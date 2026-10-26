const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('bundled server catalogs match the frontend catalogs', () => {
  for (const locale of ['zh-CN', 'en']) {
    assert.deepEqual(require(`./locales/${locale}.json`), require(`../i18n/locales/${locale}.json`));
  }
});

test('locale service loads from an isolated server deployment without frontend sources or dependencies', t => {
  const deployment = fs.mkdtempSync(path.join(os.tmpdir(), 'dmd-locale-deployment-'));
  t.after(() => {
    const expectedPrefix = path.join(path.resolve(os.tmpdir()), 'dmd-locale-deployment-');
    assert.ok(path.resolve(deployment).startsWith(expectedPrefix));
    fs.rmSync(deployment, { recursive: true, force: true });
  });
  const server = path.join(deployment, 'server');
  fs.mkdirSync(path.join(server, 'locales'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'localeService.js'), path.join(server, 'localeService.js'));
  for (const locale of ['zh-CN', 'en']) {
    fs.copyFileSync(path.join(__dirname, 'locales', `${locale}.json`), path.join(server, 'locales', `${locale}.json`));
  }
  assert.equal(fs.existsSync(path.join(deployment, 'i18n')), false);
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const service = require('./localeService.js');
    assert.equal(service.localizeMessage('服务器错误', 'en'), 'Server error');
    assert.equal(service.localeFromBrowser('zh-CN'), 'zh-CN');
    assert.equal(service.getRequestLocale(), 'zh-CN');
  `], { cwd: server, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
