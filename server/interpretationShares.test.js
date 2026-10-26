const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerShareRoutes } = require('./interpretationShares');

function setup() {
  const routes = {};
  const rows = new Map();
  const auth = () => {};
  const pool = { async execute(sql, args) {
    assert.ok(!/FROM interpretation_shares|profile|analysis_cache|ai_cache/.test(sql), 'Never read legacy/private analysis');
    if (sql.includes('FROM articles_cache') || sql.includes('FROM trials_cache') || sql.includes('FROM fda_drugs_cache')) {
      return [args[0] === 'missing' ? [] : [{ id: args[0], title: '公开标题', summary: '公开资料介绍' }]];
    }
    if (sql.startsWith('INSERT')) rows.set(args[0], { title: args[1], kind: args[2], summary: args[3], source_id: args[4] });
    return [sql.startsWith('SELECT') && rows.has(args[0]) ? [rows.get(args[0])] : []];
  } };
  const app = Object.fromEntries(['get', 'post'].map(method => [method, (path, middleware, handler) => {
    assert.equal(middleware, auth, 'Every share endpoint requires the recipient’s own authentication');
    routes[method] = handler;
  }]));
  registerShareRoutes(app, pool, auth);
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } });
  return { routes, response, rows };
}

test('all three kinds use server public data and ignore injected private content', async () => {
  const { routes, response } = setup();
  for (const kind of ['article', 'drug', 'trial']) {
    const created = response();
    await routes.post({ body: { sourceId: 'public-source', title: '私人标题', kind, summary: '患者12岁，射血分数40%，个性化建议', profile: { private: true }, chatHistory: ['private'] } }, created);
    assert.equal(created.code, 201);
    assert.match(created.body.id, /^[a-f0-9]{32}$/);
    const fetched = response();
    await routes.get({ params: { id: created.body.id } }, fetched);
    assert.equal(fetched.body.kind, kind);
    assert.equal(fetched.body.item.id, 'public-source');
    assert.equal(fetched.body.item.title, '公开标题');
    assert.ok(!JSON.stringify(fetched.body).includes('私人'));
    assert.equal(fetched.body.profile, undefined);
  }
});

test('invalid payloads and missing shares return actionable errors', async () => {
  const { routes, response } = setup();
  for (const body of [{}, { title: 'x', kind: 'other', summary: 'x' }, { sourceId: 'x'.repeat(256), kind: 'article' }, { title: '旧版个人解读', kind: 'article', summary: '私人信息' }]) {
    const res = response(); await routes.post({ body }, res); assert.equal(res.code, 400);
  }
  const missing = response();
  await routes.post({ body: { kind: 'article', sourceId: 'missing' } }, missing);
  assert.equal(missing.code, 404);
  for (const id of ['invalid', 'a'.repeat(32)]) {
    const res = response(); await routes.get({ params: { id } }, res); assert.equal(res.code, 404);
  }
});

test('legacy shares without a source ID cannot open a personal snapshot', async () => {
  const { routes, response, rows } = setup();
  const id = 'b'.repeat(32);
  rows.set(id, { title: 'old', kind: 'article', summary: 'private legacy text' });
  const res = response(); await routes.get({ params: { id } }, res);
  assert.equal(res.code, 410); assert.ok(!JSON.stringify(res.body).includes('private legacy text'));
});
