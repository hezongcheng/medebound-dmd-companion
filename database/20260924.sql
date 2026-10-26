ALTER TABLE articles_cache
ADD COLUMN drug_names JSON NULL
COMMENT '从文献标题和摘要提取的规范化药物名称数组'
AFTER sub_tags;

CREATE TABLE IF NOT EXISTS article_daily_views (
  article_id VARCHAR(50) NOT NULL,
  view_date DATE NOT NULL,
  view_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, view_date),
  KEY idx_view_date_article (view_date, article_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;