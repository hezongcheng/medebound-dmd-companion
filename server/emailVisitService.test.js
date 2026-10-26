const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmailVisitToken, buildEmailVisitUrl, recordEmailVisit } = require('./emailVisitService');
const { buildPushEmailHtml } = require('./emailPushService');

test('mail visit records one verified platform load and one operation', async () => {
  const calls = [];
  let first = true;
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE email_push_logs')) {
        const affectedRows = first ? 1 : 0;
        first = false;
        return [{ affectedRows }];
      }
      return [{}];
    },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); }
  };
  const db = { async getConnection() { return connection; } };
  const token = createEmailVisitToken(7, '42762457');
  assert.equal(await recordEmailVisit(token, db), true);
  assert.equal(await recordEmailVisit(token, db), false);
  assert.equal(calls.filter(call => call.sql?.includes('INSERT INTO user_operation_logs')).length, 1);
  assert.equal(calls.filter(call => call === 'commit').length, 2);
  assert.equal(await recordEmailVisit(`${token}x`, db), false);
  assert.match(buildEmailVisitUrl(7, '42762457'), /email_visit=/);
  assert.match(buildPushEmailHtml({ id: 7, username: '家长' }, { id: '42762457', title: '研究' }), /email_visit=/);
});
