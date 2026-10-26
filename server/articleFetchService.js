/**
 * 文章抓取服务 - 从 PubMed 获取最新文章并缓存到数据库
 */

const axios = require('axios');
const { searchTerms, appendKeywordGroupsToWhere } = require('./articleSearch');
const crypto = require('crypto');
const { pool } = require('./db');
const { recordArticleView, hotArticleQuery } = require('./articleViewService');
const { translateArticle } = require('./youdaoTranslateService');
const { callGeminiAPI } = require('./geminiService');
const { articleDrugNames, isUnsafeAlias } = require('./articleDrugNames');
const { PUBMED_PREFERRED_FILTER, EUROPE_PMC_PREFERRED_FILTER, selectArticleCandidates } = require('./articleFetchPriority');
require('dotenv').config();

const PUBMED_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EUROPE_PMC_BASE_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const PUBMED_SEARCH_RETMAX = 500;
const EUROPE_PMC_SEARCH_PAGE_SIZE = 500;
const PUBMED_REQUEST_TIMEOUT_MS = 20000;
const PUBMED_MAX_RETRIES = 3;
const configuredPubmedCooldownMs = Number.parseInt(process.env.PUBMED_FETCH_COOLDOWN_MS || '', 10);
const PUBMED_FETCH_COOLDOWN_MS = Number.isFinite(configuredPubmedCooldownMs)
  ? Math.max(60 * 1000, configuredPubmedCooldownMs)
  : 10 * 60 * 1000;

let articleFetchInFlight = null;
let lastArticleFetchAttemptAt = 0;
let lastArticleFetchError = null;

// 翻译 API 调用延迟（毫秒），避免请求过快
const TRANSLATE_DELAY_MS = 1500;

// 延迟函数
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getPubmedRequestConfig(params = {}) {
  const requestParams = {
    ...params,
    tool: process.env.PUBMED_TOOL || 'dmd_companion'
  };
  if (process.env.PUBMED_EMAIL) requestParams.email = process.env.PUBMED_EMAIL;
  if (process.env.PUBMED_API_KEY) requestParams.api_key = process.env.PUBMED_API_KEY;

  return {
    params: requestParams,
    timeout: PUBMED_REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': process.env.PUBMED_USER_AGENT || 'DMD-Companion/1.0'
    }
  };
}

function createPubmedBlockedError() {
  const error = new Error(
    'PubMed 已阻止当前服务器公网 IP。请停止高频请求，并联系 NCBI E-utilities 支持登记 tool/email、申请解除封禁。'
  );
  error.code = 'PUBMED_IP_BLOCKED';
  return error;
}

function assertPubmedResponseNotBlocked(data) {
  if (typeof data === 'string' && /NCBI\s*-\s*WWW Error Blocked Diagnostic/i.test(data)) {
    throw createPubmedBlockedError();
  }
}

function parsePubmedSearchResponse(data) {
  assertPubmedResponseNotBlocked(data);
  const result = data?.esearchresult;
  const upstreamError = data?.error || result?.error || result?.ERROR;
  if (upstreamError) {
    throw new Error(`PubMed ESearch 返回错误: ${upstreamError}`);
  }
  if (!result || !Array.isArray(result.idlist) || !/^\d+$/.test(String(result.count ?? ''))) {
    const responsePreview = JSON.stringify(data ?? null).slice(0, 500);
    throw new Error(`PubMed ESearch 响应格式异常: ${responsePreview}`);
  }
  const fieldsNotFound = result.errorlist?.fieldsnotfound;
  if (Array.isArray(fieldsNotFound) && fieldsNotFound.length > 0) {
    throw new Error(`PubMed ESearch 无法识别检索字段: ${fieldsNotFound.join(', ')}`);
  }
  if (Number(result.count) > 0 && result.idlist.length === 0) {
    throw new Error(`PubMed ESearch 返回 ${result.count} 条，但 idlist 为空`);
  }
  return result;
}

