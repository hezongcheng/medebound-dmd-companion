import { UserDatabaseEntry, UserProfile, SavedInquiry, RehabRecord, RehabStatus, RehabExercise } from '../types';
import { apiGet, apiPost, apiDelete, getLanguageHeaders, clearUserData, getAuthHeader, API_BASE, TOKEN_KEY, USER_KEY } from './apiClient';

// 登录
export const login = async (username: string, password: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getLanguageHeaders() },
      body: JSON.stringify({ username, password })
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, data.username);
    return true;
  } catch (error) {
    console.error('登录错误:', error);
    return false;
  }
};

// 注册（可选）
export const register = async (username: string, password: string, email?: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getLanguageHeaders() },
      body: JSON.stringify({ username, password, email })
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, data.username);
    return true;
  } catch (error) {
    console.error('注册错误:', error);
    return false;
  }
};

// 登出
export const logout = async () => {
  clearUserData();
};

// 获取微信授权URL
export const getWechatAuthUrl = async (): Promise<string | null> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/wechat/url`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('获取微信授权URL错误:', error);
    return null;
  }
};

// 微信登录回调处理
export const wechatLogin = async (code: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/wechat/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getLanguageHeaders() },
      body: JSON.stringify({ code })
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, data.username);
    return true;
  } catch (error) {
    console.error('微信登录错误:', error);
    return false;
  }
};

// 发送登录验证码
export const sendLoginCode = async (email: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/login/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getLanguageHeaders() },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return { success: false, message: data.error || '发送失败' };
    }
    
    return { success: true, message: data.message };
  } catch (error) {
    console.error('发送登录验证码错误:', error);
    return { success: false, message: '网络错误，请稍后重试' };
  }
};

// 邮箱验证码登录
export const loginWithCode = async (email: string, code: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/login/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getLanguageHeaders() },
      body: JSON.stringify({ email, code })
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, data.username);
    return true;
  } catch (error) {
    console.error('邮箱验证码登录错误:', error);
    return false;
  }
};

// 获取当前用户名
export const getCurrentUser = (): string | null => {
  return localStorage.getItem(USER_KEY);
};

// 检查是否已登录
export const isAuthenticated = (): boolean => {
  return !!localStorage.getItem(TOKEN_KEY);
};

// 获取用户完整数据
export const getUserData = async (): Promise<UserDatabaseEntry | null> => {
  return apiGet<UserDatabaseEntry>('/api/user/data');
};

// 保存用户档案
export const saveUserProfile = async (profile: UserProfile): Promise<boolean> => {
  const result = await apiPost('/api/user/profile', profile);
  return result !== null;
};

// 保存查询记录
export const saveInquiry = async (inquiry: SavedInquiry): Promise<boolean> => {
  const result = await apiPost('/api/user/inquiry', inquiry);
  return result !== null;
};

// 删除查询记录
export const deleteInquiry = async (inquiryId: string): Promise<boolean> => {
  const result = await apiDelete(`/api/user/inquiry/${inquiryId}`);
  return result !== null;
};

// 检查邮箱绑定状态
// 保留 HTTP 错误详情，调用方不应将请求失败当作“未绑定”。
export const checkEmailStatus = async (): Promise<{ bound: boolean; email: string | null } | null> => {
  const result = await apiGet<{ bound: boolean; email: string | null }>('/api/user/email-status', { throwOnHttpError: true });
  if (result && typeof result.bound !== 'boolean') throw new Error('邮箱状态接口返回格式异常，请检查后端部署及 API 地址');
  return result;
};

const REHAB_RECORDS_KEY = 'hanzhi_rehab_records';
const REHAB_STATUS_KEY = 'hanzhi_rehab_status_history';

export const saveRehabRecord = async (record: Omit<RehabRecord, 'id'>): Promise<void> => {
  const newRecord = { ...record, id: crypto.randomUUID() };
  const stored = localStorage.getItem(REHAB_RECORDS_KEY);
  const records: RehabRecord[] = stored ? JSON.parse(stored) : [];
  records.unshift(newRecord as RehabRecord);
  localStorage.setItem(REHAB_RECORDS_KEY, JSON.stringify(records));
};

export const saveRehabStatus = async (status: Omit<RehabStatus, 'id'>): Promise<void> => {
  const newStatus = { ...status, id: crypto.randomUUID() };
  const stored = localStorage.getItem(REHAB_STATUS_KEY);
  const history: RehabStatus[] = stored ? JSON.parse(stored) : [];
  history.unshift(newStatus as RehabStatus);
  localStorage.setItem(REHAB_STATUS_KEY, JSON.stringify(history));

  const userData = await getUserData();
  if (userData?.profile) {
    const updatedProfile = {
      ...userData.profile,
      hasJointPain: status.hasJointPain,
      jointPainDetails: status.jointPainDetails,
      hasJointContracture: status.hasJointContracture,
      jointContractureDetails: status.jointContractureDetails
    };
    await saveUserProfile(updatedProfile as UserProfile);
  }
};

export const getLocalRehabRecords = (): RehabRecord[] => {
  const stored = localStorage.getItem(REHAB_RECORDS_KEY);
  return stored ? JSON.parse(stored) : [];
};

export const getLocalRehabStatusHistory = (): RehabStatus[] => {
  const stored = localStorage.getItem(REHAB_STATUS_KEY);
  return stored ? JSON.parse(stored) : [];
};

export interface RehabVideoItem {
  id: number;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  duration: number;
  video_group: string | null;
  category: string;
  difficulty: string;
  target_status: string;
  exercises: RehabExercise[] | string;
}

export const getRehabVideos = async (videoGroup?: string): Promise<RehabVideoItem[]> => {
  const params = videoGroup ? `?videoGroup=${videoGroup}` : '';
  const result = await apiGet<RehabVideoItem[]>(`/api/rehab/videos${params}`);
  if (!result) return [];
  return result.map(v => ({
    ...v,
    exercises: typeof v.exercises === 'string' ? JSON.parse(v.exercises) : (v.exercises || [])
  }));
};

export interface RehabLevelStats {
  level1Streak: number;
  level2Streak: number;
  level3Streak: number;
  isLevel2Unlocked: boolean;
  isLevel3Unlocked: boolean;
  todayCompletedGroups: string[];
  totalDays: number;
  totalMinutes: number;
  history: Array<{
    checkin_date: string;
    video_group: string | null;
    duration_plan: number;
    completed_count: number;
    video_count: number;
    is_completed: number;
    duration_actual: number | null;
  }>;
}

export const getRehabLevelStats = async (): Promise<RehabLevelStats | null> => {
  return apiGet<RehabLevelStats>('/api/rehab/level-stats');
};

export const startRehabCheckin = async (params: {
  durationPlan: number;
  videoCount: number;
  videoGroup?: string;
}): Promise<{ success: boolean; checkinId: number } | null> => {
  return apiPost('/api/rehab/checkin/start', params);
};

export const recordVideoComplete = async (checkinId: number, params: {
  videoId: number;
  videoOrder: number;
  watchedSeconds: number;
}): Promise<boolean> => {
  const result = await apiPost(`/api/rehab/checkin/${checkinId}/video`, params);
  return result !== null;
};

export const completeRehabCheckin = async (checkinId: number, durationActual: number): Promise<boolean> => {
  const result = await apiPost(`/api/rehab/checkin/${checkinId}/complete`, { durationActual });
  return result !== null;
};

export const stopRehabCheckin = async (checkinId: number, durationActual: number): Promise<boolean> => {
  const result = await apiPost(`/api/rehab/checkin/${checkinId}/stop`, { durationActual });
  return result !== null;
};

export const tickCheckin = async (checkinId: number): Promise<boolean> => {
  const result = await apiPost(`/api/rehab/checkin/${checkinId}/tick`, {});
  return result?.success === true;
};
