import { useLanguage } from './i18n/LanguageProvider';
import { LanguageSelector } from './components/LanguageSelector';
import { plural, t, translateText, translateStageLabel, contentText, getLocale } from './i18n/runtime';
import { apiGet, apiPost } from './services/apiClient';
﻿import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { Login } from './components/Login';
import { ProfileForm } from './components/ProfileForm';
import { ArticleCard } from './components/ArticleCard';
import { TrialCard } from './components/TrialCard';
import { DrugCard } from './components/DrugCard';
import { EmailBinding } from './components/EmailBinding';
import { Logo } from './components/Logo';
import { searchArticles, refreshArticlesFromServer, fetchArticleByDoiFromServer, getArticlesCount, getHotArticles, getUserFetchedArticles, getUserFetchedArticlesCount, getRandomUserFetchedArticles, recordArticleView } from './services/pubmedService';
import type { HotArticle, HotArticlePeriod } from './services/pubmedService';
import { fetchDmdTrials, fetchTrialByNctFromServer, getUserFetchedTrials, getUserFetchedTrialsCount, getRandomUserFetchedTrials } from './services/trialService';
import { fetchDmdDrugs } from './services/fdaService';
import { logout, getCurrentUser, getUserData, saveUserProfile, isAuthenticated, checkEmailStatus, getLocalRehabRecords, getLocalRehabStatusHistory } from './services/authService';
import { UserProfile, Article, UserDatabaseEntry, InterestArea, ClinicalTrial, FDADrug } from './types';
import { Calendar, Loader2, Sparkles, LayoutGrid, UserRound, ChevronLeft, ChevronRight, Star, Microscope, Pill, CheckCircle2, AlertCircle, Search, Accessibility, RefreshCw, Eye } from 'lucide-react';
import { computeRelevance } from './utils/computeRelevance';
import { useLocation, useNavigate } from 'react-router-dom';

type ViewState = 'rehab' | 'feed' | 'trials' | 'drugs' | 'settings' | 'saved' | 'me';
type FeedTab = 'latest' | 'targeted';
type DoiFetchNotice = { type: 'success' | 'error'; text: string } | null;
type TrialTab = 'list' | 'targeted';
type TrialTypeFilter = '全部' | '治疗性试验' | '患者登记' | '观察性研究';
type TrialStatusFilter = '全部' | '招募中' | '活跃未招募';
type ArticleSortKey = 'time' | 'match' | 'if' | 'views';
const FEED_PAGE_SIZE = 10;
const FEED_BULK_PAGE_SIZE = 50;
const USER_FETCHED_PAGE_SIZE = 6;
const COMMUNITY_FETCHED_LIMIT = 9;
const COMMUNITY_CAROUSEL_INTERVAL_MS = 5000;
const ARTICLE_SORT_OPTIONS: { key: ArticleSortKey; label: string }[] = [
  { key: 'time', label: '时间' },
  { key: 'match', label: '相关性' },
  { key: 'if', label: 'IF' },
  { key: 'views', label: '阅读人数' }
];
type ArticleStageFilter =
  | 'all'
  | '指南/共识'
  | '人体临床数据'
  | '病例报告'
  | '药械分析'
  | '综述'
  | '动物实验'
  | '体外实验';

const ARTICLE_STAGE_FILTER_OPTIONS: { key: ArticleStageFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: '指南/共识', label: '指南/共识' },
  { key: '人体临床数据', label: '人体临床数据' },
  { key: '病例报告', label: '病例报告' },
  { key: '药械分析', label: '药械分析' },
  { key: '综述', label: '综述' },
  { key: '动物实验', label: '动物实验' },
  { key: '体外实验', label: '体外实验' }
];

// 归一化：去掉斜杠与空白，使「指南/共识」与库内「指南共识」等价
const normalizeStageValue = (value: string): string =>
  (value || '').replace(/[／/]/g, '').replace(/\s+/g, '').trim();

// 单篇匹配：支持「综述/指南共识」这类多值字段
const matchArticleStage = (researchStage: string | undefined, filter: ArticleStageFilter): boolean => {
  if (filter === 'all') return true;
  const target = normalizeStageValue(filter);
  if (!target) return true;
  return (researchStage || '')
    .split(/[／/、,，;；|]/)
    .map(normalizeStageValue)
    .filter(Boolean)
    .some((value) => value === target || value.includes(target));
};
const HOT_PERIOD_OPTIONS: { key: HotArticlePeriod; label: string }[] = [
  { key: 'month', label: '30天' },
  { key: 'twoMonths', label: '60天' },
  { key: 'all', label: '历史' }
];
const VIEW_PATHS: Record<ViewState, string> = {
  rehab: '/rehab',
  feed: '/feed',
  trials: '/trials',
  drugs: '/drugs',
  me: '/me',
  settings: '/settings',
  saved: '/saved'
};

const LazyRehabSection = lazy(() =>
  import('./components/RehabSection').then((module) => ({ default: module.RehabSection }))
);
const LazySavedInquiries = lazy(() =>
  import('./components/SavedInquiries').then((module) => ({ default: module.SavedInquiries }))
);
const LazyAIInterpreterModal = lazy(() =>
  import('./components/AIInterpreterModal').then((module) => ({ default: module.AIInterpreterModal }))
);
const LazyDrugInterpreterModal = lazy(() =>
  import('./components/DrugInterpreterModal').then((module) => ({ default: module.DrugInterpreterModal }))
);
const LazyTrialInterpreterModal = lazy(() =>
  import('./components/TrialInterpreterModal').then((module) => ({ default: module.TrialInterpreterModal }))
);

const getViewFromPath = (pathName: string): ViewState => {
  const matched = (Object.entries(VIEW_PATHS).find(([, path]) => path === pathName)?.[0] || 'feed') as ViewState;
  return matched;
};

const isValidViewPath = (pathName: string): boolean => {
  return Object.values(VIEW_PATHS).includes(pathName as ViewState);
};

const extractDoiFromUrl = (input: string): string | null => {
  const raw = (input || '').trim();
  if (!raw) return null;

  const doiCandidate = raw.replace(/^doi:\s*/i, '').trim();
  const DOI_REGEX = /^10\.\d{4,9}\/\S+$/i;

  // 支持直接输入 DOI（无需 https://doi.org/ 前缀）
  if (DOI_REGEX.test(doiCandidate)) {
    return doiCandidate;
  }

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'doi.org' && !hostname.endsWith('.doi.org')) {
      return null;
    }
    const doi = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim();
    return DOI_REGEX.test(doi) ? doi : null;
  } catch {
    return null;
  }
};

const normalizeDoiInput = (input: string): string => {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';

  const doi = extractDoiFromUrl(trimmed);
  if (!doi) return trimmed;
  return `https://doi.org/${doi}`;
};

const extractNctIdFromInput = (input: string): string | null => {
  const raw = (input || '').trim();
  if (!raw) return null;

  const directMatch = raw.match(/NCT\d{8}/i);
  if (directMatch) return directMatch[0].toUpperCase();

  try {
    const url = new URL(raw);
    const fromPath = `${url.pathname}${url.search}`.match(/NCT\d{8}/i);
    return fromPath ? fromPath[0].toUpperCase() : null;
  } catch {
    return null;
  }
};

const normalizeNctInput = (input: string): string => {
  const nctId = extractNctIdFromInput(input);
  return nctId || (input || '').trim();
};

const detectTrialType = (trial: ClinicalTrial): Exclude<TrialTypeFilter, '全部'> => {
  const studyType = String(trial.studyType || '').toUpperCase();
  const primaryPurpose = String(trial.primaryPurpose || '').toUpperCase();
  if (studyType === 'OBSERVATIONAL') {
    if (primaryPurpose === 'PATIENT_REGISTRY') {
      return '患者登记';
    }
    return '观察性研究';
  }
  if (studyType === 'INTERVENTIONAL') {
    return '治疗性试验';
  }

  const text = `${trial.title || ''} ${trial.summary || ''} ${trial.conditions?.join(' ') || ''}`.toLowerCase();
  if (text.includes('registry') || text.includes('登记')) {
    return '患者登记';
  }
  if ((trial.phase || []).length > 0) {
    return '治疗性试验';
  }
  return '观察性研究';
};