async function searchPubmed(params, { rejectEmpty = false } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= PUBMED_MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(
        `${PUBMED_BASE_URL}/esearch.fcgi`,
        getPubmedRequestConfig(params)
      );
      const result = parsePubmedSearchResponse(response.data);
      if (rejectEmpty && Number(result.count) === 0) {
        const translation = result.querytranslation || '无';
        const warnings = JSON.stringify(result.warninglist || {});
        throw new Error(`PubMed ESearch 异常返回 0 条；querytranslation=${translation}; warnings=${warnings}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const retryable = error.code !== 'PUBMED_IP_BLOCKED'
        && (!status || status === 429 || status >= 500);
      console.warn(`PubMed ESearch 第 ${attempt}/${PUBMED_MAX_RETRIES} 次请求失败: ${error.message}`);
      if (!retryable || attempt === PUBMED_MAX_RETRIES) break;
      await delay(attempt * 1000);
    }
  }
  throw lastError || new Error('PubMed ESearch 请求失败');
}

/**
 * 统一药物名称（用于翻译后的中文内容）
 */
function normalizeDrugNamesInText(text) {
  if (!text || typeof text !== 'string') return text;

  const replacements = [
    { pattern: /辅酶q10/gi, replacement: '辅酶Q10' },
    { pattern: /\bcoenzyme\s*q10\b/gi, replacement: '辅酶Q10' },
    { pattern: /\bcoq10\b/gi, replacement: '辅酶Q10' },

    { pattern: /强的松/g, replacement: '泼尼松' },
    { pattern: /\bprednisone\b/gi, replacement: '泼尼松' },

    { pattern: /\bvamorolone\b/gi, replacement: '氨莫洛酮' },
    { pattern: /地帕扎柯/gi, replacement: '地夫可特' },
    { pattern: /\bdeflazacort\b/gi, replacement: '地夫可特' },

    { pattern: /\bEtanercept\b/g, replacement: '依那西普' },
    { pattern: /\bdapagliflozin\b/gi, replacement: '达格列净' },
    { pattern: /\bgivinostat\b/gi, replacement: '给维司他' },
    { pattern: /\bdelandistrogene moxeparvovec(?:-rokl)?\b/gi, replacement: 'delandistrogene moxeparvovec' },
    { pattern: /\bELEVIDYS\b/g, replacement: 'Elevidys' }
  ];

  let normalized = text;
  for (const rule of replacements) {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  }
  return normalized;
}

function normalizeDrugNamesInArticlePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    titleZh: normalizeDrugNamesInText(payload.titleZh || ''),
    abstractZh: normalizeDrugNamesInText(payload.abstractZh || ''),
    aiSummary: normalizeDrugNamesInText(payload.aiSummary || ''),
    subTags: Array.isArray(payload.subTags)
      ? payload.subTags.map(tag => normalizeDrugNamesInText(String(tag)))
      : []
  };
}

function uniqueNonEmptyStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

async function expandDrugAliasTermsByKeyword(keyword) {
  const word = String(keyword || '').trim();
  if (!word) return [];

  const aliases = [];

  try {
    const kw = `%${word}%`;
    const [rows] = await pool.execute(
      `SELECT brand_name, brand_name_cn, generic_name, generic_name_cn
       FROM fda_drugs_cache
       WHERE brand_name LIKE ? OR brand_name_cn LIKE ? OR generic_name LIKE ? OR generic_name_cn LIKE ?`,
      [kw, kw, kw, kw]
    );

    for (const row of rows) {
      aliases.push(row.brand_name, row.brand_name_cn, row.generic_name, row.generic_name_cn);
    }
  } catch (error) {
    console.warn(`fda_drugs_cache 别名扩展失败 (${word}):`, error.message);
  }

  try {
    const kw = `%${word}%`;
    const [rows] = await pool.execute(
      `SELECT d.canonical_name, d.alias_name
       FROM dmd_drug_aliases d
       WHERE d.canonical_name LIKE ? OR d.alias_name LIKE ?`,
      [kw, kw]
    );
    for (const row of rows) {
      if (isUnsafeAlias(row)) continue;
      aliases.push(row.canonical_name, row.alias_name);
    }
  } catch (error) {
    // 兼容未建表场景：仅使用 fda_drugs_cache 的同义词扩展
    if (!String(error.message || '').includes('doesn\'t exist')) {
      console.warn(`dmd_drug_aliases 别名扩展失败 (${word}):`, error.message);
    }
  }

  return uniqueNonEmptyStrings(aliases);
}

async function buildExpandedSearchGroups(searchKeyword = '') {
  const exactName = String(searchKeyword || '').normalize('NFKC').trim();
  if (exactName && exactName.length <= 120) {
    try {
      const [exactRows] = await pool.execute(
        'SELECT canonical_name, alias_name FROM dmd_drug_aliases WHERE LOWER(alias_name) = LOWER(?) OR LOWER(canonical_name) = LOWER(?)',
        [exactName, exactName]
      );
      const canonicals = uniqueNonEmptyStrings(exactRows.filter(row => !isUnsafeAlias(row)).map(row => row.canonical_name));
      if (canonicals.length) {
        const [related] = await pool.query(
          'SELECT canonical_name, alias_name FROM dmd_drug_aliases WHERE canonical_name IN (?)',
          [canonicals]
        );
        return [uniqueNonEmptyStrings([exactName, ...canonicals, ...related.filter(row => !isUnsafeAlias(row)).map(row => row.alias_name)])];
      }
    } catch (error) {
      console.warn('完整药名别名检索失败:', error.message);
    }
  }
  const words = searchTerms(searchKeyword);
  if (words.length === 0) return [];

  const groups = [];
  for (const word of words) {
    const aliasTerms = await expandDrugAliasTermsByKeyword(word);
    groups.push(uniqueNonEmptyStrings([word, ...aliasTerms]));
  }
  // 分词前的完整中文药名仍参与别名查找，但泛词不作为新增匹配项。
  const chunks = String(searchKeyword).normalize('NFKC').match(/[\p{L}\p{N}-]+/gu) || [];
  for (const chunk of uniqueNonEmptyStrings(chunks).slice(0, 12)) {
    if (words.includes(chunk) || !/\p{Script=Han}/u.test(chunk) || chunk.length < 4) continue;
    const aliases = await expandDrugAliasTermsByKeyword(chunk);
    if (aliases.length) groups.push(uniqueNonEmptyStrings([chunk, ...aliases]));
  }
  return groups;
}

/**
 * 获取日期范围（最近 N 个月）
 */
function getDateBounds(months) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  const formatIsoDate = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
  return { start: formatIsoDate(start), end: formatIsoDate(end) };
}

function getDateRange(months, field = 'Entry Date') {
  const bounds = getDateBounds(months);
  const toPubmedDate = (value) => value.replace(/-/g, '/');
  return `"${toPubmedDate(bounds.start)}"[${field}] : "${toPubmedDate(bounds.end)}"[${field}]`;
}

function shouldFallbackToEuropePmc(error) {
  const status = error?.response?.status;
  return error?.code === 'PUBMED_IP_BLOCKED'
    || error?.code === 'ECONNABORTED'
    || error?.code === 'ECONNRESET'
    || error?.code === 'ETIMEDOUT'
    || error?.code === 'ENOTFOUND'
    || status === 403
    || status === 429
    || status >= 500;
}

async function searchEuropePmc(preferred = false) {
  const bounds = getDateBounds(3);
  const query = `(TITLE_ABS:"Duchenne muscular dystrophy" OR TITLE_ABS:Duchenne) AND SRC:MED AND FIRST_IDATE:[${bounds.start} TO ${bounds.end}]${preferred ? ` AND ${EUROPE_PMC_PREFERRED_FILTER}` : ''} sort_date:y`;
  const response = await axios.get(`${EUROPE_PMC_BASE_URL}/search`, {
    params: {
      query,
      format: 'json',
      resultType: 'core',
      pageSize: EUROPE_PMC_SEARCH_PAGE_SIZE
    },
    timeout: PUBMED_REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': process.env.EUROPE_PMC_USER_AGENT
        || process.env.PUBMED_USER_AGENT
        || 'DMD-Companion/1.0'
    }
  });

  const data = response.data;
  const rawResults = data?.resultList?.result;
  const results = Array.isArray(rawResults) ? rawResults : (rawResults ? [rawResults] : []);
  const hitCount = Number(data?.hitCount);
  if (!Number.isFinite(hitCount) || (hitCount > 0 && results.length === 0)) {
    const responsePreview = JSON.stringify(data ?? null).slice(0, 500);
    throw new Error(`Europe PMC 响应格式异常: ${responsePreview}`);
  }
  return { hitCount, results };
}

/**
 * 解析 XML 中的文本内容
 */
function decodeXmlEntities(text) {
  const entityMap = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const codePoint = parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#(\d+);/g, (match, num) => {
      const codePoint = parseInt(num, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name) => (
      Object.prototype.hasOwnProperty.call(entityMap, name.toLowerCase())
        ? entityMap[name.toLowerCase()]
        : match
    ));
}

function cleanXmlText(text) {
  return decodeXmlEntities(text)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlText(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? cleanXmlText(match[1]) : '';
}

/**
 * 解析作者列表
 */
function extractAuthors(articleXml) {
  const authors = [];
  const authorRegex = /<Author[^>]*>[\s\S]*?<LastName>([^<]*)<\/LastName>[\s\S]*?<Initials>([^<]*)<\/Initials>[\s\S]*?<\/Author>/gi;
  let match;
  while ((match = authorRegex.exec(articleXml)) !== null) {
    authors.push(`${match[1]} ${match[2]}`);
  }
  return authors;
}

/**
 * 解析摘要
 */
function extractAbstract(articleXml) {
  // PubMed may expose a public publisher abstract in <OtherAbstract> instead
  // of the journal's primary <Abstract>. Read both containers and de-duplicate
  // their sections so scheduled imports do not incorrectly store "no abstract".
  const containers = [];
  const containerRegex = /<(Abstract|OtherAbstract)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let containerMatch;
  while ((containerMatch = containerRegex.exec(articleXml)) !== null) {
    containers.push(containerMatch[2]);
  }
  if (containers.length === 0) return '';

  const sections = [];
  const seen = new Set();
  for (const abstractContent of containers) {
    const textRegex = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi;
    let match;
    while ((match = textRegex.exec(abstractContent)) !== null) {
      const labelMatch = (match[1] || '').match(/\bLabel="([^"]*)"/i);
      const label = labelMatch ? cleanXmlText(labelMatch[1]) : '';
      const text = cleanXmlText(match[2]);
      if (!text) continue;
      const value = label && label.toUpperCase() !== 'UNLABELLED' ? `${label}: ${text}` : text;
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        sections.push(value);
      }
    }
  }
  return sections.join('\n\n').trim();
}

const NO_ABSTRACT = 'No abstract available.';

function isMissingAbstract(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized === NO_ABSTRACT.toLowerCase()
    || normalized === '暂无摘要'
    || normalized === '暂无摘要。'
    || normalized === '没有摘要'
    || normalized === '没有摘要。';
}

function extractDoiFromPubmedXml(articleXml) {
  const patterns = [
    /<ArticleId\b[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/i,
    /<ELocationID\b[^>]*EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/i
  ];
  for (const pattern of patterns) {
    const match = String(articleXml || '').match(pattern);
    const doi = normalizeDoi(match ? cleanXmlText(match[1]) : '');
    if (doi) return doi.toLowerCase();
  }
  return '';
}

/**
 * 解析发布日期
 */
function extractPubDate(articleXml) {
  const pubDateMatch = articleXml.match(/<PubDate>([\s\S]*?)<\/PubDate>/i);
  if (!pubDateMatch) return null;
  
  const pubDateContent = pubDateMatch[1];
  const year = extractXmlText(pubDateContent, 'Year');
  const month = extractXmlText(pubDateContent, 'Month');
  const day = extractXmlText(pubDateContent, 'Day');
  
  if (year) {
    // 转换月份名称到数字
    const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                       jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const monthNum = monthMap[month.toLowerCase().substring(0, 3)] || month || '01';
    const dayNum = day || '01';
    return `${year}-${monthNum.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;
  }
  return null;
}

/**
 * 确定文章标签
 */
function determineTags(title, articleXml) {
  const tags = [];
  const titleLower = title.toLowerCase();
  const xmlLower = articleXml.toLowerCase();
  
  if (xmlLower.includes('clinical trial') || titleLower.includes('trial') || titleLower.includes('phase')) {
    tags.push('clinical_trial');
  }
  if (xmlLower.includes('review') || titleLower.includes('review')) {
    tags.push('review');
  }
  if (xmlLower.includes('guideline') || xmlLower.includes('consensus') || titleLower.includes('guideline')) {
    tags.push('guideline');
  }
  if (tags.length === 0) {
    tags.push('research');
  }
  return tags;
}

function normalizeDoi(rawDoi = '') {
  if (!rawDoi || typeof rawDoi !== 'string') return '';
  let doi = rawDoi.trim();
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  doi = doi.replace(/^doi:\s*/i, '');
  try {
    doi = decodeURIComponent(doi);
  } catch {
    // 保留无法解码的原值，后续由 DOI 校验给出提示
  }
  return doi.split(/[?#]/, 1)[0].replace(/[\s.,;:]+$/, '').trim();
}

function createDuplicateDoiError(articleId) {
  const error = new Error(`该 DOI 文献已存在 (${articleId})`);
  error.code = 'DUPLICATE_DOI';
  return error;
}

function isDuplicateDatabaseError(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

async function findExistingArticleByDoi(doi) {
  const normalizedDoi = normalizeDoi(doi).toLowerCase();
  if (!normalizedDoi) return null;

  const canonicalUrl = `https://doi.org/${normalizedDoi}`;
  const legacyUrl = `https://dx.doi.org/${normalizedDoi}`;
  const [rows] = await pool.execute(
    `SELECT id
       FROM articles_cache
      WHERE LOWER(TRIM(doi)) = ?
         OR LOWER(TRIM(TRAILING '/' FROM url)) IN (?, ?)
      LIMIT 1`,
    [normalizedDoi, canonicalUrl, legacyUrl]
  );
  return rows[0] || null;
}

function getCrossrefDate(message) {
  const dateParts = message?.published?.['date-parts']?.[0]
    || message?.['published-online']?.['date-parts']?.[0]
    || message?.['published-print']?.['date-parts']?.[0]
    || message?.created?.['date-parts']?.[0];
  if (!Array.isArray(dateParts) || !dateParts[0]) return null;
  const [year, month = 1, day = 1] = dateParts;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function fetchAndCacheArticleFromCrossref(doi, userId = null) {
  const endpoint = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  let response;
  try {
    response = await axios.get(endpoint, {
      timeout: 15000,
      headers: { 'User-Agent': 'DMD-Companion/1.0 (mailto:admin@example.com)' }
    });
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`PubMed 和 Crossref 均未找到 DOI: ${doi}`);
    }
    throw new Error(`Crossref 查询失败: ${error.message}`);
  }

  const metadata = response.data?.message;
  const title = cleanXmlText(metadata?.title?.[0] || '');
  if (!metadata || !title) throw new Error(`Crossref 未返回可用的文献元数据: ${doi}`);

  const normalizedDoi = normalizeDoi(doi).toLowerCase();
  const abstract = cleanXmlText(metadata.abstract || '') || NO_ABSTRACT;
  const authors = (metadata.author || []).map((author) =>
    [author.given, author.family].filter(Boolean).join(' ').trim()
  ).filter(Boolean);
  const journal = cleanXmlText(metadata['container-title']?.[0] || metadata.publisher || '');
  const tags = determineTags(title, `${metadata.type || ''} ${abstract}`);
  const id = `doi:${crypto.createHash('sha1').update(normalizedDoi).digest('hex')}`;

  const [existing] = await pool.execute(
    'SELECT title_zh, abstract_zh, created_by_user_id FROM articles_cache WHERE id = ?',
    [id]
  );
  let titleZh = existing[0]?.title_zh || '';
  let abstractZh = existing[0]?.abstract_zh || '';
  if (!titleZh || !abstractZh) {
    try {
      const translation = await translateArticle(title, abstract);
      titleZh = translation.titleZh || titleZh;
      abstractZh = translation.abstractZh || abstractZh;
    } catch (error) {
      console.warn(`Crossref 文献翻译失败 (${doi}):`, error.message);
    }
  }

  let aiData = { sub_tags: [], impact_factor: '', research_stage: '', ai_summary: '' };
  const enriched = await enrichArticleWithAI(title, abstract, journal);
  if (enriched) aiData = enriched;
  const normalized = normalizeDrugNamesInArticlePayload({
    titleZh, abstractZh, aiSummary: aiData.ai_summary, subTags: aiData.sub_tags
  });
  const drugNames = Array.isArray(aiData.drug_names) ? await articleDrugNames(aiData.drug_names, title, abstract) : null;
  const createdByUserId = userId || existing[0]?.created_by_user_id || null;

  try {
    await pool.execute(
      `INSERT INTO articles_cache (id, doi, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, drug_names, impact_factor, research_stage, ai_summary, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, normalizedDoi, title, normalized.titleZh, abstract, normalized.abstractZh, JSON.stringify(authors),
        getCrossrefDate(metadata), journal, `https://doi.org/${normalizedDoi}`, JSON.stringify(tags),
        JSON.stringify(normalized.subTags), drugNames === null ? null : JSON.stringify(drugNames), aiData.impact_factor, aiData.research_stage,
        normalized.aiSummary, createdByUserId]
    );
  } catch (error) {
    if (isDuplicateDatabaseError(error)) {
      const duplicate = await findExistingArticleByDoi(normalizedDoi);
      throw createDuplicateDoiError(duplicate?.id || id);
    }
    throw error;
  }

  const [rows] = await pool.execute(
    `SELECT id, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, impact_factor, research_stage, ai_summary, uv_count, created_by_user_id
     FROM articles_cache WHERE id = ?`,
    [id]
  );
  return rows[0] ? toArticleResponse(rows[0]) : null;
}

function getTagLikePatterns(tagFilter = '') {
  const normalized = String(tagFilter || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') {
    return [];
  }

  if (normalized === '临床试验' || normalized === 'clinical_trial' || normalized === 'clinical trial') {
    return ['%clinical_trial%', '%clinical trial%', '%临床试验%'];
  }
  if (normalized === '综述' || normalized === 'review') {
    return ['%review%', '%综述%'];
  }
  if (normalized === '指南/共识' || normalized === 'guideline' || normalized === 'guidelines') {
    return ['%guideline%', '%guidelines%', '%指南%', '%共识%'];
  }
  if (normalized === '研究论文' || normalized === 'research' || normalized === 'paper') {
    return ['%research%', '%paper%', '%研究论文%'];
  }
  if (normalized === '文章') {
    return ['%文章%'];
  }

  return [];
}

function toArticleResponse(article) {
  return {
    id: article.id,
    title: article.title,
    titleZh: article.title_zh || '',
    abstract: article.abstract,
    abstractZh: article.abstract_zh || '',
    authors: typeof article.authors === 'string' ? JSON.parse(article.authors) : article.authors,
    publicationDate: article.publication_date,
    journal: article.journal,
    url: article.url,
    tags: typeof article.tags === 'string' ? JSON.parse(article.tags) : article.tags,
    subTags: typeof article.sub_tags === 'string' ? JSON.parse(article.sub_tags) : (article.sub_tags || []),
    impactFactor: article.impact_factor || '',
    researchStage: article.research_stage || '',
    aiSummary: article.ai_summary || '',
    uvCount: Number(article.uv_count || 0)
  };
}

/**
 * 使用 Gemini AI 为文献补充结构化信息
 */
async function enrichArticleWithAI(title, abstract, journal) {
  try {
    const prompt = `你是一位专注于杜氏肌营养不良症（DMD）领域的医学 AI 助手。请根据以下文章信息，生成结构化元数据。

文章标题：${title}
期刊：${journal || '未知'}
摘要：${abstract}

请严格按以下 JSON 格式返回（不要返回任何其他内容）：
{
  "sub_tags": ["标签1", "标签2", "标签3"],
  "impact_factor": "期刊影响因子估计值，例如 2.4；如不确定写未知",
  "research_stage": "从以下选择一个：体外实验/动物实验/人体临床数据/药械分析/综述/指南共识/病例报告",
  "ai_summary": "用一句中文（不超过 50 字）总结文章核心发现或意义",
  "drug_names": ["标题或摘要中明确出现的药物、研究性干预或候选药物名称"]
}

要求：
1. sub_tags 给出 2-4 个细分标签，例如：基因治疗、AAV载体、免疫反应、安全性、外显子跳跃、心脏功能、呼吸康复等。
2. research_stage 根据研究内容准确判断阶段。
3. drug_names 只提取标题或摘要中实际出现的具体名称，优先保留原文名称；不要把药物类别、研究方法或猜测的商品名当作名称。没有则返回空数组。
4. 只返回 JSON。`;

    const contents = [{ parts: [{ text: prompt }] }];
    const result = await callGeminiAPI(contents);
    if (!result) return null;

    let jsonStr = result.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);
    return {
      sub_tags: Array.isArray(parsed.sub_tags) ? parsed.sub_tags : [],
      impact_factor: String(parsed.impact_factor || ''),
      research_stage: String(parsed.research_stage || ''),
      ai_summary: String(parsed.ai_summary || ''),
      drug_names: Array.isArray(parsed.drug_names) ? parsed.drug_names : null
    };
  } catch (error) {
    console.warn('AI enrichment failed:', error.message);
    return null;
  }
}

async function upsertArticleFromPubmedXml(articleXml, userId = null) {
  const pmid = extractXmlText(articleXml, 'PMID');
  if (!pmid) {
    throw new Error('DOI 未关联到可用的 PubMed PMID');
  }

  const doi = extractDoiFromPubmedXml(articleXml);
  const [existing] = await pool.execute(
    'SELECT id, abstract, title_zh, abstract_zh, created_by_user_id FROM articles_cache WHERE id = ?',
    [pmid]
  );

  const title = extractXmlText(articleXml, 'ArticleTitle');
  if (!title) {
    throw new Error('Failed to parse article title from PubMed');
  }

  const abstract = extractAbstract(articleXml) || (isMissingAbstract(existing[0]?.abstract) ? NO_ABSTRACT : existing[0].abstract);
  const authors = extractAuthors(articleXml);
  const pubDate = extractPubDate(articleXml);
  const journal = extractXmlText(articleXml, 'Title') || extractXmlText(articleXml, 'ISOAbbreviation');
  const tags = determineTags(title, articleXml);
  const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

  let titleZh = existing.length > 0 ? existing[0].title_zh : '';
  let abstractZh = existing.length > 0 ? existing[0].abstract_zh : '';

  if (!titleZh || isMissingAbstract(abstractZh)) {
    try {
      const translation = await translateArticle(title, abstract);
      titleZh = translation.titleZh || titleZh;
      abstractZh = translation.abstractZh || abstractZh;
    } catch (translateError) {
      console.warn(`翻译失败 (${pmid}):`, translateError.message);
    }
  }

  // AI enrichment for new fields
  let aiData = { sub_tags: [], impact_factor: '', research_stage: '', ai_summary: '' };
  try {
    const enriched = await enrichArticleWithAI(title, abstract, journal);
    if (enriched) aiData = enriched;
  } catch (e) { console.warn('AI enrichment skipped:', e.message); }

  const normalizedPayload = normalizeDrugNamesInArticlePayload({
    titleZh,
    abstractZh,
    aiSummary: aiData.ai_summary,
    subTags: aiData.sub_tags
  });
  titleZh = normalizedPayload.titleZh;
  abstractZh = normalizedPayload.abstractZh;
  aiData.ai_summary = normalizedPayload.aiSummary;
  aiData.sub_tags = normalizedPayload.subTags;
  const drugNames = Array.isArray(aiData.drug_names) ? await articleDrugNames(aiData.drug_names, title, abstract) : null;

  const createdByUserId = userId || (existing.length > 0 ? existing[0].created_by_user_id : null);

  try {
    await pool.execute(
      `INSERT INTO articles_cache (id, doi, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, drug_names, impact_factor, research_stage, ai_summary, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pmid, doi || null, title, titleZh, abstract, abstractZh, JSON.stringify(authors), pubDate, journal, url, JSON.stringify(tags), JSON.stringify(aiData.sub_tags), drugNames === null ? null : JSON.stringify(drugNames), aiData.impact_factor, aiData.research_stage, aiData.ai_summary, createdByUserId]
    );
  } catch (error) {
    if (isDuplicateDatabaseError(error)) {
      const duplicate = doi ? await findExistingArticleByDoi(doi) : null;
      throw createDuplicateDoiError(duplicate?.id || pmid);
    }
    throw error;
  }

  const [savedRows] = await pool.execute(
    `SELECT id, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, impact_factor, research_stage, ai_summary, uv_count, created_by_user_id
    FROM articles_cache WHERE id = ?`,
    [pmid]
  );

  return savedRows.length > 0 ? toArticleResponse(savedRows[0]) : null;
}

function getEuropePmcAuthors(record) {
  const authorList = record?.authorList?.author;
  if (Array.isArray(authorList)) {
    return authorList.map(author => cleanXmlText(
      author.fullName || [author.firstName, author.lastName].filter(Boolean).join(' ')
    )).filter(Boolean);
  }
  return String(record?.authorString || '')
    .replace(/\.$/, '')
    .split(',')
    .map(author => author.trim())
    .filter(Boolean);
}

function getEuropePmcPublicationDate(record) {
  const candidates = [
    record?.firstPublicationDate,
    record?.electronicPublicationDate,
    record?.journalInfo?.printPublicationDate
  ];
  for (const value of candidates) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return match[0];
  }
  const year = String(record?.pubYear || record?.journalInfo?.yearOfPublication || '');
  return /^\d{4}$/.test(year) ? `${year}-01-01` : null;
}

function normalizeEuropePmcRecord(record) {
  const pmid = String(record?.pmid || (record?.source === 'MED' ? record?.id : '') || '').trim();
  const doi = normalizeDoi(record?.doi || '').toLowerCase();
  const fallbackId = doi
    ? `doi:${crypto.createHash('sha1').update(doi).digest('hex')}`
    : `epmc:${String(record?.source || 'unknown').toLowerCase()}:${String(record?.id || '').trim()}`;
  const id = pmid || fallbackId;
  const title = cleanXmlText(record?.title || '');
  const abstract = cleanXmlText(record?.abstractText || '') || NO_ABSTRACT;
  const journal = cleanXmlText(
    record?.journalInfo?.journal?.title
      || record?.journalInfo?.journal?.medlineAbbreviation
      || record?.bookOrReportDetails?.publisher
      || ''
  );
  const classificationText = JSON.stringify({
    pubTypes: record?.pubTypeList?.pubType || [],
    keywords: record?.keywordList?.keyword || [],
    abstract
  });

  return {
    id,
    pmid,
    doi,
    title,
    abstract,
    authors: getEuropePmcAuthors(record),
    publicationDate: getEuropePmcPublicationDate(record),
    journal,
    url: pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      : (doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${record?.source}/${record?.id}`),
    tags: determineTags(title, classificationText)
  };
}

function isCachedArticleComplete(article) {
  return Boolean(article?.title_zh)
    && !isMissingAbstract(article?.abstract)
    && !isMissingAbstract(article?.abstract_zh);
}

async function runEuropePmcArticleFetch(pubmedError) {
  console.warn(`⚠️ PubMed 不可用，切换 Europe PMC: ${pubmedError.message}`);
  console.log('=== 开始从 Europe PMC 抓取文献 ===');

  const searchResult = await searchEuropePmc();
  let preferredResults = [];
  try {
    await delay(350);
    preferredResults = (await searchEuropePmc(true)).results;
  } catch (error) {
    console.warn(`Europe PMC 优先检索失败，继续常规抓取: ${error.message}`);
  }
  const preferredArticles = preferredResults.map(normalizeEuropePmcRecord).filter(article => article.id && article.title);
  const normalizedResults = [...new Map([...preferredResults, ...searchResult.results]
    .map(normalizeEuropePmcRecord)
    .filter(article => article.id && article.title).map(article => [article.id, article])).values()];
  console.log(`Europe PMC 检索总数: ${searchResult.hitCount}, 本次返回: ${normalizedResults.length}`);

  if (normalizedResults.length === 0) return 0;

  const ids = normalizedResults.map(article => article.id);
  const dois = normalizedResults.map(article => article.doi).filter(Boolean);
  const [cachedRows] = dois.length > 0
    ? await pool.query(
      `SELECT id, doi, title_zh, abstract, abstract_zh
         FROM articles_cache
        WHERE id IN (?) OR doi IN (?)`,
      [ids, dois]
    )
    : await pool.query(
      `SELECT id, doi, title_zh, abstract, abstract_zh
         FROM articles_cache
        WHERE id IN (?)`,
      [ids]
    );
  const cachedById = new Map(cachedRows.map(row => [String(row.id), row]));
  const cachedByDoi = new Map(cachedRows
    .filter(row => row.doi)
    .map(row => [String(row.doi).toLowerCase(), row]));
  const needsImport = article => {
    const cached = cachedById.get(article.id) || cachedByDoi.get(article.doi);
    return !isCachedArticleComplete(cached);
  };
  const candidates = selectArticleCandidates(preferredArticles.filter(needsImport), normalizedResults.filter(needsImport), article => article.id);

  if (candidates.length === 0) {
    console.log('Europe PMC 没有未入库或资料不完整的文章。');
    return 0;
  }
  console.log(`Europe PMC 本次将处理 ${candidates.length} 篇文章。`);

  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let translatedCount = 0;

  for (const article of candidates) {
    try {
      const [existingRows] = await pool.execute(
        `SELECT id, abstract, title_zh, abstract_zh
           FROM articles_cache
          WHERE id = ? OR (? <> '' AND doi = ?)
          LIMIT 1`,
        [article.id, article.doi, article.doi]
      );
      const existing = existingRows[0];
      if (isCachedArticleComplete(existing)) {
        skippedCount++;
        continue;
      }

      const abstract = isMissingAbstract(article.abstract) && !isMissingAbstract(existing?.abstract)
        ? existing.abstract
        : article.abstract;
      let titleZh = existing?.title_zh || '';
      let abstractZh = existing?.abstract_zh || '';
      if (!titleZh || isMissingAbstract(abstractZh)) {
        if (translatedCount > 0) await delay(TRANSLATE_DELAY_MS);
        try {
          const translation = await translateArticle(article.title, abstract);
          titleZh = translation.titleZh || titleZh;
          abstractZh = translation.abstractZh || abstractZh;
          translatedCount++;
        } catch (translationError) {
          console.warn(`  ⚠️ Europe PMC 翻译失败 (${article.id}): ${translationError.message}`);
        }
      }

      let aiData = { sub_tags: [], impact_factor: '', research_stage: '', ai_summary: '' };
      const enriched = await enrichArticleWithAI(article.title, abstract, article.journal);
      if (enriched) aiData = enriched;
      const normalizedPayload = normalizeDrugNamesInArticlePayload({
        titleZh,
        abstractZh,
        aiSummary: aiData.ai_summary,
        subTags: aiData.sub_tags
      });
      const drugNames = Array.isArray(aiData.drug_names) ? await articleDrugNames(aiData.drug_names, article.title, abstract) : null;

      await pool.execute(
        `INSERT INTO articles_cache
          (id, doi, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, drug_names, impact_factor, research_stage, ai_summary, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           doi = COALESCE(VALUES(doi), articles_cache.doi),
           title = VALUES(title),
           title_zh = VALUES(title_zh),
           abstract = VALUES(abstract),
           abstract_zh = VALUES(abstract_zh),
           authors = VALUES(authors),
           publication_date = VALUES(publication_date),
           journal = VALUES(journal),
           url = VALUES(url),
           tags = VALUES(tags),
           sub_tags = VALUES(sub_tags),
           drug_names = COALESCE(VALUES(drug_names), articles_cache.drug_names),
           impact_factor = VALUES(impact_factor),
           research_stage = VALUES(research_stage),
           ai_summary = VALUES(ai_summary),
           fetched_at = NOW()`,
        [article.id, article.doi || null, article.title, normalizedPayload.titleZh, abstract,
          normalizedPayload.abstractZh, JSON.stringify(article.authors), article.publicationDate,
          article.journal, article.url, JSON.stringify(article.tags), JSON.stringify(normalizedPayload.subTags),
          drugNames === null ? null : JSON.stringify(drugNames), aiData.impact_factor, aiData.research_stage, normalizedPayload.aiSummary, null]
      );
      savedCount++;
      console.log(`  ✅ Europe PMC 已缓存: ${article.id} - ${article.title.substring(0, 50)}...`);
    } catch (error) {
      failedCount++;
      console.error(`  ❌ Europe PMC 文献处理失败 (${article.id}): ${error.message}`);
    }
  }

  if (savedCount === 0 && failedCount > 0) {
    throw new Error(`Europe PMC 候选文献全部处理失败 (${failedCount}/${candidates.length})`);
  }
  console.log(`=== Europe PMC 抓取完成: ${savedCount} 篇已缓存, ${skippedCount} 篇跳过, ${failedCount} 篇失败, ${translatedCount} 篇已翻译 ===`);
  return savedCount;
}
/**
 * 从 PubMed 获取文章并缓存
 */
async function runPubmedArticleFetch() {
  console.log('=== 开始抓取 PubMed 文章 ===');
  console.log('时间:', new Date().toLocaleString('zh-CN'));
  
  try {
    // 1. 搜索文章 ID
    const term = '("Duchenne Muscular Dystrophy"[MeSH Terms] OR "Duchenne"[All Fields])';
    // 使用 Entry Date 捕获最近进入 PubMed 的记录，避免“未来刊期”的文章
    // 因出版日期晚于今天而长期漏抓。扩大扫描范围后，每次只处理一小批
    // 未入库/未完成记录，后续任务便能继续向检索结果深处推进。
    const dateRange = getDateRange(3);
    console.log('正在搜索文章...');
    const searchResult = await searchPubmed({
      db: 'pubmed',
      term: term + ' AND ' + dateRange,
      retmode: 'json',
      retmax: PUBMED_SEARCH_RETMAX,
      sort: 'date'
    }, { rejectEmpty: true });
    let preferredIds = [];
    try {
      await delay(350);
      const preferredResult = await searchPubmed({
        db: 'pubmed', term: `${term} AND ${dateRange} AND ${PUBMED_PREFERRED_FILTER}`,
        retmode: 'json', retmax: PUBMED_SEARCH_RETMAX, sort: 'date'
      });
      preferredIds = preferredResult.idlist;
    } catch (error) {
      console.warn(`PubMed 优先检索失败，继续常规抓取: ${error.message}`);
    }
    const ids = [...new Set([...preferredIds, ...searchResult.idlist])];
    console.log(`PubMed 检索总数: ${searchResult.count}, 本次返回 ID: ${ids.length}`);
    
    console.log('Found ' + ids.length + ' articles in search window.');
    if (ids.length === 0) return 0;

    const [cachedRows] = await pool.query(
      `SELECT id, title_zh, abstract, abstract_zh
         FROM articles_cache
        WHERE id IN (?)`,
      [ids]
    );
    const cachedById = new Map(cachedRows.map(row => [String(row.id), row]));
    const needsImport = id => {
      const cached = cachedById.get(String(id));
      return !cached
        || !cached.title_zh
        || isMissingAbstract(cached.abstract)
        || isMissingAbstract(cached.abstract_zh);
    };
    const candidateIds = selectArticleCandidates(preferredIds.filter(needsImport), ids.filter(needsImport));

    if (candidateIds.length === 0) {
      console.log('No uncached or incomplete articles found.');
      return 0;
    }
    console.log(`本次将处理 ${candidateIds.length} 篇未入库或资料不完整的文章。`);
    
    // 2. 获取文章详情 (XML)
    const fetchRes = await axios.get(
      `${PUBMED_BASE_URL}/efetch.fcgi`,
      getPubmedRequestConfig({
        db: 'pubmed',
        id: candidateIds.join(','),
        retmode: 'xml'
      })
    );
    const xmlData = fetchRes.data;
    assertPubmedResponseNotBlocked(xmlData);
    
    // 3. 解析并存储每篇文章
    const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi;
    let match;
    let savedCount = 0;
    let skippedCount = 0;
    let translatedCount = 0;
    let failedCount = 0;
    
    while ((match = articleRegex.exec(xmlData)) !== null) {
      const articleXml = match[1];
      
      try {
        // 提取 PMID
        const pmid = extractXmlText(articleXml, 'PMID');
        if (!pmid) continue;
        const doi = extractDoiFromPubmedXml(articleXml);
        
        // 检查是否已存在且翻译完整
        const [existing] = await pool.execute(
          'SELECT id, abstract, title_zh, abstract_zh FROM articles_cache WHERE id = ? OR (? <> \'\' AND doi = ?) LIMIT 1',
          [pmid, doi, doi]
        );
        
        if (existing.length > 0 && existing[0].title_zh && existing[0].abstract_zh
          && !isMissingAbstract(existing[0].abstract) && !isMissingAbstract(existing[0].abstract_zh)) {
          console.log(`  ⏭️ 跳过已翻译 ${pmid}`);
          skippedCount++;
          continue;
        }
        
        // 提取标题
        const title = extractXmlText(articleXml, 'ArticleTitle');
        if (!title) continue;
        
        // 提取其他字段
        const abstract = extractAbstract(articleXml) || (isMissingAbstract(existing[0]?.abstract) ? NO_ABSTRACT : existing[0].abstract);
        const authors = extractAuthors(articleXml);
        const pubDate = extractPubDate(articleXml);
        const journal = extractXmlText(articleXml, 'Title') || extractXmlText(articleXml, 'ISOAbbreviation');
        const tags = determineTags(title, articleXml);
        const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
        
        // 使用已有的翻译或进行新翻译
        let titleZh = existing.length > 0 ? existing[0].title_zh : '';
        let abstractZh = existing.length > 0 ? existing[0].abstract_zh : '';
        
        // 只有缺少翻译时才调用翻译 API
        if (!titleZh || isMissingAbstract(abstractZh)) {
          try {
            // 增加延迟，避免 API 请求过快
            if (translatedCount > 0) {
              console.log(`  ⏳ 等待 ${TRANSLATE_DELAY_MS}ms 后继续翻译...`);
              await delay(TRANSLATE_DELAY_MS);
            }
            
            const translation = await translateArticle(title, abstract);
            titleZh = translation.titleZh || titleZh;
            abstractZh = translation.abstractZh || abstractZh;
            translatedCount++;
            
            if (titleZh) {
              console.log(`  🔵 翻译完成: ${titleZh.substring(0, 30)}...`);
            }
          } catch (translateError) {
            console.warn(`  ⚠️ 翻译失败: ${translateError.message}`);
          }
        }
        
        // 存入数据库（使用 REPLACE 避免重复）
        // AI enrichment for new fields
        let aiData = { sub_tags: [], impact_factor: '', research_stage: '', ai_summary: '' };
        try {
          const enriched = await enrichArticleWithAI(title, abstract, journal);
          if (enriched) aiData = enriched;
        } catch (e) { console.warn('AI enrichment skipped:', e.message); }

        const normalizedPayload = normalizeDrugNamesInArticlePayload({
          titleZh,
          abstractZh,
          aiSummary: aiData.ai_summary,
          subTags: aiData.sub_tags
        });
        titleZh = normalizedPayload.titleZh;
        abstractZh = normalizedPayload.abstractZh;
        aiData.ai_summary = normalizedPayload.aiSummary;
        aiData.sub_tags = normalizedPayload.subTags;
        const drugNames = Array.isArray(aiData.drug_names) ? await articleDrugNames(aiData.drug_names, title, abstract) : null;

        await pool.execute(
          `INSERT INTO articles_cache
            (id, doi, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, drug_names, impact_factor, research_stage, ai_summary, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             doi = COALESCE(VALUES(doi), articles_cache.doi),
             title = VALUES(title),
             title_zh = VALUES(title_zh),
             abstract = VALUES(abstract),
             abstract_zh = VALUES(abstract_zh),
             authors = VALUES(authors),
             publication_date = VALUES(publication_date),
             journal = VALUES(journal),
             url = VALUES(url),
             tags = VALUES(tags),
             sub_tags = VALUES(sub_tags),
             drug_names = COALESCE(VALUES(drug_names), articles_cache.drug_names),
             impact_factor = VALUES(impact_factor),
             research_stage = VALUES(research_stage),
             ai_summary = VALUES(ai_summary),
             fetched_at = NOW(),
             created_by_user_id = COALESCE(articles_cache.created_by_user_id, VALUES(created_by_user_id))`,
          [pmid, doi || null, title, titleZh, abstract, abstractZh, JSON.stringify(authors), pubDate, journal, url, JSON.stringify(tags), JSON.stringify(aiData.sub_tags), drugNames === null ? null : JSON.stringify(drugNames), aiData.impact_factor, aiData.research_stage, aiData.ai_summary, null]
        );
        
        savedCount++;
        console.log(`  ✅ 已缓存: ${pmid} - ${title.substring(0, 50)}...`);
      } catch (parseError) {
        console.error('  ❌ 解析文章错误:', parseError.message);
        failedCount++;
      }
    }
    
    if (savedCount === 0 && failedCount > 0) {
      throw new Error(`候选文献全部处理失败 (${failedCount}/${candidateIds.length})`);
    }

    console.log(`=== 文章抓取完成: ${savedCount} 篇已缓存, ${skippedCount} 篇已跳过, ${failedCount} 篇失败, ${translatedCount} 篇已翻译 ===`);
    return savedCount;
    
  } catch (error) {
    console.error('文章抓取错误:', error.message);
    throw error;
  }
}

async function runArticleFetch() {
  const configuredSource = String(process.env.LITERATURE_FETCH_SOURCE || 'auto').trim().toLowerCase();
  if (configuredSource === 'europe_pmc') {
    const reason = new Error('已通过 LITERATURE_FETCH_SOURCE 配置 Europe PMC 为主数据源');
    reason.code = 'EUROPE_PMC_CONFIGURED';
    return runEuropePmcArticleFetch(reason);
  }

  try {
    return await runPubmedArticleFetch();
  } catch (error) {
    if (configuredSource !== 'pubmed' && shouldFallbackToEuropePmc(error)) {
      return runEuropePmcArticleFetch(error);
    }
    throw error;
  }
}

async function fetchAndCacheArticles() {
  if (articleFetchInFlight) {
    console.log('⏭️ 已有文献抓取任务运行中，复用当前任务');
    return articleFetchInFlight;
  }

  const now = Date.now();
  const remainingCooldownMs = PUBMED_FETCH_COOLDOWN_MS - (now - lastArticleFetchAttemptAt);
  if (lastArticleFetchAttemptAt > 0 && remainingCooldownMs > 0) {
    const remainingSeconds = Math.ceil(remainingCooldownMs / 1000);
    if (lastArticleFetchError) {
      const error = new Error(`文献抓取冷却中，请在 ${remainingSeconds} 秒后重试；上次错误: ${lastArticleFetchError.message}`);
      error.code = lastArticleFetchError.code || 'PUBMED_FETCH_COOLDOWN';
      throw error;
    }
    console.log(`⏭️ 距上次文献抓取不足冷却时间，跳过本次请求（剩余 ${remainingSeconds} 秒）`);
    return 0;
  }

  lastArticleFetchAttemptAt = now;
  articleFetchInFlight = runArticleFetch();
  try {
    const result = await articleFetchInFlight;
    lastArticleFetchError = null;
    return result;
  } catch (error) {
    lastArticleFetchError = error;
    throw error;
  } finally {
    articleFetchInFlight = null;
  }
}

async function fetchAndCacheArticleByDoi(rawDoi, userId = null) {
  const doi = normalizeDoi(rawDoi).toLowerCase();
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi)) {
    throw new Error('DOI 格式无效');
  }

  console.log(`=== 开始按 DOI 抓取文献: ${doi} ===`);

  const duplicate = await findExistingArticleByDoi(doi);
  if (duplicate) {
    throw createDuplicateDoiError(duplicate.id);
  }

  let searchResult;
  try {
    searchResult = await searchPubmed({
      db: 'pubmed',
      term: `${doi}[DOI]`,
      retmode: 'json',
      retmax: 1
    });
  } catch (error) {
    if (shouldFallbackToEuropePmc(error)) {
      console.warn(`PubMed 不可用，DOI ${doi} 改用 Crossref 抓取: ${error.message}`);
      return fetchAndCacheArticleFromCrossref(doi, userId);
    }
    throw error;
  }
  const pmid = searchResult.idlist[0];

  if (!pmid) {
    console.log(`PubMed 未找到 ${doi}，改用 Crossref 元数据抓取`);
    return fetchAndCacheArticleFromCrossref(doi, userId);
  }

  const [pmidDuplicates] = await pool.execute(
    'SELECT id FROM articles_cache WHERE id = ? LIMIT 1',
    [pmid]
  );
  if (pmidDuplicates.length > 0) {
    await pool.execute('UPDATE articles_cache SET doi = COALESCE(doi, ?) WHERE id = ?', [doi, pmid]);
    throw createDuplicateDoiError(pmid);
  }

  let xmlData;
  try {
    const fetchRes = await axios.get(
      `${PUBMED_BASE_URL}/efetch.fcgi`,
      getPubmedRequestConfig({ db: 'pubmed', id: pmid, retmode: 'xml' })
    );
    xmlData = fetchRes.data || '';
    assertPubmedResponseNotBlocked(xmlData);
  } catch (error) {
    if (shouldFallbackToEuropePmc(error)) {
      console.warn(`PubMed EFetch 不可用，DOI ${doi} 改用 Crossref 抓取: ${error.message}`);
      return fetchAndCacheArticleFromCrossref(doi, userId);
    }
    throw error;
  }
  const match = xmlData.match(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/i);

  if (!match) {
    throw new Error(`PubMed 未返回可解析的文献数据 (PMID: ${pmid})`);
  }

  const article = await upsertArticleFromPubmedXml(match[1], userId);
  if (!article) {
    throw new Error(`文献入库失败 (PMID: ${pmid})`);
  }

  console.log(`=== DOI 文献抓取完成: PMID ${pmid} ===`);
  return article;
}

