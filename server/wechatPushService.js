/**
 * 微信公众号消息推送服务
 * 用于向绑定微信的用户推送最新文献
 */

const axios = require('axios');
const cron = require('node-cron');
const { pool } = require('./db');
require('dotenv').config();

// 微信公众号配置
const WECHAT_CONFIG = {
  appId: process.env.WECHAT_APP_ID,
  appSecret: process.env.WECHAT_APP_SECRET,
  templateId: process.env.WECHAT_TEMPLATE_ID || '' // 模板消息ID
};

// 推送频率配置
const PUSH_SCHEDULE = {
  daily: '0 9 * * *',      // 每天早上9点
  weekly: '0 9 * * 1',     // 每周一早上9点
  monthly: '0 9 1 * *'     // 每月1号早上9点
};

// 缓存 access_token
let accessTokenCache = {
  token: null,
  expiresAt: 0
};

/**
 * 获取微信公众号 access_token
 */
async function getAccessToken() {
  const now = Date.now();
  
  // 检查缓存是否有效
  if (accessTokenCache.token && accessTokenCache.expiresAt > now) {
    return accessTokenCache.token;
  }
  
  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_CONFIG.appId}&secret=${WECHAT_CONFIG.appSecret}`;
    const response = await axios.get(url);
    const data = response.data;
    
    if (data.errcode) {
      console.error('获取access_token失败:', data);
      return null;
    }
    
    // 缓存 token，提前5分钟过期
    accessTokenCache = {
      token: data.access_token,
      expiresAt: now + (data.expires_in - 300) * 1000
    };
    
    console.log('✅ 获取微信access_token成功');
    return data.access_token;
  } catch (error) {
    console.error('获取access_token错误:', error.message);
    return null;
  }
}

/**
 * 获取所有绑定微信的用户（包含档案信息）
 */
async function getWechatUsersWithProfiles() {
  try {
    const [users] = await pool.execute(`
      SELECT 
        wu.openid, 
        wu.nickname,
        wu.user_id,
        u.username,
        up.age,
        up.genetic_profile,
        up.ambulatory_status,
        up.on_steroids,
        up.region,
        up.is_configured
      FROM wechat_users wu 
      JOIN users u ON wu.user_id = u.id 
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.is_active = TRUE
    `);
    
    // 获取每个用户的兴趣领域
    for (const user of users) {
      const [interests] = await pool.execute(
        'SELECT interest_area FROM user_interests WHERE user_id = ?',
        [user.user_id]
      );
      user.interests = interests.map(i => i.interest_area);
    }
    
    return users;
  } catch (error) {
    console.error('获取微信用户列表错误:', error.message);
    return [];
  }
}

/**
 * 根据用户兴趣匹配文章标签
 */
function matchArticleToInterests(article, interests) {
  if (!interests || interests.length === 0) return true; // 没有设置兴趣则推送所有
  
  const tags = article.tags || [];
  const titleLower = (article.title || '').toLowerCase();
  const abstractLower = (article.abstract || '').toLowerCase();
  
  // 兴趣领域与文章内容的关键词映射
  const interestKeywords = {
    'MEDICATIONS': ['drug', 'therapy', 'treatment', 'steroid', 'medication', 'pharmaceutical'],
    'DAILY_CARE': ['care', 'management', 'quality of life', 'daily', 'rehabilitation', 'physiotherapy'],
    'HEART_LUNGS': ['cardiac', 'heart', 'pulmonary', 'respiratory', 'cardiomyopathy', 'lung'],
    'GENE_THERAPY': ['gene therapy', 'aav', 'exon skipping', 'dystrophin', 'genetic', 'crispr'],
    'BASIC_SCIENCE': ['mechanism', 'pathway', 'molecular', 'cell', 'mouse model', 'preclinical']
  };
  
  for (const interest of interests) {
    const keywords = interestKeywords[interest] || [];
    for (const keyword of keywords) {
      if (titleLower.includes(keyword) || abstractLower.includes(keyword)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * 生成个性化推送内容
 */
function generatePersonalizedMessage(article, userProfile) {
  const nickname = userProfile.nickname || '用户';
  const ageDesc = userProfile.age ? userProfile.age + '岁' : '未填写';
  const geneticProfile = userProfile.genetic_profile || '';
  
  let greeting = `亲爱的${nickname}，`;
  let relevance = '';
  
  // 根据用户档案添加个性化内容
  if (userProfile.is_configured) {
    // 检查基因型相关性
    if (geneticProfile && article.title) {
      const titleLower = article.title.toLowerCase();
      const geneticLower = geneticProfile.toLowerCase();
      
      if (titleLower.includes('exon 51') && geneticLower.includes('51')) {
        relevance = '\n\n💡 这篇研究与您的外显子51突变类型可能相关！';
      } else if (titleLower.includes('exon 53') && geneticLower.includes('53')) {
        relevance = '\n\n💡 这篇研究与您的外显子53突变类型可能相关！';
      } else if (titleLower.includes('exon 45') && geneticLower.includes('45')) {
        relevance = '\n\n💡 这篇研究与您的外显子45突变类型可能相关！';
      }
    }
    
    // 根据行动状态提示
    if (userProfile.ambulatory_status === 'wheelchair' && 
        (article.title?.toLowerCase().includes('cardiac') || article.title?.toLowerCase().includes('heart'))) {
      relevance += '\n\n❤️ 作为轮椅使用者，心脏健康尤为重要，请关注此研究。';
    }
  }
  
  return { greeting, relevance };
}

/**
 * 获取最新的一篇文献（从缓存表）
 */
async function getLatestArticle() {
  try {
    const { getLatestCachedArticle } = require('./articleFetchService');
    return await getLatestCachedArticle();
  } catch (error) {
    console.error('获取最新文献错误:', error.message);
    return null;
  }
}

/**
 * 发送模板消息给单个用户（个性化）
 * @param {object} userProfile - 用户档案信息
 * @param {object} article - 文章信息
 */
async function sendTemplateMessage(userProfile, article) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.error('无法获取access_token，跳过推送');
    return false;
  }
  
  const { greeting, relevance } = generatePersonalizedMessage(article, userProfile);
  
  // 如果没有配置模板ID，使用客服消息
  if (!WECHAT_CONFIG.templateId) {
    return await sendCustomMessage(userProfile, article, accessToken, greeting, relevance);
  }
  
  try {
    const url = `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${accessToken}`;
    
    // 模板消息数据 (需要根据实际模板配置调整)
    const data = {
      touser: userProfile.openid,
      template_id: WECHAT_CONFIG.templateId,
      url: article.url || `https://pubmed.ncbi.nlm.nih.gov/${article.id}/`,
      data: {
        first: {
          value: `${greeting}为您推送DMD研究最新动态`,
          color: '#173177'
        },
        keyword1: {
          value: article.title.substring(0, 50) + (article.title.length > 50 ? '...' : ''),
          color: '#173177'
        },
        keyword2: {
          value: article.journal || '未知期刊',
          color: '#173177'
        },
        keyword3: {
          value: article.publicationDate || '最新',
          color: '#173177'
        },
        remark: {
          value: relevance || '点击查看详情，了解最新DMD研究进展',
          color: '#999999'
        }
      }
    };
    
    const response = await axios.post(url, data);
    
    if (response.data.errcode === 0) {
      console.log(`✅ 模板消息推送成功: ${userProfile.openid} (${userProfile.nickname})`);
      return true;
    } else {
      console.error(`模板消息推送失败 ${userProfile.openid}:`, response.data);
      return false;
    }
  } catch (error) {
    console.error(`发送模板消息错误 ${userProfile.openid}:`, error.message);
    return false;
  }
}

