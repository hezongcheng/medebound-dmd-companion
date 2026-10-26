import { Article, UserProfile, ChatMessage, ClinicalTrial, FDADrug } from '../types';
import { getAuthHeader, clearUserData, API_BASE } from './apiClient';

// 检查响应是否为 token 失效
const checkTokenExpired = (response: Response): boolean => {
    if (response.status === 401 || response.status === 403) {
        console.warn('Token 已失效，正在清除用户信息并跳转登录页...');
        clearUserData();
        window.location.reload();
        return true;
    }
    return false;
};

const readJsonSafely = async <T>(response: Response): Promise<T | null> => {
    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text) as T;
    } catch {
        const isHtml = /^\s*</.test(text);
        const preview = text.replace(/\s+/g, ' ').trim().slice(0, 120);
        console.warn('接口返回非 JSON 内容:', {
            status: response.status,
            contentType: response.headers.get('content-type'),
            preview
        });

        if (isHtml) {
            return { error: '服务返回了错误页面，请检查后端服务或代理配置。' } as T;
        }

        return { error: preview || '服务返回格式异常。' } as T;
    }
};

export const analyzeArticle = async (article: Article, profile: UserProfile): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({ article, profile })
        });
        
        if (checkTokenExpired(response)) return "登录已过期，请重新登录。";
        
        if (!response.ok) {
            const error = await readJsonSafely<{ error?: string }>(response);
            return error?.error || "服务暂时不可用，请稍后再试。";
        }
        
        const data = await readJsonSafely<{ text?: string }>(response);
        return data?.text || "抱歉，暂时无法生成摘要。";
    } catch (error) {
        console.error("AI解读错误:", error);
        return "服务暂时不可用，请稍后再试。错误: " + (error as Error).message;
    }
};

export const chatWithArticle = async (
    history: ChatMessage[], 
    newMessage: string, 
    article: Article, 
    profile: UserProfile
): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({ 
                history, 
                message: newMessage, 
                article, 
                profile 
            })
        });
        
        if (checkTokenExpired(response)) return "登录已过期，请重新登录。";
        
        if (!response.ok) {
            const error = await readJsonSafely<{ error?: string }>(response);
            return error?.error || "网络连接出现问题，请重试。";
        }
        
        const data = await readJsonSafely<{ text?: string }>(response);
        return data?.text || "抱歉，无法生成回复。";
    } catch (error) {
        console.error("AI聊天错误:", error);
        return "网络连接出现问题，请重试。错误: " + (error as Error).message;
    }
};

export const analyzeDrug = async (drug: FDADrug, profile: UserProfile): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({ type: 'drug', drug, profile })
        });
        
        if (checkTokenExpired(response)) return "登录已过期，请重新登录。";
        
        if (!response.ok) {
            const error = await readJsonSafely<{ error?: string }>(response);
            return error?.error || "服务暂时不可用，请稍后再试。";
        }
        
        const data = await readJsonSafely<{ text?: string }>(response);
        return data?.text || "抱歉，暂时无法生成药物分析。";
    } catch (error) {
        console.error("药物分析错误:", error);
        return "服务暂时不可用，请稍后再试。错误: " + (error as Error).message;
    }
};

export const chatWithDrug = async (
    history: ChatMessage[], 
    newMessage: string, 
    drug: FDADrug, 
    profile: UserProfile
): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({ 
                type: 'drug',
                history, 
                message: newMessage, 
                drug, 
                profile 
            })
        });
        
        if (checkTokenExpired(response)) return "登录已过期，请重新登录。";
        
        if (!response.ok) {
            const error = await readJsonSafely<{ error?: string }>(response);
            return error?.error || "网络连接出现问题，请重试。";
        }
        
        const data = await readJsonSafely<{ text?: string }>(response);
        return data?.text || "抱歉，无法生成回复。";
    } catch (error) {
        console.error("药物聊天错误:", error);
        return "网络连接出现问题，请重试。错误: " + (error as Error).message;
    }
};

export const analyzeTrial = async (trial: ClinicalTrial, profile: UserProfile, matchRows: Array<{ label: string; patient: string; requirement: string; state: string }>, selectedCenter?: { facility: string; city: string; country: string } | string): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({ type: 'trial', trial, profile, matchRows, selectedCenter })
        });
        
        if (checkTokenExpired(response)) return "登录已过期，请重新登录。";
        
        if (!response.ok) {
            const error = await readJsonSafely<{ error?: string }>(response);
            return error?.error || "服务暂时不可用，请稍后再试。";
        }
        
        const data = await readJsonSafely<{ text?: string }>(response);
        return data?.text || "抱歉，暂时无法生成试验分析。";
    } catch (error) {
        console.error("试验分析错误:", error);
        return "服务暂时不可用，请稍后再试。错误: " + (error as Error).message;
    }
};

export const chatWithTrial = async (
    history: ChatMessage[],
    newMessage: string,
    trial: ClinicalTrial,
    profile: UserProfile,
    selectedCenter?: { facility: string; city: string; country: string } | string
): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({
                type: 'trial',
                history,
                message: newMessage,
                trial,
                profile,
                selectedCenter
            })
        });

        if (checkTokenExpired(response)) return "登录已过期，请重新登录。";

        if (!response.ok) {
            const error = await readJsonSafely<{ error?: string }>(response);
            return error?.error || "网络连接出现问题，请重试。";
        }

        const data = await readJsonSafely<{ text?: string }>(response);
        return data?.text || "抱歉，无法生成回复。";
    } catch (error) {
        console.error("试验聊天错误:", error);
        return "网络连接出现问题，请重试。错误: " + (error as Error).message;
    }
};

export const getRecommendedQuestions = async (article: Article, profile: UserProfile): Promise<string[]> => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/recommended-questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({ article, profile })
        });

        if (checkTokenExpired(response)) return [
            "这项研究对我家孩子有什么意义？",
            "研究中提到的治疗方法安全吗？",
            "我们需要和医生讨论哪些关键点？"
        ];

        if (!response.ok) {
            const error = await readJsonSafely<{ error?: string }>(response);
            console.warn("获取推荐问题失败:", error?.error);
            return [
                "这项研究对我家孩子有什么意义？",
                "研究中提到的治疗方法安全吗？",
                "我们需要和医生讨论哪些关键点？"
            ];
        }

        const data = await readJsonSafely<{ questions?: string[] }>(response);
        return data?.questions || [];
    } catch (error) {
        console.error("获取推荐问题错误:", error);
        return [
            "这项研究对我家孩子有什么意义？",
            "研究中提到的治疗方法安全吗？",
            "我们需要和医生讨论哪些关键点？"
        ];
    }
};
