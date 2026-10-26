/**
 * 数据库种子脚本 - 创建测试用户
 * 运行: node seed.js
 */

const bcrypt = require('bcryptjs');
const { pool, testConnection } = require('./db');

const USERS = [
  { username: 'DMDsetup#1', password: '52011' },
  { username: 'DMDsetup#2', password: '52012' },
  { username: 'DMDsetup#3', password: '52013' },
  { username: 'DMDsetup#4', password: '52014' },
  { username: 'DMDsetup#5', password: '52015' },
  { username: 'DMDsetup#6', password: '52016' },
  { username: 'DMDsetup#7', password: '52017' },
  { username: 'DMDsetup#8', password: '52018' },
  { username: 'DMDsetup#9', password: '52019' }
];

async function seedUsers() {
  const connected = await testConnection();
  if (!connected) {
    console.error('无法连接数据库，请检查配置');
    process.exit(1);
  }

  console.log('开始创建测试用户...');

  for (const user of USERS) {
    try {
      // 检查用户是否已存在
      const [existing] = await pool.execute(
        'SELECT id FROM users WHERE username = ?',
        [user.username]
      );

      if (existing.length > 0) {
        console.log(`用户 ${user.username} 已存在，跳过`);
        continue;
      }

      // 创建密码hash
      const passwordHash = await bcrypt.hash(user.password, 10);

      // 插入用户
      await pool.execute(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        [user.username, passwordHash]
      );

      console.log(`✅ 创建用户: ${user.username} (密码: ${user.password})`);
    } catch (error) {
      console.error(`❌ 创建用户 ${user.username} 失败:`, error.message);
    }
  }

  console.log('\n种子数据创建完成!');
  process.exit(0);
}

seedUsers();
