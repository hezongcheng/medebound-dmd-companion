﻿import { Article, ArticleType, InterestArea } from '../types';
import { apiPost, getAuthHeader, API_BASE } from './apiClient';

const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const DB = 'pubmed';
const API_KEY_PARAM = ''; // Add &api_key=YOUR_KEY if available for higher rate limits

// Helper to calculate date range
const getDateRange = (months: number) => {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  
  const formatDate = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `"${formatDate(start)}"[Date - Publication] : "${formatDate(end)}"[Date - Publication]`;
};

// Fallback data
const MOCK_ARTICLES: Article[] = [
  {
    id: 'mock1',
    title: 'Safety and Efficacy of Next-Gen Exon Skipping in Duchenne Muscular Dystrophy',
    abstract: 'BACKGROUND: Duchenne muscular dystrophy (DMD) is characterized by progressive muscle weakness. METHODS: This Phase 3 trial evaluated the safety of a new antisense oligonucleotide. RESULTS: Participants showed statistically significant improvement in dystrophin production compared to placebo. 6-minute walk test stabilized. CONCLUSIONS: The therapy appears safe and effective for patients with exon 51 skipping amenable mutations.',
    authors: ['Smith J.', 'Doe A.', 'Gupta R.'],
    publicationDate: '2024-05-15',
    journal: 'New England Journal of Medicine',
    url: 'https://pubmed.ncbi.nlm.nih.gov/',
    tags: [ArticleType.CLINICAL_TRIAL, ArticleType.RESEARCH]
  },
  {
    id: 'mock2',
    title: 'Cardiac Management Standards in Duchenne: A Consensus Statement',
    abstract: 'Cardiomyopathy is a leading cause of mortality in DMD. This systematic review updates the 2018 guidelines. We recommend starting ACE inhibitors earlier in the disease course, prior to onset of left ventricular dysfunction. Regular MRI monitoring is suggested annually starting at age 10.',
    authors: ['Heart Working Group', 'Miller T.'],
    publicationDate: '2024-04-20',
    journal: 'The Lancet Neurology',
    url: 'https://pubmed.ncbi.nlm.nih.gov/',
    tags: [ArticleType.GUIDELINE, ArticleType.REVIEW]
  },
  {
    id: 'mock3',
    title: 'AAV Micro-dystrophin Gene Therapy: 5 Year Follow-up',
    abstract: 'Long term data from the initial cohort of gene therapy recipients. We observed sustained expression of micro-dystrophin in skeletal muscle, though viral load shedding has ceased. Functional outcomes remain stable in 60% of the cohort.',
    authors: ['Chen L.', 'Weiss P.'],
    publicationDate: '2024-06-01',
    journal: 'Nature Medicine',
    url: 'https://pubmed.ncbi.nlm.nih.gov/',
    tags: [ArticleType.RESEARCH]
  }
];

// XML Helpers
const getXmlText = (parent: Element, tagName: string): string => {
  const el = parent.getElementsByTagName(tagName)[0];
  return el ? el.textContent || '' : '';
};

const getAuthorsFromXml = (articleEl: Element): string[] => {
  const authorList = articleEl.getElementsByTagName('AuthorList')[0];
  if (!authorList) return [];
  const authors: string[] = [];
  const authorEls = authorList.getElementsByTagName('Author');
  for (let i = 0; i < authorEls.length; i++) {
    const last = getXmlText(authorEls[i], 'LastName');
    const init = getXmlText(authorEls[i], 'Initials');
    if (last) authors.push(`${last} ${init}`);
  }
  return authors;
};

const getAbstractFromXml = (articleEl: Element): string => {
  const abstractEl = articleEl.getElementsByTagName('Abstract')[0];
  if (!abstractEl) return '';
  const texts = abstractEl.getElementsByTagName('AbstractText');
  if (texts.length === 0) return '';
  
  let abstract = '';
  for (let i = 0; i < texts.length; i++) {
      const label = texts[i].getAttribute('Label');
      const text = texts[i].textContent;
      if (label && label !== 'UNLABELLED') abstract += `${label}: ${text}\n\n`;
      else abstract += `${text}\n\n`;
  }
  return abstract.trim();
};

