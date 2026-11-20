const DAY_MS = 86400000;
const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sodium', 'calcium'];

function dateTime(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? +date : NaN;
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 100) return null;
  const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit;
  const amount = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const keys = new Set();
  const foods = new Set();
  const result = [];
  for (const entry of entries) {
    if (!entry || !text(entry.key, 150) || !text(entry.name, 120) ||
        !(text(entry.foodId, 100) || Number.isSafeInteger(entry.foodId)) ||
        !amount(entry.grams, 1, 5000) || typeof entry.isLiquid !== 'boolean' ||
        (entry.servingGrams != null && !amount(entry.servingGrams, 1, 5000)) ||
        !Array.isArray(entry.servings) || entry.servings.length > 20 ||
        !entry.servings.every(item => item && text(item.description, 60) && amount(item.weightG, 0.01, 5000)) ||
        !NUTRIENTS.every(key => amount(entry.per100?.[key], 0, 100000)) ||
        keys.has(entry.key) || foods.has(String(entry.foodId))) return null;
    keys.add(entry.key);
    foods.add(String(entry.foodId));
    const { key, foodId, name, grams, per100, servings, isLiquid, servingGrams } = entry;
    result.push({
      key, foodId, name, grams, isLiquid, servingGrams: servingGrams ?? null,
      per100: Object.fromEntries(NUTRIENTS.map(nutrient => [nutrient, per100[nutrient]])),
      servings: servings.map(({ description, weightG }) => ({ description, weightG }))
    });
  }
  return result;
}

function toDay(row) {
  return {
    date: row.date,
    version: row.version,
    entries: typeof row.entries === 'string' ? JSON.parse(row.entries) : row.entries
  };
}

function registerDietRecordRoutes(app, pool, authenticateToken) {
  app.get('/api/diet/records', authenticateToken, async (req, res) => {
    const { from, to } = req.query;
    const span = dateTime(to) - dateTime(from);
    if (!(span >= 0 && span < 31 * DAY_MS)) return res.status(400).json({ error: '饮食记录日期范围无效' });
    try {
      const [rows] = await pool.execute(
        "SELECT DATE_FORMAT(record_date, '%Y-%m-%d') AS date, version, entries FROM user_diet_records WHERE user_id = ? AND record_date BETWEEN ? AND ? ORDER BY record_date",
        [req.user.userId, from, to]
      );
      res.set('Cache-Control', 'private, no-store').json({ days: rows.map(toDay) });
    } catch (error) {
      console.error('读取饮食记录失败:', error.code);
      res.status(500).json({ error: '读取饮食记录失败，请重试' });
    }
  });

  app.put('/api/diet/records/:date', authenticateToken, async (req, res) => {
    const { date } = req.params;
    const { version, entries } = req.body || {};
    const normalized = normalizeEntries(entries);
    if (!Number.isFinite(dateTime(date)) || !Number.isSafeInteger(version) || version < 0 ||
        version >= 4294967295 || !normalized) {
      return res.status(400).json({ error: '饮食记录格式无效' });
    }

    const userId = req.user.userId;
    const payload = JSON.stringify(normalized);
    try {
      if (version === 0) {
        try {
          await pool.execute(
            'INSERT INTO user_diet_records (user_id, record_date, entries, version) VALUES (?, ?, ?, 1)',
            [userId, date, payload]
          );
          return res.json({ saved: true, day: { date, version: 1, entries: normalized } });
        } catch (error) {
          if (error.code !== 'ER_DUP_ENTRY') throw error;
        }
      } else {
        const [result] = await pool.execute(
          'UPDATE user_diet_records SET entries = ?, version = version + 1 WHERE user_id = ? AND record_date = ? AND version = ?',
          [payload, userId, date, version]
        );
        if (result.affectedRows) return res.json({ saved: true, day: { date, version: version + 1, entries: normalized } });
      }
      // 返回当前记录供客户端刷新，避免覆盖另一个设备的更新。
      const [rows] = await pool.execute(
        'SELECT version, entries FROM user_diet_records WHERE user_id = ? AND record_date = ?',
        [userId, date]
      );
      const day = rows[0] ? toDay({ ...rows[0], date }) : { date, version: 0, entries: [] };
      res.json({ saved: false, day });
    } catch (error) {
      console.error('保存饮食记录失败:', error.code);
      res.status(500).json({ error: '保存饮食记录失败，请重试' });
    }
  });
}

module.exports = { registerDietRecordRoutes };
