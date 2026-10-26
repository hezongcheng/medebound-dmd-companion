-- 1.0 / 2.0 / 3.0 分别对应 level1 / level2 / level3，每条关联独立管理。
CREATE TABLE IF NOT EXISTS schema_migrations (
  id varchar(120) NOT NULL PRIMARY KEY,
  executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rehab_video_levels (
  video_id bigint NOT NULL,
  video_group enum('level1', 'level2', 'level3') NOT NULL,
  PRIMARY KEY (video_id, video_group),
  KEY idx_group_video (video_group, video_id),
  CONSTRAINT fk_rehab_video_levels_video FOREIGN KEY (video_id) REFERENCES rehab_videos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 只在首次迁移保留原分组，重复执行不会恢复管理员已删除的标签。
INSERT IGNORE INTO rehab_video_levels (video_id, video_group)
SELECT id, video_group FROM rehab_videos
WHERE video_group IN ('level1', 'level2', 'level3')
  AND NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE id = '20261026_rehab_video_levels_v1'
  );

INSERT IGNORE INTO schema_migrations (id) VALUES ('20261026_rehab_video_levels_v1');