const detectTrialStatus = (trial: ClinicalTrial): Exclude<TrialStatusFilter, '全部'> | '其他' => {
  const status = String(trial.status || '').toLowerCase();
  const normalized = status.replace(/[_,-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.includes('recruiting') || normalized.includes('招募')) return '招募中';
  if (
    normalized.includes('active not recruiting') ||
    normalized.includes('active, not recruiting') ||
    normalized.includes('enrolling by invitation') ||
    normalized.includes('邀请') ||
    normalized.includes('未招募')
  ) {
    return '活跃未招募';
  }
  return '其他';
};

const getTimestamp = (dateStr?: string): number => {
  if (!dateStr) return 0;
  const ts = new Date(dateStr).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

const parseImpactFactorValue = (impactFactor?: string): number => {
  if (!impactFactor) return 0;
  const parsed = Number.parseFloat(String(impactFactor).replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sortArticlesByKey = (
  source: Article[],
  sortKey: ArticleSortKey,
  profile: UserDatabaseEntry['profile'] | undefined | null
): Article[] => {
  const enriched = source.map(article => ({
    ...article,
    matchPercent: computeRelevance(article, profile || undefined)
  }));

  return [...enriched].sort((a, b) => {
    if (sortKey === 'match') return (b.matchPercent || 0) - (a.matchPercent || 0);
    if (sortKey === 'if') return parseImpactFactorValue(b.impactFactor) - parseImpactFactorValue(a.impactFactor);
    if (sortKey === 'views') return (b.uvCount || 0) - (a.uvCount || 0);
    return getTimestamp(b.publicationDate) - getTimestamp(a.publicationDate);
  });
};

const App: React.FC = () => {
  useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const shareId = new URLSearchParams(location.search).get('share') || sessionStorage.getItem('pending-interpretation-share');
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('share');
    if (id) sessionStorage.setItem('pending-interpretation-share', id);
  }, [location.search]);
  const [user, setUser] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserDatabaseEntry | null>(null);
  const currentView = getViewFromPath(location.pathname);
  const emailVisitHandled = useRef<string | null>(null);
  const lastTrackedPage = useRef('');
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const token = query.get('email_visit');
    if (!token || emailVisitHandled.current === token) return;
    emailVisitHandled.current = token;
    query.delete('email_visit');
    navigate({ pathname: location.pathname, search: query.toString() }, { replace: true });
    void apiPost('/api/email-push/visit', { token }, { skipAuthCheck: true });
  }, [location.pathname, location.search, navigate]);
  useEffect(() => {
    if (!user) { lastTrackedPage.current = ''; return; }
    const key = `${user}:${currentView}`;
    if (lastTrackedPage.current === key) return;
    lastTrackedPage.current = key;
    void apiPost('/api/activity', { action: 'page_view', contentId: currentView });
  }, [user, currentView]);
  
  const [articles, setArticles] = useState<Article[]>([]);
  const [trials, setTrials] = useState<ClinicalTrial[]>([]);
  const [drugs, setDrugs] = useState<FDADrug[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingDoiFetch, setLoadingDoiFetch] = useState(false);
  const [loadingTrials, setLoadingTrials] = useState(false);
  const [loadingTrialTargetFetch, setLoadingTrialTargetFetch] = useState(false);
  const [trialRegionFilter, setTrialRegionFilter] = useState('全部');
  const [trialTypeFilter, setTrialTypeFilter] = useState<TrialTypeFilter>('全部');
  const [trialStatusFilter, setTrialStatusFilter] = useState<TrialStatusFilter>('全部');
  const [trialTab, setTrialTab] = useState<TrialTab>('list');
  const [trialSearchKeyword, setTrialSearchKeyword] = useState('');
  const [trialSearchInput, setTrialSearchInput] = useState('');
  const [trialTargetInput, setTrialTargetInput] = useState('');
  const [trialTargetNotice, setTrialTargetNotice] = useState<DoiFetchNotice>(null);
  const [loadingDrugs, setLoadingDrugs] = useState(false);
  const [drugSearchKeyword, setDrugSearchKeyword] = useState('');
  const [drugSearchInput, setDrugSearchInput] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedTrial, setSelectedTrial] = useState<ClinicalTrial | null>(null);
  const [selectedDrug, setSelectedDrug] = useState<FDADrug | null>(null);
  useEffect(() => {
    if (user && selectedArticle?.id) void apiPost('/api/activity', {
      action: 'content_view', contentType: 'article', contentId: String(selectedArticle.id)
    });
  }, [user, selectedArticle?.id]);
  useEffect(() => {
    if (user && selectedTrial?.nctId) void apiPost('/api/activity', {
      action: 'content_view', contentType: 'trial', contentId: selectedTrial.nctId
    });
  }, [user, selectedTrial?.nctId]);
  useEffect(() => {
    if (user && selectedDrug?.brandName) void apiPost('/api/activity', {
      action: 'content_view', contentType: 'drug', contentId: selectedDrug.brandName
    });
  }, [user, selectedDrug?.brandName]);
  const [shareError, setShareError] = useState('');
  const [loadingShare, setLoadingShare] = useState(false);
  const [shareAttempt, setShareAttempt] = useState(0);
  const closeSharedLink = () => {
    if (!shareId) return;
    sessionStorage.removeItem('pending-interpretation-share');
    const query = new URLSearchParams(location.search);
    query.delete('share');
    navigate({ pathname: location.pathname, search: query.toString() }, { replace: true });
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreArticles, setHasMoreArticles] = useState(true);
  const [totalArticles, setTotalArticles] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [emailBound, setEmailBound] = useState<boolean | null>(null);
  const [doiInput, setDoiInput] = useState('');
  const [doiFetchNotice, setDoiFetchNotice] = useState<DoiFetchNotice>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [hotArticles, setHotArticles] = useState<HotArticle[]>([]);
  const [hotPeriod, setHotPeriod] = useState<HotArticlePeriod>('month');
  const [showHotArticles, setShowHotArticles] = useState(true);
  const [loadingHotArticles, setLoadingHotArticles] = useState(false);
  const [userFetchedArticles, setUserFetchedArticles] = useState<Article[]>([]);
  const [userFetchedTotal, setUserFetchedTotal] = useState(0);
  const [loadingUserFetched, setLoadingUserFetched] = useState(false);
  const [loadingMoreUserFetched, setLoadingMoreUserFetched] = useState(false);
  const [userFetchedPage, setUserFetchedPage] = useState(1);
  const [hasMoreUserFetched, setHasMoreUserFetched] = useState(true);
  const [communityFetchedArticles, setCommunityFetchedArticles] = useState<Article[]>([]);
  const [loadingCommunityFetched, setLoadingCommunityFetched] = useState(false);
  const [refreshingCommunityFetched, setRefreshingCommunityFetched] = useState(false);
  const [showCommunityFetched, setShowCommunityFetched] = useState(false);
  const [communityCarouselPage, setCommunityCarouselPage] = useState(0);
  const [communityItemsPerPage, setCommunityItemsPerPage] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 3 : 1
  ));
  const [userFetchedTrials, setUserFetchedTrials] = useState<ClinicalTrial[]>([]);
  const [userFetchedTrialsTotal, setUserFetchedTrialsTotal] = useState(0);
  const [loadingUserFetchedTrials, setLoadingUserFetchedTrials] = useState(false);
  const [loadingMoreUserFetchedTrials, setLoadingMoreUserFetchedTrials] = useState(false);
  const [userFetchedTrialsPage, setUserFetchedTrialsPage] = useState(1);
  const [hasMoreUserFetchedTrials, setHasMoreUserFetchedTrials] = useState(true);
  const [communityFetchedTrials, setCommunityFetchedTrials] = useState<ClinicalTrial[]>([]);
  const [loadingCommunityFetchedTrials, setLoadingCommunityFetchedTrials] = useState(false);
  const [refreshingCommunityFetchedTrials, setRefreshingCommunityFetchedTrials] = useState(false);
  const [showCommunityFetchedTrials, setShowCommunityFetchedTrials] = useState(false);
  const [communityTrialCarouselPage, setCommunityTrialCarouselPage] = useState(0);
  const [articleSortKey, setArticleSortKey] = useState<ArticleSortKey>('time');
  const [selectedStageFilter, setSelectedStageFilter] = useState<ArticleStageFilter>('all');
  const [feedTab, setFeedTab] = useState<FeedTab>('latest');
  const [sortedPool, setSortedPool] = useState<Article[] | null>(null);
  const [userDataLoadError, setUserDataLoadError] = useState<string | null>(null);
  const [emailStatusError, setEmailStatusError] = useState<string | null>(null);
  const hasAutoRefreshedFeedRef = useRef(false);
  const pullRefreshStartYRef = useRef<number | null>(null);
  const pullRefreshRunningRef = useRef(false);
  const pullRefreshLastTsRef = useRef(0);

  useEffect(() => {
    if (!shareId || !user || initializing || !userData?.profile?.isConfigured || emailBound !== true) return;
    let active = true;
    setLoadingShare(true); setShareError('');
    setSelectedArticle(null); setSelectedDrug(null); setSelectedTrial(null);
    type SharedSource = { kind: 'article'; item: Article } | { kind: 'drug'; item: FDADrug } | { kind: 'trial'; item: ClinicalTrial };
    apiGet<SharedSource>(`/api/interpretation-shares/${encodeURIComponent(shareId)}`, { throwOnHttpError: true })
      .then(result => {
        if (!active) return;
        if (!result) throw new Error('未能加载分享，请重新登录或重试。');
        if (result.kind === 'article') setSelectedArticle(result.item);
        else if (result.kind === 'drug') setSelectedDrug(result.item);
        else if (result.kind === 'trial') setSelectedTrial(result.item);
        else throw new Error('分享类型无效');
      })
      .catch(error => { if (active) setShareError(error.message); })
      .finally(() => { if (active) setLoadingShare(false); });
    return () => { active = false; };
  }, [shareId, user, initializing, userData?.profile?.isConfigured, emailBound, shareAttempt]);

  const resolveEmailBoundStatus = async (): Promise<boolean | null> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const status = await checkEmailStatus();
        if (status) return status.bound;
      } catch (error) { lastError = error; }
      if (!isAuthenticated()) return null;
      if (attempt === 0) await sleep(300);
    }
    throw lastError || new Error('接口未返回有效数据，请检查后端服务及 API 地址');
  };

  const fetchUserDataWithRetry = async (retryCount = 2): Promise<UserDatabaseEntry | null> => {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const data = await getUserData();
      if (data) return data;
      if (attempt < retryCount) {
        await sleep(350);
      }
    }
    return null;
  };

  const bootstrapAfterAuth = async (routeForConfiguredUser?: ViewState): Promise<void> => {
    setUserDataLoadError(null);
    setEmailStatusError(null);

    let emailBoundStatus: boolean | null;
    try {
      emailBoundStatus = await resolveEmailBoundStatus();
    } catch (error) {
      setEmailStatusError(`邮箱状态检查失败：${error instanceof Error ? error.message : '请求异常'}。请重试或重新登录。`);
      return;
    }
    if (!isAuthenticated() || emailBoundStatus == null) {
      setUser(null);
      setUserData(null);
      setEmailBound(null);
      return;
    }
    setEmailBound(emailBoundStatus);

    const data = await fetchUserDataWithRetry(2);
    if (!data) {
      setUserDataLoadError('用户资料加载失败，请检查网络后重试。');
      return;
    }

    setUserData(data);
    if (!data.profile?.isConfigured) {
      navigateToView('settings', true);
      return;
    }

    if (routeForConfiguredUser) {
      navigateToView(routeForConfiguredUser, true);
      return;
    }

    if (!isValidViewPath(location.pathname)) {
      navigateToView('feed', true);
    }
  };

  const fetchAllFeedArticles = async (
    interests: InterestArea[],
    keyword: string,
    total: number,
    stageFilter: ArticleStageFilter
  ): Promise<Article[]> => {
    const totalPages = Math.max(1, Math.ceil(total / FEED_BULK_PAGE_SIZE));
    const pageFetches: Promise<Article[]>[] = [];
    for (let p = 1; p <= totalPages; p += 1) {
      pageFetches.push(searchArticles(null, interests, keyword, stageFilter, p, FEED_BULK_PAGE_SIZE));
    }
    const pages = await Promise.all(pageFetches);
    const seen = new Set<string>();
    const deduped: Article[] = [];
    for (const article of pages.flat()) {
      if (!seen.has(article.id)) {
        seen.add(article.id);
        deduped.push(article);
      }
    }
    return deduped;
  };

  const loadUserFetchedData = async (pageSize = USER_FETCHED_PAGE_SIZE) => {
    const [fetched, fetchedTotal] = await Promise.all([
      getUserFetchedArticles('', 1, pageSize),
      getUserFetchedArticlesCount('')
    ]);
    setUserFetchedArticles(fetched);
    setUserFetchedTotal(fetchedTotal);
    setUserFetchedPage(1);
    setHasMoreUserFetched(fetched.length === pageSize && fetched.length < fetchedTotal);
  };

  const loadCommunityFetchedData = async (showLoading = true, limit = COMMUNITY_FETCHED_LIMIT) => {
    if (showLoading) {
      setLoadingCommunityFetched(true);
    }
    try {
      const randomPool = await getRandomUserFetchedArticles(limit);
      setCommunityFetchedArticles(randomPool);
      setCommunityCarouselPage(0);
    } catch (error) {
      console.error('加载“大家都在看”失败:', error);
    } finally {
      if (showLoading) {
        setLoadingCommunityFetched(false);
      }
    }
  };

  const loadUserFetchedTrialsData = async (pageSize = USER_FETCHED_PAGE_SIZE) => {
    const [fetched, fetchedTotal] = await Promise.all([
      getUserFetchedTrials('', 1, pageSize),
      getUserFetchedTrialsCount('')
    ]);
    setUserFetchedTrials(fetched);
    setUserFetchedTrialsTotal(fetchedTotal);
    setUserFetchedTrialsPage(1);
    setHasMoreUserFetchedTrials(fetched.length === pageSize && fetched.length < fetchedTotal);
  };

  const loadCommunityFetchedTrialsData = async (showLoading = true, limit = COMMUNITY_FETCHED_LIMIT) => {
    if (showLoading) {
      setLoadingCommunityFetchedTrials(true);
    }
    try {
      const randomPool = await getRandomUserFetchedTrials(limit);
      setCommunityFetchedTrials(randomPool);
      setCommunityTrialCarouselPage(0);
    } catch (error) {
      console.error('加载“大家都在看（临床）”失败:', error);
    } finally {
      if (showLoading) {
        setLoadingCommunityFetchedTrials(false);
      }
    }
  };

  const handleLoadMoreUserFetched = async () => {
    if (loadingUserFetched || loadingMoreUserFetched || !hasMoreUserFetched) return;

    setLoadingMoreUserFetched(true);
    try {
      const nextPage = userFetchedPage + 1;
      const moreFetched = await getUserFetchedArticles('', nextPage, USER_FETCHED_PAGE_SIZE);

      if (moreFetched.length > 0) {
        const existingIds = new Set(userFetchedArticles.map(article => article.id));
        const uniqueNew = moreFetched.filter(article => !existingIds.has(article.id));

        if (uniqueNew.length > 0) {
          setUserFetchedArticles(prev => [...prev, ...uniqueNew]);
          setUserFetchedPage(nextPage);
          setHasMoreUserFetched(
            moreFetched.length === USER_FETCHED_PAGE_SIZE &&
            userFetchedArticles.length + uniqueNew.length < userFetchedTotal
          );
        } else {
          setHasMoreUserFetched(false);
        }
      } else {
        setHasMoreUserFetched(false);
      }
    } catch (error) {
      console.error('加载更多抓取文献失败:', error);
    } finally {
      setLoadingMoreUserFetched(false);
    }
  };

  const handleLoadMoreUserFetchedTrials = async () => {
    if (loadingUserFetchedTrials || loadingMoreUserFetchedTrials || !hasMoreUserFetchedTrials) return;

    setLoadingMoreUserFetchedTrials(true);
    try {
      const nextPage = userFetchedTrialsPage + 1;
      const moreFetched = await getUserFetchedTrials('', nextPage, USER_FETCHED_PAGE_SIZE);

      if (moreFetched.length > 0) {
        const existingIds = new Set(userFetchedTrials.map(trial => trial.nctId));
        const uniqueNew = moreFetched.filter(trial => !existingIds.has(trial.nctId));

        if (uniqueNew.length > 0) {
          setUserFetchedTrials(prev => [...prev, ...uniqueNew]);
          setUserFetchedTrialsPage(nextPage);
          setHasMoreUserFetchedTrials(
            moreFetched.length === USER_FETCHED_PAGE_SIZE &&
            userFetchedTrials.length + uniqueNew.length < userFetchedTrialsTotal
          );
        } else {
          setHasMoreUserFetchedTrials(false);
        }
      } else {
        setHasMoreUserFetchedTrials(false);
      }
    } catch (error) {
      console.error('加载更多抓取临床试验失败:', error);
    } finally {
      setLoadingMoreUserFetchedTrials(false);
    }
  };

  const feedKey = JSON.stringify([user, currentView, feedTab, searchKeyword, selectedStageFilter, articleSortKey, userData?.profile]);
  const feedKeyRef = useRef(feedKey);
  feedKeyRef.current = feedKey;
  const feedRequestRef = useRef(0);
  const feedBusyRef = useRef(false);
  const moreRequestRef = useRef<object | null>(null);
  const loadFeedArticles = async (interests: InterestArea[], keyword: string) => {
    if (feedKey !== feedKeyRef.current || currentView !== 'feed' || feedTab !== 'latest') return;
    const request = ++feedRequestRef.current;
    const active = () => feedKey === feedKeyRef.current && request === feedRequestRef.current;
    feedBusyRef.current = true;
    moreRequestRef.current = null;
    setIsLoadingMore(false);
    setLoadingFeed(true);
    setArticles([]);
    setSortedPool(null);
    setHasMoreArticles(false);
    try {
      setCurrentPage(1);
      const total = await getArticlesCount(null, keyword, selectedStageFilter);

      if (!active()) return;
      setTotalArticles(total);

      if (articleSortKey === 'time') {
        setSortedPool(null);
        const data = await searchArticles(null, interests, keyword, selectedStageFilter, 1, FEED_PAGE_SIZE);
        if (!active()) return;
        setArticles(data);
        setHasMoreArticles(data.length === FEED_PAGE_SIZE);
        return;
      }

      const all = await fetchAllFeedArticles(interests, keyword, total, selectedStageFilter);
      if (!active()) return;
      const sorted = sortArticlesByKey(all, articleSortKey, userData?.profile);
      setSortedPool(sorted);
      setArticles(sorted.slice(0, FEED_PAGE_SIZE));
      setHasMoreArticles(sorted.length > FEED_PAGE_SIZE);
    } finally {
      if (active()) {
        feedBusyRef.current = false;
        setLoadingFeed(false);
      }
    }
  };

  const navigateToView = (view: ViewState, replace = false) => {
    const targetPath = VIEW_PATHS[view];
    if (location.pathname !== targetPath) {
      navigate(shareId ? `${targetPath}?share=${encodeURIComponent(shareId)}` : targetPath, { replace });
    }
  };

  useEffect(() => {
    if (!isValidViewPath(location.pathname)) {
      const query = new URLSearchParams(location.search);
      query.delete('email_visit');
      navigate({ pathname: VIEW_PATHS.feed, search: query.toString() }, { replace: true });
    }
  }, [location.pathname, navigate]);

  // Initialize User from session
  useEffect(() => {
    const initUser = async () => {
      const currentUser = getCurrentUser();
      if (currentUser && isAuthenticated()) {
        setUser(currentUser);
        await bootstrapAfterAuth();
      }
      setInitializing(false);
    };
    initUser();
  }, []);

  // 保存用户兴趣，避免 userData 变化导致重新加载
  const [userInterests, setUserInterests] = useState<InterestArea[]>([]);

  // 当 profile 加载完成时，保存兴趣列表
  useEffect(() => {
    if (userData?.profile?.interests) {
      setUserInterests(userData.profile.interests);
    }
  }, [userData?.profile?.interests]);

  // Fetch Feed Logic - 只依赖 interests，不依赖整个 userData
  useEffect(() => {
    if (user && userInterests.length > 0 && currentView === 'feed' && feedTab === 'latest') {
      const fetchFeed = async () => {
        try {
          await loadFeedArticles(userInterests, searchKeyword);
        } catch (e) {
          console.error(e);
        }
      };
      fetchFeed();
    }
  }, [user, userInterests, currentView, feedTab, searchKeyword, articleSortKey, selectedStageFilter, userData?.profile]);

  useEffect(() => {
    if (!user || currentView !== 'feed' || feedTab !== 'latest') return;
    let cancelled = false;
    setLoadingHotArticles(true);
    setHotArticles([]);
    getHotArticles(6, hotPeriod).then((items) => {
      if (!cancelled) setHotArticles(items);
    }).finally(() => {
      if (!cancelled) setLoadingHotArticles(false);
    });
    return () => { cancelled = true; };
  }, [user, currentView, feedTab, hotPeriod]);

  // 每次访问文献页时自动触发更新文献
  useEffect(() => {
    const shouldAutoRefresh = user && userInterests.length > 0 && currentView === 'feed' && feedTab === 'latest';
    if (!shouldAutoRefresh) {
      hasAutoRefreshedFeedRef.current = false;
      return;
    }
    if (hasAutoRefreshedFeedRef.current) return;

    hasAutoRefreshedFeedRef.current = true;
    const refreshFeedOnVisit = async () => {
      try {
        // 后台只更新缓存，不重置用户正在浏览的搜索结果。
        await refreshArticlesFromServer();
      } catch (error) {
        console.error('自动更新文章失败:', error);
      }
    };
    refreshFeedOnVisit();
  }, [user, userInterests, currentView, feedTab]);

  useEffect(() => {
    if (user && currentView === 'feed' && feedTab === 'targeted') {
      const fetchUserFetchedData = async () => {
        setLoadingUserFetched(true);
        try {
          await loadUserFetchedData();
        } catch (e) {
          console.error(e);
        } finally {
          setLoadingUserFetched(false);
        }
      };
      fetchUserFetchedData();
    }
  }, [user, currentView, feedTab]);

  useEffect(() => {
    if (user && currentView === 'trials' && trialTab === 'targeted') {
      const fetchUserFetchedTrialsData = async () => {
        setLoadingUserFetchedTrials(true);
        try {
          await loadUserFetchedTrialsData();
        } catch (e) {
          console.error(e);
        } finally {
          setLoadingUserFetchedTrials(false);
        }
      };
      fetchUserFetchedTrialsData();
    }
  }, [user, currentView, trialTab]);

  useEffect(() => {
    const onResize = () => {
      setCommunityItemsPerPage(window.innerWidth >= 1024 ? 3 : 1);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const communityTotalPages = useMemo(() => {
    if (communityFetchedArticles.length === 0) return 0;
    return Math.max(1, Math.ceil(communityFetchedArticles.length / communityItemsPerPage));
  }, [communityFetchedArticles.length, communityItemsPerPage]);

  const communityTrialTotalPages = useMemo(() => {
    if (communityFetchedTrials.length === 0) return 0;
    return Math.max(1, Math.ceil(communityFetchedTrials.length / communityItemsPerPage));
  }, [communityFetchedTrials.length, communityItemsPerPage]);

  useEffect(() => {
    if (communityTotalPages === 0) {
      setCommunityCarouselPage(0);
      return;
    }
    if (communityCarouselPage >= communityTotalPages) {
      setCommunityCarouselPage(0);
    }
  }, [communityCarouselPage, communityTotalPages]);

  useEffect(() => {
    if (communityTrialTotalPages === 0) {
      setCommunityTrialCarouselPage(0);
      return;
    }
    if (communityTrialCarouselPage >= communityTrialTotalPages) {
      setCommunityTrialCarouselPage(0);
    }
  }, [communityTrialCarouselPage, communityTrialTotalPages]);

  useEffect(() => {
    if (currentView !== 'feed' || feedTab !== 'targeted') return;
    if (loadingCommunityFetched || communityTotalPages <= 1) return;

    const timer = window.setInterval(() => {
      setCommunityCarouselPage(prev => (prev + 1) % communityTotalPages);
    }, COMMUNITY_CAROUSEL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [currentView, feedTab, loadingCommunityFetched, communityTotalPages]);

  useEffect(() => {
    if (currentView !== 'trials' || trialTab !== 'targeted') return;
    if (loadingCommunityFetchedTrials || communityTrialTotalPages <= 1) return;

    const timer = window.setInterval(() => {
      setCommunityTrialCarouselPage(prev => (prev + 1) % communityTrialTotalPages);
    }, COMMUNITY_CAROUSEL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [currentView, trialTab, loadingCommunityFetchedTrials, communityTrialTotalPages]);

  // 滚动监听 - 自动加载下一页
  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;
    
    const handleScroll = () => {
      if (loadingFeed || isLoadingMore || !hasMoreArticles) return;
      
      // 清除之前的定时器，避免重复触发
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      
      debounceTimer = setTimeout(() => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        
        // 当滚动到距离底部100px时加载
        if (scrollTop + clientHeight >= scrollHeight - 100) {
          handleLoadMore();
        }
      }, 100); // 100ms 闃叉姈
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [loadingFeed, isLoadingMore, hasMoreArticles, feedKey, currentPage, sortedPool, articles, userInterests]);

  // 文献页下滑刷新（移动端手势）
  useEffect(() => {
    if (currentView !== 'feed' || feedTab !== 'latest') return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        pullRefreshStartYRef.current = e.touches[0]?.clientY ?? null;
      } else {
        pullRefreshStartYRef.current = null;
      }
    };

    const onTouchEnd = async (e: TouchEvent) => {
      const startY = pullRefreshStartYRef.current;
      pullRefreshStartYRef.current = null;
      if (startY == null) return;

      const endY = e.changedTouches[0]?.clientY ?? startY;
      const deltaY = endY - startY;
      const now = Date.now();
      if (deltaY < 90) return;
      if (loadingFeed || pullRefreshRunningRef.current) return;
      if (now - pullRefreshLastTsRef.current < 15000) return;

      pullRefreshRunningRef.current = true;
      pullRefreshLastTsRef.current = now;
      try {
        await refreshArticlesFromServer();
        await loadFeedArticles(userInterests, searchKeyword);
      } catch (error) {
        console.error('下滑刷新文章失败:', error);
      } finally {
        pullRefreshRunningRef.current = false;
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [currentView, feedTab, loadingFeed, userInterests, feedKey]);

  // Fetch Trials Logic
  useEffect(() => {
    if (user && userData?.profile && currentView === 'trials') {
      const fetchTrialsData = async () => {
        setLoadingTrials(true);
        try {
          const regionParam = trialRegionFilter !== '全部' ? trialRegionFilter : '';
          const data = await fetchDmdTrials(regionParam);
          setTrials(data);
        } catch (e) {
          console.error(e);
        } finally {
          setLoadingTrials(false);
        }
      };
      fetchTrialsData();
    }
  }, [user, userData, currentView, trialRegionFilter]);

  // Fetch Drugs Logic
  useEffect(() => {
    if (user && userData?.profile && currentView === 'drugs') {
      const fetchDrugsData = async () => {
        setLoadingDrugs(true);
        try {
          const data = await fetchDmdDrugs(drugSearchKeyword);
          setDrugs(data);
        } catch (e) {
          console.error(e);
        } finally {
          setLoadingDrugs(false);
        }
      };
      fetchDrugsData();
    }
  }, [user, userData, currentView, drugSearchKeyword]);

  const handleLoginSuccess = async () => {
    setInitializing(true);
    try {
      const u = getCurrentUser();
      setUser(u);
      await bootstrapAfterAuth(shareId ? undefined : 'rehab');
    } finally {
      setInitializing(false);
    }
  };

  const handleEmailBindingSuccess = (email: string) => {
    console.log('邮箱绑定成功:', email);
    setEmailBound(true);
  };

  const handleLogout = async () => {
    await apiPost('/api/activity', { action: 'logout' });
    await logout();
    // 清除所有用户相关状态
    setUser(null);
    setUserData(null);
    setUserInterests([]);
    setArticles([]);
    setSortedPool(null);
    setTrials([]);
    setDrugs([]);
    setEmailBound(null);
    setEmailStatusError(null);
    setUserDataLoadError(null);
    navigateToView('rehab', true);
  };

  const handleProfileSave = async (profile: UserProfile) => {
      const saved = await saveUserProfile(profile);
      if (!saved) throw new Error('个人资料保存失败，请重试');
      // Reload local user data
      const refreshedData = await getUserData();
      if (refreshedData) {
        setUserData(refreshedData);
      }
      navigateToView('rehab', true);
  };

  // 加载更多文章
  const handleLoadMore = async () => {
    if (currentView !== 'feed' || feedTab !== 'latest' || feedKey !== feedKeyRef.current || loadingFeed || feedBusyRef.current || moreRequestRef.current || !hasMoreArticles) return;
    const token = {};
    const request = feedRequestRef.current;
    moreRequestRef.current = token;
    const active = () => feedKey === feedKeyRef.current && request === feedRequestRef.current && moreRequestRef.current === token;
    
    setIsLoadingMore(true);
    try {
      if (articleSortKey !== 'time' && sortedPool) {
        const nextPage = currentPage + 1;
        const nextCount = nextPage * FEED_PAGE_SIZE;
        setArticles(sortedPool.slice(0, nextCount));
        setCurrentPage(nextPage);
        setHasMoreArticles(sortedPool.length > nextCount);
        return;
      }

      const nextPage = currentPage + 1;
      const moreArticles = await searchArticles(null, userInterests, searchKeyword, selectedStageFilter, nextPage, FEED_PAGE_SIZE);
      if (!active()) return;
      
      if (moreArticles.length > 0) {
        // 过滤掉已存在的文章，避免重复 key
        const existingIds = new Set(articles.map(article => article.id));
        const newArticles = moreArticles.filter(article => !existingIds.has(article.id));
        
        if (newArticles.length > 0) {
          setArticles(prev => {
            const ids = new Set(prev.map(article => article.id));
            return [...prev, ...newArticles.filter(article => !ids.has(article.id))];
          });
          setCurrentPage(nextPage);
          setHasMoreArticles(moreArticles.length === FEED_PAGE_SIZE);
        } else {
          setCurrentPage(nextPage);
          setHasMoreArticles(moreArticles.length === FEED_PAGE_SIZE);
        }
      } else {
        setHasMoreArticles(false);
      }
    } catch (error) {
      console.error('加载更多文章失败:', error);
    } finally {
      if (moreRequestRef.current === token) {
        moreRequestRef.current = null;
        setIsLoadingMore(false);
      }
    }
  };

  const handleFetchByDoi = async () => {
    const doiUrl = doiInput.trim();
    if (!doiUrl) return;

    const parsedDoi = extractDoiFromUrl(doiUrl);
    if (!parsedDoi) {
      setDoiFetchNotice({
        type: 'error',
        text: '请输入有效 DOI（如 10.xxxx/xxxx）或 DOI URL。'
      });
      return;
    }

    setLoadingDoiFetch(true);
    setLoadingUserFetched(true);
    setDoiFetchNotice(null);
    try {
      const result = await fetchArticleByDoiFromServer(parsedDoi);
      await Promise.all([
        loadUserFetchedData(),
        loadCommunityFetchedData(false),
        loadFeedArticles(userInterests, searchKeyword)
      ]);
      setDoiInput('');
      setDoiFetchNotice({
        type: 'success',
        text: result?.message || 'Targeted fetch completed.'
      });
    } catch (error) {
      console.error('按 DOI 抓取文献失败:', error);
      setDoiFetchNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Targeted fetch failed. Please try again.'
      });
    } finally {
      setLoadingDoiFetch(false);
      setLoadingUserFetched(false);
    }
  };

  const handleFetchTrialByNct = async () => {
    const parsedNctId = extractNctIdFromInput(trialTargetInput);
    if (!parsedNctId) {
      setTrialTargetNotice({
        type: 'error',
        text: '请输入有效 NCT ID（如 NCT01234567）或试验链接。'
      });
      return;
    }

    setLoadingTrialTargetFetch(true);
    setLoadingUserFetchedTrials(true);
    setTrialTargetNotice(null);
    try {
      const result = await fetchTrialByNctFromServer(parsedNctId);
      const regionParam = trialRegionFilter !== '全部' ? trialRegionFilter : '';
      const [data] = await Promise.all([
        fetchDmdTrials(regionParam),
        loadUserFetchedTrialsData(),
        loadCommunityFetchedTrialsData(false)
      ]);
      setTrials(data);
      setTrialTargetInput('');
      setTrialTargetNotice({
        type: 'success',
        text: result?.message || '定向抓取成功'
      });
    } catch (error) {
      console.error('按 NCT 抓取试验失败:', error);
      setTrialTargetNotice({
        type: 'error',
        text: error instanceof Error ? error.message : '定向抓取失败，请稍后重试。'
      });
    } finally {
      setLoadingTrialTargetFetch(false);
      setLoadingUserFetchedTrials(false);
    }
  };

  const handleRefreshCommunityFetched = async () => {
    if (loadingCommunityFetched || refreshingCommunityFetched) return;
    setRefreshingCommunityFetched(true);
    try {
      await loadCommunityFetchedData(false);
    } finally {
      setRefreshingCommunityFetched(false);
    }
  };

  const handleToggleCommunityFetched = async () => {
    if (!showCommunityFetched && communityFetchedArticles.length === 0 && !loadingCommunityFetched) {
      await loadCommunityFetchedData(true);
    }
    setShowCommunityFetched(prev => !prev);
  };

  const handleRefreshCommunityFetchedTrials = async () => {
    if (loadingCommunityFetchedTrials || refreshingCommunityFetchedTrials) return;
    setRefreshingCommunityFetchedTrials(true);
    try {
      await loadCommunityFetchedTrialsData(false);
    } finally {
      setRefreshingCommunityFetchedTrials(false);
    }
  };

  const handleToggleCommunityFetchedTrials = async () => {
    if (!showCommunityFetchedTrials && communityFetchedTrials.length === 0 && !loadingCommunityFetchedTrials) {
      await loadCommunityFetchedTrialsData(true);
    }
    setShowCommunityFetchedTrials(prev => !prev);
  };

  const sortedArticles = useMemo(() => {
    if (articleSortKey === 'time') {
      return sortArticlesByKey(articles, 'time', userData?.profile);
    }
    return articles;
  }, [articles, articleSortKey, userData?.profile]);

  const filteredArticles = useMemo(() => {
    if (selectedStageFilter === 'all') {
      return sortedArticles;
    }
    return sortedArticles.filter((article) => matchArticleStage(article.researchStage, selectedStageFilter));
  }, [sortedArticles, selectedStageFilter]);

  const filteredTrials = useMemo(() => {
    const normalizedKeyword = trialSearchKeyword.trim().toLowerCase();
    return trials.filter((trial) => {
      const typeOk = trialTypeFilter === '全部' || detectTrialType(trial) === trialTypeFilter;
      const statusOk = trialStatusFilter === '全部' || detectTrialStatus(trial) === trialStatusFilter;
      const keywordOk =
        normalizedKeyword.length === 0 ||
        [
          trial.nctId,
          trial.title,
          trial.summary,
          trial.status,
          trial.leadSponsor,
          ...(trial.conditions || []),
          ...(trial.interventionNames || []),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedKeyword);
      return typeOk && statusOk && keywordOk;
    });
  }, [trials, trialTypeFilter, trialStatusFilter, trialSearchKeyword]);

  const trialTypeOptions = useMemo<TrialTypeFilter[]>(() => {
    const dynamicTypes = new Set<Exclude<TrialTypeFilter, '全部'>>();
    for (const trial of trials) {
      dynamicTypes.add(detectTrialType(trial));
    }
    return ['全部', ...Array.from(dynamicTypes)];
  }, [trials]);

  if (initializing) {
      return <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>;
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (emailStatusError) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white border border-red-100 rounded-2xl shadow-sm p-6 text-center">
        <p className="text-sm text-red-600 mb-4">{translateText(emailStatusError)}</p>
        <button
          type="button"
          onClick={async () => {
            setInitializing(true);
            try {
              await bootstrapAfterAuth();
            } finally {
              setInitializing(false);
            }
          }}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t("ui.retry")}</button>
        <button type="button" onClick={async () => {
          await logout();
          setUser(null);
          setUserData(null);
          setEmailBound(null);
          setEmailStatusError(null);
          setUserDataLoadError(null);
        }} className="ml-3 px-5 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
          {t("ui.sign.in.again")}</button>
      </div>
    </div>;
  }

  // 强制邮箱绑定（登录后且未绑定邮箱）
  if (emailBound === false) {
    return <EmailBinding onBindingSuccess={handleEmailBindingSuccess} />;
  }

  if (emailBound === null) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
    </div>;
  }

  if (userDataLoadError) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white border border-red-100 rounded-2xl shadow-sm p-6 text-center">
        <p className="text-sm text-red-600 mb-4">{translateText(userDataLoadError)}</p>
        <button
          type="button"
          onClick={async () => {
            setInitializing(true);
            try {
              const data = await fetchUserDataWithRetry(2);
              if (!data) {
                setUserDataLoadError('用户资料加载失败，请检查网络后重试。');
                return;
              }
              setUserDataLoadError(null);
              setUserData(data);
              if (!data.profile?.isConfigured) {
                navigateToView('settings', true);
              } else {
                navigateToView('rehab', true);
              }
            } finally {
              setInitializing(false);
            }
          }}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t("ui.reload.profile")}</button>
      </div>
    </div>;
  }

  // 已登录但用户资料尚未完成加载时，保持加载态，避免误判为新用户。
  if (!userData) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
    </div>;
  }

  // Initial Onboarding View - show only if profile not configured
  if (!userData.profile?.isConfigured) {
      return (
          <div className="min-h-screen bg-brand-50 flex items-center justify-center p-4">
              <div><LanguageSelector /><ProfileForm onSave={handleProfileSave} isInitialSetup={true} /></div>
          </div>
      );
  }

  // 「我的」聚合页：包含 我的收藏(saved) 与 我的档案(settings) 两个子页面
  const isMeSection = currentView === 'me' || currentView === 'saved' || currentView === 'settings';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900">
      
      {/* Navigation */}
      <header className="bg-white sticky top-0 z-30 border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Logo />
          
          <div className="ml-auto flex items-center">
             <nav className="flex items-center bg-gray-100 p-1 rounded-lg overflow-x-auto scrollbar-hide">
                 <button aria-label={t('ui.rehabilitation')}
                    onClick={() => navigateToView('rehab')}
                    className={`flex items-center px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentView === 'rehab' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                 >
                    <Accessibility className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("ui.rehabilitation")}</span>
                 </button>
                  <button aria-label={t('ui.literature')}
                    onClick={() => { setFeedTab('latest'); navigateToView('feed'); }}
                     className={`flex items-center px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentView === 'feed' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                     <LayoutGrid className="w-4 h-4 sm:mr-2" />
                     <span className="hidden sm:inline">{t("ui.literature")}</span>
                  </button>
                  <button aria-label={t('ui.trials')}
                    onClick={() => navigateToView('trials')}
                     className={`flex items-center px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentView === 'trials' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Microscope className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("ui.trials")}</span>
                 </button>
                 <button aria-label={t('ui.drugs')}
                    onClick={() => navigateToView('drugs')}
                    className={`flex items-center px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentView === 'drugs' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                 >
                    <Pill className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("ui.drugs")}</span>
                 </button>
                 <button aria-label={t('ui.my')}
                    onClick={() => navigateToView('me')}
                    className={`flex items-center px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all ${isMeSection ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                 >
                    <UserRound className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("ui.my")}</span>
                 </button>
             </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* VIEW: REHAB */}
        {currentView === 'rehab' && userData && (
            <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>}>
              <LazyRehabSection 
                userData={{ ...userData, rehabRecords: getLocalRehabRecords(), rehabStatusHistory: getLocalRehabStatusHistory() }} 
                onUpdate={async () => {
                  const refreshedData = await getUserData();
                  if (refreshedData) setUserData(refreshedData);
                }} 
              />
            </Suspense>
        )}

        {/* VIEW: ME（我的：收藏 + 档案入口） */}
        {currentView === 'me' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">{t("ui.my")}</h2>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => navigateToView('saved')}
                    className="group rounded-xl border border-gray-200 bg-white p-3 sm:p-5 text-left transition-all hover:border-brand-200 hover:shadow-md shadow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <span className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
                        <Star className="w-5 h-5" fill="currentColor" />
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-300 transition-colors group-hover:text-brand-500" />
                    </div>
                    <div className="mt-3">
                      <div className="text-sm sm:text-base font-bold text-gray-900">{t("ui.my.favorites")}</div>
                      <p className="mt-1 text-xs text-gray-500">{t("ui.my.favorites.hint", { p0: (userData.savedInquiries || []).length })}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToView('settings')}
                    className="group rounded-xl border border-gray-200 bg-white p-3 sm:p-5 text-left transition-all hover:border-brand-200 hover:shadow-md shadow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <span className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                        <UserRound className="w-5 h-5" />
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-300 transition-colors group-hover:text-brand-500" />
                    </div>
                    <div className="mt-3">
                      <div className="text-sm sm:text-base font-bold text-gray-900">{t("ui.my.profile")}</div>
                      <p className="mt-1 text-xs text-gray-500">{t("ui.my.profile.hint")}</p>
                    </div>
                  </button>
                </div>
            </div>
        )}

        {/* VIEW: SETTINGS（我的档案） */}
        {currentView === 'settings' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button
                  type="button"
                  onClick={() => navigateToView('me')}
                  className="mb-4 inline-flex items-center text-sm font-medium text-gray-500 hover:text-brand-600 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 mr-0.5" />{t("ui.back")}
                </button>
                <h2 className="text-2xl font-bold text-gray-900 mb-6">{t("ui.personal.settings")}</h2>
                <LanguageSelector />
                <ProfileForm initialData={userData.profile} onSave={handleProfileSave} onLogout={handleLogout} />
            </div>
        )}

        {/* VIEW: SAVED（我的收藏） */}
        {currentView === 'saved' && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button
                  type="button"
                  onClick={() => navigateToView('me')}
                  className="mb-4 inline-flex items-center text-sm font-medium text-gray-500 hover:text-brand-600 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 mr-0.5" />{t("ui.back")}
                </button>
                <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>}>
                  <LazySavedInquiries inquiries={userData.savedInquiries || []} />
                </Suspense>
            </div>
        )}

        {/* VIEW: FEED (MAIN) */}
        {currentView === 'feed' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-800 flex items-center gap-2 whitespace-nowrap">
                        <Calendar className="w-5 h-5 text-gray-500" />
                        {t("ui.research.updates")}</h2>
                    <div className="text-xs sm:text-sm text-gray-500 bg-white px-2.5 sm:px-3 py-1 rounded-full border border-gray-200 whitespace-nowrap">
                      {t("ui.found")}<span className="font-bold text-brand-700">{translateText(totalArticles)}</span> {plural("counts.articles", totalArticles)}</div>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFeedTab('latest')}
                    className={`text-left rounded-xl border px-4 py-3 transition-all ${
                      feedTab === 'latest'
                        ? 'bg-brand-50 border-brand-200 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`text-sm font-bold ${feedTab === 'latest' ? 'text-brand-700' : 'text-gray-800'}`}>{t("ui.article.list")}</div>
                    <div className="text-xs text-gray-500 mt-1">{t("ui.browse.and.filter.recent.articles")}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedTab('targeted')}
                    className={`text-left rounded-xl border px-4 py-3 transition-all ${
                      feedTab === 'targeted'
                        ? 'bg-brand-50 border-brand-200 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`text-sm font-bold ${feedTab === 'targeted' ? 'text-brand-700' : 'text-gray-800'}`}>{t("ui.fetch.by.id")}</div>
                    <div className="text-xs text-gray-500 mt-1">{t("ui.fetch.articles.by.doi.url")}</div>
                  </button>
                </div>

                {feedTab === 'latest' && (
                  <>
                {/* Hot articles ranked by unique readers */}
                {(
                  <div
                    onClick={() => setShowHotArticles(previous => !previous)}
                    className="mb-6 cursor-pointer rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50/70 p-4 sm:p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
                      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <Sparkles className="h-5 w-5 text-orange-500 sm:h-6 sm:w-6" />
                        <h3 className="whitespace-nowrap text-sm font-bold text-orange-800 sm:text-base">
                          <button
                            type="button"
                            aria-expanded={showHotArticles}
                            aria-controls="hot-article-list"
                            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                          >
                            {t("ui.popular.articles")}</button>
                        </h3>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                        <div role="group" aria-label={t("ui.ranking.period")} className="inline-flex rounded-full border border-orange-200 bg-white/80 p-0.5">
                          {HOT_PERIOD_OPTIONS.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              aria-pressed={hotPeriod === option.key}
                              onClick={(event) => { event.stopPropagation(); setHotPeriod(option.key); }}
                              className={`rounded-full px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1 sm:px-3 sm:text-sm ${hotPeriod === option.key ? 'bg-orange-500 text-white shadow-sm' : 'text-orange-800 hover:bg-orange-50'}`}
                            >
                              {translateText(option.label)}
                            </button>
                          ))}
                        </div>
                        <span
                          className="rounded-full border border-orange-200 bg-orange-100/60 px-2.5 py-1 text-xs font-medium text-orange-700 sm:px-3 sm:text-sm"
                        >
                          {translateText(showHotArticles ? '收起' : '展开')}
                        </span>
                      </div>
                    </div>

                    <div id="hot-article-list" hidden={!showHotArticles}>
                    {showHotArticles && (
                      loadingHotArticles ? <p className="mt-3 text-xs text-orange-700">{t("ui.loading.rankings")}</p> :
                      hotArticles.length === 0 ? <p className="mt-3 text-xs text-orange-700">{t("ui.no.reading.activity.in.this.period")}</p> :
                      <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                        {hotArticles.map((article, index) => (
                          <button
                            key={article.id}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              recordArticleView(article.id);
                              setSelectedArticle(article);
                            }}
                            className="w-full min-w-0 rounded-xl border border-white/80 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 sm:p-4"
                          >
                            <div className="flex items-start gap-2.5 sm:gap-3">
                              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold sm:h-8 sm:w-8 sm:text-base ${
                                index === 0 ? 'bg-red-500 text-white' :
                                index === 1 ? 'bg-orange-500 text-white' :
                                index === 2 ? 'bg-amber-400 text-white' :
                                'bg-gray-100 text-gray-500'
                              }`}>
                                {translateText(index + 1)}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="line-clamp-2 break-words text-sm font-medium leading-5 text-gray-900 sm:text-base sm:leading-6" title={translateText(contentText(article.title, article.titleZh))}>
                                  {translateText(contentText(article.title, article.titleZh))}
                                </p>
                                <div className="mt-2 flex min-w-0 items-center gap-2 text-xs sm:text-sm">
                                  <span className="truncate text-gray-400" title={translateText(article.journal)}>{translateText(article.journal)}</span>
                                  <span className="inline-flex shrink-0 items-center gap-1 text-orange-500" aria-label={translateText(`${article.uvCount || 0}人阅读`)} title={t("ui.unique.readers.uv")}>
                                    <Eye className="h-3.5 w-3.5" aria-hidden="true" /> {translateText(article.uvCount || 0)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    </div>
                  </div>
                )}

                {/* Search Bar */}
                <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <form onSubmit={(e) => { e.preventDefault(); setSearchKeyword(searchInput.trim()); if (searchInput.trim()) void apiPost('/api/activity', { action: 'search', contentType: 'article' }); }} className="flex items-center gap-2 sm:gap-3">
                    <div className="relative flex-grow">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder={t("ui.search.articles.generic.names.brand.names.or.development.codes")}
                        className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <button
                      type="submit"
                      className="h-10 w-10 sm:h-auto sm:w-auto sm:px-5 sm:py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors flex items-center justify-center sm:gap-1.5 shrink-0"
                      aria-label={t("ui.search")}
                    >
                      <Search className="w-4 h-4 sm:w-4 sm:h-4" />
                      <span className="hidden sm:inline">{t("ui.search")}</span>
                    </button>
                    {searchKeyword && (
                      <button
                        type="button"
                        onClick={() => { setSearchInput(''); setSearchKeyword(''); }}
                        className="px-3 sm:px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors shrink-0"
                      >
                        {t("ui.clear")}</button>
                    )}
                  </form>
                  {searchKeyword && (
                    <div className="mt-2 text-xs text-gray-500">
                      {t("ui.current.search")}<span className="font-semibold text-brand-600">"{translateText(searchKeyword)}"</span>
                    </div>
                  )}
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500 shrink-0 whitespace-nowrap">{t("ui.sort")}</span>
                      <div className="bg-gray-50 p-1 rounded-full border border-gray-200 shadow-sm flex-1 overflow-x-auto">
                        <div className="flex items-center gap-1 min-w-max">
                          {ARTICLE_SORT_OPTIONS.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => setArticleSortKey(option.key)}
                              className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                                articleSortKey === option.key
                                  ? 'bg-brand-600 text-white shadow-sm'
                                  : 'text-gray-600 hover:text-gray-800 hover:bg-white'
                              }`}
                            >
                              {translateText(option.label)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500 shrink-0 whitespace-nowrap">{t("ui.type")}</span>
                      <div className="bg-gray-50 p-1 rounded-full border border-gray-200 shadow-sm flex-1 overflow-x-auto">
                        <div className="flex items-center gap-1 min-w-max">
                          {ARTICLE_STAGE_FILTER_OPTIONS.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => setSelectedStageFilter(option.key)}
                              className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                                selectedStageFilter === option.key
                                  ? 'bg-brand-600 text-white shadow-sm'
                                  : 'text-gray-600 hover:text-gray-800 hover:bg-white'
                              }`}
                            >
                              {translateStageLabel(option.label)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Feed Grid */}
                {loadingFeed ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 text-brand-600 animate-spin mb-4" />
                        <p className="text-gray-500">{t("ui.scanning.the.latest.pubmed.database")}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredArticles.map(article => (
                          <ArticleCard
                            key={article.id}
                            article={article}
                            onSelect={(a) => {
                              recordArticleView(a.id);
                              setSelectedArticle(a);
                            }}
                          />
                        ))}
                    </div>
                )}
                
                {!loadingFeed && articles.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <p className="text-gray-500">{t("ui.no.articles.available")}</p>
                    </div>
                )}

                {!loadingFeed && articles.length > 0 && filteredArticles.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <p className="text-gray-500">{t("ui.no.articles.match.these.filters")}</p>
                    </div>
                )}
                
                {/* 加载更多按钮 */}
                {!loadingFeed && articles.length > 0 && hasMoreArticles && (
                    <div className="mt-8 text-center">
                        <button
                            onClick={handleLoadMore}
                            disabled={isLoadingMore}
                            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-700/60 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 mx-auto"
                        >
                            <Loader2 className={`w-4 h-4 ${isLoadingMore ? 'animate-spin' : ''}`} />
                            {translateText(isLoadingMore ? '加载中...' : '加载更多')}
                        </button>
                    </div>
                )}
                
                {!loadingFeed && articles.length > 0 && !hasMoreArticles && (
                    <div className="mt-8 text-center">
                        <p className="text-gray-500 text-sm">{t("ui.you.have.reached.the.end.of.the.article.list")}</p>
                    </div>
                )}
                </>
              )}
            </div>
        )}

        {/* FEED TAB: TARGETED FETCH */}
        {currentView === 'feed' && feedTab === 'targeted' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h3 className="text-sm font-bold text-gray-800 mb-3">{t("ui.fetch.an.article.by.doi.url")}</h3>
                  <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                    <input
                      type="text"
                      value={doiInput}
                      onChange={(e) => {
                        setDoiInput(e.target.value);
                        if (doiFetchNotice) setDoiFetchNotice(null);
                      }}
                      onPaste={(e) => {
                        const pasted = e.clipboardData?.getData('text') || '';
                        const normalized = normalizeDoiInput(pasted);
                        if (normalized !== pasted) {
                          e.preventDefault();
                          setDoiInput(normalized);
                          if (doiFetchNotice) setDoiFetchNotice(null);
                        }
                      }}
                      onBlur={() => {
                        const normalized = normalizeDoiInput(doiInput);
                        if (normalized && normalized !== doiInput) {
                          setDoiInput(normalized);
                        }
                      }}
                      placeholder={t("ui.paste.a.doi.or.doi.url.e.g.10")}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <button
                      onClick={handleFetchByDoi}
                      disabled={loadingDoiFetch || !extractDoiFromUrl(doiInput)}
                      className="w-full md:w-auto h-10 md:h-auto px-3 md:px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-700/60 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg shadow-md transition-all flex items-center justify-center shrink-0"
                      aria-label={t("ui.fetch.by.id")}
                    >
                      <Loader2 className={`w-4 h-4 ${loadingDoiFetch ? 'animate-spin' : ''} md:mr-2`} />
                      <span className="ml-1 md:hidden">{t("ui.fetch")}</span>
                      <span className="hidden md:inline">{t("ui.fetch.by.id")}</span>
                    </button>
                  </div>
                  {doiFetchNotice && (
                    <div className={`mt-3 px-3 py-2 rounded-lg border text-sm flex items-center gap-2 ${
                      doiFetchNotice.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}>
                      {doiFetchNotice.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{translateText(doiFetchNotice.text)}</span>
                    </div>
                  )}
                </div>

                <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="w-full flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-gray-800">{t("ui.community.discoveries")}</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleToggleCommunityFetched}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                      >
                        {translateText(showCommunityFetched ? '收起' : '展开')}
                      </button>
                      <button
                        type="button"
                        onClick={handleRefreshCommunityFetched}
                        disabled={loadingCommunityFetched || refreshingCommunityFetched}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${(loadingCommunityFetched || refreshingCommunityFetched) ? 'animate-spin' : ''}`} />
                        {t("ui.refresh.selection")}</button>
                    </div>
                  </div>

                  {showCommunityFetched && loadingCommunityFetched ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-2 mt-3">
                      <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                      {t("ui.loading.community.articles")}</div>
                  ) : showCommunityFetched && communityFetchedArticles.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2 mt-3">{t("ui.no.community.articles.available.yet")}</p>
                  ) : showCommunityFetched ? (
                    <div className="mt-3">
                      <div className="overflow-hidden pb-2">
                        <div
                          className="flex transition-transform duration-500 ease-out"
                          style={{ transform: `translateX(-${communityCarouselPage * 100}%)` }}
                        >
                          {communityFetchedArticles.map(article => (
                            <div
                              key={`community-fetched-${article.id}`}
                              className="shrink-0 px-2"
                              style={{ width: `${100 / communityItemsPerPage}%` }}
                            >
                              <ArticleCard
                                article={article}
                                onSelect={(selected) => {
                                  recordArticleView(selected.id);
                                  setSelectedArticle(selected);
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      {communityTotalPages > 1 && (
                        <div className="mt-3 flex items-center justify-center gap-1.5">
                          {Array.from({ length: communityTotalPages }).map((_, index) => (
                            <button
                              key={`community-page-${index}`}
                              type="button"
                              onClick={() => setCommunityCarouselPage(index)}
                              className={`h-1.5 rounded-full transition-all ${
                                index === communityCarouselPage
                                  ? 'w-5 bg-brand-600'
                                  : 'w-1.5 bg-gray-300 hover:bg-gray-400'
                              }`}
                              aria-label={translateText(`切换到第 ${index + 1} 页`)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 py-2 mt-3">{t("ui.collapsed.by.default.select.expand.to.view")}</p>
                  )}
                </div>

                <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="w-full flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-800">{t("ui.my.fetched.articles")}</h3>
                    <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                      {t("ui.total")}{translateText(userFetchedTotal)} {t("ui.items.2")}</span>
                  </div>
                  {loadingUserFetched ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-2 mt-3">
                      <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                      {t("ui.loading.your.fetched.items")}</div>
                  ) : userFetchedArticles.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2 mt-3">{t("ui.you.have.not.fetched.any.articles.yet")}</p>
                  ) : (
                    <div className="mt-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {userFetchedArticles.map(article => (
                          <ArticleCard
                            key={`user-fetched-${article.id}`}
                            article={article}
                            onSelect={(selected) => {
                              recordArticleView(selected.id);
                              setSelectedArticle(selected);
                            }}
                          />
                        ))}
                      </div>
                      {hasMoreUserFetched ? (
                        <div className="mt-8 text-center">
                          <button
                            type="button"
                            onClick={handleLoadMoreUserFetched}
                            disabled={loadingMoreUserFetched}
                            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-700/60 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 mx-auto"
                          >
                            <Loader2 className={`w-4 h-4 ${loadingMoreUserFetched ? 'animate-spin' : ''}`} />
                            {translateText(loadingMoreUserFetched ? '加载中...' : '加载更多')}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-8 text-center">
                          <p className="text-gray-500 text-sm">{t("ui.you.have.reached.the.end.of.the.article.list")}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
            </div>
        )}

        {/* VIEW: TRIALS */}
        {currentView === 'trials' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                    <Microscope className="w-6 h-6 text-brand-600" />
                    {t("ui.global.clinical.trial.database")}</h2>

                <div className="mb-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTrialTab('list')}
                    className={`text-left rounded-xl border px-4 py-3 transition-all ${
                      trialTab === 'list'
                        ? 'bg-brand-50 border-brand-200 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`text-sm font-bold ${trialTab === 'list' ? 'text-brand-700' : 'text-gray-800'}`}>{t("ui.trial.list")}</div>
                    <div className="text-xs text-gray-500 mt-1">{t("ui.browse.and.filter.clinical.trials")}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrialTab('targeted')}
                    className={`text-left rounded-xl border px-4 py-3 transition-all ${
                      trialTab === 'targeted'
                        ? 'bg-brand-50 border-brand-200 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`text-sm font-bold ${trialTab === 'targeted' ? 'text-brand-700' : 'text-gray-800'}`}>{t("ui.fetch.by.id")}</div>
                    <div className="text-xs text-gray-500 mt-1">{t("ui.fetch.by.nct.id.url")}</div>
                  </button>
                </div>

                {trialTab === 'list' && (
                  <>
                    <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="space-y-3">
                        <form onSubmit={(e) => { e.preventDefault(); setTrialSearchKeyword(trialSearchInput.trim()); if (trialSearchInput.trim()) void apiPost('/api/activity', { action: 'search', contentType: 'trial' }); }} className="flex items-center gap-2 sm:gap-3">
                          <div className="relative flex-grow">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={trialSearchInput}
                              onChange={(e) => setTrialSearchInput(e.target.value)}
                              placeholder={t("ui.search.nct.id.title.institution.or.location")}
                              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                            />
                          </div>
                          <button
                            type="submit"
                            className="h-10 w-10 sm:h-auto sm:w-auto sm:px-5 sm:py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors flex items-center justify-center sm:gap-1.5 shrink-0"
                            aria-label={t("ui.search")}
                          >
                            <Search className="w-4 h-4 sm:w-4 sm:h-4" />
                            <span className="hidden sm:inline">{t("ui.search")}</span>
                          </button>
                          {trialSearchKeyword && (
                            <button
                              type="button"
                              onClick={() => { setTrialSearchInput(''); setTrialSearchKeyword(''); }}
                              className="px-3 sm:px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors shrink-0"
                            >
                              {t("ui.clear")}</button>
                          )}
                        </form>
                        {trialSearchKeyword && (
                          <div className="mt-2 text-xs text-gray-500">
                            {t("ui.current.search")}<span className="font-semibold text-brand-600">"{translateText(trialSearchKeyword)}"</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-500 shrink-0 whitespace-nowrap">{t("ui.region")}</span>
                          <div className="bg-gray-50 p-1 rounded-full border border-gray-200 shadow-sm flex-1 overflow-x-auto">
                            <div className="flex items-center gap-1 min-w-max">
                              {['全部', '中国大陆', '亚洲', '北美', '欧洲', '大洋洲'].map(region => (
                                <button
                                  key={region}
                                  type="button"
                                  onClick={() => setTrialRegionFilter(region)}
                                  className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                                    trialRegionFilter === region
                                      ? 'bg-brand-600 text-white shadow-sm'
                                      : 'text-gray-600 hover:text-gray-800 hover:bg-white'
                                  }`}
                                >
                                  {translateText(region)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-500 shrink-0 whitespace-nowrap">{t("ui.type")}</span>
                          <div className="bg-gray-50 p-1 rounded-full border border-gray-200 shadow-sm flex-1 overflow-x-auto">
                            <div className="flex items-center gap-1 min-w-max">
                              {trialTypeOptions.map(type => (
                                <button
                                  key={type}
                                  type="button"
                                  onClick={() => setTrialTypeFilter(type)}
                                  className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                                    trialTypeFilter === type
                                      ? 'bg-brand-600 text-white shadow-sm'
                                      : 'text-gray-600 hover:text-gray-800 hover:bg-white'
                                  }`}
                                >
                                  {translateText(type)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-500 shrink-0 whitespace-nowrap">{t("ui.status")}</span>
                          <div className="bg-gray-50 p-1 rounded-full border border-gray-200 shadow-sm flex-1 overflow-x-auto">
                            <div className="flex items-center gap-1 min-w-max">
                              {['全部', '招募中', '活跃未招募'].map(status => (
                                <button
                                  key={status}
                                  type="button"
                                  onClick={() => setTrialStatusFilter(status as TrialStatusFilter)}
                                  className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                                    trialStatusFilter === status
                                      ? 'bg-brand-600 text-white shadow-sm'
                                      : 'text-gray-600 hover:text-gray-800 hover:bg-white'
                                  }`}
                                >
                                  {translateText(status)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {loadingTrials ? (
                      <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 text-brand-600 animate-spin mb-4" />
                        <p className="text-gray-500">{t("ui.loading.clinical.trials")}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredTrials.map(trial => (
                          <TrialCard key={trial.nctId} trial={trial} onSelect={setSelectedTrial} />
                        ))}
                      </div>
                    )}
                    {!loadingTrials && filteredTrials.length === 0 && (
                      <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <p className="text-gray-500">{t("ui.no.clinical.trials.match.these.filters")}</p>
                      </div>
                    )}
                  </>
                )}

                {trialTab === 'targeted' && (
                  <>
                    <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="mb-3">
                        <h3 className="text-sm font-bold text-gray-800">{t("ui.fetch.a.trial.by.nct.id.url")}</h3>
                        <p className="text-xs text-gray-500 mt-1">{t("ui.enter.an.nct.id.or.clinicaltrials.gov.url.to")}</p>
                      </div>
                      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                        <input
                          type="text"
                          value={trialTargetInput}
                          onChange={(e) => {
                            setTrialTargetInput(e.target.value);
                            if (trialTargetNotice) setTrialTargetNotice(null);
                          }}
                          onPaste={(e) => {
                            const pasted = e.clipboardData?.getData('text') || '';
                            const normalized = normalizeNctInput(pasted);
                            if (normalized !== pasted) {
                              e.preventDefault();
                              setTrialTargetInput(normalized);
                              if (trialTargetNotice) setTrialTargetNotice(null);
                            }
                          }}
                          onBlur={() => {
                            const normalized = normalizeNctInput(trialTargetInput);
                            if (normalized && normalized !== trialTargetInput) {
                              setTrialTargetInput(normalized);
                            }
                          }}
                          placeholder={t("ui.paste.an.nct.id.or.trial.url.e.g")}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                        <button
                          onClick={handleFetchTrialByNct}
                          disabled={loadingTrialTargetFetch || !extractNctIdFromInput(trialTargetInput)}
                          className="w-full md:w-auto h-10 md:h-auto px-3 md:px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-700/60 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg shadow-md transition-all flex items-center justify-center shrink-0"
                          aria-label={t("ui.fetch.a.clinical.trial")}
                        >
                          <Loader2 className={`w-4 h-4 ${loadingTrialTargetFetch ? 'animate-spin' : ''} md:mr-2`} />
                          <span className="ml-1 md:hidden">{t("ui.fetch")}</span>
                          <span className="hidden md:inline">{t("ui.fetch.by.id")}</span>
                        </button>
                      </div>
                      {trialTargetNotice && (
                        <div className={`mt-3 px-3 py-2 rounded-lg border text-sm flex items-center gap-2 ${
                          trialTargetNotice.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}>
                          {trialTargetNotice.type === 'success' ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 shrink-0" />
                          )}
                          <span>{translateText(trialTargetNotice.text)}</span>
                        </div>
                      )}
                    </div>

                    <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="w-full flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-gray-800">{t("ui.community.discoveries")}</h3>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleToggleCommunityFetchedTrials}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                          >
                            {translateText(showCommunityFetchedTrials ? '收起' : '展开')}
                          </button>
                          <button
                            type="button"
                            onClick={handleRefreshCommunityFetchedTrials}
                            disabled={loadingCommunityFetchedTrials || refreshingCommunityFetchedTrials}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${(loadingCommunityFetchedTrials || refreshingCommunityFetchedTrials) ? 'animate-spin' : ''}`} />
                            {t("ui.refresh.selection")}</button>
                        </div>
                      </div>

                      {showCommunityFetchedTrials && loadingCommunityFetchedTrials ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 py-2 mt-3">
                          <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                          {t("ui.loading.community.trials")}</div>
                      ) : showCommunityFetchedTrials && communityFetchedTrials.length === 0 ? (
                        <p className="text-sm text-gray-500 py-2 mt-3">{t("ui.no.community.trials.available.yet")}</p>
                      ) : showCommunityFetchedTrials ? (
                        <div className="mt-3">
                          <div className="overflow-hidden pb-2">
                            <div
                              className="flex transition-transform duration-500 ease-out"
                              style={{ transform: `translateX(-${communityTrialCarouselPage * 100}%)` }}
                            >
                              {communityFetchedTrials.map(trial => (
                                <div
                                  key={`community-fetched-trial-${trial.nctId}`}
                                  className="shrink-0 px-2"
                                  style={{ width: `${100 / communityItemsPerPage}%` }}
                                >
                                  <TrialCard trial={trial} onSelect={setSelectedTrial} />
                                </div>
                              ))}
                            </div>
                          </div>
                          {communityTrialTotalPages > 1 && (
                            <div className="mt-3 flex items-center justify-center gap-1.5">
                              {Array.from({ length: communityTrialTotalPages }).map((_, index) => (
                                <button
                                  key={`community-trial-page-${index}`}
                                  type="button"
                                  onClick={() => setCommunityTrialCarouselPage(index)}
                                  className={`h-1.5 rounded-full transition-all ${
                                    index === communityTrialCarouselPage
                                      ? 'w-5 bg-brand-600'
                                      : 'w-1.5 bg-gray-300 hover:bg-gray-400'
                                  }`}
                                  aria-label={translateText(`切换到第 ${index + 1} 页`)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 py-2 mt-3">{t("ui.collapsed.by.default.select.expand.to.view")}</p>
                      )}
                    </div>

                    <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="w-full flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-800">{t("ui.my.fetched.trials")}</h3>
                        <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                          {t("ui.total")}{translateText(userFetchedTrialsTotal)} {t("ui.items.2")}</span>
                      </div>
                      {loadingUserFetchedTrials ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 py-2 mt-3">
                          <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                          {t("ui.loading.your.fetched.items")}</div>
                      ) : userFetchedTrials.length === 0 ? (
                        <p className="text-sm text-gray-500 py-2 mt-3">{t("ui.you.have.not.fetched.any.clinical.trials.yet")}</p>
                      ) : (
                        <div className="mt-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {userFetchedTrials.map(trial => (
                              <TrialCard
                                key={`user-fetched-trial-${trial.nctId}`}
                                trial={trial}
                                onSelect={setSelectedTrial}
                              />
                            ))}
                          </div>
                          {hasMoreUserFetchedTrials ? (
                            <div className="mt-8 text-center">
                              <button
                                type="button"
                                onClick={handleLoadMoreUserFetchedTrials}
                                disabled={loadingMoreUserFetchedTrials}
                                className="px-6 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-700/60 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 mx-auto"
                              >
                                <Loader2 className={`w-4 h-4 ${loadingMoreUserFetchedTrials ? 'animate-spin' : ''}`} />
                                {translateText(loadingMoreUserFetchedTrials ? '加载中...' : '加载更多')}
                              </button>
                            </div>
                          ) : (
                            <div className="mt-8 text-center">
                              <p className="text-gray-500 text-sm">{t("ui.you.have.reached.the.end.of.the.trial.list")}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
            </div>
        )}

        {/* VIEW: DRUGS */}
        {currentView === 'drugs' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                    <Pill className="w-6 h-6 text-brand-600" />
                    {t("ui.fda.approved.dmd.drugs")}</h2>
                <p className="mb-4 text-sm text-gray-600">{t("ui.open.drug.details.for.a.summary.of.public.fda")}</p>

                {/* 药物搜索 */}
                <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <form onSubmit={(e) => { e.preventDefault(); setDrugSearchKeyword(drugSearchInput.trim()); if (drugSearchInput.trim()) void apiPost('/api/activity', { action: 'search', contentType: 'drug' }); }} className="flex items-center gap-2 sm:gap-3">
                    <div className="relative flex-grow">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={drugSearchInput}
                        onChange={(e) => setDrugSearchInput(e.target.value)}
                        placeholder={t("ui.enter.an.english.drug.name.for.an.exact.search")}
                        className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <button
                      type="submit"
                      className="h-10 w-10 sm:h-auto sm:w-auto sm:px-5 sm:py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors flex items-center justify-center sm:gap-1.5 shrink-0"
                      aria-label={t("ui.search.drugs")}
                    >
                      <Search className="w-4 h-4" />
                      <span className="hidden sm:inline">{t("ui.find")}</span>
                    </button>
                    {drugSearchKeyword && (
                      <button
                        type="button"
                        onClick={() => { setDrugSearchInput(''); setDrugSearchKeyword(''); }}
                        className="px-3 sm:px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors shrink-0"
                      >
                        {t("ui.clear")}</button>
                    )}
                  </form>
                  {drugSearchKeyword && (
                    <div className="mt-2 text-xs text-gray-500">
                      {t("ui.exact.search")}<span className="font-semibold text-brand-600">"{translateText(drugSearchKeyword)}"</span>{t("ui.found.2")}{translateText(drugs.length)} {t("ui.matching.drugs")}</div>
                  )}
                </div>

                {loadingDrugs ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 text-brand-600 animate-spin mb-4" />
                        <p className="text-gray-500">{t("ui.loading.drug.data")}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {drugs.map((drug, idx) => (
                            <DrugCard
                                key={`${drug.brandName}-${idx}`}
                                drug={drug}
                                onSelect={setSelectedDrug}
                            />
                        ))}
                    </div>
                )}
                {!loadingDrugs && drugs.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <p className="text-gray-500">{t("ui.no.drug.data.available")}</p>
                    </div>
                )}
            </div>
        )}

      </main>

      {shareId && (loadingShare || shareError) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4">
        <div role="status" className="rounded-2xl bg-white p-6 max-w-md">
          <p>{translateText(loadingShare ? '正在打开分享的咨询窗口…' : shareError)}</p>
          {shareError && <button className="mt-4 mr-4 text-brand-600" onClick={() => setShareAttempt(value => value + 1)}>{t("ui.retry")}</button>}
          <button className="mt-4" onClick={closeSharedLink}>{t("ui.close")}</button>
        </div>
      </div>}
      {/* AI Modal */}
      {selectedArticle && userData?.profile && (
        <Suspense fallback={null}>
          <LazyAIInterpreterModal 
              article={selectedArticle} 
              profile={userData.profile} 
              savedInquiries={userData.savedInquiries || []}
              onSavedChange={async () => {
                  const refreshed = await getUserData();
                  if (refreshed) setUserData(refreshed);
              }}
              onClose={() => {
                  setSelectedArticle(null);
                  closeSharedLink();
              }} 
          />
        </Suspense>
      )}

      {/* Drug Modal */}
      {selectedDrug && userData?.profile && (
        <Suspense fallback={null}>
          <LazyDrugInterpreterModal 
              drug={selectedDrug} 
              profile={userData.profile} 
              savedInquiries={userData.savedInquiries || []}
              onSavedChange={async () => {
                  const refreshed = await getUserData();
                  if (refreshed) setUserData(refreshed);
              }}
              onClose={() => {
                  setSelectedDrug(null);
                  closeSharedLink();
              }} 
          />
        </Suspense>
      )}

      {/* Trial Modal */}
      {selectedTrial && userData?.profile && (
        <Suspense fallback={null}>
          <LazyTrialInterpreterModal 
              trial={selectedTrial} 
              profile={userData.profile} 
              savedInquiries={userData.savedInquiries || []}
              onSavedChange={async () => {
                  const refreshed = await getUserData();
                  if (refreshed) setUserData(refreshed);
              }}
              onClose={() => {
                  setSelectedTrial(null);
                  closeSharedLink();
              }} 
          />
        </Suspense>
      )}

    </div>
  );
};

export default App;
