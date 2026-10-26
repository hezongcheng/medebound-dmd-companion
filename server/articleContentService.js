/**
 * 文章原文内容抓取服务
 * 从 PubMed Central (PMC) 或 PubMed 获取文章全文内容
 */

const axios = require('axios');
const { pool } = require('./db');
require('dotenv').config();

const PUBMED_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PMC_BASE_URL = 'https://www.ncbi.nlm.nih.gov/pmc/articles';

/**
 * 从 PubMed 获取文章的 PMC ID (如果有)
 */
async function getPmcId(pmid) {
  try {
    const url = `${PUBMED_BASE_URL}/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json`;
    const response = await axios.get(url, { timeout: 10000 });
    
    const linksets = response.data?.linksets?.[0]?.linksetdbs;
    if (linksets) {
      const pmcLink = linksets.find(link => link.dbto === 'pmc');
      if (pmcLink?.links?.[0]) {
        return `PMC${pmcLink.links[0]}`;
      }
    }
    return null;
  } catch (error) {
    console.error(`获取PMC ID失败 (PMID: ${pmid}):`, error.message);
    return null;
  }
}

/**
 * 从 PMC 获取文章全文 (XML格式)
 */
async function fetchPmcFullText(pmcId) {
  try {
    const url = `${PUBMED_BASE_URL}/efetch.fcgi?db=pmc&id=${pmcId.replace('PMC', '')}&rettype=xml`;
    const response = await axios.get(url, { timeout: 30000 });
    
    if (response.data) {
      return parsePmcXml(response.data);
    }
    return null;
  } catch (error) {
    console.error(`获取PMC全文失败 (${pmcId}):`, error.message);
    return null;
  }
}

/**
 * 解析 PMC XML 提取正文内容
 */
function parsePmcXml(xml) {
  const sections = [];
  
  // 提取各个section
  const sectionRegex = /<sec[^>]*>[\s\S]*?<title>([^<]*)<\/title>([\s\S]*?)<\/sec>/gi;
  let match;
  
  while ((match = sectionRegex.exec(xml)) !== null) {
    const title = match[1].trim();
    let content = match[2];
    
    // 提取段落文本
    const paragraphs = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch;
    while ((pMatch = pRegex.exec(content)) !== null) {
      let text = pMatch[1]
        .replace(/<[^>]+>/g, '') // 移除HTML标签
        .replace(/\s+/g, ' ')    // 合并空白
        .trim();
      if (text) {
        paragraphs.push(text);
      }
    }
    
    if (paragraphs.length > 0) {
      sections.push({
        title,
        content: paragraphs.join('\n\n')
      });
    }
  }
  
  // 如果没有找到sections，尝试提取body内容
  if (sections.length === 0) {
    const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      let bodyText = bodyMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (bodyText) {
        sections.push({
          title: '正文',
          content: bodyText.substring(0, 50000) // 限制长度
        });
      }
    }
  }
  
  return sections.length > 0 ? sections : null;
}

/**
 * 从 PubMed 获取扩展摘要信息
 */
async function fetchPubmedAbstract(pmid) {
  try {
    const url = `${PUBMED_BASE_URL}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml`;
    const response = await axios.get(url, { timeout: 15000 });
    
    if (response.data) {
      return parsePubmedAbstractXml(response.data);
    }
    return null;
  } catch (error) {
    console.error(`获取PubMed摘要失败 (PMID: ${pmid}):`, error.message);
    return null;
  }
}

/**
 * 解析 PubMed 摘要 XML
 */
