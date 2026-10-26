const { registerLocaleRoutes, localeMiddleware, getRequestLocale } = require('./localeService');
const profileRulesPromise = import('./profileRules.mjs');
const CONSULTATION_PROMPT_VERSION = 'trial-detail-v2-20260923';
﻿﻿const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pool, testConnection } = require('./db');
const { ensureShareTable, registerShareRoutes } = require('./interpretationShares');
const { runMigrations } = require('./migrationService');
const { chatWithArticle, analyzeDrug, chatWithDrug, analyzeTrial, chatWithTrial, generateRecommendedQuestions } = require('./geminiService');
const { articleAnalysisService } = require('./articleAnalysisService');
const { getDrugEvents } = require('./adverseEventService');
const { recordUserOperationSafely, contentForOperation } = require('./operationLogService');
const { buildTrialAnalysisContext, normalizeMatchRows } = require('./trialAnalysisContext');
const { buildAITrialMatches } = require('./trialAIMatching');
const { getEvidence } = require('./consultationEvidence');
const { startArticleDrugBackfill } = require('./articleDrugBackfill');
const { recordEmailVisit } = require('./emailVisitService');
const rehabService = require('./rehabService');
require('dotenv').config();

// 微信公众号配置
const WECHAT_CONFIG = {
  appId: process.env.WECHAT_APP_ID || '',
  appSecret: process.env.WECHAT_APP_SECRET || '',
  redirectUri: process.env.WECHAT_REDIRECT_URI || 'http://localhost:5173/wechat/callback'
};

const app = express();
const PORT = process.env.SERVER_PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || (NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex'));
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 未配置，生产环境禁止使用默认密钥');
}

// 枚举映射 - 前端显示值 <-> 数据库值
const REGION_MAP = {
  '亚洲 (Asia)': 'ASIA',
  '北美 (North America)': 'NORTH_AMERICA',
  '欧洲 (Europe)': 'EUROPE',
  '其他 (Other)': 'OTHER'
};

const REGION_MAP_REVERSE = Object.fromEntries(
  Object.entries(REGION_MAP).map(([k, v]) => [v, k])
);

const INTEREST_MAP = {
  '新药与临床试验': 'MEDICATIONS',
  '日常护理与康复': 'DAILY_CARE',
  '心脏与肺部健康': 'HEART_LUNGS',
  '基因疗法动态': 'GENE_THERAPY',
  '基础科学研究': 'BASIC_SCIENCE'
};

const INTEREST_MAP_REVERSE = Object.fromEntries(
  Object.entries(INTEREST_MAP).map(([k, v]) => [v, k])
);

const corsOriginEnv = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '';
const corsAllowlist = corsOriginEnv
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (corsAllowlist.length === 0 || corsAllowlist.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));
app.use(express.json());
// Use explicit proxy IPs/subnets; do not trust arbitrary forwarded headers.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean));
app.use('/api', localeMiddleware);

// JWT 验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: '令牌无效或已过期' });
    }
    req.user = user;
    next();
  });
};

// 记录已认证用户成功提交的 API 操作；AI 解读和康复完成已有更具体的日志。
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ||
      /^\/(activity|email-push\/visit|auth\/|ai\/(analyze|chat)|rehab\/checkin\/\d+\/complete)/.test(req.path)) return next();
  const token = (req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
  if (!token) return next();
  let identity;
  try { identity = jwt.verify(token, JWT_SECRET); } catch { return next(); }
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    void recordUserOperationSafely({ userId: identity.userId, action: 'api_action',
      contentId: `${req.method} ${req.path}` });
  });
  next();
});

registerLocaleRoutes(app, pool, authenticateToken);

app.post('/api/activity', authenticateToken, async (req, res) => {
  const { action, contentType, contentId } = req.body || {};
  if (!['page_view', 'content_view', 'search', 'logout'].includes(action) ||
      (contentType != null && !['article', 'trial', 'drug'].includes(contentType)) ||
      (contentId != null && (typeof contentId !== 'string' || contentId.length > 100))) {
    return res.status(400).json({ error: '无效的操作事件' });
  }
  await recordUserOperationSafely({ userId: req.user.userId, action, contentType, contentId });
  res.json({ success: true });
});

// 邮件链接在前端实际加载后回传；不把邮件预览或链接扫描当成打开平台。
app.post('/api/email-push/visit', async (req, res) => {
  try {
    const recorded = await recordEmailVisit(req.body?.token);
    res.json({ recorded });
  } catch (error) {
    console.error('记录邮件访问失败:', error);
    res.status(500).json({ error: '记录访问失败' });
  }
});

registerShareRoutes(app, pool, authenticateToken);
const adminUserIds = new Set(
  String(process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0)
);

const requireAdmin = (req, res, next) => {
  const userId = Number(req.user?.userId);
  if (!Number.isInteger(userId) || !adminUserIds.has(userId)) {
    return res.status(403).json({ error: '无管理权限' });
  }
  next();
};

function toPositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// =============================================
// 用户认证 API
// 注意: 已移除用户名/密码登录和注册，仅支持微信授权登录和邮箱验证码登录
// =============================================

// =============================================
// 邮箱绑定验证 API
// =============================================
const { sendVerificationCode, verifyCode, sendLoginVerificationCode, verifyLoginCode } = require('./emailService');