/**
 * 获取用户定向抓取的文献
 */
async function getUserFetchedArticles(userId, searchKeyword = '', page = 1, pageSize = 10) {
  try {
    let searchCondition = ' WHERE created_by_user_id = ? AND publication_date <= CURDATE()';
    const params = [userId];
    
    if (searchKeyword) {
      searchCondition = appendKeywordGroupsToWhere(searchCondition, params, await buildExpandedSearchGroups(searchKeyword));
    }

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset = (safePage - 1) * safePageSize;

    const sql = `SELECT id, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, impact_factor, research_stage, ai_summary, uv_count, created_by_user_id
      FROM articles_cache${searchCondition}
      ORDER BY fetched_at DESC
      LIMIT ${safePageSize} OFFSET ${offset}`;
    
    const [articles] = await pool.execute(sql, params);

    return articles.map(article => ({
      id: article.id,
      title: article.title,
      titleZh: article.title_zh || '',
      abstract: article.abstract,
      abstractZh: article.abstract_zh || '',
      authors: typeof article.authors === 'string' ? JSON.parse(article.authors) : article.authors,
      publicationDate: article.publication_date,
      journal: article.journal,
      url: article.url,
      tags: typeof article.tags === 'string' ? JSON.parse(article.tags) : article.tags,
      subTags: typeof article.sub_tags === 'string' ? JSON.parse(article.sub_tags) : (article.sub_tags || []),
      impactFactor: article.impact_factor || '',
      researchStage: article.research_stage || '',
      aiSummary: article.ai_summary || '',
      uvCount: Number(article.uv_count || 0)
    }));
  } catch (error) {
    console.error('获取用户定向抓取文献错误:', error.message);
    return [];
  }
}