/**
 * 发送客服消息（个性化）
 */
async function sendCustomMessage(userProfile, article, accessToken, greeting, relevance) {
  try {
    const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${accessToken}`;
    
    const articleUrl = article.url || `https://pubmed.ncbi.nlm.nih.gov/${article.id}/`;
    
    // 构建个性化内容
    let content = `${greeting}\n\n📚 DMD研究最新动态\n\n` +
      `【${article.title}】\n\n` +
      `期刊: ${article.journal || '未知'}\n` +
      `日期: ${article.publicationDate || '最新'}`;
    
    // 添加个性化相关性提示
    if (relevance) {
      content += relevance;
    }
    
    content += `\n\n点击链接查看详情:\n${articleUrl}`;
    
    const data = {
      touser: userProfile.openid,
      msgtype: 'text',
      text: {
        content: content
      }
    };
    
    const response = await axios.post(url, data);
    
    if (response.data.errcode === 0) {
      console.log(`✅ 客服消息推送成功: ${userProfile.openid} (${userProfile.nickname})`);
      return true;
    } else {
      console.error(`客服消息推送失败 ${userProfile.openid}:`, response.data);
      return false;
    }
  } catch (error) {
    console.error(`发送客服消息错误 ${userProfile.openid}:`, error.message);
    return false;
  }
}

