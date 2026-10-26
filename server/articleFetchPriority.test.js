const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { selectArticleCandidates, PUBMED_PREFERRED_FILTER, EUROPE_PMC_PREFERRED_FILTER } = require('./articleFetchPriority');

test('临床及应用相关候选占32个名额，早期研究保留8个名额，并去重', () => {
  const preferred = Array.from({ length: 50 }, (_, i) => `clinical${i}`);
  const general = Array.from({ length: 30 }, (_, i) => `early${i}`);
  const selected = selectArticleCandidates([...preferred, preferred[0]], [...preferred, ...general]);
  assert.equal(selected.length, 40);
  assert.equal(selected.filter(id => id.startsWith('clinical')).length, 32);
  assert.equal(selected.filter(id => id.startsWith('early')).length, 8);
  assert.equal(new Set(selected).size, 40);
});

test('候选不足时互相补足，不凭空增加文章', () => {
  const ids = Array.from({ length: 60 }, (_, i) => String(i));
  assert.equal(selectArticleCandidates([], ids).length, 40);
  assert.equal(selectArticleCandidates(ids, []).length, 40);
  assert.deepEqual(selectArticleCandidates(['1'], ['1', '2']), ['1', '2']);
  assert.deepEqual(selectArticleCandidates([], []), []);
  assert.equal(selectArticleCandidates([{ id: '1' }], [{ id: '1' }, { id: '2' }], item => item.id).length, 2);
});

function serviceHarness({ failPreferred = false, cachedIds = [] } = {}) {
  const requests = [];
  const savedIds = [];
  const general = Array.from({ length: 60 }, (_, i) => String(i + 1));
  const preferred = Array.from({ length: 60 }, (_, i) => String(i + 101));
  const axios = { async get(url, config) {
    requests.push({ url, params: config.params });
    if (url.endsWith('efetch.fcgi')) return { data: '<PubmedArticleSet></PubmedArticleSet>' };
    const priority = (config.params.term || config.params.query).includes('Clinical Trial');
    if (priority && failPreferred) throw Object.assign(new Error('bad filter'), { response: { status: 400 } });
    const ids = priority ? preferred : general;
    if (url.endsWith('esearch.fcgi')) return { data: { esearchresult: { count: '60', idlist: ids } } };
    return { data: { hitCount: ids.length, resultList: { result: ids.map(id => ({ id, pmid: id, source: 'MED', title: 'DMD study', abstractText: 'Patient outcomes' })) } } };
  } };
  const pool = { async query() {
    return [cachedIds.map(id => ({ id, title_zh: '标题', abstract: 'Abstract', abstract_zh: '摘要' }))];
  }, async execute(sql, params) {
    if (sql.includes('INSERT INTO')) savedIds.push(params[0]);
    return [[]];
  } };
  const context = { module: { exports: {} }, process: { env: {} }, console: { log() {}, warn() {}, error() {} },
    setTimeout: fn => { fn(); }, require(name) {
      if (name === 'axios') return axios;
      if (name === './db') return { pool };
      if (name === './youdaoTranslateService') return { translateArticle: async () => ({ titleZh: '标题', abstractZh: '摘要' }) };
      if (name === './geminiService') return { callGeminiAPI: async () => null };
      if (name === 'dotenv') return { config() {} };
      if (name === './articleFetchPriority') return require(name);
      if (name === 'crypto') return require(name);
      return {};
    } };
  vm.createContext(context);
  const source = fs.readFileSync(require('node:path').join(__dirname, 'articleFetchService.js'), 'utf8');
  vm.runInContext(`${source}\nmodule.exports.fetchForTest = runPubmedArticleFetch; module.exports.europeForTest = runEuropePmcArticleFetch;`, context);
  return { service: context.module.exports, requests, general, preferred, savedIds };
}

test('PubMed实际抓取在排除完整缓存后选取32篇优先候选与8篇常规候选', async () => {
  const h = serviceHarness({ cachedIds: ['101', '1'] });
  await h.service.fetchForTest();
  const searches = h.requests.filter(r => r.url.endsWith('esearch.fcgi'));
  assert.equal(searches.length, 2);
  assert.ok(searches[1].params.term.includes(PUBMED_PREFERRED_FILTER));
  const ids = h.requests.find(r => r.url.endsWith('efetch.fcgi')).params.id.split(',');
  assert.equal(ids.length, 40);
  assert.equal(ids.filter(id => Number(id) > 100).length, 32);
  assert.ok(!ids.includes('101') && !ids.includes('1'));
});

test('PubMed优先检索失败仍继续40篇常规抓取', async () => {
  const h = serviceHarness({ failPreferred: true });
  await h.service.fetchForTest();
  const ids = h.requests.find(r => r.url.endsWith('efetch.fcgi')).params.id.split(',');
  assert.deepEqual(ids, h.general.slice(0, 40));
});

test('Europe PMC备用源同样进行优先检索，并跳过完整缓存', async () => {
  const h = serviceHarness({ cachedIds: Array.from({ length: 200 }, (_, i) => String(i + 1)) });
  assert.equal(await h.service.europeForTest(new Error('offline')), 0);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests[1].params.query.includes(EUROPE_PMC_PREFERRED_FILTER));
});

test('Europe PMC实际入库同样选取32篇优先候选与8篇常规候选', async () => {
  const h = serviceHarness({ cachedIds: ['101', '1'] });
  assert.equal(await h.service.europeForTest(new Error('offline')), 40);
  assert.equal(h.savedIds.filter(id => Number(id) > 100).length, 32);
  assert.equal(h.savedIds.filter(id => Number(id) < 100).length, 8);
  assert.ok(!h.savedIds.includes('101') && !h.savedIds.includes('1'));
});