/**
 * 获取用户定向抓取的文献总数
 */
async function backfillArticleDrugNames(limit = 20, afterId = '') {
  const batchSize = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
  const [articles] = await pool.execute(
    `SELECT id, title, abstract, journal FROM articles_cache
     WHERE drug_names IS NULL AND id > ? ORDER BY id LIMIT ${batchSize}`,
    [afterId]
  );
  let updated = 0;
  let failed = 0;
  for (const [index, article] of articles.entries()) {
    try {
      const aiData = await enrichArticleWithAI(article.title, article.abstract || '', article.journal);
      if (!Array.isArray(aiData?.drug_names)) { failed++; continue; }
      const drugNames = await articleDrugNames(aiData.drug_names, article.title, article.abstract);
      await pool.execute(
        'UPDATE articles_cache SET drug_names = ? WHERE id = ? AND drug_names IS NULL',
        [JSON.stringify(drugNames), article.id]
      );
      updated++;
    } catch (error) {
      failed++;
      console.warn(`药物名称回填失败 (${article.id}):`, error.message);
    }
    if (index < articles.length - 1) await delay(250);
  }
  return { selected: articles.length, updated, failed, lastId: articles.at(-1)?.id || afterId };
}

async function getUserFetchedArticlesCount(userId, searchKeyword = '') {
  try {
    let searchCondition = ' WHERE created_by_user_id = ? AND publication_date <= CURDATE()';
    const params = [userId];
    
    if (searchKeyword) {
      searchCondition = appendKeywordGroupsToWhere(searchCondition, params, await buildExpandedSearchGroups(searchKeyword));
    }

    const countSql = `SELECT COUNT(*) as total FROM articles_cache${searchCondition}`;
    const [result] = await pool.execute(countSql, params);
    
    return result[0]?.total || 0;
  } catch (error) {
    console.error('获取用户定向抓取文献总数错误:', error.message);
    return 0;
  }
}

