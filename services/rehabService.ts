/**
 * 康复视频 + 打卡 前端服务
 */

import { apiGet, apiPost } from './apiClient';

export interface RehabVideo {
  id: number;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  duration: number;
  category: string;
  difficulty: string;
  target_status: string;
  sort_order: number;
}

export interface CheckinStats {
  totalDays: number;
  streak: number;
  todayCheckin: { id: number; is_completed: number } | null;
  weekRecords: Array<{
    checkin_date: string;
    is_completed: number;
    duration_plan: number;
    completed_count: number;
    video_count: number;
  }>;
}

export interface CheckinRecord {
  id: number;
  checkin_date: string;
  duration_plan: number;
  video_count: number;
  completed_count: number;
  is_completed: number;
  started_at: string;
  completed_at: string | null;
  detail_count: number;
}

/** 获取康复视频列表 */
export async function fetchRehabVideos(targetStatus?: string): Promise<RehabVideo[]> {
  const query = targetStatus ? `?targetStatus=${targetStatus}` : '';
  const data = await apiGet<RehabVideo[]>(`/api/rehab/videos${query}`);
  return data || [];
}

/** 提交康复评估 */
export async function submitAssessment(contractures: string, painWarnings: string): Promise<number | null> {
  const data = await apiPost<{ success: boolean; assessmentId: number }>('/api/rehab/assessment', {
    contractures,
    painWarnings,
  });
  return data?.assessmentId || null;
}

/** 开始训练（创建打卡） */
export async function startCheckin(assessmentId: number, durationPlan: number, videoCount: number): Promise<number | null> {
  const data = await apiPost<{ success: boolean; checkinId: number }>('/api/rehab/checkin/start', {
    assessmentId,
    durationPlan,
    videoCount,
  });
  return data?.checkinId || null;
}

/** 记录单个视频完成 */
export async function recordVideoComplete(checkinId: number, videoId: number, videoOrder: number, watchedSeconds: number): Promise<boolean> {
  const data = await apiPost(`/api/rehab/checkin/${checkinId}/video`, {
    videoId,
    videoOrder,
    watchedSeconds,
  });
  return !!data?.success;
}

/** 完成打卡 */
export async function completeCheckin(checkinId: number, nextReminderTime?: string): Promise<boolean> {
  const data = await apiPost(`/api/rehab/checkin/${checkinId}/complete`, {
    nextReminderTime: nextReminderTime || null,
  });
  return !!data?.success;
}

/** 获取打卡统计 */
export async function fetchCheckinStats(): Promise<CheckinStats | null> {
  return apiGet<CheckinStats>('/api/rehab/stats');
}

/** 获取打卡历史 */
export async function fetchCheckinHistory(limit = 30): Promise<CheckinRecord[]> {
  const data = await apiGet<CheckinRecord[]>(`/api/rehab/history?limit=${limit}`);
  return data || [];
}
