const mysql = require('mysql2/promise');
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number.parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER = process.env.DB_USER || '';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || '';

if (NODE_ENV === 'production') {
  if (!DB_USER || DB_USER.toLowerCase() === 'root') {
    throw new Error('生产环境必须使用非 root 的最小权限数据库账号 (DB_USER)');
  }
  if (!DB_PASSWORD) {
    throw new Error('生产环境必须配置强密码 DB_PASSWORD');
  }
  if (!DB_NAME) {
    throw new Error('生产环境必须配置 DB_NAME');
  }
}

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number.isFinite(DB_PORT) ? DB_PORT : 3306,
  user: DB_USER || 'root',
  password: DB_PASSWORD,
  database: DB_NAME || 'dmd_companion',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const allowDangerousSql = String(process.env.ALLOW_DANGEROUS_SQL || '').toLowerCase() === 'true';
const dangerousSqlPattern = /\b(drop\s+database|drop\s+table|truncate\s+table|rename\s+table|create\s+user|alter\s+user|drop\s+user|grant\s+all|grant\s+.*\bon\b|revoke\s+all|set\s+global|flush\s+privileges|shutdown)\b/i;

function assertSafeSql(sql) {
  if (allowDangerousSql) return;
  if (typeof sql !== 'string') return;
  if (dangerousSqlPattern.test(sql)) {
    throw new Error('检测到高危 SQL，已在应用层阻断执行');
  }
}

const rawExecute = pool.execute.bind(pool);
pool.execute = async (sql, params) => {
  assertSafeSql(sql);
  return rawExecute(sql, params);
};

const rawQuery = pool.query.bind(pool);
pool.query = async (sql, params) => {
  assertSafeSql(sql);
  return rawQuery(sql, params);
};

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL 数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ MySQL 数据库连接失败:', error.message);
    return false;
  }
}

module.exports = { pool, testConnection };