/**
 * 获取全站用户手动抓取文献（随机）
 */
async function getRandomUserFetchedArticles(limit = 9) {
  try {
    const safeLimit = Math.min(30, Math.max(1, parseInt(limit, 10) || 9));
    const [articles] = await pool.execute(`
      SELECT id, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, impact_factor, research_stage, ai_summary, uv_count
      FROM articles_cache
      WHERE created_by_user_id IS NOT NULL
        AND publication_date <= CURDATE()
      ORDER BY RAND()
      LIMIT ${safeLimit}
    `);

    return articles.map(article => ({
      id: article.id,
      title: article.title,
      titleZh: article.title_zh || '',
      abstract: article.abstract,
      abstractZh: article.abstract_zh || '',
      authors: typeof article.authors === 'string' ? JSON.parse(article.authors) : article.authors,
      publicationDate: article.publication_date,
      journal: article.journal,
      url: article.url,
      tags: typeof article.tags === 'string' ? JSON.parse(article.tags) : article.tags,
      subTags: typeof article.sub_tags === 'string' ? JSON.parse(article.sub_tags) : (article.sub_tags || []),
      impactFactor: article.impact_factor || '',
      researchStage: article.research_stage || '',
      aiSummary: article.ai_summary || '',
      uvCount: Number(article.uv_count || 0)
    }));
  } catch (error) {
    console.error('获取随机用户抓取文献错误:', error.message);
    return [];
  }
}

