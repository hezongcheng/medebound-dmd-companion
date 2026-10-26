const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runArticleDrugBackfill } = require('./articleDrugBackfill');

function fakeDb(missing, lock = 1) {
  const calls = [];
  const connection = {
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: lock }]];
      if (sql.includes('COUNT(*)')) return [[{ missing }]];
      return [[]];
    },
    release() { calls.push('release'); }
  };
  return { calls, async getConnection() { return connection; } };
}

test('startup skips extraction when every article was already checked', async () => {
  const db = fakeDb(0);
  let batches = 0;
  const result = await runArticleDrugBackfill({ db, async processBatch() { batches++; } });
  assert.equal(result.updated, 0);
  assert.equal(batches, 0);
  assert.ok(db.calls.some(call => call.includes('RELEASE_LOCK')));
});

test('startup processes missing articles with a moving cursor', async () => {
  const db = fakeDb(3);
  const cursors = [];
  const result = await runArticleDrugBackfill({ db, async processBatch(_limit, cursor) {
    cursors.push(cursor);
    return cursor ? { selected: 0, updated: 0, failed: 0, lastId: cursor }
      : { selected: 3, updated: 2, failed: 1, lastId: '42770351' };
  } });
  assert.deepEqual(cursors, ['', '42770351']);
  assert.equal(result.updated, 2);
  assert.equal(result.failed, 1);
});

test('a second instance does not duplicate the AI work', async () => {
  const db = fakeDb(3, 0);
  let batches = 0;
  const result = await runArticleDrugBackfill({ db, async processBatch() { batches++; } });
  assert.equal(result.skipped, '另一个实例正在回填');
  assert.equal(batches, 0);
});
