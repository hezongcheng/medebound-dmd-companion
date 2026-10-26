-- Also created automatically by server/migrationService.js on startup.
CREATE TABLE IF NOT EXISTS user_language_preferences (
  user_id INT NOT NULL PRIMARY KEY,
  language_mode VARCHAR(10) NOT NULL,
  preferred_locale VARCHAR(16) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
