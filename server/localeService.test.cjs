const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { countryForIP, localeFromBrowser, validPreference, registerLocaleRoutes, localeMiddleware, localeContext, getRequestLocale } = require('./localeService');
const { createArticleAnalysisService } = require('./articleAnalysisService');

test('IP lookup supports public IPv4, mapped IPv4 and IPv6; private/invalid IPs fall back', () => {
  assert.equal(countryForIP('114.114.114.114'), 'CN');
  assert.equal(countryForIP('::ffff:8.8.8.8'), 'US');
  assert.equal(countryForIP('2001:4860:4860::8888'), 'US');
  for (const address of ['127.0.0.1', '::1', '192.168.1.1', 'not-an-ip']) assert.equal(countryForIP(address), null);
});
test('browser fallback honors quality, skips unsupported languages and defaults to English', () => {
  assert.equal(localeFromBrowser('fr-FR, en-US;q=0.8, zh-CN;q=0.9'), 'zh-CN');
  assert.equal(localeFromBrowser('zh-CN;q=0, en;q=0.4'), 'en');
  assert.equal(localeFromBrowser('zh-TW'), 'zh-CN');
  assert.equal(localeFromBrowser('ja-JP'), 'en');
  assert.equal(localeFromBrowser(''), 'en');
});
test('preference validation rejects unsupported locales and inconsistent auto settings', () => {
  assert.equal(validPreference({ mode: 'auto', locale: null }), true);
  assert.equal(validPreference({ mode: 'manual', locale: 'en' }), true);
  for (const value of [null, {}, { mode: 'auto', locale: 'en' }, { mode: 'manual', locale: 'ja' }, { mode: 'manual', locale: null }]) assert.equal(validPreference(value), false);
});
test('locale detection prioritizes IP, falls back safely, and ignores untrusted forwarded addresses', async t => {
  const app = express(); const seen = [];
  registerLocaleRoutes(app, {}, (_req, _res, next) => next(), ip => { seen.push(ip); return seen.length === 1 ? 'CN' : seen.length === 2 ? 'US' : null; });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const cn = await fetch(base + '/api/locale', { headers: { 'Accept-Language': 'en', 'X-Forwarded-For': '8.8.8.8' } });
  assert.equal((await cn.json()).locale, 'zh-CN');
  assert.match(cn.headers.get('cache-control'), /no-store/);
  const us = await fetch(base + '/api/locale', { headers: { 'Accept-Language': 'zh-CN' } });
  assert.equal((await us.json()).locale, 'en');
  const unknown = await fetch(base + '/api/locale', { headers: { 'Accept-Language': 'zh-CN' } });
  assert.deepEqual(await unknown.json(), { locale: 'zh-CN', country: null, source: 'browser' });
  assert.ok(seen.every(ip => ip === '127.0.0.1'));
});
test('account preferences are isolated, persist manual/auto, validate writes and fail explicitly', async t => {
  const stored = new Map(); let offline = false;
  const pool = { execute: async (sql, parameters) => {
    if (offline) throw new Error('offline');
    if (sql.startsWith('SELECT')) return [[stored.get(parameters[0])].filter(Boolean)];
    stored.set(parameters[0], { language_mode: parameters[1], preferred_locale: parameters[2] }); return [{}];
  } };
  const app = express(); app.use(express.json());
  registerLocaleRoutes(app, pool, (req, res, next) => {
    if (!req.headers['x-test-user']) return res.sendStatus(401);
    req.user = { userId: req.headers['x-test-user'] }; next();
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/user/language`;
  assert.equal((await fetch(base)).status, 401);
  const write = value => fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Test-User': 'a' }, body: JSON.stringify(value) });
  assert.equal((await write({ mode: 'manual', locale: 'fr' })).status, 400);
  assert.equal((await write({ mode: 'manual', locale: 'en' })).status, 200);
  assert.deepEqual(await (await fetch(base, { headers: { 'X-Test-User': 'a' } })).json(), { preference: { mode: 'manual', locale: 'en' } });
  assert.deepEqual(await (await fetch(base, { headers: { 'X-Test-User': 'b' } })).json(), { preference: null });
  await write({ mode: 'auto', locale: null }); assert.equal(stored.get('a').preferred_locale, null);
  offline = true; assert.equal((await write({ mode: 'manual', locale: 'en' })).status, 503);
});
test('concurrent requests retain their own locale across async work', async () => {
  const values = await Promise.all(['zh-CN', 'en'].map(locale => localeContext.run({ locale }, async () => {
    await new Promise(resolve => setTimeout(resolve, locale === 'en' ? 1 : 5)); return getRequestLocale();
  })));
  assert.deepEqual(values, ['zh-CN', 'en']);
});
test('article public/personal caches separate languages and deduplicate same-language requests', async () => {
  const pub = new Map(), personal = new Map(); let calls = 0;
  const db = { execute: async (sql, p) => {
    if (sql.includes('FROM articles_cache')) return [[{ id: p[0], title: 'Study', abstract: 'Abstract' }]];
    if (sql.startsWith('INSERT IGNORE INTO article_public')) { pub.set(p.slice(0, 2).join('|'), { quickConclusion: p[2], detailedReading: p[3] }); return [{}]; }
    if (sql.startsWith('INSERT IGNORE INTO article_personal')) { personal.set(p.slice(0, 4).join('|'), { personalizedMeaning: p[4], familyTakeaway: p[5] }); return [{}]; }
    if (sql.includes('FROM article_public')) return [[pub.get(p.join('|'))].filter(Boolean)];
    if (sql.includes('FROM article_personal')) return [[personal.get(p.join('|'))].filter(Boolean)];
    throw new Error(sql);
  } };
  const service = createArticleAnalysisService(db, {
    public: async () => { calls++; await new Promise(r => setTimeout(r, 2)); return { quickConclusion: getRequestLocale(), detailedReading: getRequestLocale() }; },
    personal: async () => ({ personalizedMeaning: getRequestLocale(), familyTakeaway: getRequestLocale() })
  });
  const run = locale => localeContext.run({ locale }, () => service.analyze('one', { age: 8 }, 1));
  const [zh, en] = await Promise.all([run('zh-CN'), run('en')]);
  assert.match(zh.text, /快速结论/); assert.match(en.text, /Quick conclusion/);
  assert.doesNotMatch(en.text, /zh-CN/); assert.equal(calls, 2);
  assert.equal((await run('en')).cached, true); assert.equal(calls, 2);
});
