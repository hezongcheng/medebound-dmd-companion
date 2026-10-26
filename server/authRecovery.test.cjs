const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function clientHarness(status, body) {
  const storage = new Map([['hanzhi_auth_token', 'old-session'], ['hanzhi_current_user', 'user']]);
  const state = { reloads: 0 };
  const source = fs.readFileSync(path.join(__dirname, '../services/apiClient.ts'), 'utf8')
    .replace(/const API_BASE = .*;/, "const API_BASE = 'https://example.test';");
  const context = {
    exports: {}, console: { warn() {}, error() {} },
    localStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
    sessionStorage: { clear() {} }, window: { location: { reload() { state.reloads++; } } },
    fetch: async () => new Response(JSON.stringify(body), { status })
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), context);
  return { client: context.exports, storage, state };
}

test('401 and legacy JWT 403 clear stale login and return to login', async () => {
  for (const [status, body] of [[401, { error: '令牌无效或已过期' }], [403, { error: '令牌无效或已过期' }], [403, { message: 'jwt expired' }]]) {
    const h = clientHarness(status, body);
    assert.equal(await h.client.apiGet('/api/user/email-status', { throwOnHttpError: true }), null);
    assert.equal(h.storage.size, 0);
    assert.equal(h.state.reloads, 1);
  }
});

test('permission 403 does not log user out; server failures preserve diagnostic details', async () => {
  for (const [status, error] of [[403, '没有权限'], [500, '服务器错误'], [404, '用户不存在']]) {
    const h = clientHarness(status, { error });
    await assert.rejects(h.client.apiGet('/api/user/email-status', { throwOnHttpError: true }), new RegExp(`${error}.*${status}`));
    assert.equal(h.state.reloads, 0);
    assert.equal(h.storage.size, 2);
  }
});

test('bound and unbound statuses remain distinct', async () => {
  for (const bound of [true, false]) {
    const h = clientHarness(200, { bound, email: bound ? 'ab***@example.test' : null });
    assert.equal((await h.client.apiGet('/api/user/email-status')).bound, bound);
    assert.equal(h.state.reloads, 0);
  }
});

test('email status retries transient failures and propagates persistent failures', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
  const start = source.indexOf('  const resolveEmailBoundStatus = async');
  const end = source.indexOf('  const fetchUserDataWithRetry', start);
  let calls = 0;
  const ctx = { isAuthenticated: () => true, sleep: async () => {},
    checkEmailStatus: async () => { if (++calls === 1) throw new Error('服务暂不可用'); return { bound: true }; } };
  vm.createContext(ctx);
  const resolve = vm.runInContext(ts.transpile(`(function() { ${source.slice(start, end)} return resolveEmailBoundStatus; })()`, { target: ts.ScriptTarget.ES2022 }), ctx);
  assert.equal(await resolve(), true);
  assert.equal(calls, 2);
  ctx.checkEmailStatus = async () => { throw new Error('服务器错误 (HTTP 500)'); };
  await assert.rejects(resolve(), /HTTP 500/);
  ctx.checkEmailStatus = async () => null;
  ctx.isAuthenticated = () => false;
  assert.equal(await resolve(), null);
});