const getPubDateFromXml = (articleEl: Element): string => {
  const pubDateEl = articleEl.getElementsByTagName('PubDate')[0];
  if (!pubDateEl) return 'Unknown Date';
  
  const medlineDate = getXmlText(pubDateEl, 'MedlineDate');
  if (medlineDate) return medlineDate;

  const year = getXmlText(pubDateEl, 'Year');
  const month = getXmlText(pubDateEl, 'Month');
  const day = getXmlText(pubDateEl, 'Day');
  
  return [year, month, day].filter(Boolean).join('-');
};

const mapServerTagToArticleType = (tag: string): ArticleType => {
  const normalized = String(tag || '').trim().toLowerCase();

  // 兼容服务端历史数据：英文标识、英文枚举值、中文标签文案
  if (
    normalized === 'clinical_trial' ||
    normalized === 'clinical trial' ||
    normalized === ArticleType.CLINICAL_TRIAL.toLowerCase()
  ) {
    return ArticleType.CLINICAL_TRIAL;
  }

  if (
    normalized === 'review' ||
    normalized === ArticleType.REVIEW.toLowerCase()
  ) {
    return ArticleType.REVIEW;
  }

  if (
    normalized === 'guideline' ||
    normalized === 'guidelines' ||
    normalized === ArticleType.GUIDELINE.toLowerCase()
  ) {
    return ArticleType.GUIDELINE;
  }

  if (
    normalized === 'research' ||
    normalized === 'paper' ||
    normalized === ArticleType.RESEARCH.toLowerCase()
  ) {
    return ArticleType.RESEARCH;
  }

  return ArticleType.RESEARCH;
};

const normalizeServerArticle = (article: any): Article => ({
  id: article.id,
  title: article.title,
  titleZh: article.titleZh || '',
  abstract: article.abstract,
  abstractZh: article.abstractZh || '',
  authors: article.authors || [],
  publicationDate: article.publicationDate,
  journal: article.journal,
  url: article.url,
  tags: (article.tags || []).map((tag: string) => mapServerTagToArticleType(tag)),
  subTags: article.subTags || [],
  impactFactor: article.impactFactor || '',
  researchStage: article.researchStage || '',
  aiSummary: article.aiSummary || '',
  uvCount: Number(article.uvCount || 0)
});

