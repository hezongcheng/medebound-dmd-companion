/**
 * 有道翻译API服务
 * 用于将英文文献标题和摘要翻译为中文
 */

const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const YOUDAO_CONFIG = {
  appKey: process.env.YOUDAO_APP_KEY,
  appSecret: process.env.YOUDAO_APP_SECRET,
  apiUrl: 'https://openapi.youdao.com/api'
};

/**
 * 生成有道翻译API签名
 */
function generateSign(appKey, input, salt, curtime, appSecret) {
  const str = appKey + input + salt + curtime + appSecret;
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * 处理输入文本（有道API要求：长度>20时取前10+长度+后10）
 */
function truncateInput(text) {
  if (!text) return '';
  if (text.length <= 20) return text;
  return text.substring(0, 10) + text.length + text.substring(text.length - 10);
}

/**
 * 过滤HTML标签
 */
function stripHtmlTags(text) {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').trim();
}

/**
 * 翻译文本（英文->中文）
 * @param {string} text - 要翻译的文本
 * @returns {Promise<string>} - 翻译后的中文文本
 */
async function translateToZh(text) {
  if (!text || text.trim() === '') {
    return '';
  }

  // 如果未配置有道API，返回空字符串
  if (!YOUDAO_CONFIG.appKey || !YOUDAO_CONFIG.appSecret) {
    console.warn('⚠️ 有道翻译API未配置，跳过翻译');
    return '';
  }

  try {
    const salt = crypto.randomUUID();
    const curtime = Math.floor(Date.now() / 1000).toString();
    const input = truncateInput(text);
    const sign = generateSign(
      YOUDAO_CONFIG.appKey,
      input,
      salt,
      curtime,
      YOUDAO_CONFIG.appSecret
    );

    const params = new URLSearchParams();
    params.append('q', text);
    params.append('from', 'en');
    params.append('to', 'zh-CHS');
    params.append('appKey', YOUDAO_CONFIG.appKey);
    params.append('salt', salt);
    params.append('sign', sign);
    params.append('signType', 'v3');
    params.append('curtime', curtime);

    const response = await axios.post(YOUDAO_CONFIG.apiUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });

    const data = response.data;
    
    if (data.errorCode === '0' && data.translation && data.translation.length > 0) {
      // 过滤翻译结果中的HTML标签
      return stripHtmlTags(data.translation[0]);
    } else {
      console.error('有道翻译API错误:', data.errorCode, data);
      return '';
    }
  } catch (error) {
    console.error('有道翻译请求错误:', error.message);
    return '';
  }
}

/**
 * 批量翻译文章标题和摘要
 * @param {string} title - 英文标题
 * @param {string} abstract - 英文摘要
 * @returns {Promise<{titleZh: string, abstractZh: string}>}
 */
async function translateArticle(title, abstract) {
  // 并行翻译标题和摘要
  const [titleZh, abstractZh] = await Promise.all([
    translateToZh(title),
    translateToZh(abstract)
  ]);

  return { titleZh, abstractZh };
}

module.exports = {
  translateToZh,
  translateArticle
};
