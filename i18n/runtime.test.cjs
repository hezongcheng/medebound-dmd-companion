const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const zh = require('./locales/zh-CN.json');
const en = require('./locales/en.json');
function runtime() {
  const context = { exports: {}, Intl, Date, require: name => name.endsWith('zh-CN.json') ? zh : name.endsWith('en.json') ? en : { DEFAULT_LOCALE: 'en' } };
  vm.createContext(context);
  vm.runInContext(ts.transpile(fs.readFileSync(path.join(__dirname, 'runtime.ts'), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }), context);
  return context.exports;
}
test('language catalogs have matching keys, parameters and nonempty translations', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries(zh)) {
    assert.ok(en[key].trim(), key);
    assert.deepEqual((value.match(/\{\w+\}/g) || []).sort(), (en[key].match(/\{\w+\}/g) || []).sort(), key);
  }
});
test('legacy enum labels translate only at display time and preserve unknown source content', () => {
  const r = runtime(); const stored = '亚洲 (Asia)';
  r.setLocale('en'); assert.equal(r.translateText(stored), 'Asia'); assert.equal(stored, '亚洲 (Asia)');
  assert.equal(r.translateText('独立行走期'), 'Independent walking');
  assert.equal(r.translateText('作者自己的原始内容'), '作者自己的原始内容');
  r.setLocale('zh-CN'); assert.equal(r.translateText(stored), stored);
});
test('dynamic labels retain interpolated values and do not interpret user input as markup', () => {
  const r = runtime(); r.setLocale('en');
  assert.equal(r.translateText('当前年龄：8 周岁，生日后自动更新'), 'Current age: 8 years. Updated automatically after each birthday.');
  assert.equal(r.translateText('早期1期'), 'Early phase 1');
  assert.equal(r.translateText('等级 2.0'), 'Level 2.0');
  assert.equal(r.translateText('药物 / 生物制品'), 'Drugs / Biological product');
  assert.equal(r.translateText('8岁'), '8 years');
});
test('original/Chinese content selection follows locale and falls back when translation is absent', () => {
  const r = runtime(); r.setLocale('en');
  assert.equal(r.contentText('Original', '中文'), 'Original');
  assert.equal(r.contentText('', '中文'), '中文');
  r.setLocale('zh-CN'); assert.equal(r.contentText('Original', '中文'), '中文');
  assert.equal(r.contentText('Original', ''), 'Original');
});
test('locale subscriptions update without remounting application state', () => {
  const r = runtime(); let changes = 0;
  const stop = r.subscribeLocale(() => changes++);
  r.setLocale('zh-CN'); r.setLocale('zh-CN'); assert.equal(changes, 1);
  stop(); r.setLocale('en'); assert.equal(changes, 1);
});
test('count labels follow the selected language plural rules', () => {
  const r = runtime(); r.setLocale('en');
  assert.equal(r.plural('counts.articles', 1), 'article');
  assert.equal(r.plural('counts.articles', 2), 'articles');
  r.setLocale('zh-CN'); assert.equal(r.plural('counts.articles', 1), '条资料');
});
