const { getEvidence } = require('./consultationEvidence');
const { getDrugEvents } = require('./adverseEventService');
const { getCenterSpecialRequirements } = require('./trialCenterMatching');

const stateLabels = { match: '符合', mismatch: '不符合', pending: '待确认', unknown: '未知' };

function normalizeMatchRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 12).filter(row => row && stateLabels[row.state]).map(row => ({
    label: String(row.label || '').slice(0, 60),
    patient: String(row.patient || '').slice(0, 180),
    requirement: String(row.requirement || '').slice(0, 1600),
    state: stateLabels[row.state]
  }));
}

async function buildTrialAnalysisContext(trial, matchRows, selectedCenter, dependencies = { getEvidence, getDrugEvents }) {
  const names = (trial.interventionNames || []).filter((name, index) =>
    ['DRUG', 'BIOLOGICAL'].includes(String((trial.interventionTypes || [])[index] || '').toUpperCase()) &&
    name && !/placebo|安慰剂/i.test(name)
  );
  const uniqueNames = [...new Set(names)].slice(0, 3);
  const [sources, adverseReports] = await Promise.all([
    dependencies.getEvidence('trial', trial),
    Promise.all(uniqueNames.map(name => dependencies.getDrugEvents(name)))
  ]);
  const official = sources.find(source => source.available && source.content)?.content || null;
  const centerSpecialRequirements = getCenterSpecialRequirements(official, selectedCenter);
  return { registry: official, matchRows: normalizeMatchRows(matchRows), adverseReports, centerSpecialRequirements, selectedCenter };
}

module.exports = { buildTrialAnalysisContext, normalizeMatchRows };
