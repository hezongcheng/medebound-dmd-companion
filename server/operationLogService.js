const { pool } = require('./db');

const ACTIONS = new Set(['login', 'logout', 'ai_analyze', 'ai_chat', 'rehab_checkin', 'page_view', 'content_view', 'search', 'api_action', 'email_platform_visit']);
const CONTENT_TYPES = new Set(['article', 'drug', 'trial']);

function createOperationLogService(database = pool) {
  async function record({ userId, action, contentType = null, contentId = null, contentTitle = null, messageCount = null }) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0 || !ACTIONS.has(action)) throw new Error('无效的用户操作日志参数');
    const type = CONTENT_TYPES.has(contentType) ? contentType : null;
    const count = Number.isInteger(messageCount) && messageCount > 0 ? messageCount : null;
    await database.execute(
      `INSERT INTO user_operation_logs (user_id, action, content_type, content_id, content_title, message_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, action, type, contentId == null ? null : String(contentId).slice(0, 100),
        contentTitle == null ? null : String(contentTitle).slice(0, 500), count]
    );
  }

  async function recordSafely(entry) {
    try {
      await record(entry);
    } catch (error) {
      console.error('用户操作日志写入失败:', error.code || error.message);
    }
  }

  return { record, recordSafely };
}

const { recordUserOperation, recordUserOperationSafely } = (() => {
  const service = createOperationLogService();
  return { recordUserOperation: service.record, recordUserOperationSafely: service.recordSafely };
})();

function contentForOperation(type, { article, drug, trial } = {}) {
  if (type === 'drug') return { contentType: 'drug', contentId: drug?.brandName || null, contentTitle: drug?.brandNameCn || drug?.brandName || null };
  if (type === 'trial') return { contentType: 'trial', contentId: trial?.nctId || null, contentTitle: trial?.title || null };
  return { contentType: 'article', contentId: article?.id || null, contentTitle: article?.title || null };
}

module.exports = { createOperationLogService, recordUserOperation, recordUserOperationSafely, contentForOperation };
