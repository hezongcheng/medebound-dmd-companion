import { API_BASE } from './apiClient';

export interface AdverseEventSummary {
  status: 'available' | 'no_reports' | 'unavailable' | 'invalid';
  name: string;
  total: number | null;
  reactions: Array<{ term: string; count: number }>;
  source?: string;
  sourceUrl?: string;
  dashboardUrl: string;
  checkedAt?: string;
  dataUpdatedAt?: string | null;
}

export const AEMS_DASHBOARD_URL = 'https://www.fda.gov/drugs/fda-adverse-event-monitoring-system-aems/fda-adverse-event-monitoring-system-aems-public-dashboard';

export async function fetchAdverseEventSummary(name: string): Promise<AdverseEventSummary> {
  try {
    const response = await fetch(`${API_BASE}/api/adverse-events?name=${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return { status: 'unavailable', name, total: null, reactions: [], dashboardUrl: AEMS_DASHBOARD_URL };
  }
}
