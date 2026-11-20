const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerDietRecordRoutes } = require('./dietRecords');

const date = '2026-11-20';
const entry = {
  key: 'rice-1', foodId: 1, name: '米饭', grams: 120, isLiquid: false, servingGrams: 100,
  per100: { calories: 116, protein: 2.6, carbs: 25.9, fat: 0.3, fiber: 0.3, sodium: 2.5, calcium: 7 },
  servings: [{ description: '100 克', weightG: 100 }]
};

function setup() {
  const routes = {};
  const rows = new Map();
  const authenticate = () => {};
  const app = {
    get(path, middleware, handler) {
      assert.equal(middleware, authenticate);
      routes.get = handler;
    },
    put(path, middleware, handler) {
      assert.equal(middleware, authenticate);
      routes.put = handler;
    }
  };
  const pool = {
    async execute(sql, args) {
      if (sql.startsWith('INSERT')) {
        const [userId, day, entries] = args;
        const key = `${userId}:${day}`;
        if (rows.has(key)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        rows.set(key, { userId, date: day, entries, version: 1 });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE')) {
        const [entries, userId, day, version] = args;
        const row = rows.get(`${userId}:${day}`);
        if (!row || row.version !== version) return [{ affectedRows: 0 }];
        rows.set(`${userId}:${day}`, { ...row, entries, version: version + 1 });
        return [{ affectedRows: 1 }];
      }
      const [userId, from, to = from] = args;
      return [[...rows.values()].filter(row => row.userId === userId && row.date >= from && row.date <= to)];
    }
  };
  registerDietRecordRoutes(app, pool, authenticate);

  const call = async (method, userId, options) => {
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      set() { return this; },
      json(body) { this.body = body; return this; }
    };
    await routes[method]({ user: { userId }, ...options }, res);
    return res;
  };
  return {
    put: (userId, version, entries, day = date) => call('put', userId, {
      params: { date: day }, body: { userId: 999, version, entries }
    }),
    get: (userId, from = date, to = date) => call('get', userId, { query: { from, to, userId: 999 } })
  };
}

test('stores food snapshots per account and date, with portion changes and removal', async () => {
  const { get, put } = setup();
  assert.deepEqual((await put(1, 0, [entry])).body.day, { date, version: 1, entries: [entry] });
  assert.deepEqual((await get(2)).body.days, []);
  assert.deepEqual((await get(999)).body.days, []);
  assert.deepEqual((await get(1, '2026-11-18', '2026-11-19')).body.days, []);
  const updated = { ...entry, grams: 180 };
  assert.equal((await put(1, 1, [updated])).body.saved, true);
  assert.deepEqual((await get(1)).body.days[0].entries, [updated]);
  assert.equal((await put(1, 2, [])).body.saved, true);
  assert.deepEqual((await get(1)).body.days[0].entries, []);
});

test('only one concurrent edit wins and legacy import cannot recreate a cleared day', async () => {
  const { put } = setup();
  const a = { ...entry, grams: 80 };
  const b = { ...entry, grams: 95 };
  const created = await Promise.all([put(1, 0, [a]), put(1, 0, [b])]);
  assert.equal(created.filter(result => result.body.saved).length, 1);
  assert.deepEqual(created[0].body.day, created[1].body.day);
  const cleared = await put(1, 1, []);
  for (const version of [0, 1]) {
    const conflict = await put(1, version, [b]);
    assert.deepEqual(conflict.body, { saved: false, day: cleared.body.day });
  }
});

test('rejects invalid dates, date ranges and invalid entries before saving', async () => {
  const { get, put } = setup();
  assert.equal((await get(1, '2026-01-01', date)).code, 400);
  assert.equal((await put(1, 0, [entry], '2026-02-30')).code, 400);
  assert.equal((await put(1, 0, [{ ...entry, grams: -50 }])).code, 400);
  assert.equal((await put(1, 0, [entry, entry])).code, 400);
  assert.deepEqual((await get(1)).body.days, []);
});
