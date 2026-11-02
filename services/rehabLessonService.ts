import { apiGet, apiPost } from './apiClient';

export interface RehabLesson {
  id: number;
  title: string;
  video_url: string | null;
  thumbnail_url: string | null;
  video_version: string | null;
  training_category: string;
  duration: number;
  unlock_after_count: number;
  required_watch_seconds: number;
  completed_count: number;
  is_unlocked: boolean;
  prerequisite_id: number | null;
  prerequisite_title: string | null;
  prerequisite_count: number;
  prerequisite_required: number;
}
export interface LessonCatalog {
  categories: { code: string; title: string; sort_order: number }[];
  videos: RehabLesson[];
}

const options = { throwOnHttpError: true };
export const fetchLessons = () => apiGet<LessonCatalog>('/api/rehab/lessons', options);
export const startLesson = (videoId: number) => apiPost<{ sessionId: number; video: RehabLesson }>(
  `/api/rehab/lessons/${videoId}/start`, {}, options
);
export const completeLesson = (sessionId: number, watchedSeconds: number) => apiPost<{ success: boolean }>(
  `/api/rehab/lesson-sessions/${sessionId}/complete`, { watchedSeconds }, options
);
export const stopLesson = (sessionId: number) => apiPost<{ success: boolean }>(
  `/api/rehab/lesson-sessions/${sessionId}/stop`, {}, options
);
