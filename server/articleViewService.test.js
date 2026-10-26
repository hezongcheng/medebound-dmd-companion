const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordArticleView, hotArticleQuery } = require('./articleViewService');

function database() {
  let stored = { pv: 0, uv: 0, visitors: new Set(), days: new Set(), dailyPv: 0 };
  let transaction;
  const db = { today: '2026-09-30', missing: false, fail: false, released: 0, rolledBack: 0 };
  const connection = {
    async beginTransaction() { transaction = structuredClone(stored); },
    async execute(sql, [articleId, userId]) {
      if (sql.includes('SET view_count')) {
        if (db.missing) return [{ affectedRows: 0 }];
        transaction.pv++;
      } else if (sql.includes('INTO article_visitors')) {
        const key = `${articleId}:${userId}`;
        if (transaction.visitors.has(key)) return [{ affectedRows: 0 }];
        transaction.visitors.add(key);
      } else if (sql.includes('SET uv_count')) {
        transaction.uv++;
      } else if (sql.includes('INTO article_daily_visitors')) {
        if (db.fail) throw new Error('write failed');
        transaction.days.add(`${articleId}:${userId}:${db.today}`);
      } else if (sql.includes('INTO article_daily_views')) {
        transaction.dailyPv++;
      } else throw new Error(`Unexpected SQL: ${sql}`);
      return [{ affectedRows: 1 }];
    },
    async commit() { stored = transaction; },
    async rollback() { db.rolledBack++; },
    release() { db.released++; }
  };
  db.getConnection = async () => connection;
  db.read = () => stored;
  return db;
}

test('repeated openings increment stored PV but only one UV per account, including across days', async () => {
  const db = database();
  await recordArticleView(db, 'A', 1);
  await recordArticleView(db, 'A', 1);
  db.today = '2026-10-01';
  await recordArticleView(db, 'A', 1);
  await recordArticleView(db, 'A', 2);
  assert.equal(db.read().pv, 4);
  assert.equal(db.read().dailyPv, 4);
  assert.equal(db.read().uv, 2);
  assert.equal(db.read().days.size, 3);
  assert.equal(db.released, 4);
});

test('UV is independent for each article; unidentified visits do not count', async () => {
  const db = database();
  assert.equal(await recordArticleView(db, 'A', undefined), false);
  assert.equal(await recordArticleView(db, 'A', '1'), false);
  await recordArticleView(db, 'A', 1);
  await recordArticleView(db, 'B', 1);
  assert.equal(db.read().visitors.size, 2);
  assert.equal(db.read().pv, 2);
});

test('missing articles and failed writes leave all UV/PV records unchanged', async () => {
  const db = database();
  db.missing = true;
  assert.equal(await recordArticleView(db, 'missing', 1), false);
  db.missing = false;
  db.fail = true;
  await assert.rejects(recordArticleView(db, 'A', 1), /write failed/);
  assert.equal(db.read().pv, 0);
  assert.equal(db.read().uv, 0);
  assert.equal(db.read().visitors.size, 0);
  assert.equal(db.rolledBack, 2);
  assert.equal(db.released, 2);
});

test('30/60 day rankings deduplicate across the entire window and never use PV', () => {
  for (const [period, interval] of [['month', 29], ['twoMonths', 59]]) {
    const query = hotArticleQuery(6, period);
    assert.ok(query.includes('COUNT(DISTINCT user_id)'));
    assert.ok(query.includes(`INTERVAL ${interval} DAY AND CURDATE()`));
    assert.ok(query.includes('ORDER BY v.uv_count DESC'));
    assert.ok(!query.includes('view_count'));
  }
  const query = hotArticleQuery('6; DROP TABLE articles_cache', 'all');
  assert.ok(query.includes('ORDER BY a.uv_count DESC'));
  assert.ok(query.endsWith('LIMIT 6'));
  assert.ok(!query.includes('view_count'));
});
