const { getRequestLocale } = require('./localeService');
const crypto = require('crypto');

async function ensureShareTable(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS public_interpretation_shares (
    id CHAR(32) PRIMARY KEY,
    source_id VARCHAR(255) DEFAULT NULL,
    title VARCHAR(1000) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    summary MEDIUMTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4`);
  const [columns] = await pool.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'public_interpretation_shares' AND column_name = 'source_id'");
  if (!columns.length) await pool.execute('ALTER TABLE public_interpretation_shares ADD COLUMN source_id VARCHAR(255) DEFAULT NULL');
}

async function getSharedSource(pool, kind, sourceId) {
  // Select public source fields only; never return creator IDs, profiles or cached analyses.
  const queries = {
    article: 'SELECT id, title, title_zh AS titleZh, abstract, abstract_zh AS abstractZh, authors, publication_date AS publicationDate, journal, url, tags FROM articles_cache WHERE id = ? LIMIT 1',
    drug: `SELECT brand_name AS brandName, brand_name_cn AS brandNameCn, generic_name AS genericName, generic_name_cn AS genericNameCn, manufacturer, approval_date AS approvalDate, approval_year AS approvalYear, indication, indication_zh AS indicationZh, dosage, dosage_zh AS dosageZh, label_url AS labelUrl, china_status AS chinaStatus, china_status_note AS chinaStatusNote FROM fda_drugs_cache WHERE brand_name = ? LIMIT 1`,
    trial: 'SELECT nct_id AS nctId, title, title_zh AS titleZh, status, phase, conditions, locations, regions, intervention_names AS interventionNames, summary, summary_zh AS summaryZh, eligibility, eligibility_zh AS eligibilityZh, last_update AS lastUpdate, study_type AS studyType, minimum_age AS minimumAge, maximum_age AS maximumAge, sex, healthy_volunteers AS healthyVolunteers, enrollment_count AS enrollmentCount, lead_sponsor AS leadSponsor FROM trials_cache WHERE nct_id = ? LIMIT 1'
  };
  if (!queries[kind]) return null;
  const [rows] = await pool.execute(queries[kind], [sourceId]);
  if (!rows.length) return null;
  const item = rows[0];
  for (const key of kind === 'article' ? ['authors', 'tags'] : kind === 'trial' ? ['phase', 'conditions', 'locations', 'regions', 'interventionNames'] : []) {
    if (typeof item[key] === 'string') { try { item[key] = JSON.parse(item[key]); } catch { item[key] = []; } }
    if (!Array.isArray(item[key])) item[key] = [];
  }
  return item;
}

function registerShareRoutes(app, pool, authenticateToken) {
  app.post('/api/interpretation-shares', authenticateToken, async (req, res) => {
    const { kind, sourceId } = req.body || {};
    if (!['article', 'drug', 'trial'].includes(kind) || typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 255) {
      return res.status(400).json({ error: '分享内容无效或过长' });
    }
    try {
      // Only read public source fields. Never accept a client analysis or read a profile/AI cache.
      const sources = {
        article: "SELECT COALESCE(NULLIF(title_zh, ''), title) AS title, COALESCE(NULLIF(abstract_zh, ''), abstract) AS summary FROM articles_cache WHERE id = ? LIMIT 1",
        trial: "SELECT COALESCE(NULLIF(title_zh, ''), title) AS title, COALESCE(NULLIF(summary_zh, ''), summary) AS summary FROM trials_cache WHERE nct_id = ? LIMIT 1",
        drug: "SELECT COALESCE(NULLIF(brand_name_cn, ''), brand_name) AS title, COALESCE(NULLIF(indication_zh, ''), indication) AS summary FROM fda_drugs_cache WHERE brand_name = ? LIMIT 1"
      };
      const englishSources = {
        article: "SELECT COALESCE(NULLIF(title, ''), title_zh) AS title, COALESCE(NULLIF(abstract, ''), abstract_zh) AS summary FROM articles_cache WHERE id = ? LIMIT 1",
        trial: "SELECT COALESCE(NULLIF(title, ''), title_zh) AS title, COALESCE(NULLIF(summary, ''), summary_zh) AS summary FROM trials_cache WHERE nct_id = ? LIMIT 1",
        drug: "SELECT COALESCE(NULLIF(brand_name, ''), brand_name_cn) AS title, COALESCE(NULLIF(indication, ''), indication_zh) AS summary FROM fda_drugs_cache WHERE brand_name = ? LIMIT 1"
      };
      const [sourceRows] = await pool.execute(getRequestLocale() === 'en' ? englishSources[kind] : sources[kind], [sourceId]);
      if (!sourceRows.length) return res.status(404).json({ error: '未找到可分享的公开资料，请刷新后重试' });
      const title = String(sourceRows[0].title || '').slice(0, 1000);
      const summary = String(sourceRows[0].summary || '暂无公开摘要。').slice(0, 24000);
      const id = crypto.randomBytes(16).toString('hex');
      await pool.execute('INSERT INTO public_interpretation_shares (id, title, kind, summary, source_id) VALUES (?, ?, ?, ?, ?)', [id, title, kind, summary, sourceId]);
      res.status(201).json({ id, title, summary });
    } catch (error) {
      console.error('保存分享失败', error.message);
      res.status(503).json({ error: '分享暂时不可用，请稍后重试' });
    }
  });
  app.get('/api/interpretation-shares/:id', authenticateToken, async (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.id)) return res.status(404).json({ error: '分享不存在' });
    try {
      const [rows] = await pool.execute('SELECT title, kind, summary, source_id, created_at FROM public_interpretation_shares WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: '分享不存在或已失效，请让分享者重新生成不含个人信息的分享链接' });
      const share = rows[0];
      if (!share.source_id) return res.status(410).json({ error: '此旧链接未关联原始条目，请重新分享' });
      const item = await getSharedSource(pool, share.kind, share.source_id);
      if (!item) return res.status(404).json({ error: '原始资料已不可用' });
      res.set('Cache-Control', 'private, no-store').json({ kind: share.kind, item });
    } catch (error) {
      res.status(503).json({ error: '加载失败，请稍后重试' });
    }
  });
}
module.exports = { ensureShareTable, registerShareRoutes, getSharedSource };
