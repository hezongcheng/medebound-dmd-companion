/**
 * API Client - handles token expiry and auth headers
 */
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const TOKEN_KEY = 'hanzhi_auth_token';
const USER_KEY = 'hanzhi_current_user';

export const getLanguageHeaders = (): Record<string, string> => {
  const locale = typeof document !== 'undefined' ? document.documentElement.lang : 'zh-CN';
  return { 'X-App-Locale': locale || 'en', 'Accept-Language': locale || 'en' };
};
// Get auth header from localStorage
export const getAuthHeader = (): Record<string, string> => {
  const token = localStorage.getItem(TOKEN_KEY);
  return { ...getLanguageHeaders(), ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
};

// Clear all user data from storage
export const clearUserData = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.clear();
};

// Handle token expiry - clear data and reload
const handleTokenExpired = () => {
  console.warn('Token expired, clearing user data...');
  clearUserData();
  window.location.reload();
};

// Check if response indicates token expiry
const isTokenExpired = async (response: Response): Promise<boolean> => {
  if (response.status === 401) return true;
  // Some older deployments returned 403 for invalid JWTs. Other 403s are permissions errors.
  if (response.status !== 403) return false;
  try {
    const data = await response.clone().json();
    return /令牌无效|令牌.*过期|无效.*令牌|token.*(?:expired|invalid)|(?:expired|invalid).*token|jwt expired|invalid signature/i.test(String(data?.error || data?.message || ''));
  } catch {
    return false;
  }
};

interface FetchOptions extends RequestInit {
  skipAuthCheck?: boolean;
  throwOnHttpError?: boolean;
}

/**
 * Unified API request method with auto token expiry handling
 */
export const apiRequest = async <T = any>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T | null> => {
  const { skipAuthCheck = false, throwOnHttpError = false, headers = {}, ...restOptions } = options;
  
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getLanguageHeaders(),
    ...headers as Record<string, string>,
  };
  
  // Add auth header unless skipped
  if (!skipAuthCheck) {
    Object.assign(requestHeaders, getAuthHeader());
  }
  
  try {
    const response = await fetch(url, {
      ...restOptions,
      headers: requestHeaders,
    });
    
    // Check if token expired
    if (!skipAuthCheck && await isTokenExpired(response)) {
      handleTokenExpired();
      return null;
    }
    
    if (!response.ok) {
      if (throwOnHttpError) {
        let message = `请求失败 (${response.status})`;
        try {
          const data = await response.json();
          const detail = data?.error || data?.message;
          if (detail) message = `${detail} (HTTP ${response.status})`;
        } catch {
          // 非 JSON 错误响应使用状态码提示
        }
        throw new Error(message);
      }
      return null;
    }
    
    // Try to parse JSON, return null on failure
    try {
      return await response.json();
    } catch {
      return null;
    }
  } catch (error) {
    console.error('API request error:', error);
    if (throwOnHttpError) throw error;
    return null;
  }
};

/**
 * GET request
 */
export const apiGet = <T = any>(endpoint: string, options: FetchOptions = {}): Promise<T | null> => {
  return apiRequest<T>(endpoint, { ...options, method: 'GET' });
};

/**
 * POST request
 */
export const apiPost = <T = any>(
  endpoint: string,
  data?: any,
  options: FetchOptions = {}
): Promise<T | null> => {
  return apiRequest<T>(endpoint, {
    ...options,
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });
};

/**
 * DELETE request
 */
export const apiDelete = <T = any>(endpoint: string, options: FetchOptions = {}): Promise<T | null> => {
  return apiRequest<T>(endpoint, { ...options, method: 'DELETE' });
};

export { API_BASE, TOKEN_KEY, USER_KEY };
