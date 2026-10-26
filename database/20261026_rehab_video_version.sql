-- 视频版本独立管理，不从 video_group 或其他视频的版本推导。
-- 可重复执行，已有版本数据保持不变。
SET @rehab_version_ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE rehab_videos ADD COLUMN video_version VARCHAR(20) NULL DEFAULT NULL COMMENT ''视频版本，独立于训练等级，例如1.0/2.0/3.0'' AFTER video_group',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'rehab_videos'
    AND column_name = 'video_version'
);
PREPARE rehab_version_stmt FROM @rehab_version_ddl;
EXECUTE rehab_version_stmt;
DEALLOCATE PREPARE rehab_version_stmt;