// 从服务端缓存获取文章（包含中文翻译，支持分页）
const fetchFromServerCache = async (
  months: number | null = null, 
  searchKeyword: string = '', 
  tagFilter: string = 'all',
  page: number = 1, 
  pageSize: number = 10
): Promise<Article[] | null> => {
  try {
    let url = `${API_BASE}/api/articles?page=${page}&pageSize=${pageSize}`;
    if (months) url += `&months=${months}`;
    if (searchKeyword) url += `&search=${encodeURIComponent(searchKeyword)}`;
    if (tagFilter && tagFilter !== 'all') url += `&tag=${encodeURIComponent(tagFilter)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    
    // 转换服务端返回的标签格式
    return data.map(normalizeServerArticle);
  } catch (error) {
    console.warn('服务端缓存获取失败:', error);
    return null;
  }
};

// 触发服务端从 PubMed 抓取并翻译最新文章
export const refreshArticlesFromServer = async (): Promise<{ success: boolean; message: string }> => {
  const result = await apiPost<{ success: boolean; message: string }>('/api/admin/fetch-articles');
  if (!result) {
    throw new Error('更新失败');
  }
  return result;
};

export const fetchArticleByDoiFromServer = async (doi: string): Promise<{ success: boolean; message: string }> => {
  const cleanDoi = (doi || '').trim();
  if (!cleanDoi) {
    throw new Error('DOI 不能为空');
  }

  const result = await apiPost<{ success: boolean; message: string }>(
    '/api/admin/fetch-article-by-doi',
    { doi: cleanDoi },
    { throwOnHttpError: true }
  );
  if (!result) {
    throw new Error('DOI 抓取失败');
  }
  return result;
};

// 获取文章总数
export const getArticlesCount = async (
  months: number | null,
  searchKeyword: string = '',
  tagFilter: string = 'all'
): Promise<number> => {
  try {
    let url = `${API_BASE}/api/articles/count`;
    const params = [];
    if (months) params.push(`months=${months}`);
    if (searchKeyword) params.push(`search=${encodeURIComponent(searchKeyword)}`);
    if (tagFilter && tagFilter !== 'all') params.push(`tag=${encodeURIComponent(tagFilter)}`);
    if (params.length > 0) url += `?${params.join('&')}`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    
    const data = await res.json();
    return typeof data === 'number' ? data : 0;
  } catch (error) {
    console.warn('获取文章总数失败:', error);
    return 0;
  }
};

export const searchArticles = async (
  months: number | null, 
  interests: InterestArea[], 
  searchKeyword: string = '',
  tagFilter: string = 'all',
  page: number = 1,
  pageSize: number = 10
): Promise<Article[]> => {
  const cachedArticles = await fetchFromServerCache(months, searchKeyword, tagFilter, page, pageSize);
  if (cachedArticles && cachedArticles.length > 0) {
    const uniqueArticles = [];
    const seenIds = new Set();
    
    for (const article of cachedArticles) {
      if (!seenIds.has(article.id)) {
        seenIds.add(article.id);
        uniqueArticles.push(article);
      }
    }
    
    console.log(`从服务端缓存获取了 ${uniqueArticles.length} 篇文章`);
    return uniqueArticles;
  }
  
  console.log('缓存为空，进入文献页后会自动触发更新文献');
  return [];
};

export interface HotArticle extends Article {
  uvCount: number;
}

export type HotArticlePeriod = 'month' | 'twoMonths' | 'all';

export const getHotArticles = async (limit: number = 6, period: HotArticlePeriod = 'month'): Promise<HotArticle[]> => {
  try {
    const response = await fetch(`${API_BASE}/api/articles/hot?limit=${limit}&period=${period}`);
    if (response.ok) {
      return await response.json();
    }
    return [];
  } catch (error) {
    console.error('获取热门文章失败:', error);
    return [];
  }
};

export const getUserFetchedArticles = async (
  searchKeyword: string = '',
  page: number = 1,
  pageSize: number = 6
): Promise<Article[]> => {
  try {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    if (searchKeyword) {
      params.set('search', searchKeyword);
    }

    const response = await fetch(`${API_BASE}/api/articles/user-fetched?${params.toString()}`, {
      headers: { ...getAuthHeader() }
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeServerArticle);
  } catch (error) {
    console.error('获取用户抓取文献列表失败:', error);
    return [];
  }
};

export const getUserFetchedArticlesCount = async (searchKeyword: string = ''): Promise<number> => {
  try {
    const params = new URLSearchParams();
    if (searchKeyword) {
      params.set('search', searchKeyword);
    }
    const query = params.toString();

    const response = await fetch(`${API_BASE}/api/articles/user-fetched/count${query ? `?${query}` : ''}`, {
      headers: { ...getAuthHeader() }
    });
    if (!response.ok) return 0;

    const data = await response.json();
    return typeof data === 'number' ? data : 0;
  } catch (error) {
    console.error('获取用户抓取文献总数失败:', error);
    return 0;
  }
};

export const getRandomUserFetchedArticles = async (limit: number = 9): Promise<Article[]> => {
  try {
    const safeLimit = Math.min(30, Math.max(1, Number(limit) || 9));
    const response = await fetch(`${API_BASE}/api/articles/user-fetched/random?limit=${safeLimit}`, {
      headers: { ...getAuthHeader() }
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeServerArticle);
  } catch (error) {
    console.error('获取随机用户抓取文献失败:', error);
    return [];
  }
};

export const recordArticleView = async (articleId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/articles/${articleId}/view`, {
      method: 'POST',
      headers: getAuthHeader()
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('记录浏览量失败:', error);
    return false;
  }
};
