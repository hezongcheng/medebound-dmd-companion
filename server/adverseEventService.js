const axios = require('axios');

const OPENFDA_EVENT_URL = 'https://api.fda.gov/drug/event.json';
const AEMS_DASHBOARD_URL = 'https://www.fda.gov/drugs/fda-adverse-event-monitoring-system-aems/fda-adverse-event-monitoring-system-aems-public-dashboard';

function createAdverseEventService(http = axios) {
  const cache = new Map();
  const pending = new Map();

  async function load(name) {
    const common = { timeout: 7000, maxContentLength: 1024 * 1024 };
    for (const field of ['brand_name', 'generic_name']) {
      const search = `patient.drug.openfda.${field}:"${name}"`;
      const params = { search, count: 'patient.reaction.reactionmeddrapt.exact', limit: '5' };
      const queryUrl = `${OPENFDA_EVENT_URL}?${new URLSearchParams(params)}`;
      if (process.env.OPENFDA_API_KEY) params.api_key = process.env.OPENFDA_API_KEY;
      try {
        const response = await http.get(OPENFDA_EVENT_URL, { ...common, params });
        const reactions = Array.isArray(response.data?.results) ? response.data.results : [];
        const reportedTotal = response.data?.meta?.results?.total;
        const total = reportedTotal == null ? null : Number(reportedTotal);
        return {
          status: 'available', name, matchedBy: field, total: total !== null && Number.isFinite(total) ? total : null,
          reactions: reactions.map(item => ({ term: String(item.term || ''), count: Number(item.count) || 0 })).filter(item => item.term),
          source: 'openFDA 药物不良事件 API（FAERS 公开数据）', sourceUrl: queryUrl,
          dashboardUrl: AEMS_DASHBOARD_URL, dataUpdatedAt: response.data?.meta?.last_updated || null, checkedAt: new Date().toISOString()
        };
      } catch (error) {
        if (error.response?.status === 404) continue;
        return { status: 'unavailable', name, total: null, reactions: [], sourceUrl: queryUrl, dashboardUrl: AEMS_DASHBOARD_URL, checkedAt: new Date().toISOString() };
      }
    }
    return { status: 'no_reports', name, total: null, reactions: [], dashboardUrl: AEMS_DASHBOARD_URL, checkedAt: new Date().toISOString() };
  }

  async function getDrugEvents(rawName) {
    const name = String(rawName || '').trim();
    if (!name || name.length > 100 || !/^[\p{L}\p{N}][\p{L}\p{N} .,'()\-/]*$/u.test(name)) {
      return { status: 'invalid', name, total: null, reactions: [], dashboardUrl: AEMS_DASHBOARD_URL };
    }
    const key = name.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const promise = load(name).then(value => {
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: Date.now() + (value.status === 'available' ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000) });
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  return { getDrugEvents };
}

const { getDrugEvents } = createAdverseEventService();
module.exports = { createAdverseEventService, getDrugEvents, AEMS_DASHBOARD_URL };