function parsePubmedAbstractXml(xml) {
  const sections = [];
  
  // 提取结构化摘要
  const abstractMatch = xml.match(/<Abstract>([\s\S]*?)<\/Abstract>/i);
  if (abstractMatch) {
    const abstractContent = abstractMatch[1];
    const textRegex = /<AbstractText[^>]*(?:Label="([^"]*)")?[^>]*>([^<]*)<\/AbstractText>/gi;
    
    let match;
    while ((match = textRegex.exec(abstractContent)) !== null) {
      const label = match[1] || '摘要';
      const text = match[2].trim();
      if (text) {
        sections.push({
          title: label,
          content: text
        });
      }
    }
  }
  
  // 提取关键词
  const keywordsMatch = xml.match(/<KeywordList[^>]*>([\s\S]*?)<\/KeywordList>/i);
  if (keywordsMatch) {
    const keywords = [];
    const kwRegex = /<Keyword[^>]*>([^<]*)<\/Keyword>/gi;
    let kwMatch;
    while ((kwMatch = kwRegex.exec(keywordsMatch[1])) !== null) {
      keywords.push(kwMatch[1].trim());
    }
    if (keywords.length > 0) {
      sections.push({
        title: '关键词',
        content: keywords.join(', ')
      });
    }
  }
  
  // 提取MeSH术语
  const meshMatch = xml.match(/<MeshHeadingList>([\s\S]*?)<\/MeshHeadingList>/i);
  if (meshMatch) {
    const meshTerms = [];
    const meshRegex = /<DescriptorName[^>]*>([^<]*)<\/DescriptorName>/gi;
    let mMatch;
    while ((mMatch = meshRegex.exec(meshMatch[1])) !== null) {
      meshTerms.push(mMatch[1].trim());
    }
    if (meshTerms.length > 0) {
      sections.push({
        title: 'MeSH术语',
        content: meshTerms.join(', ')
      });
    }
  }
  
  return sections.length > 0 ? sections : null;
}

/**
 * 格式化内容为显示文本
 */
function formatContentForDisplay(sections) {
  if (!sections || sections.length === 0) return null;
  
  return sections.map(section => {
    return `## ${section.title}\n\n${section.content}`;
  }).join('\n\n---\n\n');
}

/**
 * 获取并缓存文章原文内容
 */
async function getArticleContent(articleId) {
  try {
    // 1. 先检查数据库缓存
    const [cached] = await pool.execute(
      'SELECT full_content, content_fetched_at FROM articles_cache WHERE id = ?',
      [articleId]
    );
    
    if (cached.length > 0 && cached[0].full_content) {
      console.log(`使用缓存的文章内容 (PMID: ${articleId})`);
      return {
        success: true,
        content: cached[0].full_content,
        fromCache: true
      };
    }
    
    // 2. 尝试获取PMC全文
    console.log(`正在获取文章内容 (PMID: ${articleId})...`);
    const pmcId = await getPmcId(articleId);
    let content = null;
    let source = 'pubmed';
    
    if (pmcId) {
      console.log(`找到PMC ID: ${pmcId}, 正在获取全文...`);
      const pmcContent = await fetchPmcFullText(pmcId);
      if (pmcContent) {
        content = formatContentForDisplay(pmcContent);
        source = 'pmc';
      }
    }
    
    // 3. 如果没有PMC全文，获取PubMed扩展摘要
    if (!content) {
      console.log('未找到PMC全文，获取PubMed摘要信息...');
      const pubmedContent = await fetchPubmedAbstract(articleId);
      if (pubmedContent) {
        content = formatContentForDisplay(pubmedContent);
      }
    }
    
    // 4. 如果仍然没有内容，返回数据库中的摘要
    if (!content) {
      const [article] = await pool.execute(
        'SELECT abstract, abstract_zh FROM articles_cache WHERE id = ?',
        [articleId]
      );
      if (article.length > 0) {
        const abstract = article[0].abstract_zh || article[0].abstract;
        if (abstract) {
          content = `## 摘要\n\n${abstract}`;
        }
      }
    }
    
    if (!content) {
      return {
        success: false,
        error: '无法获取文章内容'
      };
    }
    
    // 5. 缓存到数据库
    await pool.execute(
      'UPDATE articles_cache SET full_content = ?, content_fetched_at = NOW() WHERE id = ?',
      [content, articleId]
    );
    
    console.log(`文章内容已缓存 (PMID: ${articleId}, 来源: ${source})`);
    
    return {
      success: true,
      content,
      source,
      fromCache: false
    };
    
  } catch (error) {
    console.error(`获取文章内容失败 (PMID: ${articleId}):`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  getArticleContent,
  getPmcId,
  fetchPmcFullText,
  fetchPubmedAbstract
};
