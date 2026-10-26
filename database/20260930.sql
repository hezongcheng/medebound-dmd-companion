-- PV continues to use articles_cache.view_count and article_daily_views.
-- Old aggregate PV cannot be converted to UV without visitor identities.
ALTER TABLE articles_cache ADD COLUMN uv_count INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS article_visitors (
  article_id VARCHAR(50) NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (article_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS article_daily_visitors (
  article_id VARCHAR(50) NOT NULL,
  user_id INT NOT NULL,
  visit_date DATE NOT NULL,
  PRIMARY KEY (article_id, user_id, visit_date),
  KEY idx_visit_date_article_user (visit_date, article_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
