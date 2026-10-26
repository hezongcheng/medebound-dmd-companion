const { pool } = require('./db');
const { runMigrations } = require('./migrationService');
const { runArticleDrugBackfill } = require('./articleDrugBackfill');

async function main() {
  await runMigrations();
  console.log(await runArticleDrugBackfill());
}

main().catch(error => {
  console.error('历史文献药物名称回填失败:', error);
  process.exitCode = 1;
}).finally(() => pool.end());
