const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAITrialMatches, sanitizeRows } = require('./trialAIMatching');

test('匹配使用归一化的单外显子编号，展示保留原始登记格式', async () => {
  for (const [index, geneticProfile] of ['44-44', '44 / 44', '外显子 44-44 缺失'].entries()) {
    const trial = { nctId: `NCT_EXON_NORMALIZATION_${index}`, eligibility: 'Inclusion Criteria:\nDeletion of exon 44.' };
    const profile = { mutationType: 'deletion', geneticProfile };
    const result = await buildAITrialMatches(trial, null, profile, null, async contents => {
      const prompt = contents[0].parts[0].text;
      const patient = JSON.parse(prompt.match(/患者资料：(.*)/)[1]);
      assert.equal(patient.mutation, index === 2 ? '外显子缺失；外显子 44 缺失' : '外显子缺失；44');
      assert.ok(prompt.includes('不能仅因分隔符或重复编号判为“不符合”'));
      return JSON.stringify({ rows: [{ field: 'mutation', requirement: '外显子44缺失', state: 'match', sourceQuote: 'Deletion of exon 44.' }] });
    });
    assert.equal(result.rows[1].state, 'match');
    assert.equal(result.rows[1].patient, `外显子缺失；${geneticProfile}`);
    assert.equal(profile.geneticProfile, geneticProfile);
  }
});

test('AI匹配只保留有登记原文依据的精简条件', async () => {
  const trial = {
    nctId: 'NCT00000001', title: 'DMD study', minimumAge: '7 Years', maximumAge: '16 Years',
    eligibility: 'Inclusion Criteria:\n* Able to walk independently.\n* Receiving a stable corticosteroid dose.'
  };
  const profile = { age: 10, mobilityStage: 'independent', steroidStatus: 'current' };
  const result = await buildAITrialMatches(trial, null, profile, null, async () => JSON.stringify({ rows: [
    { field: 'age', requirement: '7至16岁', state: 'match', sourceQuote: 'STRUCTURED_AGE' },
    { field: 'mobility', requirement: '能够独立行走', state: 'match', sourceQuote: 'Able to walk independently.' },
    { field: 'heart', requirement: '心功能正常', state: 'match', sourceQuote: 'LVEF ≥50%' }
  ] }));
  assert.equal(result.rows.length, 6);
  assert.deepEqual(result.rows.map(row => row.label), ['年龄', '基因突变', '身体阶段', '呼吸支持', '心脏射血分数（LVEF）', '激素使用']);
  assert.equal(result.rows[0].state, 'match');
  assert.equal(result.rows[2].patient, '独立行走');
  assert.equal(result.rows[4].state, 'unknown');
  assert.equal(result.rows[4].sourceQuote, undefined);
});

test('缺失的患者数据不能由AI判为符合，年龄超界不能由AI判为符合', () => {
  const rows = sanitizeRows([
    { field: 'age', requirement: '7至16岁', state: 'match', sourceQuote: 'STRUCTURED_AGE' },
    { field: 'heart', requirement: 'LVEF至少50%', state: 'match', sourceQuote: 'LVEF at least 50%' }
  ], 'LVEF at least 50%', '', { minimumAge: '7 Years', maximumAge: '16 Years' }, { age: 17 });
  assert.equal(rows[0].state, 'mismatch');
  assert.equal(rows[4].state, 'unknown');
});

test('按队列另设年龄条件时不能只按总年龄范围判符合', () => {
  const rows = sanitizeRows([
    { field: 'age', requirement: '总体为4至16岁，具体按队列', state: 'match', sourceQuote: 'STRUCTURED_AGE' }
  ], 'Cohort A: 4 to <7 years of age; Cohort B: 7 to <12 years of age', '',
  { minimumAge: '4 Years', maximumAge: '16 Years' }, { age: 13 });
  assert.equal(rows[0].state, 'pending');
});

test('AI接口失败时不沿用关键词规则作确定判断', async () => {
  const result = await buildAITrialMatches({
    nctId: 'NCT00000002', eligibility: 'Inclusion Criteria:\n* LVEF at least 50%'
  }, null, { ejectionFraction: 55 }, null, async () => { throw new Error('offline'); });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].state, 'unknown');
});

test('基础匹配保留真实突变和激素名称，不纳入第二层筛查或中心附加条件', async () => {
  const trial = { nctId: 'NCT00000003', eligibility: 'Receiving prednisone at a stable dose for at least 24 weeks.' };
  const profile = { mutationType: 'deletion', geneticProfile: '外显子45缺失', steroidStatus: 'current', steroidMedication: 'prednisone' };
  const registry = { locations: [
    { facility: 'A', additionalRequirements: 'Center A requires FVC at least 60%' },
    { facility: 'B', additionalRequirements: 'Center B requires FVC at least 70%' }
  ] };
  let calls = 0;
  const callAI = async contents => {
    calls++;
    const prompt = contents[0].parts[0].text;
    for (const text of ['外显子缺失；外显子45缺失', '正在使用；泼尼松', '不允许 other', '稳定使用时间', '不因此把基础匹配改为“待确认”', 'Receiving prednisone at a stable dose for at least 24 weeks.']) assert.ok(prompt.includes(text), text);
    assert.ok(!prompt.includes('Center A requires'));
    return JSON.stringify({ rows: [
      { field: 'steroid', requirement: '允许使用泼尼松', state: 'match', sourceQuote: trial.eligibility },
      { field: 'other', requirement: '稳定使用至少24周', state: 'pending', sourceQuote: trial.eligibility },
      { field: 'respiratory', requirement: 'FVC至少60%', state: 'pending', sourceQuote: 'Center A requires FVC at least 60%' }
    ] });
  };
  const first = await buildAITrialMatches(trial, registry, profile, 'A', callAI);
  const second = await buildAITrialMatches(trial, registry, profile, 'B', callAI);
  assert.equal(calls, 1);
  assert.deepEqual(first.rows, second.rows);
  assert.equal(first.rows.length, 6);
  assert.equal(first.rows[1].patient, '外显子缺失；外显子45缺失');
  assert.equal(first.rows[5].patient, '正在使用；泼尼松');
  assert.equal(first.rows[5].state, 'match');
  assert.equal(first.rows[3].sourceQuote, undefined);
  assert.equal(first.centerSpecialRequirements, 'Center A requires FVC at least 60%');
  assert.equal(second.centerSpecialRequirements, 'Center B requires FVC at least 70%');
});
