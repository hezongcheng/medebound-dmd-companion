const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEvidenceService, getEvidence } = require('./consultationEvidence');
const { buildTrialAnalysisContext } = require('./trialAnalysisContext');
const { buildArticlePrompt, ARTICLE_PROMPT_VERSION } = require('./articlePrompt');

test('trial matching and AI context share the exported evidence getter', async () => {
  assert.equal(typeof getEvidence, 'function');
  const context = await buildTrialAnalysisContext({ nctId: 'invalid', interventionNames: [], interventionTypes: [] }, [], '');
  assert.equal(context.registry, null);
  assert.deepEqual(context.matchRows, []);
});

test('article instructions use all four requested sections and evidence limits', () => {
  const prompt = buildArticlePrompt({ title: '研究标题', abstract: '摘要正文' }, {
    age: 12, mutationType: 'deletion', geneticProfile: '外显子 45-50 缺失',
    mobilityStage: 'wheelchair_dependent', respiratorySupport: 'night', ejectionFraction: 42,
    steroidStatus: 'current', steroidMedication: 'deflazacort', interests: ['心脏与肺部健康']
  });
  for (const text of ['**1.快速结论**', '**2.研究详细解读**', '**3.根据患者个性化病情，这个研究对我有何种意义**', '**4.给家庭启示**', '缺少哪项相关信息', '3—5句话', '不等于功能恢复', '蛋白质、病毒载体、细胞外囊泡', '年龄：12岁', '基因突变类型：外显子缺失', '基因突变详情：外显子 45-50 缺失', '身体阶段：轮椅依赖期', '呼吸支持情况：只需要夜间呼吸支持', '心脏射血分数（LVEF）：42%', '类皮质激素使用状态：正在使用', '当前使用的激素：地夫可特', '文章摘要：摘要正文']) assert.ok(prompt.includes(text), text);
  assert.ok(!prompt.includes('研究概要（专业版）'));
  assert.ok(ARTICLE_PROMPT_VERSION);
});

test('article prompt keeps missing clinical values explicit', () => {
  const prompt = buildArticlePrompt({ title: '标题', abstract: '摘要' }, { age: 0, ambulatoryStatus: 'wheelchair', onSteroids: 'no' });
  for (const text of ['年龄：0岁', '身体阶段：使用轮椅', '心脏射血分数（LVEF）：未填写', '类皮质激素使用状态：未使用', '当前使用的激素：不适用']) assert.ok(prompt.includes(text), text);
});

test('drug evidence selects exact drug and sends no patient data; concurrent requests reuse results', async () => {
  const calls = [];
  const { getEvidence } = createEvidenceService({ async get(url, options) {
    calls.push({ url, options });
    if (url.includes('/label')) return { data: { results: [
      { openfda: { brand_name: ['Wrong Drug'] }, indications_and_usage: ['Wrong data'] },
      { openfda: { brand_name: ['TEST'] }, indications_and_usage: ['Correct data'] }
    ] } };
    return { data: { results: [{ products: [{ brand_name: 'Test' }], submissions: [] }] } };
  } });
  const input = { brandName: 'Test', profile: 'PRIVATE PATIENT' };
  const results = await Promise.all([getEvidence('drug', input), getEvidence('drug', input)]);
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE PATIENT'));
  assert.equal(results[0][0].content.indications, 'Correct data');
  await getEvidence('drug', input); assert.equal(calls.length, 2);
});

test('trial mismatch, invalid ID and unavailable services do not fabricate evidence', async () => {
  let calls = 0;
  const service = createEvidenceService({ async get() { calls++; return { data: { protocolSection: { identificationModule: { nctId: 'NCT00000002' } } } }; } });
  assert.deepEqual(await service.getEvidence('trial', { nctId: 'bad' }), []);
  assert.equal(calls, 0);
  const result = await service.getEvidence('trial', { nctId: 'NCT00000001' });
  assert.equal(result[0].available, false);
  const failing = createEvidenceService({ async get() { throw new Error('timeout'); } });
  const failed = await failing.getEvidence('drug', { brandName: 'Test' });
  assert.equal(failed.length, 2); assert.ok(failed.every(source => !source.available));
});
