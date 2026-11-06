const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { normalizePhone, codeHash, sendSms } = require('./smsService');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function registerPhoneAuth(app, { pool, authenticateToken, secret, recordLogin }) {
  const route = (handler) => async (req, res) => {
    try { await handler(req, res); }
    catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '该手机号已绑定其他账号' });
      res.status(err.status || 500).json({ error: err.status ? err.message : '服务暂不可用，请稍后重试' });
    }
  };
  async function locked(phone, action) {
    const connection = await pool.getConnection();
    const key = `sms:${phone}`;
    let acquired = false;
    try {
      const [rows] = await connection.execute('SELECT GET_LOCK(?, 5) AS acquired', [key]);
      acquired = rows[0].acquired === 1;
      if (!acquired) throw fail('操作频繁，请稍后重试', 429);
      return await action(connection);
    } finally {
      try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [key]); }
      finally { connection.release(); }
    }
  }
  async function limit(connection, key, maximum, seconds) {
    const bucket = crypto.createHash('sha256').update(key).digest('hex');
    await connection.execute(`INSERT INTO sms_rate_limits (bucket, hits, expires_at)
      VALUES (?, 1, DATE_ADD(NOW(), INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE
      hits = IF(expires_at <= NOW(), 1, hits + 1),
      expires_at = IF(expires_at <= NOW(), VALUES(expires_at), expires_at)`, [bucket, seconds]);
    const [rows] = await connection.execute('SELECT hits FROM sms_rate_limits WHERE bucket = ?', [bucket]);
    if (rows[0].hits > maximum) throw fail('验证码请求过于频繁，请稍后重试', 429);
  }
  const send = (purpose) => route(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const userId = purpose === 'bind' ? req.user.userId : null;
    const scope = purpose === 'bind' ? `bind:${userId}:${phone}` : `login:${phone}`;
    await locked(phone, async (connection) => {
      await connection.execute('DELETE FROM sms_rate_limits WHERE expires_at < NOW() LIMIT 100');
      if (purpose === 'bind') {
        const [current] = await connection.execute('SELECT phone, is_active FROM users WHERE id = ?', [userId]);
        if (!current.length || !current[0].is_active) throw fail('账号不可用', 403);
        if (current[0].phone) throw fail('当前账号已绑定手机号', 409);
        const [owners] = await connection.execute('SELECT id FROM users WHERE phone = ?', [phone]);
        if (owners.length) throw fail('该手机号已绑定其他账号', 409);
      }
      await limit(connection, `cooldown:${phone}`, 1, 60);
      await limit(connection, `phone-day:${phone}`, 10, 86400);
      await limit(connection, `ip-minute:${req.ip}`, 5, 60);
      await limit(connection, `ip-day:${req.ip}`, 50, 86400);
      const code = String(crypto.randomInt(100000, 1000000));
      // Invalidate the preceding challenge before submitting a replacement.
      await connection.execute('DELETE FROM sms_challenges WHERE scope = ?', [scope]);
      await sendSms(phone, code);
      await connection.execute(`INSERT INTO sms_challenges
        (scope, phone, purpose, user_id, code_hash, expires_at, sent_at)
        VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW())`,
      [scope, phone, purpose, userId, codeHash(scope, code, secret)]);
    });
    res.json({ message: '验证码已发送，5分钟内有效', retryAfter: 60 });
  });
  const verify = (purpose) => route(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (typeof req.body.code !== 'string' || !/^\d{6}$/.test(req.body.code)) throw fail('请输入6位验证码');
    const userId = purpose === 'bind' ? req.user.userId : null;
    const scope = purpose === 'bind' ? `bind:${userId}:${phone}` : `login:${phone}`;
    const user = await locked(phone, async (connection) => {
      const [rows] = await connection.execute(`SELECT *, expires_at > NOW() AS valid
        FROM sms_challenges WHERE scope = ?`, [scope]);
      const challenge = rows[0];
      if (!challenge || !challenge.valid || challenge.consumed || challenge.attempts >= 5) throw fail('验证码错误或已过期');
      if (challenge.code_hash !== codeHash(scope, req.body.code, secret)) {
        await connection.execute('UPDATE sms_challenges SET attempts = attempts + 1 WHERE scope = ?', [scope]);
        throw fail('验证码错误或已过期');
      }
      await connection.beginTransaction();
      try {
        let user;
        if (purpose === 'bind') {
          const [users] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId]);
          user = users[0];
          if (!user || !user.is_active) throw fail('账号不可用', 403);
          if (user.phone) throw fail('当前账号已绑定手机号', 409);
          await connection.execute('UPDATE users SET phone = ?, phone_bound_at = NOW() WHERE id = ?', [phone, userId]);
        } else {
          const [users] = await connection.execute('SELECT * FROM users WHERE phone = ? FOR UPDATE', [phone]);
          user = users[0];
          if (user && !user.is_active) throw fail('账号已被禁用', 403);
          if (!user) {
            const username = `DMD_${crypto.randomBytes(12).toString('hex')}`;
            const [created] = await connection.execute(`INSERT INTO users (username, email, phone, phone_bound_at)
              VALUES (?, NULL, ?, NOW())`, [username, phone]);
            user = { id: created.insertId, username };
          }
          await connection.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
        }
        await connection.execute('UPDATE sms_challenges SET consumed = 1 WHERE scope = ?', [scope]);
        await connection.commit();
        return user;
      } catch (err) { await connection.rollback(); throw err; }
    });
    if (purpose === 'bind') return res.json({ message: '手机号绑定成功', phone: phone.replace(/^(\d{3})\d{4}/, '$1****') });
    const token = jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '7d' });
    await recordLogin({ userId: user.id, action: 'login' });
    res.json({ token, username: user.username });
  });
  app.post('/api/auth/phone/send-code', send('login'));
  app.post('/api/auth/phone/verify-code', verify('login'));
  app.post('/api/phone/send-code', authenticateToken, send('bind'));
  app.post('/api/phone/verify', authenticateToken, verify('bind'));
  app.get('/api/user/phone-status', authenticateToken, route(async (req, res) => {
    const [users] = await pool.execute('SELECT phone, is_active FROM users WHERE id = ?', [req.user.userId]);
    if (!users.length || !users[0].is_active) throw fail('账号不可用', 401);
    const phone = users[0].phone;
    res.json({ bound: !!phone, phone: phone ? phone.replace(/^(\d{3})\d{4}/, '$1****') : null });
  }));
}
module.exports = { registerPhoneAuth };
