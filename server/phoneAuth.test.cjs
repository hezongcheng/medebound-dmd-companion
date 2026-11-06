const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizePhone, codeHash } = require('./smsService');

function harness() {
  const state = { users: [], challenge: null, sent: [], buckets: new Map(), commits: 0, releases: 0 };
  const connection = {
    async execute(sql, args = []) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) { state.releases++; return [[]]; }
      if (sql.startsWith('DELETE FROM sms_rate_limits')) return [[]];
      if (sql.startsWith('INSERT INTO sms_rate_limits')) {
        state.buckets.set(args[0], (state.buckets.get(args[0]) || 0) + 1); return [[]];
      }
      if (sql.startsWith('SELECT hits')) return [[{ hits: state.buckets.get(args[0]) }]];
      if (sql.startsWith('DELETE FROM sms_challenges')) { state.challenge = null; return [[]]; }
      if (sql.startsWith('INSERT INTO sms_challenges')) {
        state.challenge = { scope: args[0], code_hash: args[4], valid: 1, attempts: 0, consumed: 0 }; return [[]];
      }
      if (sql.includes('FROM sms_challenges')) return [[state.challenge].filter(Boolean)];
      if (sql.includes('SET attempts')) { state.challenge.attempts++; return [[]]; }
      if (sql.includes('SET consumed')) { state.challenge.consumed = 1; return [[]]; }
      if (sql.includes('FROM users WHERE phone')) return [state.users.filter(u => u.phone === args[0])];
      if (sql.includes('FROM users WHERE id')) return [state.users.filter(u => u.id === args[0])];
      if (sql.startsWith('INSERT INTO users')) {
        const user = { id: state.users.length + 1, username: args[0], phone: args[1], is_active: 1, email: null };
        state.users.push(user); return [{ insertId: user.id }];
      }
      if (sql.includes('SET phone =')) { state.users.find(u => u.id === args[1]).phone = args[0]; return [[]]; }
      if (sql.includes('SET last_login_at')) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async beginTransaction() {}, async commit() { state.commits++; }, async rollback() {}, release() {}
  };
  const routes = {};
  const app = { post(url, ...handlers) { routes[url] = handlers.at(-1); }, get(url, ...handlers) { routes[url] = handlers.at(-1); } };
  const context = { module: { exports: {} }, require(name) {
    if (name === './smsService') return { normalizePhone, codeHash, sendSms: async (phone, code) => state.sent.push({ phone, code }) };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'phoneAuth.js'), 'utf8'), context);
  context.module.exports.registerPhoneAuth(app, { pool: { getConnection: async () => connection, execute: connection.execute },
    authenticateToken() {}, secret: crypto.randomBytes(32).toString('hex'), recordLogin: async () => {} });
  return { state, async call(url, body = {}, userId = 9) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await routes[url]({ body, ip: '127.0.0.1', user: { userId } }, res); return res;
  } };
}
test('phone normalization accepts mainland numbers and rejects malformed inputs', () => {
  assert.equal(normalizePhone(' +8613800138000 '), '13800138000');
  for (const value of ['123', 'user@test.com', null, {}, '13800138000x']) assert.throws(() => normalizePhone(value));
});
test('verified new phone creates one account with nullable email and consumes code', async () => {
  const h = harness(); const phone = '13800138000';
  assert.equal((await h.call('/api/auth/phone/send-code', { phone })).statusCode, 200);
  const code = h.state.sent[0].code;
  assert.match(code, /^\d{6}$/);
  assert.notEqual(h.state.challenge.code_hash, code);
  const login = await h.call('/api/auth/phone/verify-code', { phone, code });
  assert.equal(login.statusCode, 200); assert.ok(login.body.token);
  assert.equal(h.state.users.length, 1); assert.equal(h.state.users[0].email, null);
  assert.equal((await h.call('/api/auth/phone/verify-code', { phone, code })).statusCode, 400);
  assert.equal(h.state.users.length, 1);
});
test('existing phone logs into the same account; disabled accounts cannot log in', async () => {
  for (const is_active of [1, 0]) {
    const h = harness(); const phone = '13800138000';
    h.state.users.push({ id: 7, username: 'original', phone, email: 'old@example.com', is_active });
    await h.call('/api/auth/phone/send-code', { phone });
    const res = await h.call('/api/auth/phone/verify-code', { phone, code: h.state.sent[0].code });
    assert.equal(res.statusCode, is_active ? 200 : 403);
    if (is_active) assert.equal(res.body.username, 'original');
    assert.equal(h.state.users.length, 1); assert.equal(h.state.users[0].email, 'old@example.com');
  }
});
test('wrong codes lock out after five attempts; expiry and purpose isolation are enforced', async () => {
  const h = harness(); const phone = '13800138000';
  await h.call('/api/auth/phone/send-code', { phone });
  const code = h.state.sent[0].code;
  for (let i = 0; i < 5; i++) assert.equal((await h.call('/api/auth/phone/verify-code', { phone, code: '000000' })).statusCode, 400);
  assert.equal((await h.call('/api/auth/phone/verify-code', { phone, code })).statusCode, 400);
  h.state.challenge.attempts = 0; h.state.challenge.valid = 0;
  assert.equal((await h.call('/api/auth/phone/verify-code', { phone, code })).statusCode, 400);
  h.state.challenge.valid = 1;
  assert.equal((await h.call('/api/phone/verify', { phone, code })).statusCode, 400);
});
test('binding preserves email and user identity; other owners are rejected', async () => {
  const h = harness(); const phone = '13800138000';
  h.state.users.push({ id: 9, username: 'wechat', email: 'keep@example.com', is_active: 1 });
  assert.equal((await h.call('/api/phone/send-code', { phone })).statusCode, 200);
  assert.equal((await h.call('/api/phone/verify', { phone, code: h.state.sent[0].code })).statusCode, 200);
  assert.equal(h.state.users[0].email, 'keep@example.com'); assert.equal(h.state.users[0].phone, phone);
  h.state.users.push({ id: 10, is_active: 1 });
  assert.equal((await h.call('/api/phone/send-code', { phone }, 10)).statusCode, 409);
});
test('server cooldown prevents repeat sends', async () => {
  const h = harness(); const phone = '13800138000';
  await h.call('/api/auth/phone/send-code', { phone });
  assert.equal((await h.call('/api/auth/phone/send-code', { phone })).statusCode, 429);
  assert.equal(h.state.sent.length, 1);
});