/**
 * 执行推送任务（个性化推送）
 */
async function executePushTask() {
  console.log('=== 开始执行文献推送任务 ===');
  console.log('时间:', new Date().toLocaleString('zh-CN'));
  
  // 1. 获取最新文献
  const article = await getLatestArticle();
  if (!article) {
    console.log('没有找到可推送的文献，任务结束');
    return;
  }
  console.log('最新文献:', article.title);
  
  // 2. 获取微信用户列表（包含档案信息）
  const users = await getWechatUsersWithProfiles();
  if (users.length === 0) {
    console.log('没有绑定微信的用户，任务结束');
    return;
  }
  console.log(`找到 ${users.length} 个微信用户`);
  
  // 3. 逐个推送（个性化）
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  
  for (const user of users) {
    // 检查文章是否匹配用户兴趣
    if (user.is_configured && user.interests && user.interests.length > 0) {
      if (!matchArticleToInterests(article, user.interests)) {
        console.log(`⏭️ 跳过用户 ${user.nickname}: 文章不匹配兴趣领域`);
        skippedCount++;
        continue;
      }
    }
    
    const success = await sendTemplateMessage(user, article);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`=== 推送任务完成 ===`);
  console.log(`成功: ${successCount}, 失败: ${failCount}, 跳过: ${skippedCount}`);
}

/**
 * 初始化定时任务
 */
function initScheduler() {
  const frequency = process.env.WECHAT_PUSH_FREQUENCY || 'weekly';
  const schedule = PUSH_SCHEDULE[frequency] || PUSH_SCHEDULE.weekly;
  
  console.log(`📅 文献推送定时任务已启动`);
  console.log(`   频率: ${frequency}`);
  console.log(`   Cron: ${schedule}`);
  
  // 文章抓取定时任务 (每天凌晨3点更新缓存)
  const { fetchAndCacheArticles } = require('./articleFetchService');
  cron.schedule('0 3 * * *', () => {
    console.log('⏰ 执行文章缓存更新任务...');
    fetchAndCacheArticles().catch(err => {
      console.error('文章缓存更新错误:', err);
    });
  });
  console.log(`📰 文章缓存定时任务已启动 (每天 03:00)`);
  
  // 微信推送定时任务
  cron.schedule(schedule, () => {
    executePushTask().catch(err => {
      console.error('推送任务执行错误:', err);
    });
  });
}

/**
 * 手动触发推送（用于测试）
 */
async function manualPush() {
  await executePushTask();
}

module.exports = {
  initScheduler,
  manualPush,
  getAccessToken,
  getWechatUsersWithProfiles,
  getLatestArticle,
  matchArticleToInterests
};
