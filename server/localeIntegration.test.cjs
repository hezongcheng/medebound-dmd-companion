const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { localeContext, localeMiddleware, localizeMessage } = require('./localeService');

function load(file, overrides) {
  const filename = path.join(__dirname, file);
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: name => overrides[name] || originalRequire(name),
    console: { log() {}, warn() {}, error() {} }, process, Buffer, URL, setTimeout, clearTimeout, setInterval() {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
}
test('English verification email preserves the code, expiry and security instructions without sending mail', () => {
  const email = load('emailService.js', { nodemailer: { createTransport() { throw new Error('Mail must not be sent'); } } });
  const parameters = { subtitle: '安全登录验证', intro: '您正在登录罕知 DMD 研究助手，请使用以下验证码完成登录：', code: '123456', tip: '如非本人操作，请忽略此邮件。为了您的账户安全，请勿将验证码透露给他人。' };
  const en = localeContext.run({ locale: 'en' }, () => email.buildAuthEmailHtml(parameters));
  const zh = localeContext.run({ locale: 'zh-CN' }, () => email.buildAuthEmailHtml(parameters));
  assert.match(en, /lang="en"/); assert.match(en, /123456/); assert.match(en, /10 minutes/);
  assert.match(en, /never share the code/); assert.doesNotMatch(en, /[\u3400-\u9fff]/);
  assert.match(zh, /安全登录验证/); assert.match(zh, /123456/);
});
test('English model requests override Chinese prose instructions while preserving protocol keys and evidence', async () => {
  const bodies = [];
  const https = { request(_options, callback) {
    const request = new EventEmitter(); let body = '';
    request.write = data => { body += data; };
    request.setTimeout = () => {}; request.destroy = () => {};
    request.end = () => {
      bodies.push(JSON.parse(body));
      const response = new EventEmitter(); response.statusCode = 200; response.headers = { 'content-type': 'application/json' };
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Answer' }] } }] })));
      response.emit('end');
    };
    return request;
  } };
  const service = load('geminiService.js', { https });
  const contents = [{ parts: [{ text: '请使用简体中文输出 JSON。' }] }];
  await localeContext.run({ locale: 'en' }, () => service.callGeminiAPI(contents));
  await localeContext.run({ locale: 'zh-CN' }, () => service.callGeminiAPI(contents));
  const instruction = bodies[0].contents[0].parts.at(-1).text;
  assert.match(instruction, /Write all human-readable/); assert.match(instruction, /Preserve all JSON field names/);
  assert.match(instruction, /verbatim source quotes/);
  assert.equal(bodies[1].contents[0].parts.length, 1); assert.equal(contents[0].parts.length, 1);
});
test('error localization preserves status and stable error codes without rewriting clinical payloads', () => {
  let response;
  const res = { statusCode: 400, set() {}, json(value) { response = value; return this; } };
  const clinical = { title: '原始医学资料', age: 8 };
  localeMiddleware({ headers: { 'x-app-locale': 'en' } }, res, () => res.json({ error: '请输入有效的邮箱地址', item: clinical }));
  assert.equal(response.error, 'Enter a valid email address');
  assert.equal(response.code, 'REQUEST_FAILED'); assert.equal(response.item, clinical);
  assert.equal(localizeMessage('服务器错误', 'zh-CN'), '服务器错误');
});
