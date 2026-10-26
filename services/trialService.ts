import { ClinicalTrial } from '../types';
import { apiPost, API_BASE, getAuthHeader } from './apiClient';

interface ServerTrial {
  nctId: string;
  title: string;
  titleZh?: string;
  status: string;
  phase: string[] | string;
  conditions: string[] | string;
  locations: string[] | string;
  regions: string[] | string;
  summary?: string;
  summaryZh?: string;
  eligibility?: string;
  eligibilityZh?: string;
  lastUpdate?: string;
  studyType?: string;
  interventionTypes?: string[] | string;
  interventionNames?: string[] | string;
  leadSponsor?: string;
  primaryPurpose?: string;
  observationalModel?: string;
  timePerspective?: string;
  allocation?: string;
  masking?: string;
  enrollmentCount?: number | string | null;
  enrollmentType?: string;
  sex?: string;
  minimumAge?: string;
  maximumAge?: string;
  healthyVolunteers?: string;
  stdAges?: string[] | string;
  suggestedMaterials?: string[] | string;
}

export interface TrialSite {
  facility: string;
  status: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  contacts: Array<{ name: string; phone: string; email: string }>;
}

export interface TrialMatchRow {
  label: string;
  patient: string;
  requirement: string;
  sourceQuote?: string;
  state: 'match' | 'pending' | 'unknown' | 'mismatch';
}

export interface TrialMatchResult {
  rows: TrialMatchRow[];
  criteria: string;
  source: string;
  centerSpecialRequirements?: string | null;
  studyPhases?: string[];
  selectedCenterKey?: string;
}

export async function fetchTrialMatches(nctId: string, profile: unknown, selectedCenter?: Pick<TrialSite, 'facility' | 'city' | 'country'> | string): Promise<TrialMatchResult | null> {
  if (!/^NCT\d{8}$/i.test(nctId)) return null;
  return apiPost<TrialMatchResult>(`/api/trials/${encodeURIComponent(nctId)}/match`, { profile, selectedCenter });
}

export async function fetchTrialSites(nctId: string): Promise<TrialSite[]> {
  if (!/^NCT\d{8}$/i.test(nctId)) return [];
  try {
    const response = await fetch(`${API_BASE}/api/trials/${encodeURIComponent(nctId)}/locations`);
    if (!response.ok) return [];
    const sites = await response.json();
    return Array.isArray(sites) ? sites : [];
  } catch {
    return [];
  }
}

const toArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const normalizeServerTrial = (trial: ServerTrial): ClinicalTrial => ({
  nctId: trial.nctId,
  title: trial.title || '',
  titleZh: trial.titleZh || '',
  status: trial.status || '',
  phase: toArray(trial.phase),
  conditions: toArray(trial.conditions),
  locations: toArray(trial.locations),
  regions: toArray(trial.regions),
  summary: trial.summary || '',
  summaryZh: trial.summaryZh || '',
  eligibility: trial.eligibility || '',
  eligibilityZh: trial.eligibilityZh || '',
  lastUpdate: trial.lastUpdate || '',
  studyType: trial.studyType || '',
  interventionTypes: toArray(trial.interventionTypes),
  interventionNames: toArray(trial.interventionNames),
  leadSponsor: trial.leadSponsor || '',
  primaryPurpose: trial.primaryPurpose || '',
  observationalModel: trial.observationalModel || '',
  timePerspective: trial.timePerspective || '',
  allocation: trial.allocation || '',
  masking: trial.masking || '',
  enrollmentCount: trial.enrollmentCount == null ? null : Number(trial.enrollmentCount),
  enrollmentType: trial.enrollmentType || '',
  sex: trial.sex || '',
  minimumAge: trial.minimumAge || '',
  maximumAge: trial.maximumAge || '',
  healthyVolunteers: trial.healthyVolunteers || '',
  stdAges: toArray(trial.stdAges),
  suggestedMaterials: toArray(trial.suggestedMaterials)
});

export const fetchDmdTrials = async (regionFilter: string = ''): Promise<ClinicalTrial[]> => {
  try {
    const params = new URLSearchParams();
    if (regionFilter) params.set('region', regionFilter);

    const query = params.toString();
    const url = `${API_BASE}/api/trials${query ? '?' + query : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch cached trials');
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeServerTrial);
  } catch (error) {
    console.error('ClinicalTrials Cache Error:', error);
    return [];
  }
};

export const fetchTrialByNctFromServer = async (nctId: string): Promise<{ success: boolean; message: string }> => {
  const cleanNctId = (nctId || '').trim();
  if (!cleanNctId) {
    throw new Error('NCT ID 不能为空');
  }

  const result = await apiPost<{ success: boolean; message: string }>(
    '/api/admin/fetch-trial-by-nct',
    { nctId: cleanNctId }
  );
  if (!result) {
    throw new Error('NCT 定向抓取失败');
  }
  return result;
};

export const getUserFetchedTrials = async (
  searchKeyword: string = '',
  page: number = 1,
  pageSize: number = 10
): Promise<ClinicalTrial[]> => {
  const params = new URLSearchParams();
  if (searchKeyword) params.set('search', searchKeyword);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const query = params.toString();
  const response = await fetch(`${API_BASE}/api/trials/user-fetched${query ? '?' + query : ''}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) throw new Error('Failed to fetch user fetched trials');
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map(normalizeServerTrial);
};

export const getUserFetchedTrialsCount = async (searchKeyword: string = ''): Promise<number> => {
  const params = new URLSearchParams();
  if (searchKeyword) params.set('search', searchKeyword);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/api/trials/user-fetched/count${query ? '?' + query : ''}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) throw new Error('Failed to fetch user fetched trials count');
  const data = await response.json();
  return Number(data) || 0;
};

export const getRandomUserFetchedTrials = async (limit: number = 9): Promise<ClinicalTrial[]> => {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  const response = await fetch(`${API_BASE}/api/trials/user-fetched/random?${params.toString()}`, {
    headers: { ...getAuthHeader() }
  });
  if (!response.ok) throw new Error('Failed to fetch random user fetched trials');
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map(normalizeServerTrial);
};
