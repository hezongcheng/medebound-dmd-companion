-- 独立分类与逐集累计学习解锁。基于 2026-10-28 线上 rehab_videos 导出。
-- 分类、标题与顺序仅首次迁移设置，后续管理员修改不被启动迁移覆盖。
-- 每集 unlock_after_count 默认 3，可设置为 3、4、5。视频版本保持独立。
-- 新增 18 个已有视频的分类并启用，不删除旧视频，不改写 URL。
-- 不在清单中的髂胫束牵伸、髂胫束筋膜放松保留原数据，不进入新分类。
-- 肩胛后收训练、推墙练习缺少视频地址，上肢分类保留为空，不生成占位视频。
-- 旧版打卡历史保留，新的累计次数只来自完整的单集学习记录。
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(120) NOT NULL PRIMARY KEY, executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @rehab_ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE rehab_videos ADD COLUMN training_category VARCHAR(50) NULL DEFAULT NULL COMMENT ''独立训练分类''', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'rehab_videos' AND column_name = 'training_category');
PREPARE rehab_stmt FROM @rehab_ddl;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;

SET @rehab_ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE rehab_videos ADD COLUMN unlock_after_count TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT ''本集累计完成多少次解锁下一集，3至5次''', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'rehab_videos' AND column_name = 'unlock_after_count');
PREPARE rehab_stmt FROM @rehab_ddl;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;

CREATE TABLE IF NOT EXISTS rehab_training_categories (
    code VARCHAR(50) NOT NULL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rehab_lesson_sessions (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @rehab_seed_needed = (SELECT COUNT(*) = 0 FROM schema_migrations WHERE id = '20261028_rehab_independent_lessons_v1');
START TRANSACTION;
SET @rehab_seed = IF(@rehab_seed_needed, 'INSERT INTO rehab_training_categories (code, title, sort_order) VALUES (''breathing_flexibility'', ''呼吸与柔韧性训练'', 1) ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order)', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'INSERT INTO rehab_training_categories (code, title, sort_order) VALUES (''trunk_control'', ''躯干控制训练'', 2) ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order)', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'INSERT INTO rehab_training_categories (code, title, sort_order) VALUES (''lower_limb'', ''下肢功能训练'', 3) ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order)', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'INSERT INTO rehab_training_categories (code, title, sort_order) VALUES (''upper_limb'', ''上肢功能训练'', 4) ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order)', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'INSERT INTO rehab_training_categories (code, title, sort_order) VALUES (''joint_mobility'', ''关节活动度训练'', 5) ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order)', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''腹式呼吸训练'', training_category = ''breathing_flexibility'', sort_order = 1, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/腹式呼吸训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''腿绳肌拉伸'', training_category = ''breathing_flexibility'', sort_order = 2, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation3.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''腿绳肌筋膜放松'', training_category = ''breathing_flexibility'', sort_order = 3, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation4.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''髋屈肌牵伸'', training_category = ''breathing_flexibility'', sort_order = 4, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation7.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''前臂拉伸'', training_category = ''breathing_flexibility'', sort_order = 5, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation8.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''胸肌牵伸训练'', training_category = ''breathing_flexibility'', sort_order = 6, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation9.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''肘屈肌拉伸'', training_category = ''breathing_flexibility'', sort_order = 7, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation10.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''颈部收下巴训练'', training_category = ''trunk_control'', sort_order = 8, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/颈部收下巴训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''平躺核心激活训练'', training_category = ''trunk_control'', sort_order = 9, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/平躺核心激活训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''简化死虫式训练'', training_category = ''trunk_control'', sort_order = 10, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/简化死虫式训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''桥式训练'', training_category = ''trunk_control'', sort_order = 11, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/桥式训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''蛙式开合训练'', training_category = ''lower_limb'', sort_order = 12, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/蚌式开合训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''俯卧后抬腿训练'', training_category = ''lower_limb'', sort_order = 13, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/俯卧后抬腿训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''坐位抬膝训练'', training_category = ''lower_limb'', sort_order = 14, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/坐位抬膝训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''坐位勾脚训练'', training_category = ''lower_limb'', sort_order = 15, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/坐位勾脚训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''坐位踢腿训练'', training_category = ''lower_limb'', sort_order = 16, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/坐位踢腿训练.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''屈膝俯卧位踝关节背屈训练'', training_category = ''joint_mobility'', sort_order = 17, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
SET @rehab_seed = IF(@rehab_seed_needed, 'UPDATE rehab_videos SET title = ''伸膝俯卧位踝关节背屈训练'', training_category = ''joint_mobility'', sort_order = 18, is_active = 1 WHERE video_url = ''https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/rehabilitation2.mp4''', 'SELECT 1');
PREPARE rehab_stmt FROM @rehab_seed;
EXECUTE rehab_stmt;
DEALLOCATE PREPARE rehab_stmt;
INSERT IGNORE INTO schema_migrations (id) VALUES ('20261028_rehab_independent_lessons_v1');
COMMIT;

-- 核对分类、启用状态、版本排序和后续解锁次数。
SELECT id,title,training_category,video_version,sort_order,unlock_after_count,is_active FROM rehab_videos WHERE training_category IS NOT NULL ORDER BY training_category,CASE WHEN video_version='2.0' THEN 0 ELSE 1 END,sort_order,id;
