const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTrialMatches } = require('./trialMatching');

const trial = {
  minimumAge: '10 Years', maximumAge: '',
  eligibility: `Inclusion Criteria:
1. Male subjects at least 10 years of age.
2. Confirmatory genetic testing for DMD.
3. Reduced ability to walk/run: more than 10 seconds for the 10-meter walk/run.
4. Treatment with systemic glucocorticoids for at least 12 months and at a stable dose for 6 months.
Exclusion Criteria:
1. Left ventricular ejection fraction (LVEF) less than or equal to 35%.
2. Percent predicted forced vital capacity (FVC%) less than 35%.`
};

test('preserves actual requirements and evaluates only unambiguous registered values', () => {
  const { rows } = buildTrialMatches(trial, {
    age: 12, geneticProfile: '外显子44缺失', ambulatoryStatus: 'ambulatory',
    ejectionFraction: 50, steroidStatus: 'current'
  });
  assert.equal(rows.find(row => row.label === '年龄').state, 'match');
  assert.equal(rows.find(row => row.label === '心脏射血分数').state, 'match');
  assert.match(rows.find(row => row.label === '心脏射血分数').requirement, /35%/);
  assert.match(rows.find(row => row.label === '激素使用').requirement, /12 months.*6 months/);
  assert.equal(rows.find(row => row.label === '激素使用').state, 'pending');
  assert.equal(rows.find(row => row.label === '呼吸支持').state, 'unknown');
});

test('exclusion threshold and age boundary can reject, absent criteria cannot confirm', () => {
  const { rows } = buildTrialMatches(trial, { age: 9, ejectionFraction: 35, steroidStatus: 'never' });
  assert.equal(rows.find(row => row.label === '年龄').state, 'mismatch');
  assert.equal(rows.find(row => row.label === '心脏射血分数').state, 'mismatch');
  assert.equal(rows.find(row => row.label === '激素使用').state, 'mismatch');
  assert.equal(rows.find(row => row.label === '基因突变').state, 'unknown');
});

test('cohort age restrictions prevent a false age match', () => {
  const { rows } = buildTrialMatches({ minimumAge: '4 Years', eligibility: 'Inclusion Criteria:\n* Cohort 1: 4 to <7 years of age\n* Cohort 2: 7 to <12 years of age' }, { age: 8 });
  assert.equal(rows[0].state, 'pending');
  assert.match(rows[0].requirement, /队列年龄条件/);
});
