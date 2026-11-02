-- 来源：C:/Users/93645/Desktop/video/rehab_videos.sql 及同目录 10 个 MP4。
-- 目标：现有 rehab_videos 表（须已有 video_version 字段）。不包含建表或清表操作。
-- OSS 对象名须与原文件名完全一致，video_version 独立设置为 2.0。
-- duration 来自本地 MP4 的 mvhd 元数据，单位秒，向上取整。
-- 未提供封面和描述，均为 NULL。
-- 按要求暂将全部视频的 video_group 设为 level1，后续可手动调整。
-- is_active=0，配置审核后再启用。
-- category 仅按文件名初步归类，difficulty=easy、target_status=all 为待审核占位值，
-- 不代表已评定临床难度或适用范围，启用前请一并核对。
-- sort_order 使用 11~20 接续来源 SQL 的 1~10，仅控制展示顺序。
-- 按 video_url 去重，重复串行执行不会再次插入已有 URL，也不会覆盖已有记录。
SET NAMES utf8mb4;

START TRANSACTION;

INSERT INTO rehab_videos
  (title, description, video_url, thumbnail_url, duration, category, difficulty,
   target_status, video_group, video_version, sort_order, is_active)
SELECT incoming.title, NULL,
       CONCAT('https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/', incoming.filename),
       NULL, incoming.duration, incoming.category, 'easy', 'all', 'level1', '2.0', incoming.sort_order, 0
FROM (
  SELECT '俯卧后抬腿训练' AS title, '俯卧后抬腿训练.mp4' AS filename, 106 AS duration, 'TRUNK' AS category, 11 AS sort_order
  UNION ALL SELECT '坐位勾脚训练', '坐位勾脚训练.mp4', 226, 'ANKLE', 12
  UNION ALL SELECT '坐位抬膝训练', '坐位抬膝训练.mp4', 166, 'TRUNK', 13
  UNION ALL SELECT '坐位踢腿训练', '坐位踢腿训练.mp4', 122, 'TRUNK', 14
  UNION ALL SELECT '平躺核心激活训练', '平躺核心激活训练.mp4', 128, 'TRUNK', 15
  UNION ALL SELECT '桥式训练', '桥式训练.mp4', 142, 'TRUNK', 16
  UNION ALL SELECT '简化死虫式训练', '简化死虫式训练.mp4', 101, 'TRUNK', 17
  UNION ALL SELECT '腹式呼吸训练', '腹式呼吸训练.mp4', 94, 'BREATHING', 18
  UNION ALL SELECT '蚌式开合训练', '蚌式开合训练.mp4', 196, 'TRUNK', 19
  UNION ALL SELECT '颈部收下巴训练', '颈部收下巴训练.mp4', 118, 'TRUNK', 20
) AS incoming
WHERE NOT EXISTS (
  SELECT 1 FROM rehab_videos existing
  WHERE existing.video_url = CONCAT(
    'https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/', incoming.filename
  )
);

COMMIT;

-- 检查导入结果及临时分组，不自动启用视频。
SELECT id, title, video_url, duration, category, difficulty, target_status,
       video_group, video_version, sort_order, is_active
FROM rehab_videos
WHERE video_url LIKE 'https://medebounde.oss-cn-beijing.aliyuncs.com/assets/hzc/videos/v2/%'
ORDER BY sort_order, id;