// 发送邮箱验证码
app.post('/api/email/send-code', authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }
    
    // 检查邮箱是否已被其他用户绑定
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, userId]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: '该邮箱已被其他账号绑定' });
    }
    
    const result = await sendVerificationCode(email, userId);
    
    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('发送验证码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 验证验证码并绑定邮箱
app.post('/api/email/verify', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.userId;
    
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: '请输入6位验证码' });
    }
    
    const result = verifyCode(userId, code);
    
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    
    // 验证成功，更新用户邮箱
    await pool.execute(
      'UPDATE users SET email = ? WHERE id = ?',
      [result.email, userId]
    );
    
    console.log(`✅ 用户 ${userId} 成功绑定邮箱: ${result.email}`);
    res.json({ message: '邮箱绑定成功', email: result.email });
  } catch (error) {
    console.error('验证邮箱错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 检查用户邮箱绑定状态
app.get('/api/user/email-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const [users] = await pool.execute(
      'SELECT email FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    const email = users[0].email;
    res.json({ 
      bound: !!email, 
      email: email ? email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : null 
    });
  } catch (error) {
    console.error('获取邮箱状态错误', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// =============================================
// 邮箱验证码登录API
// =============================================

// 发送登录验证码
app.post('/api/auth/login/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }
    
    // 检查邮箱是否已注册
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND is_active = TRUE',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: '该邮箱尚未注册' });
    }
    
    const result = await sendLoginVerificationCode(email);
    
    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('发送登录验证码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 邮箱验证码登录
app.post('/api/auth/login/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }
    
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: '请输入6位验证码' });
    }
    
    // 验证验证码
    const verifyResult = verifyLoginCode(email, code);
    
    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.message });
    }
    
    // 验证码正确，查找用户
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ error: '用户不存在或已被禁用' });
    }
    
    const user = users[0];
    
    // 更新最后登录时间
    await pool.execute(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [user.id]
    );
    
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    await recordUserOperationSafely({ userId: user.id, action: 'login' });
    res.json({ token, username: user.username });
  } catch (error) {
    console.error('邮箱验证码登录错误', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// =============================================
// 微信公众号登录API
// =============================================

// 生成微信授权登录URL
app.get('/api/auth/wechat/url', (req, res) => {
  if (!WECHAT_CONFIG.appId || !WECHAT_CONFIG.appSecret) {
    return res.status(503).json({ error: '微信登录服务未配置' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  const scope = 'snsapi_userinfo';
  const redirectUri = encodeURIComponent(WECHAT_CONFIG.redirectUri);
  
  const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WECHAT_CONFIG.appId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}#wechat_redirect`;
  
  res.json({ url: authUrl, state });
});

// 微信授权回调处理 (GET - 微信重定向回调
app.get('/api/auth/wechat/callback', async (req, res) => {
  if (!WECHAT_CONFIG.appId || !WECHAT_CONFIG.appSecret) {
    return res.status(503).json({ error: '微信登录服务未配置' });
  }
  const frontendUrl = process.env.FRONTEND_URL || 'https://dmd.medebound.com';
  
  console.log('=== 微信回调开始===');
  console.log('收到code:', req.query.code);
  console.log('收到state:', req.query.state);
  
  try {
    const { code } = req.query;
    
    if (!code) {
      console.error('缺少code参数');
      return res.redirect(`${frontendUrl}?wechat_error=missing_code`);
    }
    
    // 1. 通过 code 获取 access_token
    console.log('正在获取access_token...');
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${WECHAT_CONFIG.appId}&secret=${WECHAT_CONFIG.appSecret}&code=${code}&grant_type=authorization_code`;
    
    const tokenResponse = await axios.get(tokenUrl);
    const tokenData = tokenResponse.data;
    console.log('微信token响应:', JSON.stringify(tokenData));
    
    if (tokenData.errcode) {
      console.error('微信获取token失败:', tokenData);
      return res.redirect(`${frontendUrl}?wechat_error=token_failed`);
    }
    
    const { access_token, openid, unionid } = tokenData;
    
    // 2. 获取用户信息
    const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`;
    
    const userInfoResponse = await axios.get(userInfoUrl);
    const userInfo = userInfoResponse.data;
    
    if (userInfo.errcode) {
      console.error('微信获取用户信息失败:', userInfo);
      return res.redirect(`${frontendUrl}?wechat_error=userinfo_failed`);
    }
    
    console.log('微信用户信息:', JSON.stringify(userInfo));
    
    // 3. 检查微信用户是否已绑定
    console.log('检查用户是否已绑定, openid:', openid);
    const [existingWechatUser] = await pool.execute(
      'SELECT wu.*, u.username FROM wechat_users wu JOIN users u ON wu.user_id = u.id WHERE wu.openid = ?',
      [openid]
    );
    
    let userId, username;
    
    if (existingWechatUser.length > 0) {
      // 已有绑定，直接登录
      userId = existingWechatUser[0].user_id;
      username = existingWechatUser[0].username;
      
      // 更新微信用户信息
      await pool.execute(
        `UPDATE wechat_users SET 
          nickname = ?, headimgurl = ?, sex = ?, province = ?, city = ?, country = ?, updated_at = NOW()
        WHERE openid = ?`,
        [userInfo.nickname, userInfo.headimgurl, userInfo.sex, userInfo.province, userInfo.city, userInfo.country, openid]
      );
    } else {
      // 新微信用户，自动创建账号
      console.log('新微信用户，开始创建账号...');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        
        // 生成用户名(格式: DMDwx#序号)
        const [countResult] = await connection.execute(
          'SELECT COUNT(*) as count FROM wechat_users'
        );
        const wxUserCount = countResult[0].count + 1;
        username = `DMDwx#${wxUserCount}`;
        console.log('生成用户名', username);
        
        // 创建用户 (无需密码，仅支持微信和邮箱验证码登录)
        const [userResult] = await connection.execute(
          'INSERT INTO users (username) VALUES (?)',
          [username]
        );
        userId = userResult.insertId;
        
        // 创建微信用户关联
        await connection.execute(
          `INSERT INTO wechat_users 
            (user_id, openid, unionid, nickname, headimgurl, sex, province, city, country)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, openid, unionid || null, userInfo.nickname, userInfo.headimgurl, userInfo.sex, userInfo.province, userInfo.city, userInfo.country]
        );
        
        await connection.commit();
        console.log(`✅ 微信用户自动注册: ${username} (openid: ${openid})`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    
    // 更新最后登录时间
    await pool.execute(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [userId]
    );
    
    // 生成 JWT token
    const token = jwt.sign(
      { userId, username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    await recordUserOperationSafely({ userId, action: 'login' });
    // 重定向到前端，带上token和用户名
    console.log('=== 微信登录成功 ===');
    console.log('用户ID:', userId, '用户名', username);
    res.redirect(`${frontendUrl}?wechat_token=${token}&wechat_username=${encodeURIComponent(username)}`);
  } catch (error) {
    console.error('=== 微信登录错误 ===');
    console.error('错误详情:', error.message);
    console.error('错误堆栈:', error.stack);
    res.redirect(`${frontendUrl}?wechat_error=server_error`);
  }
});

// =============================================
// 用户档案 API
// =============================================

// 获取用户完整数据
app.get('/api/user/data', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // 获取用户档案
    const [profiles] = await pool.execute(
      `SELECT *, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date_text FROM user_profiles WHERE user_id = ?`,
      [userId]
    );
    
    // 获取用户兴趣
    const [interests] = await pool.execute(
      'SELECT interest_area FROM user_interests WHERE user_id = ?',
      [userId]
    );
    
    // 获取已保存的查询
    const [inquiries] = await pool.execute(
      'SELECT * FROM saved_inquiries WHERE user_id = ? ORDER BY inquiry_date DESC',
      [userId]
    );
    
    // 批量获取聊天记录，避免N+1 查询
    const inquiryIds = inquiries.map(i => i.id);
    const chatMap = new Map();
    if (inquiryIds.length > 0) {
      const placeholders = inquiryIds.map(() => '?').join(', ');
      const [allMessages] = await pool.execute(
        `SELECT inquiry_id, role, message_text as text
         FROM chat_messages
         WHERE inquiry_id IN (${placeholders})
         ORDER BY inquiry_id, message_order`,
        inquiryIds
      );

      for (const msg of allMessages) {
        if (!chatMap.has(msg.inquiry_id)) {
          chatMap.set(msg.inquiry_id, []);
        }
        chatMap.get(msg.inquiry_id).push({ role: msg.role, text: msg.text });
      }
    }

    for (const inquiry of inquiries) {
      inquiry.chatHistory = chatMap.get(inquiry.id) || [];
    }
    
    const profile = profiles.length > 0 ? {
      isConfigured: profiles[0].is_configured,
      age: profiles[0].birth_date_text ? (await profileRulesPromise).ageFromBirthDate(profiles[0].birth_date_text) : profiles[0].age,
      birthDate: profiles[0].birth_date_text || null,
      geneticProfile: profiles[0].genetic_profile || '',
      ambulatoryStatus: profiles[0].ambulatory_status,
      onSteroids: profiles[0].on_steroids,
      region: REGION_MAP_REVERSE[profiles[0].region] || profiles[0].region,
      interests: interests.map(i => INTEREST_MAP_REVERSE[i.interest_area] || i.interest_area),
      clinicalNotes: profiles[0].clinical_notes || '',
      contentPreference: profiles[0].content_preference == null ? 40 : Number(profiles[0].content_preference),
      hasJointPain: profiles[0].has_joint_pain === 1 ? true : profiles[0].has_joint_pain === 0 ? false : null,
      jointPainDetails: profiles[0].joint_pain_details || '',
      hasJointContracture: profiles[0].has_joint_contracture === 1 ? true : profiles[0].has_joint_contracture === 0 ? false : null,
      jointContractureDetails: profiles[0].joint_contracture_details || '',
      province: profiles[0].province || '',
      mobilityStage: profiles[0].mobility_stage || undefined,
      respiratorySupport: profiles[0].respiratory_support || undefined,
      ejectionFraction: profiles[0].ejection_fraction == null ? undefined : Number(profiles[0].ejection_fraction),
      steroidStatus: profiles[0].steroid_status || undefined,
      steroidMedication: profiles[0].steroid_medication || undefined,
      mutationType: profiles[0].mutation_type || undefined,
      exonStart: profiles[0].exon_start == null ? undefined : Number(profiles[0].exon_start),
      exonEnd: profiles[0].exon_end == null ? undefined : Number(profiles[0].exon_end)
    } : null;
    
    const savedInquiries = inquiries.map(i => ({
      id: i.id,
      date: i.inquiry_date,
      articleTitle: i.article_title,
      articleId: i.article_id,
      summary: i.summary,
      chatHistory: i.chatHistory
    }));
    
    res.json({
      username: req.user.username,
      profile,
      savedInquiries
    });
  } catch (error) {
    console.error('获取用户数据错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 保存用户档案
app.post('/api/user/profile', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const userId = req.user.userId;
    let profile = req.body;
    
    // 检查是否已有档案
    const [existing] = await connection.execute(
      `SELECT id, age, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date_text FROM user_profiles WHERE user_id = ?`,
      [userId]
    );
    
    try {
      const birthDate = Object.prototype.hasOwnProperty.call(profile, 'birthDate') ? profile.birthDate : existing[0]?.birth_date_text || null;
      if (!existing.length && !birthDate) throw new Error('请填写出生日期');
      profile = (await profileRulesPromise).normalizeProfile({ ...profile, birthDate });
    } catch (error) { error.status = 400; throw error; }

    // 转换前端值到数据库值
    const dbRegion = REGION_MAP[profile.region] || profile.region;
    const dbInterests = (profile.interests || []).map(i => INTEREST_MAP[i] || i);
    
    if (existing.length > 0) {
      // 更新现有档案
      await connection.execute(
        `UPDATE user_profiles SET 
          is_configured = TRUE,
          age = ?,
          birth_date = ?,
          genetic_profile = ?,
          ambulatory_status = ?,
          on_steroids = ?,
          region = ?,
          clinical_notes = ?,
          literature_push_enabled = ?,
          has_joint_pain = ?,
          joint_pain_details = ?,
          has_joint_contracture = ?,
          joint_contracture_details = ?,
          province = ?,
          mobility_stage = ?,
          respiratory_support = ?,
          ejection_fraction = ?,
          steroid_status = ?,
          steroid_medication = ?,
          mutation_type = ?,
          exon_start = ?,
          exon_end = ?,
          content_preference = ?,
          updated_at = NOW()
        WHERE user_id = ?`,
        [
          profile.age,
          profile.birthDate,
          profile.geneticProfile,
          profile.ambulatoryStatus,
          profile.onSteroids,
          dbRegion,
          profile.clinicalNotes,
          1,
          profile.hasJointPain === true ? 1 : profile.hasJointPain === false ? 0 : null,
          profile.jointPainDetails || null,
          profile.hasJointContracture === true ? 1 : profile.hasJointContracture === false ? 0 : null,
          profile.jointContractureDetails || null,
          profile.province || null,
          profile.mobilityStage || null,
          profile.respiratorySupport || null,
          profile.ejectionFraction == null ? null : Number(profile.ejectionFraction),
          profile.steroidStatus || null,
          profile.steroidMedication || null,
          profile.mutationType || null,
          profile.exonStart == null ? null : Number(profile.exonStart),
          profile.exonEnd == null ? null : Number(profile.exonEnd),
          profile.contentPreference,
          userId
        ]
      );
    } else {
      // 创建新档案
      await connection.execute(
        `INSERT INTO user_profiles 
          (user_id, is_configured, age, birth_date, genetic_profile, ambulatory_status, on_steroids, region, clinical_notes, literature_push_enabled, has_joint_pain, joint_pain_details, has_joint_contracture, joint_contracture_details, province, mobility_stage, respiratory_support, ejection_fraction, steroid_status, steroid_medication, mutation_type, exon_start, exon_end, content_preference)
        VALUES (?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          userId,
          profile.age,
          profile.birthDate,
          profile.geneticProfile,
          profile.ambulatoryStatus,
          profile.onSteroids,
          dbRegion,
          profile.clinicalNotes,
          1,
          profile.hasJointPain === true ? 1 : profile.hasJointPain === false ? 0 : null,
          profile.jointPainDetails || null,
          profile.hasJointContracture === true ? 1 : profile.hasJointContracture === false ? 0 : null,
          profile.jointContractureDetails || null,
          profile.province || null,
          profile.mobilityStage || null,
          profile.respiratorySupport || null,
          profile.ejectionFraction == null ? null : Number(profile.ejectionFraction),
          profile.steroidStatus || null,
          profile.steroidMedication || null,
          profile.mutationType || null,
          profile.exonStart == null ? null : Number(profile.exonStart),
          profile.exonEnd == null ? null : Number(profile.exonEnd),
          profile.contentPreference
        ]
      );
    }
    
    // 更新用户兴趣
    await connection.execute(
      'DELETE FROM user_interests WHERE user_id = ?',
      [userId]
    );
    
    if (dbInterests && dbInterests.length > 0) {
      const placeholders = dbInterests.map(() => '(?, ?)').join(', ');
      const params = dbInterests.flatMap(interest => [userId, interest]);
      await connection.execute(
        `INSERT INTO user_interests (user_id, interest_area) VALUES ${placeholders}`,
        params
      );
    }
    
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('保存档案错误:', error);
    res.status(500).json({ error: '服务器错误' });
  } finally {
    connection.release();
  }
});

// =============================================
// 保存的查询API
// =============================================

// 保存查询
app.post('/api/user/inquiry', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const userId = req.user.userId;
    const inquiry = req.body;
    
    // 检查是否已存在
    const [existing] = await connection.execute(
      'SELECT id FROM saved_inquiries WHERE id = ?',
      [inquiry.id]
    );
    
    // 转换日期格式 (前端发送 "2024/12/25" 格式)
    let inquiryDate = new Date();
    if (inquiry.date) {
      // 尝试解析前端日期格式
      const parsed = new Date(inquiry.date.replace(/\//g, '-'));
      if (!isNaN(parsed.getTime())) {
        inquiryDate = parsed;
      }
    }
    
    if (existing.length > 0) {
      // 更新现有查询
      await connection.execute(
        `UPDATE saved_inquiries SET 
          article_title = ?,
          summary = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [inquiry.articleTitle, inquiry.summary, inquiry.id]
      );
      
      // 删除旧的聊天记录
      await connection.execute(
        'DELETE FROM chat_messages WHERE inquiry_id = ?',
        [inquiry.id]
      );
    } else {
      // 创建新查询
      await connection.execute(
        `INSERT INTO saved_inquiries 
          (id, user_id, article_id, article_title, summary, inquiry_date)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [inquiry.id, userId, inquiry.articleId, inquiry.articleTitle, inquiry.summary, inquiryDate]
      );
    }
    
    // 保存聊天记录
    if (inquiry.chatHistory && inquiry.chatHistory.length > 0) {
      const placeholders = inquiry.chatHistory.map(() => '(?, ?, ?, ?)').join(', ');
      const params = inquiry.chatHistory.flatMap((msg, i) => [inquiry.id, msg.role, msg.text, i]);
      await connection.execute(
        `INSERT INTO chat_messages (inquiry_id, role, message_text, message_order) VALUES ${placeholders}`,
        params
      );
    }
    
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('保存查询错误:', error);
    res.status(500).json({ error: '服务器错误' });
  } finally {
    connection.release();
  }
});

// 删除查询
app.delete('/api/user/inquiry/:id', authenticateToken, async (req, res) => {
  try {
    const inquiryId = req.params.id;
    const userId = req.user.userId;
    
    await pool.execute(
      'DELETE FROM saved_inquiries WHERE id = ? AND user_id = ?',
      [inquiryId, userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('删除查询错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// =============================================
// Gemini AI API
// =============================================

// 生成用户档案哈希（用于缓存键）
function generateProfileHash(profile) {
  const key = JSON.stringify(Object.fromEntries(Object.keys(profile).sort().map(key => [key, profile[key]])));
  return crypto.createHash('md5').update(key).digest('hex');
}

// Derive AI age from the signed-in user's stored birthday; never send birthday to the model.
async function refreshAIProfile(req, res, next) {
  try {
    if (!req.body.profile) return res.status(400).json({ error: '缺少用户档案数据' });
    const [rows] = await pool.execute(`SELECT age, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthday,
      mutation_type, exon_start, exon_end, genetic_profile FROM user_profiles WHERE user_id = ?`, [req.user.userId]);
    if (!rows.length) return res.status(400).json({ error: '请先完善个人资料' });
    const stored = rows[0];
    const { profileForAI } = await profileRulesPromise;
    req.body.profile = profileForAI(req.body.profile, stored);
    next();
  } catch (error) { res.status(400).json({ error: '患者资料读取失败，请检查出生日期和外显子范围后重试' }); }
}

// AI 解读（支持文章、药物、试验）
app.post('/api/ai/analyze', authenticateToken, refreshAIProfile, async (req, res) => {
  try {
    const { type, article, drug, trial, profile, selectedCenter } = req.body;
    const analyzeType = type || 'article';
    
    if (!profile) {
      return res.status(400).json({ error: '缺少用户档案数据' });
    }
    
    const profileHash = crypto.createHash('md5').update(CONSULTATION_PROMPT_VERSION + ':' + getRequestLocale() + ':' + new Date().toISOString().slice(0, 10) + ':' + generateProfileHash(profile)).digest('hex');
    let result;
    let cacheId;
    
    if (analyzeType === 'drug') {
      // 药物分析
      if (!drug) {
        return res.status(400).json({ error: '缺少药物数据' });
      }
      cacheId = `drug-${drug.brandName}`;
      
      // 检查缓存
      try {
        const [cached] = await pool.execute(
          'SELECT analysis_content FROM article_analysis_cache WHERE article_id = ? AND profile_hash = ?',
          [cacheId, profileHash]
        );
        
        if (cached.length > 0) {
          console.log(`✅ AI药物分析缓存命中: drug=${drug.brandName}, profile=${profileHash.substring(0, 8)}...`);
          await recordUserOperationSafely({ userId: req.user.userId, action: 'ai_analyze', ...contentForOperation('drug', { drug }) });
          return res.json({ text: cached[0].analysis_content, cached: true });
        }
      } catch (cacheError) {
        console.warn('药物缓存查询失败，继续请求AI:', cacheError.message || cacheError);
      }
      
      console.log(`🤖 请求AI药物分析: drug=${drug.brandName}`);
      result = await analyzeDrug(drug, profile);
      
      // 保存到缓存
      try {
        await pool.execute(
          `INSERT INTO article_analysis_cache (article_id, profile_hash, analysis_content) 
           VALUES (?, ?, ?) 
           ON DUPLICATE KEY UPDATE analysis_content = VALUES(analysis_content), updated_at = CURRENT_TIMESTAMP`,
          [cacheId, profileHash, result]
        );
        console.log(`💾 AI药物分析已缓存 drug=${drug.brandName}`);
      } catch (saveError) {
        console.warn('药物缓存保存失败:', saveError.message);
      }
      
    } else if (analyzeType === 'trial') {
      // 临床试验分析
      if (!trial) {
        return res.status(400).json({ error: '缺少试验数据' });
      }
      const storedTrial = await trialCacheService.getCachedTrialById(trial.nctId);
      if (!storedTrial) return res.status(404).json({ error: '试验不存在' });
      const context = await buildTrialAnalysisContext(storedTrial, null, selectedCenter);
      const match = await buildAITrialMatches(storedTrial, context.registry, profile, selectedCenter);
      const criteriaTrial = context.registry?.eligibility?.eligibilityCriteria
        ? { ...storedTrial, eligibility: context.registry.eligibility.eligibilityCriteria,
          minimumAge: context.registry.eligibility.minimumAge || storedTrial.minimumAge,
          maximumAge: context.registry.eligibility.maximumAge || storedTrial.maximumAge,
          phase: match.studyPhases }
        : { ...storedTrial, phase: match.studyPhases };
      context.matchRows = normalizeMatchRows(match.rows);
      console.log(`🤖 请求AI试验分析: trial=${trial.nctId}`);
      result = await analyzeTrial(criteriaTrial, profile, context);

    } else {
      // 文章分析（默认，带缓存）
      if (!article) {
        return res.status(400).json({ error: '缺少文章数据' });
      }
      const analysis = await articleAnalysisService.analyze(article.id, profile, req.user.userId);
      await recordUserOperationSafely({ userId: req.user.userId, action: 'ai_analyze', ...contentForOperation('article', { article }) });
      return res.json(analysis);
    }
    
    await recordUserOperationSafely({ userId: req.user.userId, action: 'ai_analyze', ...contentForOperation(analyzeType, { article, drug, trial }) });
    res.json({ text: result, cached: false });
  } catch (error) {
    console.error('AI解读错误:', error);
    const errorMsg = error.message || error.toString() || JSON.stringify(error) || '未知错误';
    res.status(error.status || 500).json({ error: error.status ? errorMsg : '服务暂时不可用，请稍后再试。错误: ' + errorMsg });
  }
});

// AI 生成推荐问题
app.post('/api/ai/recommended-questions', authenticateToken, refreshAIProfile, async (req, res) => {
  try {
    const { article, profile } = req.body;

    if (!article || !profile) {
      return res.status(400).json({ error: '缺少文章或用户档案数据' });
    }

    const questions = await generateRecommendedQuestions(article, profile);
    res.json({ questions });
  } catch (error) {
    console.error('生成推荐问题错误:', error);
    // 兜底返回默认问题
    res.json({
      questions: [
        "这项研究对我家孩子有什么意义？",
        "研究中提到的治疗方法安全吗？",
        "我们需要和医生讨论哪些关键点？"
      ]
    });
  }
});

// AI 聊天（支持文章、药物、试验）
app.post('/api/ai/chat', authenticateToken, refreshAIProfile, async (req, res) => {
  try {
    const { type, history, message, article, drug, trial, profile, selectedCenter } = req.body;
    const chatType = type || 'article';
    
    if (!profile || !message) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    let result;
    
    if (chatType === 'drug') {
      if (!drug) {
        return res.status(400).json({ error: '缺少药物数据' });
      }
      result = await chatWithDrug(history, message, drug, profile);
    } else if (chatType === 'trial') {
      if (!trial) {
        return res.status(400).json({ error: '缺少试验数据' });
      }
      const storedTrial = await trialCacheService.getCachedTrialById(trial.nctId);
      if (!storedTrial) return res.status(404).json({ error: '试验不存在' });
      const context = await buildTrialAnalysisContext(storedTrial, null, selectedCenter);
      const match = await buildAITrialMatches(storedTrial, context.registry, profile, selectedCenter);
      const criteriaTrial = context.registry?.eligibility?.eligibilityCriteria
        ? { ...storedTrial, eligibility: context.registry.eligibility.eligibilityCriteria,
          phase: match.studyPhases }
        : { ...storedTrial, phase: match.studyPhases };
      result = await chatWithTrial(history, message, criteriaTrial, profile, {
        matchRows: normalizeMatchRows(match.rows),
        centerSpecialRequirements: match.centerSpecialRequirements
      });
    } else {
      if (!article) {
        return res.status(400).json({ error: '缺少文章数据' });
      }
      result = await chatWithArticle(history, message, article, profile);
    }
    
    await recordUserOperationSafely({ userId: req.user.userId, action: 'ai_chat', ...contentForOperation(chatType, { article, drug, trial }), messageCount: 1 });
    res.json({ text: result });
  } catch (error) {
    console.error('AI聊天错误:', error);
    const errorMsg = error.message || error.toString() || JSON.stringify(error) || '未知错误';
    res.status(500).json({ error: '网络连接出现问题，请重试。错误: ' + errorMsg });
  }
});

// 导入邮件推送服务（替代微信推送）
const { initScheduler, manualPush } = require('./emailPushService');
const { fetchAndCacheArticles, getLatestCachedArticle, getAllCachedArticles, getTotalCachedArticles, getUserFetchedArticles, getUserFetchedArticlesCount, getRandomUserFetchedArticles, fetchAndCacheArticleByDoi, incrementViewCount, getHotArticles } = require('./articleFetchService');

// 导入试验和药物缓存服务
const trialCacheService = require('./trialCacheService');
const drugCacheService = require('./drugCacheService');
const { fetchAndCacheTrials, fetchAndCacheTrialByNct } = require('./trialFetchService');
const { getUserFetchedTrials, getUserFetchedTrialsCount, getRandomUserFetchedTrials } = require('./trialCacheService');

// 手动触发邮件推送接口（用于测试）
app.post('/api/admin/push-article', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('手动触发邮件文献推送...');
    const result = await manualPush();
    res.json({ success: result.success, message: result.message });
  } catch (error) {
    console.error('邮件推送错误', error);
    res.status(500).json({ error: '推送失败: ' + error.message });
  }
});

// 手动触发文章缓存更新
app.post('/api/admin/fetch-articles', authenticateToken, async (req, res) => {
  try {
    console.log('手动触发文章抓取...');
    const count = await fetchAndCacheArticles();
    res.json({ success: true, message: `已缓存${count} 篇文章` });
  } catch (error) {
    console.error('文章抓取错误:', error);
    res.status(500).json({ error: '抓取失败: ' + error.message });
  }
});

app.post('/api/admin/fetch-article-by-doi', authenticateToken, async (req, res) => {
  try {
    const { doi } = req.body || {};
    const userId = req.user.userId;
    if (!doi || typeof doi !== 'string') {
      return res.status(400).json({ error: '缺少有效 DOI' });
    }

    const article = await fetchAndCacheArticleByDoi(doi, userId);
    res.json({
      success: true,
      message: `DOI 文献已入库: ${article.id}`,
      article
    });
    } catch (error) {
      console.error('按 DOI 抓取文献失败:', error);
      const status = error.code === 'DUPLICATE_DOI' ? 409 : 500;
      res.status(status).json({ error: '按 DOI 抓取失败: ' + error.message });
    }
});

app.post('/api/admin/fetch-trial-by-nct', authenticateToken, async (req, res) => {
  try {
    const { nctId } = req.body || {};
    const userId = req.user.userId;
    if (!nctId || typeof nctId !== 'string') {
      return res.status(400).json({ error: '缺少有效 NCT ID' });
    }

    const trial = await fetchAndCacheTrialByNct(nctId, userId);
    res.json({
      success: true,
      message: `临床试验已入库: ${trial.nctId}`,
      trial
    });
  } catch (error) {
    console.error('按 NCT 抓取试验失败:', error);
    res.status(500).json({ error: '按 NCT 抓取失败: ' + error.message });
  }
});

// 获取文章总数（带时间筛选和搜索）
app.get('/api/articles/count', async (req, res) => {
  try {
    const months = req.query.months ? toPositiveInt(req.query.months, null, { min: 1, max: 120 }) : null;
    const search = (req.query.search || '').trim();
    const tag = (req.query.tag || '').trim();
    
    const total = await getTotalCachedArticles(months, search, tag);
    res.json(total);
  } catch (error) {
    console.error('获取文章总数错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 记录文章浏览量
app.post('/api/articles/:articleId/view', authenticateToken, async (req, res) => {
  try {
    const { articleId } = req.params;
    if (!articleId) {
      return res.status(400).json({ error: '缺少文章ID' });
    }
    
    const success = await incrementViewCount(articleId, req.user.userId);
    res.json({ success });
  } catch (error) {
    console.error('记录浏览量错误', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取指定时间窗口的热门文章
app.get('/api/articles/hot', async (req, res) => {
  try {
    const limit = toPositiveInt(req.query.limit, 6, { min: 1, max: 30 });
    const period = ['month', 'twoMonths', 'quarter', 'all'].includes(req.query.period) ? req.query.period : 'month';
    const articles = await getHotArticles(limit, period);
    res.json(articles);
  } catch (error) {
    console.error('获取热门文章错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取所有缓存的文章（带时间筛选和搜索，支持分页）
app.get('/api/articles', async (req, res) => {
  try {
    const months = req.query.months ? toPositiveInt(req.query.months, null, { min: 1, max: 120 }) : null;
    const search = (req.query.search || '').trim();
    const tag = (req.query.tag || '').trim();
    const page = toPositiveInt(req.query.page, 1, { min: 1, max: 1000000 });
    const pageSize = toPositiveInt(req.query.pageSize, 10, { min: 1, max: 50 });

    const articles = await getAllCachedArticles(months, search, tag, page, pageSize);
    res.json(articles);
  } catch (error) {
    console.error('获取文章列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取当前用户定向抓取过的文献列表
app.get('/api/articles/user-fetched', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const search = (req.query.search || '').trim();
    const page = toPositiveInt(req.query.page, 1, { min: 1, max: 1000000 });
    const pageSize = toPositiveInt(req.query.pageSize, 10, { min: 1, max: 50 });
    const articles = await getUserFetchedArticles(userId, search, page, pageSize);
    res.json(articles);
  } catch (error) {
    console.error('获取用户定向抓取文献列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取当前用户定向抓取过的文献总数
app.get('/api/articles/user-fetched/count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const search = (req.query.search || '').trim();
    const total = await getUserFetchedArticlesCount(userId, search);
    res.json(total);
  } catch (error) {
    console.error('获取用户定向抓取文献总数错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取全站用户手动抓取文献（随机）
app.get('/api/articles/user-fetched/random', authenticateToken, async (req, res) => {
  try {
    const limit = toPositiveInt(req.query.limit, 9, { min: 1, max: 30 });
    const articles = await getRandomUserFetchedArticles(limit);
    res.json(articles);
  } catch (error) {
    console.error('获取随机用户抓取文献错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取当前用户定向抓取过的临床试验列表
app.get('/api/trials/user-fetched', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const search = (req.query.search || '').trim();
    const page = toPositiveInt(req.query.page, 1, { min: 1, max: 1000000 });
    const pageSize = toPositiveInt(req.query.pageSize, 10, { min: 1, max: 50 });
    const trials = await getUserFetchedTrials(userId, search, page, pageSize);
    res.json(trials);
  } catch (error) {
    console.error('获取用户定向抓取临床试验列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取当前用户定向抓取过的临床试验总数
app.get('/api/trials/user-fetched/count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const search = (req.query.search || '').trim();
    const total = await getUserFetchedTrialsCount(userId, search);
    res.json(total);
  } catch (error) {
    console.error('获取用户定向抓取临床试验总数错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取全站用户手动抓取临床试验（随机）
app.get('/api/trials/user-fetched/random', authenticateToken, async (req, res) => {
  try {
    const limit = toPositiveInt(req.query.limit, 9, { min: 1, max: 30 });
    const trials = await getRandomUserFetchedTrials(limit);
    res.json(trials);
  } catch (error) {
    console.error('获取随机用户抓取临床试验错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取最新缓存的文章
app.get('/api/articles/latest', async (req, res) => {
  try {
    const article = await getLatestCachedArticle();
    if (article) {
      res.json(article);
    } else {
      res.status(404).json({ error: '没有缓存的文章' });
    }
  } catch (error) {
    console.error('获取文章错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取文章原文内容
const { getArticleContent } = require('./articleContentService');

app.get('/api/articles/:articleId/content', authenticateToken, async (req, res) => {
  try {
    const { articleId } = req.params;
    const result = await getArticleContent(articleId);
    
    if (result.success) {
      res.json({
        content: result.content,
        fromCache: result.fromCache,
        source: result.source
      });
    } else {
      res.status(404).json({ error: result.error || '无法获取文章内容' });
    }
  } catch (error) {
    console.error('获取文章内容错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// 临床试验缓存 API
// =============================================

app.get('/api/adverse-events', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: '请提供有效的英文药物名称' });
  const result = await getDrugEvents(name);
  if (result.status === 'invalid') return res.status(400).json({ error: '药物名称格式无效' });
  res.json(result);
});

// 获取所有缓存的临床试验（支持按地区筛选）
app.get('/api/trials', async (req, res) => {
  try {
    const region = (req.query.region || '').trim();
    const refresh = String(req.query.refresh || '').toLowerCase();
    if (refresh === '1' || refresh === 'true') {
      await fetchAndCacheTrials();
    }

    let trials = await trialCacheService.getAllCachedTrials(region);

    // 首次空缓存时自动回源抓取并翻译入库
    if (!trials || trials.length === 0) {
      await fetchAndCacheTrials();
      trials = await trialCacheService.getAllCachedTrials(region);
    }

    res.json(trials || []);
  } catch (error) {
    console.error('获取试验列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取单个试验
app.get('/api/trials/:nctId/locations', async (req, res) => {
  const nctId = String(req.params.nctId || '').toUpperCase();
  if (!/^NCT\d{8}$/.test(nctId)) return res.status(400).json({ error: '无效的试验编号' });
  try {
    const response = await axios.get(`https://clinicaltrials.gov/api/v2/studies/${nctId}`, { timeout: 8000 });
    const locations = response.data?.protocolSection?.contactsLocationsModule?.locations || [];
    res.json(locations.map(site => ({
      facility: site.facility || '',
      status: site.status || '',
      city: site.city || '', state: site.state || '', zip: site.zip || '', country: site.country || '',
      contacts: (site.contacts || []).map(contact => ({ name: contact.name || '', phone: contact.phone || '', email: contact.email || '' }))
    })));
  } catch (error) {
    console.error('获取试验中心详情失败:', nctId, error.message);
    res.status(502).json({ error: '试验中心详情暂时无法获取' });
  }
});

app.get('/api/trials/:nctId', async (req, res) => {
  try {
    const trial = await trialCacheService.getCachedTrialById(req.params.nctId);
    if (trial) {
      res.json(trial);
    } else {
      res.status(404).json({ error: '试验不存在' });
    }
  } catch (error) {
    console.error('获取试验错误:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/trials/:nctId/match', authenticateToken, refreshAIProfile, async (req, res) => {
  const nctId = String(req.params.nctId || '').toUpperCase();
  if (!/^NCT\d{8}$/.test(nctId)) return res.status(400).json({ error: '无效的试验编号' });
  try {
    const trial = await trialCacheService.getCachedTrialById(nctId);
    if (!trial) return res.status(404).json({ error: '试验不存在' });
    const sources = await getEvidence('trial', trial);
    const official = sources.find(source => source.available && source.content)?.content;
    res.json(await buildAITrialMatches(trial, official, req.body.profile, req.body.selectedCenter));
  } catch (error) {
    console.error('计算试验匹配失败:', nctId, error);
    res.status(500).json({ error: '试验条件暂时无法获取' });
  }
});

// 保存/更新试验缓存 (管理接口)
app.post('/api/admin/trials', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const trial = req.body;
    if (!trial.nctId || !trial.title) {
      return res.status(400).json({ error: '缺少必填字段: nctId, title' });
    }
    await trialCacheService.saveCachedTrial(trial);
    res.json({ success: true, message: '试验缓存已保存' });
  } catch (error) {
    console.error('保存试验错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 批量保存试验缓存 (管理接口)
app.post('/api/admin/trials/batch', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { trials } = req.body;
    if (!Array.isArray(trials) || trials.length === 0) {
      return res.status(400).json({ error: '请提供试验数据' });
    }
    await trialCacheService.batchSaveTrials(trials);
    res.json({ success: true, message: `已保存${trials.length} 条试验` });
  } catch (error) {
    console.error('批量保存试验错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除试验缓存 (管理接口)
app.delete('/api/admin/trials/:nctId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await trialCacheService.deleteCachedTrial(req.params.nctId);
    res.json({ success: true, message: '试验缓存已删除' });
  } catch (error) {
    console.error('删除试验错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取试验缓存统计
app.get('/api/admin/trials/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await trialCacheService.getTrialCacheStats();
    res.json(stats);
  } catch (error) {
    console.error('获取试验统计错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 手动触发临床试验抓取并翻译入库
app.get('/api/admin/trials/fetch', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const count = await fetchAndCacheTrials();
    res.json({ success: true, message: `已抓取并缓存 ${count} 条试验` });
  } catch (error) {
    console.error('手动抓取试验错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// FDA药物缓存 API
// =============================================

// 获取所有缓存的FDA药物（支持英文名搜索）
app.get('/api/drugs', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const drugs = await drugCacheService.getAllCachedDrugs(search);
    res.json(drugs);
  } catch (error) {
    console.error('获取药物列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取单个药物 (按品牌名)
app.get('/api/drugs/:brandName', async (req, res) => {
  try {
    const drug = await drugCacheService.getCachedDrugByBrandName(req.params.brandName);
    if (drug) {
      res.json(drug);
    } else {
      res.status(404).json({ error: '药物不存在' });
    }
  } catch (error) {
    console.error('获取药物错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 保存/更新药物缓存 (管理接口)
app.post('/api/admin/drugs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const drug = req.body;
    if (!drug.brandName || !drug.genericName) {
      return res.status(400).json({ error: '缺少必填字段: brandName, genericName' });
    }
    await drugCacheService.saveCachedDrug(drug);
    res.json({ success: true, message: '药物缓存已保存' });
  } catch (error) {
    console.error('保存药物错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 批量保存药物缓存 (管理接口)
app.post('/api/admin/drugs/batch', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { drugs } = req.body;
    if (!Array.isArray(drugs) || drugs.length === 0) {
      return res.status(400).json({ error: '请提供药物数据' });
    }
    await drugCacheService.batchSaveDrugs(drugs);
    res.json({ success: true, message: `已保存${drugs.length} 条药物` });
  } catch (error) {
    console.error('批量保存药物错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除药物缓存 (管理接口)
app.delete('/api/admin/drugs/:brandName', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await drugCacheService.deleteCachedDrug(req.params.brandName);
    res.json({ success: true, message: '药物缓存已删除' });
  } catch (error) {
    console.error('删除药物错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取药物缓存统计
app.get('/api/admin/drugs/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await drugCacheService.getDrugCacheStats();
    res.json(stats);
  } catch (error) {
    console.error('获取药物统计错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清理过期AI缓存 (管理接口)
app.post('/api/admin/cache/clean', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const trialsCleaned = await trialCacheService.cleanExpiredTrialAICache();
    const drugsCleaned = await drugCacheService.cleanExpiredDrugAICache();
    res.json({ 
      success: true, 
      message: `清理完成: 试验AI缓存 ${trialsCleaned} 条, 药物AI缓存 ${drugsCleaned} 条` 
    });
  } catch (error) {
    console.error('清理缓存错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// 康复视频 + 打卡 API
// =============================================

// 获取康复视频列表（可按行动状态过滤）
app.get('/api/rehab/videos', authenticateToken, async (req, res) => {
  try {
    const { targetStatus, videoGroup } = req.query;
    const videos = await rehabService.getRehabVideos(targetStatus || null, videoGroup || null);
    res.set('Cache-Control', 'private, max-age=300');
    res.json(videos);
  } catch (error) {
    console.error('获取康复视频错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 提交康复评估
app.post('/api/rehab/assessment', authenticateToken, async (req, res) => {
  try {
    const { contractures, painWarnings } = req.body;
    const userId = req.user.userId;
    const assessmentId = await rehabService.createAssessment(userId, contractures, painWarnings);
    res.json({ success: true, assessmentId });
  } catch (error) {
    console.error('创建评估错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 开始训练（创建打卡记录）
app.post('/api/rehab/checkin/start', authenticateToken, async (req, res) => {
  try {
    const { assessmentId, durationPlan, videoCount, videoGroup } = req.body;
    const userId = req.user.userId;
    const checkinId = await rehabService.createCheckin(
      userId,
      assessmentId ?? null,
      durationPlan ?? 10,
      videoCount ?? 4,
      videoGroup ?? null
    );
    res.json({ success: true, checkinId });
  } catch (error) {
    console.error('创建打卡错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 记录单个视频完成
app.post('/api/rehab/checkin/:checkinId/video', authenticateToken, async (req, res) => {
  try {
    const { checkinId } = req.params;
    const userId = req.user.userId;
    const { videoId, videoOrder, watchedSeconds } = req.body;
    const success = await rehabService.recordVideoComplete(userId, checkinId, videoId, videoOrder, watchedSeconds);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Checkin not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('记录视频完成错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 完成打卡
app.post('/api/rehab/checkin/:checkinId/complete', authenticateToken, async (req, res) => {
  try {
    const { checkinId } = req.params;
    const userId = req.user.userId;
    const { nextReminderTime, durationActual } = req.body;
    const success = await rehabService.completeCheckin(userId, checkinId, {
      nextReminderTime: nextReminderTime || null,
      durationActual: durationActual ?? null
    });
    if (!success) {
      return res.status(404).json({ success: false, error: 'Checkin not found or already completed' });
    }
    await recordUserOperationSafely({ userId, action: 'rehab_checkin', contentId: checkinId });
    res.json({ success: true });
  } catch (error) {
    console.error('完成打卡错误:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rehab/checkin/:checkinId/tick', authenticateToken, async (req, res) => {
  try {
    const { checkinId } = req.params;
    const userId = req.user.userId;
    const ok = await rehabService.tickCheckin(userId, checkinId);
    res.json({ success: ok });
  } catch (error) {
    console.error('打卡计时错误:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rehab/checkin/:checkinId/stop', authenticateToken, async (req, res) => {
  try {
    const { checkinId } = req.params;
    const userId = req.user.userId;
    const { durationActual } = req.body;
    const success = await rehabService.stopCheckin(userId, checkinId, { durationActual });
    if (!success) {
      return res.status(404).json({ success: false, error: 'Checkin not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('终止练习错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取打卡统计
app.get('/api/rehab/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const stats = await rehabService.getCheckinStats(userId);
    res.json(stats);
  } catch (error) {
    console.error('获取打卡统计错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取打卡历史
app.get('/api/rehab/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 30;
    const history = await rehabService.getCheckinHistory(userId, limit);
    res.json(history);
  } catch (error) {
    console.error('获取打卡历史错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取按等级分组的打卡统计（用于解锁判断和打卡记录展示）
app.get('/api/rehab/level-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const stats = await rehabService.getCheckinStatsByLevel(userId);
    res.json(stats);
  } catch (error) {
    console.error('获取等级打卡统计错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// SPA fallback (for BrowserRouter refresh)
// =============================================
const clientDistPath = path.resolve(__dirname, '..', 'dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');

if (fs.existsSync(clientDistPath) && fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientDistPath, {
    index: false,
    setHeaders: (res, filePath) => {
      const filename = path.basename(filePath);
      // index.html 必须禁缓存，避免发布后仍引用旧的 hash 资源导致白屏。
      if (filename === 'index.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return;
      }
      // 带 hash 的静态资源可长期缓存，提升回访速度。
      if (/\.[a-f0-9]{8,}\./i.test(filename)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }));

  // 仅在“页面导航”场景回退 index.html，避免 JS/CSS 资源 404 被错误回退成 HTML。
  app.get(/^\/(?!api).*/, (req, res, next) => {
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    const hasFileExtension = path.extname(req.path) !== '';
    if (!acceptsHtml || hasFileExtension) {
      return next();
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(clientIndexPath);
  });
}

// 启动服务
app.listen(PORT, async () => {
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  await testConnection();
  await runMigrations();
  await ensureShareTable(pool);
  startArticleDrugBackfill();
  
  // 启动定时推送任务
  initScheduler();
  
  // 首次启动时检查并初始化文章缓存
  const latestArticle = await getLatestCachedArticle();
  if (!latestArticle) {
    console.log('📰 文章缓存为空，执行初始化抓取...');
    fetchAndCacheArticles().catch(err => console.error('初始化抓取错误', err));
  }
});




