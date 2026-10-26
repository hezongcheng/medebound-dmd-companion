const { pool } = require('./db');
const { backfillArticleDrugNames } = require('./articleFetchService');

let running = null;

async function runArticleDrugBackfill(dependencies = { db: pool, processBatch: backfillArticleDrugNames }) {
  const { db, processBatch } = dependencies;
  const connection = await db.getConnection();
  let acquired = false;
  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', ['dmd_article_drug_names_backfill_v1']);
    acquired = lockRows[0]?.acquired === 1;
    if (!acquired) return { skipped: '另一个实例正在回填' };

    const [countRows] = await connection.execute('SELECT COUNT(*) AS missing FROM articles_cache WHERE drug_names IS NULL');
    const missing = Number(countRows[0]?.missing || 0);
    if (!missing) return { missing: 0, updated: 0, failed: 0 };

    console.log(`📰 发现 ${missing} 篇文献尚未提取药物名称，开始后台回填`);
    let afterId = '';
    let updated = 0;
    let failed = 0;
    for (;;) {
      const batch = await processBatch(10, afterId);
      updated += batch.updated;
      failed += batch.failed;
      if (!batch.selected) break;
      if (!batch.lastId || batch.lastId === afterId) throw new Error('药物名称回填游标未前进');
      afterId = batch.lastId;
      if (!batch.updated && batch.failed) {
        console.warn('药物名称回填连续失败，剩余文献将在下次启动时重试');
        break;
      }
    }
    console.log(`📰 药物名称回填完成：更新 ${updated} 篇，失败 ${failed} 篇`);
    return { missing, updated, failed };
  } finally {
    if (acquired) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', ['dmd_article_drug_names_backfill_v1']); }
      catch (error) { console.warn('释放文献药物回填锁失败:', error.message); }
    }
    connection.release();
  }
}

function startArticleDrugBackfill() {
  if (!running) {
    running = runArticleDrugBackfill().catch(error => {
      console.error('启动时回填文献药物名称失败:', error);
    }).finally(() => { running = null; });
  }
  return running;
}

module.exports = { runArticleDrugBackfill, startArticleDrugBackfill };
