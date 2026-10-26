const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { pool } = require('./db');
const { createOperationLogService } = require('./operationLogService');

const signingSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex'));

function createEmailVisitToken(userId, articleId) {
  if (!signingSecret) throw new Error('JWT_SECRET 未配置，无法生成邮件访问链接');
  return jwt.sign({ purpose: 'email_platform_visit', userId: Number(userId), articleId: String(articleId) },
    signingSecret, { expiresIn: '30d' });
}

function buildEmailVisitUrl(userId, articleId) {
  const url = new URL(process.env.EMAIL_PUSH_PLATFORM_URL || 'https://dmd.medebound.com/feed');
  url.searchParams.set('email_visit', createEmailVisitToken(userId, articleId));
  return url.toString();
}

async function recordEmailVisit(token, database = pool) {
  if (typeof token !== 'string' || token.length > 2000 || !signingSecret) return false;
  let payload;
  try { payload = jwt.verify(token, signingSecret); }
  catch { return false; }
  if (payload.purpose !== 'email_platform_visit' || !Number.isInteger(payload.userId) ||
      payload.userId <= 0 || typeof payload.articleId !== 'string' || !payload.articleId) return false;

  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE email_push_logs SET visited_at = NOW()
       WHERE user_id = ? AND article_id = ? AND status = 'success'
         AND visited_at IS NULL AND pushed_at >= FROM_UNIXTIME(?)`,
      [payload.userId, payload.articleId, payload.iat - 86400]
    );
    if (result.affectedRows) {
      await createOperationLogService(connection).record({
        userId: payload.userId, action: 'email_platform_visit',
        contentType: 'article', contentId: payload.articleId
      });
    }
    await connection.commit();
    return Boolean(result.affectedRows);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createEmailVisitToken, buildEmailVisitUrl, recordEmailVisit };
