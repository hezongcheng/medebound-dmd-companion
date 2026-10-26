const { getRequestLocale } = require('./localeService');
const crypto = require('crypto');
const { pool } = require('./db');
const { ARTICLE_PROMPT_VERSION } = require('./articlePrompt');
const promptVersion = () => getRequestLocale() === 'en' ? ARTICLE_PROMPT_VERSION + ':en' : ARTICLE_PROMPT_VERSION;
const { analyzeArticlePublic, analyzeArticlePersonal } = require('./geminiService');

function profileHash(profile) {
  const stable = Object.fromEntries(Object.keys(profile).sort().map(key => [key, profile[key]]));
  return crypto.createHash('md5').update(JSON.stringify(stable)).digest('hex');
}

function composeArticleAnalysis(publicParts, personalParts) {
  if (getRequestLocale() === 'en') return [
    '**1. Quick conclusion**\n\n' + publicParts.quickConclusion,
    '**2. Detailed research review**\n\n' + publicParts.detailedReading,
    '**3. What this research means for this patient**\n\n' + personalParts.personalizedMeaning,
    '**4. Takeaways for the family**\n\n' + personalParts.familyTakeaway
  ].join('\n\n');
  return [
    `**1.快速结论**\n\n${publicParts.quickConclusion}`,
    `**2.研究详细解读**\n\n${publicParts.detailedReading}`,
    `**3.根据患者个性化病情，这个研究对我有何种意义**\n\n${personalParts.personalizedMeaning}`,
    `**4.给家庭启示**\n\n${personalParts.familyTakeaway}`
  ].join('\n\n');
}

function createArticleAnalysisService(database = pool, generators = {
  public: analyzeArticlePublic,
  personal: analyzeArticlePersonal
}) {
  const publicInFlight = new Map();
  const personalInFlight = new Map();

  async function findPublic(articleId) {
    const [rows] = await database.execute(
      `SELECT quick_conclusion AS quickConclusion, detailed_reading AS detailedReading
         FROM article_public_analysis_cache WHERE article_id = ? AND prompt_version = ?`,
      [articleId, promptVersion()]
    );
    return rows[0] || null;
  }

  async function findPersonal(userId, articleId, hash) {
    const [rows] = await database.execute(
      `SELECT personalized_meaning AS personalizedMeaning, family_takeaway AS familyTakeaway
         FROM article_personal_analysis_cache
        WHERE user_id = ? AND article_id = ? AND profile_hash = ? AND prompt_version = ?`,
      [userId, articleId, hash, promptVersion()]
    );
    return rows[0] || null;
  }

  async function getPublic(article) {
    const cached = await findPublic(article.id);
    if (cached) return { parts: cached, cached: true };
    const key = `${article.id}:${promptVersion()}`;
    if (publicInFlight.has(key)) return publicInFlight.get(key);
    const work = (async () => {
      const generated = await generators.public(article);
      await database.execute(
        `INSERT IGNORE INTO article_public_analysis_cache
           (article_id, prompt_version, quick_conclusion, detailed_reading)
         VALUES (?, ?, ?, ?)`,
        [article.id, promptVersion(), generated.quickConclusion, generated.detailedReading]
      );
      const saved = await findPublic(article.id);
      if (!saved) throw new Error('文献公共解读保存失败');
      return { parts: saved, cached: false };
    })().finally(() => publicInFlight.delete(key));
    publicInFlight.set(key, work);
    return work;
  }

  async function getPersonal(article, profile, userId, hash, publicParts) {
    const cached = await findPersonal(userId, article.id, hash);
    if (cached) return { parts: cached, cached: true };
    const key = `${userId}:${article.id}:${hash}:${promptVersion()}`;
    if (personalInFlight.has(key)) return personalInFlight.get(key);
    const work = (async () => {
      const generated = await generators.personal(article, profile, publicParts);
      await database.execute(
        `INSERT IGNORE INTO article_personal_analysis_cache
           (user_id, article_id, profile_hash, prompt_version, personalized_meaning, family_takeaway)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, article.id, hash, promptVersion(),
          generated.personalizedMeaning, generated.familyTakeaway]
      );
      const saved = await findPersonal(userId, article.id, hash);
      if (!saved) throw new Error('患者个性化解读保存失败');
      return { parts: saved, cached: false };
    })().finally(() => personalInFlight.delete(key));
    personalInFlight.set(key, work);
    return work;
  }

  async function analyze(articleId, profile, userId) {
    if (typeof articleId !== 'string' || !articleId || articleId.length > 50) {
      const error = new Error('无效的文献ID');
      error.status = 400;
      throw error;
    }
    const [rows] = await database.execute(
      'SELECT id, title, abstract FROM articles_cache WHERE id = ? LIMIT 1', [articleId]
    );
    if (!rows.length) {
      const error = new Error('文献不存在');
      error.status = 404;
      throw error;
    }
    const article = rows[0];
    const hash = profileHash(profile);
    const publicResult = await getPublic(article);
    const personalResult = await getPersonal(article, profile, userId, hash, publicResult.parts);
    return {
      text: composeArticleAnalysis(publicResult.parts, personalResult.parts),
      cached: publicResult.cached && personalResult.cached,
      publicCached: publicResult.cached,
      personalCached: personalResult.cached
    };
  }

  return { analyze };
}

const articleAnalysisService = createArticleAnalysisService();
module.exports = { createArticleAnalysisService, composeArticleAnalysis, articleAnalysisService };
