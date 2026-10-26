const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOperationLogService, contentForOperation } = require('./operationLogService');

test('records only bounded operation metadata using SQL parameters', async () => {
  const calls = [];
  const service = createOperationLogService({ async execute(sql, params) { calls.push({ sql, params }); } });
  await service.record({ userId: 7, action: 'ai_chat', contentType: 'article', contentId: '123', contentTitle: 'A'.repeat(520), messageCount: 1 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO user_operation_logs/);
  assert.deepEqual(calls[0].params.slice(0, 4), [7, 'ai_chat', 'article', '123']);
  assert.equal(calls[0].params[4].length, 500);
  assert.equal(calls[0].params[5], 1);
  assert.equal(JSON.stringify(calls).includes('患者资料'), false);
  await assert.rejects(service.record({ userId: 0, action: 'ai_chat' }));
  await assert.rejects(service.record({ userId: 7, action: 'unknown' }));
  assert.equal(calls.length, 1);
});

test('logging failure is reported without failing the user operation', async () => {
  const service = createOperationLogService({ async execute() { throw new Error('database unavailable'); } });
  const originalError = console.error;
  let errorLogged = false;
  console.error = () => { errorLogged = true; };
  try { await service.recordSafely({ userId: 7, action: 'login' }); }
  finally { console.error = originalError; }
  assert.equal(errorLogged, true);
});

test('maps AI content to the same content IDs used by operation reports', () => {
  assert.deepEqual(contentForOperation('article', { article: { id: '41548716', title: '文献标题' } }), { contentType: 'article', contentId: '41548716', contentTitle: '文献标题' });
  assert.deepEqual(contentForOperation('drug', { drug: { brandName: 'Elevidys' } }), { contentType: 'drug', contentId: 'Elevidys', contentTitle: 'Elevidys' });
  assert.deepEqual(contentForOperation('trial', { trial: { nctId: 'NCT12345678', title: '试验标题' } }), { contentType: 'trial', contentId: 'NCT12345678', contentTitle: '试验标题' });
});
