async function applyPhoneSchema(connection, ensureColumn) {
  const [columns] = await connection.execute("SHOW COLUMNS FROM users LIKE 'email'");
  if (columns[0]?.Null === 'NO') {
    // Preserve the deployed column definition and existing values; only relax nullability.
    const column = columns[0];
    if (!/^varchar\(\d+\)$/i.test(column.Type)) throw new Error('Unexpected users.email type');
    await connection.execute(`ALTER TABLE users MODIFY COLUMN email ${column.Type} NULL DEFAULT NULL`);
  }
  await ensureColumn(connection, 'users', 'phone', 'ALTER TABLE users ADD COLUMN phone VARCHAR(16) NULL DEFAULT NULL');
  await ensureColumn(connection, 'users', 'phone_bound_at', 'ALTER TABLE users ADD COLUMN phone_bound_at TIMESTAMP NULL DEFAULT NULL');
  const [indexes] = await connection.execute("SHOW INDEX FROM users WHERE Key_name = 'uk_phone'");
  if (!indexes.length) await connection.execute('ALTER TABLE users ADD UNIQUE INDEX uk_phone (phone)');
  await connection.execute(`CREATE TABLE IF NOT EXISTS sms_challenges (
    scope VARCHAR(64) NOT NULL PRIMARY KEY, phone VARCHAR(16) NOT NULL,
    purpose VARCHAR(10) NOT NULL, user_id BIGINT NULL, code_hash CHAR(64) NOT NULL,
    attempts INT NOT NULL DEFAULT 0, expires_at DATETIME NOT NULL,
    sent_at DATETIME NOT NULL, consumed TINYINT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await connection.execute(`CREATE TABLE IF NOT EXISTS sms_rate_limits (
    bucket CHAR(64) NOT NULL PRIMARY KEY, hits INT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL, INDEX idx_sms_rate_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
module.exports = { applyPhoneSchema };
