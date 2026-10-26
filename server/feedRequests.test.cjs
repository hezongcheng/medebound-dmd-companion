const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../App.tsx'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const load = extract('  const loadFeedArticles = async', '  const navigateToView');
const more = extract('  const handleLoadMore = async', '  const handleFetchByDoi');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('默认推荐保留穿插顺序，同时为每张卡片计算患者相关性', async () => {
  const { recommendArticles } = await import('../utils/contentPreference.mjs');
  const articles = Array.from({ length: 30 }, (_, i) => ({ id: String(i),
    publicationDate: '2026-10-15', researchStage: i < 20 ? '人体临床数据' : '动物实验' }));
  const profile = { contentPreference: 40 };
  const ctx = { recommendArticles, computeRelevance: (article, actualProfile) => {
    assert.equal(actualProfile, profile);
    return 30 + Number(article.id);
  } };
  vm.createContext(ctx);
  const sort = vm.runInContext(ts.transpile(`${extract('const sortArticlesByKey = (', 'const App: React.FC')}\nsortArticlesByKey;`, { target: ts.ScriptTarget.ES2022 }), ctx);
  const result = sort(articles, 'recommend', profile);
  assert.deepEqual(result.map(a => a.id), recommendArticles(articles, 40).map(a => a.id));
  for (const article of result) assert.equal(article.matchPercent, 30 + Number(article.id));
  assert.equal(articles[0].matchPercent, undefined);
});
function harness() {
  const state = { articles: [], loadingFeed: false, currentPage: 1, hasMoreArticles: true };
  const ctx = {
    console, feedKey: 'old', feedKeyRef: { current: 'old' }, feedRequestRef: { current: 0 },
    feedBusyRef: { current: false }, moreRequestRef: { current: null }, currentView: 'feed', feedTab: 'latest',
    FEED_PAGE_SIZE: 2, articleSortKey: 'time', selectedTagFilter: 'all', userData: {},
    userInterests: [], searchKeyword: 'old', sortedPool: null,
    getArticlesCount: async () => 10, getHotArticles: async () => [],
  };
  for (const name of ['articles', 'loadingFeed', 'currentPage', 'hasMoreArticles', 'isLoadingMore', 'totalArticles', 'hotArticles', 'sortedPool']) {
    Object.defineProperty(ctx, name, { get: () => state[name], configurable: true });
    ctx['set' + name[0].toUpperCase() + name.slice(1)] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  }
  vm.createContext(ctx);
  // 每次渲染创建独立闭包，同时共享 refs 和状态 setters。
  function render(key) {
    ctx.feedKey = key; ctx.feedKeyRef.current = key; ctx.searchKeyword = key;
    const code = `(function(feedKey, searchKeyword) { ${load}\n${more}\nreturn {loadFeedArticles, handleLoadMore}; })(feedKey, searchKeyword)`;
    return vm.runInContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), ctx);
  }
  return { state, ctx, render };
}
test('旧搜索晚返回不能覆盖新搜索，也不能提前结束新请求的加载状态', async () => {
  const h = harness(); const old = deferred(); const fresh = deferred();
  h.ctx.searchArticles = (...args) => args[2] === 'old' ? old.promise : fresh.promise;
  const oldRun = h.render('old').loadFeedArticles([], 'old');
  await new Promise(setImmediate);
  const newRun = h.render('new').loadFeedArticles([], 'new');
  await new Promise(setImmediate);
  old.resolve([{ id: 'wrong' }]); await oldRun;
  assert.equal(h.state.loadingFeed, true);
  fresh.resolve([{ id: 'target' }]); await newRun;
  assert.equal(h.state.articles[0].id, 'target');
  assert.equal(h.state.loadingFeed, false);
});
test('旧翻页不能追加到新搜索，同步重复滚动只发一次请求', async () => {
  const h = harness(); const page = deferred(); let calls = 0;
  h.ctx.searchArticles = () => { calls++; return page.promise; };
  const oldRender = h.render('old');
  const pending = oldRender.handleLoadMore();
  await oldRender.handleLoadMore();
  assert.equal(calls, 1);
  h.ctx.searchArticles = async () => [{ id: 'target' }];
  await h.render('new').loadFeedArticles([], 'new');
  page.resolve([{ id: 'wrong' }]); await pending;
  assert.equal(h.state.articles.length, 1);
  assert.equal(h.state.articles[0].id, 'target');
  await oldRender.loadFeedArticles([], 'old');
  assert.equal(h.state.articles[0].id, 'target');
});

test('推荐排序使用完整候选池和已保存偏好，翻页保持已展示顺序', async () => {
  const h = harness();
  h.ctx.articleSortKey = 'recommend';
  h.ctx.userData = { profile: { contentPreference: 75 } };
  const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const ranked = [candidates[1], candidates[3], candidates[0], candidates[2]];
  h.ctx.fetchAllFeedArticles = async () => candidates;
  h.ctx.sortArticlesByKey = (articles, key, profile) => {
    assert.equal(articles, candidates);
    assert.equal(key, 'recommend');
    assert.equal(profile.contentPreference, 75);
    return ranked;
  };
  h.ctx.searchArticles = () => { throw new Error('推荐翻页不应重新请求时间分页'); };
  const render = h.render('recommended');
  await render.loadFeedArticles([], 'recommended');
  assert.deepEqual(h.state.articles.map(a => a.id), ['b', 'd']);
  await h.render('recommended').handleLoadMore();
  assert.deepEqual(h.state.articles.map(a => a.id), ['b', 'd', 'a', 'c']);
  assert.equal(h.state.hasMoreArticles, false);
});
