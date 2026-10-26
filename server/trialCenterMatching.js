const { buildTrialMatches } = require('./trialMatching');

function findSelectedCenter(registry, selectedCenter) {
  if (!selectedCenter) return null;
  const locations = registry?.locations || [];
  if (typeof selectedCenter === 'string') {
    return locations.find(site => (site.facility || [site.city, site.country].filter(Boolean).join(', ')) === selectedCenter) || null;
  }
  return locations.find(site => String(site.facility || '') === String(selectedCenter.facility || '') &&
    String(site.city || '') === String(selectedCenter.city || '') &&
    String(site.country || '') === String(selectedCenter.country || '')) || null;
}

function getCenterSpecialRequirements(registry, selectedCenter) {
  const site = findSelectedCenter(registry, selectedCenter);
  const requirement = String(site?.eligibilityCriteria || site?.additionalRequirements || '').trim();
  const studyCriteria = String(registry?.eligibility?.eligibilityCriteria || '').trim();
  return requirement && requirement.replace(/\s+/g, ' ') !== studyCriteria.replace(/\s+/g, ' ')
    ? requirement.slice(0, 3000) : null;
}

function buildCenterAwareTrialMatches(trial, registry, profile, selectedCenter) {
  const eligibility = registry?.eligibility || {};
  const studyPhases = Array.isArray(registry?.design?.phases) && registry.design.phases.length
    ? registry.design.phases : trial.phase || [];
  const currentTrial = eligibility.eligibilityCriteria
    ? { ...trial, eligibility: eligibility.eligibilityCriteria,
        minimumAge: eligibility.minimumAge || trial.minimumAge,
        maximumAge: eligibility.maximumAge || trial.maximumAge, phase: studyPhases }
    : { ...trial, phase: studyPhases };
  const result = buildTrialMatches(currentTrial, profile);
  const centerSpecialRequirements = getCenterSpecialRequirements(registry, selectedCenter);
  if (centerSpecialRequirements) {
    result.rows.push({ label: '研究中心附加条件', patient: '需研究中心核验',
      requirement: centerSpecialRequirements, state: 'pending' });
    result.source += '；当前研究中心公布的附加要求';
  }
  return { ...result, centerSpecialRequirements, studyPhases };
}

module.exports = { findSelectedCenter, getCenterSpecialRequirements, buildCenterAwareTrialMatches };
