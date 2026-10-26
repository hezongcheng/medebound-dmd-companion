const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCenterAwareTrialMatches } = require('./trialCenterMatching');

const trial = { minimumAge: '7 Years', maximumAge: '16 Years', eligibility: 'Inclusion Criteria:\n* DMD diagnosis' };
const profile = { age: 10, geneticProfile: 'DMD 基因检测阳性' };
const registry = {
  design: { phases: ['PHASE3'] },
  eligibility: { eligibilityCriteria: trial.eligibility, minimumAge: '7 Years', maximumAge: '16 Years' },
  locations: [
    { facility: '同名医院', city: 'Boston', country: 'United States', additionalRequirements: 'LVEF ≥50%' },
    { facility: '同名医院', city: 'New York', country: 'United States', additionalRequirements: '肺活量 ≥60%' },
    { facility: '其他中心', city: 'Chicago', country: 'United States' }
  ]
};

test('selected center contributes only its documented additional requirement', () => {
  const boston = buildCenterAwareTrialMatches(trial, registry, profile,
    { facility: '同名医院', city: 'Boston', country: 'United States' });
  const newYork = buildCenterAwareTrialMatches(trial, registry, profile,
    { facility: '同名医院', city: 'New York', country: 'United States' });
  assert.equal(boston.rows.at(-1).requirement, 'LVEF ≥50%');
  assert.equal(newYork.rows.at(-1).requirement, '肺活量 ≥60%');
  assert.equal(boston.rows.at(-1).state, 'pending');
  assert.equal(boston.rows[0].state, newYork.rows[0].state);
  assert.deepEqual(boston.studyPhases, ['PHASE3']);
  assert.deepEqual(newYork.studyPhases, ['PHASE3']);
  assert.ok(!boston.criteria.includes('肺活量'));
});

test('center without published extra criteria keeps study matching unchanged', () => {
  const result = buildCenterAwareTrialMatches(trial, registry, profile,
    { facility: '其他中心', city: 'Chicago', country: 'United States' });
  assert.equal(result.centerSpecialRequirements, null);
  assert.equal(result.rows.some(row => row.label === '研究中心附加条件'), false);
});
