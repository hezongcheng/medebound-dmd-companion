import { apiGet, apiRequest } from './apiClient';
import type { DietLogEntry } from '../utils/dietLog';

export interface DietRecordDay {
  date: string;
  version: number;
  entries: DietLogEntry[];
}

export async function getDietRecords(from: string, to: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ from, to });
  const result = await apiGet<{ days: DietRecordDay[] }>(`/api/diet/records?${query}`, { signal, throwOnHttpError: true });
  if (!Array.isArray(result?.days)) throw new Error('读取饮食记录失败');
  return result.days;
}

export async function saveDietRecord(date: string, version: number, entries: DietLogEntry[]) {
  const result = await apiRequest<{ saved: boolean; day: DietRecordDay }>(`/api/diet/records/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify({ version, entries }),
    throwOnHttpError: true
  });
  if (!result?.day || typeof result.saved !== 'boolean') throw new Error('保存饮食记录失败');
  return result;
}
