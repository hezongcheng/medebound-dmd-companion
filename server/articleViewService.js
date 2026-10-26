// PV counts every opening; UV counts distinct authenticated accounts.
async function recordArticleView(pool, articleId, userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Lock the article first so simultaneous openings cannot double-count UV.
    const [result] = await connection.execute(
      'UPDATE articles_cache SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?', [articleId]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return false;
    }
    const [visitor] = await connection.execute(
      'INSERT IGNORE INTO article_visitors (article_id, user_id) VALUES (?, ?)', [articleId, userId]
    );
    if (visitor.affectedRows === 1) {
      await connection.execute('UPDATE articles_cache SET uv_count = uv_count + 1 WHERE id = ?', [articleId]);
    }
    await connection.execute(
      'INSERT IGNORE INTO article_daily_visitors (article_id, user_id, visit_date) VALUES (?, ?, CURDATE())',
      [articleId, userId]
    );
    await connection.execute(
      `INSERT INTO article_daily_views (article_id, view_date, view_count) VALUES (?, CURDATE(), 1)
       ON DUPLICATE KEY UPDATE view_count = view_count + 1`, [articleId]
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function hotArticleQuery(limit = 6, period = 'month') {
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 6));
  const fields = `a.id, a.title, a.title_zh, a.abstract, a.abstract_zh, a.authors,
    a.publication_date, a.journal, a.url, a.tags, a.sub_tags, a.impact_factor, a.research_stage, a.ai_summary`;
  if (period === 'all') return `SELECT ${fields}, a.uv_count FROM articles_cache a
    WHERE a.uv_count > 0 AND a.publication_date <= CURDATE()
    ORDER BY a.uv_count DESC, a.publication_date DESC, a.id DESC LIMIT ${safeLimit}`;
  const days = period === 'twoMonths' ? 60 : period === 'quarter' ? 90 : 30;
  // Count users across the entire window, not the sum of daily UV.
  return `SELECT ${fields}, v.uv_count FROM articles_cache a
    JOIN (SELECT article_id, COUNT(DISTINCT user_id) AS uv_count FROM article_daily_visitors
      WHERE visit_date BETWEEN CURDATE() - INTERVAL ${days - 1} DAY AND CURDATE()
      GROUP BY article_id) v ON a.id = v.article_id
    WHERE a.publication_date <= CURDATE()
    ORDER BY v.uv_count DESC, a.publication_date DESC, a.id DESC LIMIT ${safeLimit}`;
}

module.exports = { recordArticleView, hotArticleQuery };
