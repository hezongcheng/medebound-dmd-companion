const MIGRATION_ID = '20261028_rehab_independent_lessons_v1';
const BASE = 'https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/';
const categories = [
  ['breathing_flexibility', '呼吸与柔韧性训练'],
  ['trunk_control', '躯干控制训练'],
  ['lower_limb', '下肢功能训练'],
  ['upper_limb', '上肢功能训练'],
  ['joint_mobility', '关节活动度训练']
];
// 顺序使用需求清单，实际显示时每类 2.0 优先。只按来源 URL 匹配，不依赖线上 ID。
const lessons = [
  ['breathing_flexibility', '腹式呼吸训练', 'v2/腹式呼吸训练.mp4'],
  ['breathing_flexibility', '腿绳肌拉伸', 'rehabilitation3.mp4'],
  ['breathing_flexibility', '腿绳肌筋膜放松', 'rehabilitation4.mp4'],
  ['breathing_flexibility', '髋屈肌牵伸', 'rehabilitation7.mp4'],
  ['breathing_flexibility', '前臂拉伸', 'rehabilitation8.mp4'],
  ['breathing_flexibility', '胸肌牵伸训练', 'rehabilitation9.mp4'],
  ['breathing_flexibility', '肘屈肌拉伸', 'rehabilitation10.mp4'],
  ['trunk_control', '颈部收下巴训练', 'v2/颈部收下巴训练.mp4'],
  ['trunk_control', '平躺核心激活训练', 'v2/平躺核心激活训练.mp4'],
  ['trunk_control', '简化死虫式训练', 'v2/简化死虫式训练.mp4'],
  ['trunk_control', '桥式训练', 'v2/桥式训练.mp4'],
  ['lower_limb', '蛙式开合训练', 'v2/蚌式开合训练.mp4'],
  ['lower_limb', '俯卧后抬腿训练', 'v2/俯卧后抬腿训练.mp4'],
  ['lower_limb', '坐位抬膝训练', 'v2/坐位抬膝训练.mp4'],
  ['lower_limb', '坐位勾脚训练', 'v2/坐位勾脚训练.mp4'],
  ['lower_limb', '坐位踢腿训练', 'v2/坐位踢腿训练.mp4'],
  ['joint_mobility', '屈膝俯卧位踝关节背屈训练', 'rehabilitation.mp4'],
  ['joint_mobility', '伸膝俯卧位踝关节背屈训练', 'rehabilitation2.mp4']
];

const columns = [
  ['training_category', "ALTER TABLE rehab_videos ADD COLUMN training_category VARCHAR(50) NULL DEFAULT NULL COMMENT '独立训练分类'"],
  ['unlock_after_count', "ALTER TABLE rehab_videos ADD COLUMN unlock_after_count TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '本集累计完成多少次解锁下一集，3至5次'"]
];
const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS rehab_training_categories (
    code VARCHAR(50) NOT NULL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS rehab_lesson_sessions (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    video_id BIGINT NOT NULL,
    status ENUM('started','completed','stopped') NOT NULL DEFAULT 'started',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME NULL,
    watched_seconds INT NOT NULL DEFAULT 0,
    KEY idx_user_video_status (user_id, video_id, status),
    CONSTRAINT fk_rehab_lesson_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_rehab_lesson_video FOREIGN KEY (video_id) REFERENCES rehab_videos(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
const quote = value => `'${String(value).replace(/'/g, "''")}'`;
const seedStatements = [
  ...categories.map(([code, title], i) => `INSERT INTO rehab_training_categories (code, title, sort_order) VALUES (${quote(code)}, ${quote(title)}, ${i + 1}) ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order)`),
  ...lessons.map(([category, title, filename], i) => `UPDATE rehab_videos SET title = ${quote(title)}, training_category = ${quote(category)}, sort_order = ${i + 1}, is_active = 1 WHERE video_url = ${quote(BASE + filename)}`)
];

async function applyRehabLessonSchema(connection, ensureColumn) {
  for (const [column, ddl] of columns) await ensureColumn(connection, 'rehab_videos', column, ddl);
  for (const sql of schemaStatements) await connection.execute(sql);
  const [rows] = await connection.execute('SELECT id FROM schema_migrations WHERE id = ?', [MIGRATION_ID]);
  if (!rows.length) {
    await connection.beginTransaction();
    try {
      for (const sql of seedStatements) await connection.execute(sql);
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [MIGRATION_ID]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}

module.exports = { MIGRATION_ID, BASE, categories, lessons, columns, schemaStatements, seedStatements, applyRehabLessonSchema };
