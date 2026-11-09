const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness({ email = null, affectedRows = 1, duplicate = false, verified = true } = {}) {
  const handlers = {};
  const calls = [];
  const source = fs.readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');
  const start = source.indexOf("app.post('/api/email/send-code'");
  const end = source.indexOf('// 检查用户邮箱绑定状态', start);
  vm.runInNewContext(source.slice(start, end), {
    app: { post(url, _auth, handler) { handlers[url] = handler; } }, authenticateToken() {},
    pool: { async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT email')) return [[{ email, is_active: 1 }]];
      if (sql.startsWith('SELECT id')) return [[]];
      if (duplicate) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      return [{ affectedRows }];
    } },
    sendVerificationCode: async () => ({ success: true, message: 'sent' }),
    verifyCode: () => ({ success: verified, email: 'verified@example.com', message: 'invalid' }),
    console: { log() {}, error() {} }
  });
  return { calls, async call(url, body) {
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
    await handlers[url]({ body, user: { userId: 7 } }, res);
    return res;
  } };
}
test('bound email cannot request a replacement binding code', async () => {
  const h = harness({ email: 'existing@example.com' });
  assert.equal((await h.call('/api/email/send-code', { email: 'new@example.com' })).statusCode, 409);
});
test('invalid verification code never writes an email', async () => {
  const h = harness({ verified: false });
  assert.equal((await h.call('/api/email/verify', { code: '123456' })).statusCode, 400);
  assert.equal(h.calls.length, 0);
});
test('successful binding uses only the verified address and guards empty email atomically', async () => {
  const h = harness();
  assert.equal((await h.call('/api/email/verify', { code: '123456', email: 'unverified@example.com' })).statusCode, 200);
  assert.equal(h.calls[0].params[0], 'verified@example.com');
  assert.match(h.calls[0].sql, /email IS NULL OR email = ''/);
});
test('concurrent binding and another account owning the email return conflicts', async () => {
  for (const config of [{ affectedRows: 0 }, { duplicate: true }]) {
    const h = harness(config);
    assert.equal((await h.call('/api/email/verify', { code: '123456' })).statusCode, 409);
  }
});
