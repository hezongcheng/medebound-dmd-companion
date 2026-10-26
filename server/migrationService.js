const { pool } = require('./db');

const MIGRATION_ID = '20260512_trials_extended_fields_v2';
const DOI_UNIQUE_MIGRATION_ID = '20260806_articles_doi_unique_v1';
const PROFILE_DETAILS_MIGRATION_ID = '20260814_profile_clinical_details_v1';
const REHAB_REPEAT_PLAYBACK_MIGRATION_ID = '20260814_rehab_repeat_playback_v1';
const ARTICLE_DRUG_NAMES_MIGRATION_ID = '20260924_article_drug_names_v1';
const EMAIL_VISIT_MIGRATION_ID = '20260924_email_platform_visit_v1';
const ARTICLE_DAILY_VIEWS_MIGRATION_ID = '20260928_article_daily_views_v1';
const ARTICLE_SPLIT_ANALYSIS_MIGRATION_ID = '20260929_article_split_analysis_v1';
const ARTICLE_UV_MIGRATION_ID = '20260930_article_uv_v1';
const CONTENT_PREFERENCE_MIGRATION_ID = '20261015_content_preference_v1';

async function ensureIndex(connection, tableName, indexName, ddlSql) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  if (!rows.length) {
    await connection.execute(ddlSql);
  }
}

// Add column if it doesn't exist (MySQL-compatible check)
async function ensureColumn(connection, tableName, columnName, ddlSql) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  if (!rows.length) {
    await connection.execute(ddlSql);
  }
}