/**
 * 获取缓存中的最新文献
 */
async function getLatestCachedArticle() {
  try {
    const [articles] = await pool.execute(`
      SELECT id, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, impact_factor, research_stage, ai_summary
      FROM articles_cache
      ORDER BY publication_date DESC, fetched_at DESC
      LIMIT 1
    `);

    if (articles.length > 0) {
      return toArticleResponse(articles[0]);
    }
    return null;
  } catch (error) {
    console.error('获取缓存文章错误:', error.message);
    return null;
  }
}
async function getAllCachedArticles(months = null, searchKeyword = '', tagFilter = '', page = 1, pageSize = 10) {
  try {
    // Build search condition with parameterized queries
    let searchCondition = '';
    const params = [];
    
    searchCondition += " WHERE publication_date <= CURDATE()";

    // 时间筛选（可选）
    if (months) {
      const monthsNum = parseInt(months, 10) || 3;
      const dateLimit = new Date();
      dateLimit.setMonth(dateLimit.getMonth() - monthsNum);
      const dateLimitStr = dateLimit.toISOString().split('T')[0];
      searchCondition += searchCondition ? " AND publication_date >= ?" : " WHERE publication_date >= ?";
      params.push(dateLimitStr);
    }
    
    // 搜索关键词：支持药物别名扩展（如 A/B/C 任一别名都可命中）
    if (searchKeyword) {
      const keywordGroups = await buildExpandedSearchGroups(searchKeyword);
      searchCondition = appendKeywordGroupsToWhere(searchCondition, params, keywordGroups);
    }

    const tagPatterns = getTagLikePatterns(tagFilter);
    if (tagPatterns.length > 0) {
      const tagClauses = tagPatterns.map(() => 'tags LIKE ?').join(' OR ');
      searchCondition += searchCondition ? ` AND (${tagClauses})` : ` WHERE (${tagClauses})`;
      params.push(...tagPatterns);
    }

    // 分页参数 - MySQL LIMIT/OFFSET 不能直接参数化，需要直接拼接
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset = (safePage - 1) * safePageSize;

    const sql = `SELECT id, title, title_zh, abstract, abstract_zh, authors, publication_date, journal, url, tags, sub_tags, impact_factor, research_stage, ai_summary, uv_count
      FROM articles_cache` + searchCondition + `
      ORDER BY publication_date DESC, id DESC
      LIMIT ${safePageSize} OFFSET ${offset}`;

    const [articles] = await pool.execute(sql, params);

    return articles.map(article => ({
      id: article.id,
      title: article.title,
      titleZh: article.title_zh || '',
      abstract: article.abstract,
      abstractZh: article.abstract_zh || '',
      authors: typeof article.authors === 'string' ? JSON.parse(article.authors) : article.authors,
      publicationDate: article.publication_date,
      journal: article.journal,
      url: article.url,
      tags: typeof article.tags === 'string' ? JSON.parse(article.tags) : article.tags,
      subTags: typeof article.sub_tags === 'string' ? JSON.parse(article.sub_tags) : (article.sub_tags || []),
      impactFactor: article.impact_factor || '',
      researchStage: article.research_stage || '',
      aiSummary: article.ai_summary || '',
      uvCount: Number(article.uv_count || 0)
    }));
  } catch (error) {
    console.error('获取缓存文章列表错误:', error.message);
    return [];
  }
}

async function getTotalCachedArticles(months = null, searchKeyword = '', tagFilter = '') {
  try {
    // Build search condition with parameterized queries
    let searchCondition = '';
    const params = [];
    
    searchCondition += " WHERE publication_date <= CURDATE()";

    // 时间筛选（可选）
    if (months) {
      const monthsNum = parseInt(months, 10) || 3;
      const dateLimit = new Date();
      dateLimit.setMonth(dateLimit.getMonth() - monthsNum);
      const dateLimitStr = dateLimit.toISOString().split('T')[0];
      searchCondition += searchCondition ? " AND publication_date >= ?" : " WHERE publication_date >= ?";
      params.push(dateLimitStr);
    }
    
    // 搜索关键词：支持药物别名扩展（与列表查询逻辑一致）
    if (searchKeyword) {
      const keywordGroups = await buildExpandedSearchGroups(searchKeyword);
      searchCondition = appendKeywordGroupsToWhere(searchCondition, params, keywordGroups);
    }

    const tagPatterns = getTagLikePatterns(tagFilter);
    if (tagPatterns.length > 0) {
      const tagClauses = tagPatterns.map(() => 'tags LIKE ?').join(' OR ');
      searchCondition += searchCondition ? ` AND (${tagClauses})` : ` WHERE (${tagClauses})`;
      params.push(...tagPatterns);
    }

    const countSql = `SELECT COUNT(*) as total FROM articles_cache` + searchCondition;
    const [result] = await pool.execute(countSql, params);

    return result[0]?.total || 0;
  } catch (error) {
    console.error('获取文章总数错误:', error.message);
    return 0;
  }
}