async function applyPerformanceSchemaV2(connection) {
  // Core cache tables (some environments may miss them entirely).
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS trials_cache (
      nct_id varchar(50) NOT NULL,
      title varchar(500) NOT NULL,
      title_zh varchar(500) DEFAULT NULL,
      status varchar(100) DEFAULT NULL,
      phase json DEFAULT NULL,
      conditions json DEFAULT NULL,
      study_type varchar(64) DEFAULT NULL,
      intervention_types json DEFAULT NULL,
      intervention_names json DEFAULT NULL,
      lead_sponsor varchar(255) DEFAULT NULL,
      primary_purpose varchar(120) DEFAULT NULL,
      observational_model varchar(120) DEFAULT NULL,
      time_perspective varchar(120) DEFAULT NULL,
      allocation varchar(120) DEFAULT NULL,
      masking varchar(120) DEFAULT NULL,
      enrollment_count int DEFAULT NULL,
      enrollment_type varchar(32) DEFAULT NULL,
      sex varchar(32) DEFAULT NULL,
      minimum_age varchar(64) DEFAULT NULL,
      maximum_age varchar(64) DEFAULT NULL,
      healthy_volunteers varchar(32) DEFAULT NULL,
      std_ages json DEFAULT NULL,
      suggested_materials json DEFAULT NULL,
      locations json DEFAULT NULL,
      regions json DEFAULT NULL,
      summary text,
      summary_zh text,
      eligibility text,
      eligibility_zh text,
      last_update date DEFAULT NULL,
      fetched_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (nct_id),
      KEY idx_last_update (last_update),
      KEY idx_fetched_at (fetched_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS trials_ai_cache (
      id bigint NOT NULL AUTO_INCREMENT,
      nct_id varchar(50) NOT NULL,
      profile_hash varchar(64) NOT NULL,
      analysis_text mediumtext NOT NULL,
      expires_at datetime DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_trial_profile (nct_id, profile_hash),
      KEY idx_trial_ai_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS fda_drugs_cache (
      id bigint NOT NULL AUTO_INCREMENT,
      brand_name varchar(255) NOT NULL,
      brand_name_cn varchar(255) DEFAULT NULL,
      generic_name varchar(255) DEFAULT NULL,
      generic_name_cn varchar(255) DEFAULT NULL,
      manufacturer varchar(255) DEFAULT NULL,
      approval_date date DEFAULT NULL,
      approval_year int DEFAULT NULL,
      indication text,
      indication_zh text,
      dosage text,
      dosage_zh text,
      label_url varchar(500) DEFAULT NULL,
      china_status enum('not_available','clinical_trial','nda_review','approved','unknown') DEFAULT 'unknown',
      china_status_note text,
      fetched_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_brand_name (brand_name),
      KEY idx_approval_date (approval_date),
      KEY idx_fetched_at (fetched_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS drugs_ai_cache (
      id bigint NOT NULL AUTO_INCREMENT,
      brand_name varchar(255) NOT NULL,
      profile_hash varchar(64) NOT NULL,
      analysis_text mediumtext NOT NULL,
      expires_at datetime DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_drug_profile (brand_name, profile_hash),
      KEY idx_drug_ai_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // New progress table: stable unlock state + best streak snapshots.
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS rehab_user_progress (
      user_id bigint NOT NULL,
      level1_best_streak int NOT NULL DEFAULT 0,
      level2_best_streak int NOT NULL DEFAULT 0,
      level2_unlocked_at datetime DEFAULT NULL,
      level3_unlocked_at datetime DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      KEY idx_level2_unlocked_at (level2_unlocked_at),
      KEY idx_level3_unlocked_at (level3_unlocked_at),
      CONSTRAINT fk_rehab_user_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Backfill progress rows from existing unlock flags.
  await connection.execute(`
    INSERT INTO rehab_user_progress (user_id, level2_unlocked_at, level3_unlocked_at)
    SELECT
      u.id,
      CASE WHEN u.rehab_level2_unlocked = 1 THEN NOW() ELSE NULL END,
      CASE WHEN u.rehab_level3_unlocked = 1 THEN NOW() ELSE NULL END
    FROM users u
    ON DUPLICATE KEY UPDATE
      level2_unlocked_at = COALESCE(rehab_user_progress.level2_unlocked_at, VALUES(level2_unlocked_at)),
      level3_unlocked_at = COALESCE(rehab_user_progress.level3_unlocked_at, VALUES(level3_unlocked_at))
  `);

  // Deduplicate detail rows before adding unique keys.
  await connection.execute(`
    DELETE d1 FROM rehab_checkin_details d1
    INNER JOIN rehab_checkin_details d2
      ON d1.checkin_id = d2.checkin_id
     AND d1.video_id = d2.video_id
     AND d1.id > d2.id
  `);

  // Recompute denormalized counter.
  await connection.execute(`
    UPDATE rehab_checkins c
    LEFT JOIN (
      SELECT checkin_id, COUNT(*) AS detail_count
      FROM rehab_checkin_details
      GROUP BY checkin_id
    ) d ON d.checkin_id = c.id
    SET c.completed_count = COALESCE(d.detail_count, 0)
  `);

  // High-value indexes for current query patterns.
  await ensureIndex(
    connection,
    'articles_cache',
    'idx_created_by_fetched',
    'ALTER TABLE articles_cache ADD INDEX idx_created_by_fetched (created_by_user_id, fetched_at DESC)'
  );
  await ensureColumn(
    connection,
    'trials_cache',
    'created_by_user_id',
    'ALTER TABLE trials_cache ADD COLUMN created_by_user_id BIGINT NULL AFTER fetched_at'
  );
  await ensureColumn(connection, 'trials_cache', 'study_type', 'ALTER TABLE trials_cache ADD COLUMN study_type VARCHAR(64) NULL AFTER conditions');
  await ensureColumn(connection, 'trials_cache', 'intervention_types', 'ALTER TABLE trials_cache ADD COLUMN intervention_types JSON NULL AFTER study_type');
  await ensureColumn(connection, 'trials_cache', 'intervention_names', 'ALTER TABLE trials_cache ADD COLUMN intervention_names JSON NULL AFTER intervention_types');
  await ensureColumn(connection, 'trials_cache', 'lead_sponsor', 'ALTER TABLE trials_cache ADD COLUMN lead_sponsor VARCHAR(255) NULL AFTER intervention_names');
  await ensureColumn(connection, 'trials_cache', 'primary_purpose', 'ALTER TABLE trials_cache ADD COLUMN primary_purpose VARCHAR(120) NULL AFTER lead_sponsor');
  await ensureColumn(connection, 'trials_cache', 'observational_model', 'ALTER TABLE trials_cache ADD COLUMN observational_model VARCHAR(120) NULL AFTER primary_purpose');
  await ensureColumn(connection, 'trials_cache', 'time_perspective', 'ALTER TABLE trials_cache ADD COLUMN time_perspective VARCHAR(120) NULL AFTER observational_model');
  await ensureColumn(connection, 'trials_cache', 'allocation', 'ALTER TABLE trials_cache ADD COLUMN allocation VARCHAR(120) NULL AFTER time_perspective');
  await ensureColumn(connection, 'trials_cache', 'masking', 'ALTER TABLE trials_cache ADD COLUMN masking VARCHAR(120) NULL AFTER allocation');
  await ensureColumn(connection, 'trials_cache', 'enrollment_count', 'ALTER TABLE trials_cache ADD COLUMN enrollment_count INT NULL AFTER masking');
  await ensureColumn(connection, 'trials_cache', 'enrollment_type', 'ALTER TABLE trials_cache ADD COLUMN enrollment_type VARCHAR(32) NULL AFTER enrollment_count');
  await ensureColumn(connection, 'trials_cache', 'sex', 'ALTER TABLE trials_cache ADD COLUMN sex VARCHAR(32) NULL AFTER enrollment_type');
  await ensureColumn(connection, 'trials_cache', 'minimum_age', 'ALTER TABLE trials_cache ADD COLUMN minimum_age VARCHAR(64) NULL AFTER sex');
  await ensureColumn(connection, 'trials_cache', 'maximum_age', 'ALTER TABLE trials_cache ADD COLUMN maximum_age VARCHAR(64) NULL AFTER minimum_age');
  await ensureColumn(connection, 'trials_cache', 'healthy_volunteers', 'ALTER TABLE trials_cache ADD COLUMN healthy_volunteers VARCHAR(32) NULL AFTER maximum_age');
  await ensureColumn(connection, 'trials_cache', 'std_ages', 'ALTER TABLE trials_cache ADD COLUMN std_ages JSON NULL AFTER healthy_volunteers');
  await ensureColumn(connection, 'trials_cache', 'suggested_materials', 'ALTER TABLE trials_cache ADD COLUMN suggested_materials JSON NULL AFTER std_ages');
  await ensureIndex(
    connection,
    'trials_cache',
    'idx_created_by_fetched',
    'ALTER TABLE trials_cache ADD INDEX idx_created_by_fetched (created_by_user_id, fetched_at DESC)'
  );
  await ensureIndex(
    connection,
    'articles_cache',
    'idx_pub_date_id',
    'ALTER TABLE articles_cache ADD INDEX idx_pub_date_id (publication_date DESC, id)'
  );
  await ensureIndex(
    connection,
    'email_push_logs',
    'idx_user_pushed_at',
    'ALTER TABLE email_push_logs ADD INDEX idx_user_pushed_at (user_id, pushed_at DESC)'
  );
  await ensureIndex(
    connection,
    'rehab_videos',
    'idx_active_group_status_sort',
    'ALTER TABLE rehab_videos ADD INDEX idx_active_group_status_sort (is_active, video_group, target_status, sort_order)'
  );
  await ensureIndex(
    connection,
    'rehab_checkins',
    'idx_user_completed_group_date',
    'ALTER TABLE rehab_checkins ADD INDEX idx_user_completed_group_date (user_id, is_completed, video_group, checkin_date DESC, started_at DESC)'
  );
  await ensureIndex(
    connection,
    'rehab_checkins',
    'idx_user_completed_date',
    'ALTER TABLE rehab_checkins ADD INDEX idx_user_completed_date (user_id, is_completed, checkin_date DESC, id DESC)'
  );
  await ensureIndex(
    connection,
    'rehab_checkins',
    'idx_user_date_completed',
    'ALTER TABLE rehab_checkins ADD INDEX idx_user_date_completed (user_id, checkin_date, is_completed, id DESC)'
  );
  await ensureIndex(
    connection,
    'rehab_checkin_details',
    'uk_checkin_order',
    'ALTER TABLE rehab_checkin_details ADD UNIQUE INDEX uk_checkin_order (checkin_id, video_order)'
  );
  await ensureIndex(
    connection,
    'rehab_checkin_details',
    'idx_checkin_order',
    'ALTER TABLE rehab_checkin_details ADD INDEX idx_checkin_order (checkin_id, video_order)'
  );

  // 20260507: 药物中国可用性状态 + 文章全文搜索索引
  // 为已知 DMD 药物设置中国可用性默认值（仅当为 NULL/unknown 时更新）
  await connection.execute(`
    UPDATE fda_drugs_cache SET
      china_status = CASE brand_name
        WHEN 'Emflaza' THEN 'approved'
        WHEN 'Exondys 51' THEN 'not_available'
        WHEN 'Vyondys 53' THEN 'not_available'
        WHEN 'Amondys 45' THEN 'not_available'
        WHEN 'Viltepso' THEN 'not_available'
        WHEN 'Elevidys' THEN 'clinical_trial'
        WHEN 'Duvyzat' THEN 'clinical_trial'
        WHEN 'Agamree' THEN 'clinical_trial'
        ELSE 'unknown'
      END,
      china_status_note = CASE brand_name
        WHEN 'Emflaza' THEN '地夫可特（商品名 Emflaza）已在中国获批上市，国内有仿制药。'
        WHEN 'Exondys 51' THEN '该药物尚未进入中国市场，外显子51跳跃疗法在国内仍处于发展阶段。'
        WHEN 'Vyondys 53' THEN '该药物尚未进入中国市场。'
        WHEN 'Amondys 45' THEN '该药物尚未进入中国市场。'
        WHEN 'Viltepso' THEN '该药物尚未进入中国市场。'
        WHEN 'Elevidys' THEN '该基因疗法正在中国进行桥接临床试验，有望未来几年内申请上市。'
        WHEN 'Duvyzat' THEN '吉维诺他正在中国进行临床试验，尚未正式获批。'
        WHEN 'Agamree' THEN '瓦莫洛隆正在中国进行国际多中心临床试验。'
        ELSE NULL
      END
    WHERE china_status IS NULL OR china_status = 'unknown'
  `);

  await ensureColumn(
    connection,
    'fda_drugs_cache',
    'china_status',
    "ALTER TABLE fda_drugs_cache ADD COLUMN china_status ENUM('not_available','clinical_trial','nda_review','approved','unknown') DEFAULT 'unknown' AFTER label_url"
  );
  await ensureColumn(
    connection,
    'fda_drugs_cache',
    'china_status_note',
    'ALTER TABLE fda_drugs_cache ADD COLUMN china_status_note TEXT AFTER china_status'
  );
  await ensureIndex(
    connection,
    'articles_cache',
    'ft_search',
    'ALTER TABLE articles_cache ADD FULLTEXT INDEX ft_search (title, title_zh, abstract, abstract_zh)'
  );

  await ensureColumn(
    connection,
    'user_profiles',
    'literature_push_enabled',
    'ALTER TABLE user_profiles ADD COLUMN literature_push_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER clinical_notes'
  );
}

async function applyArticleDoiUniqueSchema(connection) {
  await ensureColumn(
    connection,
    'articles_cache',
    'doi',
    'ALTER TABLE articles_cache ADD COLUMN doi VARCHAR(255) NULL AFTER id'
  );

  // Older Crossref-only records already carry a canonical doi.org URL. Backfill
  // them before enabling the constraint so future PubMed imports cannot create
  // a second row for the same publication.
  await connection.execute(`
    UPDATE articles_cache
       SET doi = LOWER(LEFT(SUBSTRING(url, 17), 255))
     WHERE doi IS NULL
       AND LOWER(url) LIKE 'https://doi.org/%'
  `);

  await ensureIndex(
    connection,
    'articles_cache',
    'uq_articles_doi',
    'ALTER TABLE articles_cache ADD UNIQUE INDEX uq_articles_doi (doi)'
  );
}

async function applyProfileClinicalDetailsSchema(connection) {
  const columns = [
    ['province', 'ALTER TABLE user_profiles ADD COLUMN province VARCHAR(80) NULL AFTER region'],
    ['mobility_stage', 'ALTER TABLE user_profiles ADD COLUMN mobility_stage VARCHAR(40) NULL AFTER ambulatory_status'],
    ['respiratory_support', 'ALTER TABLE user_profiles ADD COLUMN respiratory_support VARCHAR(40) NULL AFTER mobility_stage'],
    ['ejection_fraction', 'ALTER TABLE user_profiles ADD COLUMN ejection_fraction TINYINT UNSIGNED NULL AFTER respiratory_support'],
    ['steroid_status', 'ALTER TABLE user_profiles ADD COLUMN steroid_status VARCHAR(30) NULL AFTER on_steroids'],
    ['steroid_medication', 'ALTER TABLE user_profiles ADD COLUMN steroid_medication VARCHAR(30) NULL AFTER steroid_status'],
    ['mutation_type', 'ALTER TABLE user_profiles ADD COLUMN mutation_type VARCHAR(30) NULL AFTER genetic_profile'],
    ['exon_start', 'ALTER TABLE user_profiles ADD COLUMN exon_start TINYINT UNSIGNED NULL AFTER mutation_type'],
    ['exon_end', 'ALTER TABLE user_profiles ADD COLUMN exon_end TINYINT UNSIGNED NULL AFTER exon_start']
  ];

  for (const [columnName, ddlSql] of columns) {
    await ensureColumn(connection, 'user_profiles', columnName, ddlSql);
  }
}

async function applyRehabRepeatPlaybackSchema(connection) {
  const [oldIndexRows] = await connection.execute(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'rehab_checkin_details'
       AND index_name = 'uk_checkin_video'
     LIMIT 1`
  );
  if (oldIndexRows.length > 0) {
    await connection.execute('ALTER TABLE rehab_checkin_details DROP INDEX uk_checkin_video');
  }

  // Keep the earliest row if legacy data accidentally reused an order number.
  await connection.execute(`
    DELETE d1 FROM rehab_checkin_details d1
    INNER JOIN rehab_checkin_details d2
      ON d1.checkin_id = d2.checkin_id
     AND d1.video_order = d2.video_order
     AND d1.id > d2.id
  `);

  await ensureIndex(
    connection,
    'rehab_checkin_details',
    'uk_checkin_order',
    'ALTER TABLE rehab_checkin_details ADD UNIQUE INDEX uk_checkin_order (checkin_id, video_order)'
  );
}

async function runMigrations() {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_operation_logs (
        id bigint NOT NULL AUTO_INCREMENT,
        user_id int NOT NULL,
        action varchar(50) NOT NULL,
        content_type varchar(20) DEFAULT NULL,
        content_id varchar(100) DEFAULT NULL,
        content_title varchar(500) DEFAULT NULL,
        message_count int DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_user_id (user_id),
        KEY idx_action (action),
        KEY idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id varchar(120) NOT NULL,
        executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
      [MIGRATION_ID]
    );
    if (rows.length === 0) {
      await applyPerformanceSchemaV2(connection);
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [MIGRATION_ID]);
      console.log(`✅ 数据库迁移完成: ${MIGRATION_ID}`);
    }

    const [doiRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
      [DOI_UNIQUE_MIGRATION_ID]
    );
    if (doiRows.length === 0) {
      await applyArticleDoiUniqueSchema(connection);
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [DOI_UNIQUE_MIGRATION_ID]);
      console.log(`✅ 数据库迁移完成: ${DOI_UNIQUE_MIGRATION_ID}`);
    }

    const [profileRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
      [PROFILE_DETAILS_MIGRATION_ID]
    );
    if (profileRows.length === 0) {
      await applyProfileClinicalDetailsSchema(connection);
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [PROFILE_DETAILS_MIGRATION_ID]);
      console.log(`Profile clinical details migration completed: ${PROFILE_DETAILS_MIGRATION_ID}`);
    }

    await ensureColumn(connection, 'user_profiles', 'birth_date', "ALTER TABLE user_profiles ADD COLUMN birth_date DATE NULL DEFAULT NULL COMMENT '出生日期；为空时兼容历史年龄' AFTER age");

    const [rehabRepeatRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
      [REHAB_REPEAT_PLAYBACK_MIGRATION_ID]
    );
    if (rehabRepeatRows.length === 0) {
      await applyRehabRepeatPlaybackSchema(connection);
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [REHAB_REPEAT_PLAYBACK_MIGRATION_ID]);
      console.log(`Rehab repeat playback migration completed: ${REHAB_REPEAT_PLAYBACK_MIGRATION_ID}`);
    }

    const [drugNameRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
      [ARTICLE_DRUG_NAMES_MIGRATION_ID]
    );
    if (drugNameRows.length === 0) {
      await ensureColumn(connection, 'articles_cache', 'drug_names',
        'ALTER TABLE articles_cache ADD COLUMN drug_names JSON NULL AFTER sub_tags');
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [ARTICLE_DRUG_NAMES_MIGRATION_ID]);
      console.log(`Article drug names migration completed: ${ARTICLE_DRUG_NAMES_MIGRATION_ID}`);
    }

    const [emailVisitRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1', [EMAIL_VISIT_MIGRATION_ID]
    );
    if (emailVisitRows.length === 0) {
      await ensureColumn(connection, 'email_push_logs', 'visited_at',
        'ALTER TABLE email_push_logs ADD COLUMN visited_at TIMESTAMP NULL DEFAULT NULL AFTER pushed_at');
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [EMAIL_VISIT_MIGRATION_ID]);
      console.log(`Email platform visit migration completed: ${EMAIL_VISIT_MIGRATION_ID}`);
    }

    const [dailyViewRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1', [ARTICLE_DAILY_VIEWS_MIGRATION_ID]
    );
    if (dailyViewRows.length === 0) {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS article_daily_views (
          article_id varchar(50) NOT NULL,
          view_date date NOT NULL,
          view_count int unsigned NOT NULL DEFAULT 0,
          PRIMARY KEY (article_id, view_date),
          KEY idx_view_date_article (view_date, article_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [ARTICLE_DAILY_VIEWS_MIGRATION_ID]);
      console.log(`Article daily views migration completed: ${ARTICLE_DAILY_VIEWS_MIGRATION_ID}`);
    }

    const [uvRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1', [ARTICLE_UV_MIGRATION_ID]
    );
    if (uvRows.length === 0) {
      await ensureColumn(connection, 'articles_cache', 'uv_count',
        'ALTER TABLE articles_cache ADD COLUMN uv_count INT UNSIGNED NOT NULL DEFAULT 0');
      await connection.execute(`CREATE TABLE IF NOT EXISTS article_visitors (
        article_id VARCHAR(50) NOT NULL,
        user_id INT NOT NULL,
        PRIMARY KEY (article_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await connection.execute(`CREATE TABLE IF NOT EXISTS article_daily_visitors (
        article_id VARCHAR(50) NOT NULL,
        user_id INT NOT NULL,
        visit_date DATE NOT NULL,
        PRIMARY KEY (article_id, user_id, visit_date),
        KEY idx_visit_date_article_user (visit_date, article_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // Existing aggregate PV has no visitor identities and cannot be converted to UV.
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [ARTICLE_UV_MIGRATION_ID]);
    }

    const [splitAnalysisRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1', [ARTICLE_SPLIT_ANALYSIS_MIGRATION_ID]
    );
    if (splitAnalysisRows.length === 0) {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS article_public_analysis_cache (
          article_id varchar(50) NOT NULL,
          prompt_version varchar(64) NOT NULL,
          quick_conclusion mediumtext NOT NULL,
          detailed_reading mediumtext NOT NULL,
          created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (article_id, prompt_version)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS article_personal_analysis_cache (
          user_id int NOT NULL,
          article_id varchar(50) NOT NULL,
          profile_hash char(32) NOT NULL,
          prompt_version varchar(64) NOT NULL,
          personalized_meaning mediumtext NOT NULL,
          family_takeaway mediumtext NOT NULL,
          created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, article_id, profile_hash, prompt_version)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [ARTICLE_SPLIT_ANALYSIS_MIGRATION_ID]);
      console.log(`Article split analysis migration completed: ${ARTICLE_SPLIT_ANALYSIS_MIGRATION_ID}`);
    }
    const [contentPreferenceRows] = await connection.execute(
      'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1', [CONTENT_PREFERENCE_MIGRATION_ID]
    );
    if (contentPreferenceRows.length === 0) {
      await ensureColumn(connection, 'user_profiles', 'content_preference',
        'ALTER TABLE user_profiles ADD COLUMN content_preference TINYINT UNSIGNED NOT NULL DEFAULT 40');
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [CONTENT_PREFERENCE_MIGRATION_ID]);
    }
    await connection.execute(`CREATE TABLE IF NOT EXISTS user_language_preferences (
      user_id INT NOT NULL PRIMARY KEY,
      language_mode VARCHAR(10) NOT NULL,
      preferred_locale VARCHAR(16) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const rehabLevelsSql = require('fs').readFileSync(
      require('path').join(__dirname, '../database/20261026_rehab_video_levels.sql'), 'utf8'
    );
    for (const statement of rehabLevelsSql.split(';').map(sql => sql.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

module.exports = { runMigrations };