module.exports = {
  fetchAndCacheArticles,
  getLatestCachedArticle,
  getAllCachedArticles,
  getTotalCachedArticles,
  getUserFetchedArticles,
  getUserFetchedArticlesCount,
  getRandomUserFetchedArticles,
  fetchAndCacheArticleByDoi,
  backfillArticleDrugNames,
  incrementViewCount,
  getHotArticles
};

if (process.env.NODE_ENV === 'test') {
  module.exports.__test = {
    searchEuropePmc,
    normalizeEuropePmcRecord,
    shouldFallbackToEuropePmc
  };
}

/**
 * 增加文章浏览量
 */
async function incrementViewCount(articleId, userId) {
  try {
    return await recordArticleView(pool, articleId, userId);
  } catch (error) {
    console.error('记录文章UV/PV错误:', error.message);
    return false;
  }
}

/**
 * 获取热门文章。展示和排序均按时间窗口内去重阅读人数（UV）。
 */
async function getHotArticles(limit = 6, period = 'month') {
  try {
    const [articles] = await pool.execute(hotArticleQuery(limit, period));

    return articles.map(article => ({
      id: article.id,
      title: article.title,
      titleZh: article.title_zh || '',
      abstract: article.abstract,
      abstractZh: article.abstract_zh || '',
      authors: typeof article.authors === 'string' ? JSON.parse(article.authors) : article.authors,
      publicationDate: article.publication_date,
      journal: article.journal,
      url: article.url,
      tags: typeof article.tags === 'string' ? JSON.parse(article.tags) : article.tags,
      subTags: typeof article.sub_tags === 'string' ? JSON.parse(article.sub_tags) : (article.sub_tags || []),
      impactFactor: article.impact_factor || '',
      researchStage: article.research_stage || '',
      aiSummary: article.ai_summary || '',
      uvCount: Number(article.uv_count || 0)
    }));
  } catch (error) {
    console.error('获取热门文章错误:', error.message);
    return [];
  }
}



