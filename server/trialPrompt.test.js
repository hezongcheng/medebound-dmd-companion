const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTrialPrompt, extractScreeningRequirements } = require('./trialPrompt');
const { buildTrialAnalysisContext } = require('./trialAnalysisContext');

test('试验解读同时提供原始突变详情和用于比较的单外显子编号', () => {
  const prompt = buildTrialPrompt({}, { mutationType: 'deletion', geneticProfile: '外显子 44 / 44 缺失' });
  assert.ok(prompt.includes('基因突变：外显子缺失；外显子 44 / 44 缺失'));
  assert.ok(prompt.includes('用于比较的基因突变详情（相同起止编号已合并）：外显子 44 缺失'));
  assert.ok(prompt.includes('不得把缺失外显子编号直接当作可跳跃的外显子编号'));
});

test('trial prompt preserves system matches, screening thresholds, and separate safety sources', () => {
  const prompt = buildTrialPrompt({ nctId: 'NCT12345678', title: '测试试验', phase: ['PHASE3'],
    summary: '研究一种DMD干预', eligibility: 'LVEF ≥50%; Hemoglobin ≥8 g/dL', interventionNames: ['TEST'] },
  { age: 12, mutationType: 'deletion', geneticProfile: '外显子 45 缺失', ejectionFraction: undefined },
  { matchRows: [{ label: '年龄', patient: '12岁', requirement: '7–16岁', state: '符合' }],
    registry: { outcomes: { primaryOutcomes: [{ measure: '步行距离' }] }, reportedSafety: { seriousEvents: [{ term: 'Fever' }] } },
    adverseReports: [{ name: 'TEST', status: 'available', total: 3, reactions: [{ term: 'HEADACHE', count: 2 }], checkedAt: '2026-09-23T00:00:00Z' }] });
  for (const text of ['**1. 这项试验在研究什么**', '**2. 这项试验和我有什么关系**', '年龄：我的情况 12岁；试验要求 7–16岁；系统结果 符合', 'LVEF ≥50%', 'Hemoglobin ≥8 g/dL', '步行距离', 'Fever', 'HEADACHE', '现有资料不足，暂时无法判断', '不得生成百分比匹配度或总体匹配概率', '需基因确诊DMD，具体突变限制未明确', '基础条件本身没有明显冲突，但仍需进一步确认相关细分要求', '不能根据报告数量计算真实发生率', '不能自动被解释成该治疗已经产生相应毒性', '治疗组和对照组', '必须优先使用试验安全性结果', '目前没有足够资料判断这一风险对您是否特别突出']) assert.ok(prompt.includes(text), text);
  assert.equal(extractScreeningRequirements('Age 7 to 16 years; LVEF ≥50%; Hemoglobin ≥8 g/dL'), 'LVEF ≥50%\nHemoglobin ≥8 g/dL');
});

test('trial analysis context keeps registry safety and filters placebo', async () => {
  const names = [];
  const context = await buildTrialAnalysisContext({ nctId: 'NCT12345678', interventionNames: ['TEST', 'Placebo'], interventionTypes: ['DRUG', 'DRUG'] },
    [{ label: '年龄', patient: '12岁', requirement: '7–16岁', state: 'match' }], 'Center A', {
      async getEvidence() { return [{ available: true, content: { locations: [{ facility: 'Center A', additionalRequirements: '本中心额外筛查' }], reportedSafety: { seriousEvents: [] } } }]; },
      async getDrugEvents(name) { names.push(name); return { name, status: 'no_reports' }; }
    });
  assert.deepEqual(names, ['TEST']);
  assert.equal(context.matchRows[0].state, '符合');
  assert.equal(context.centerSpecialRequirements, '本中心额外筛查');
  assert.equal(context.selectedCenter, 'Center A');
});

test('未检索到外部报告仍保留完整的试验安全性资料和真实筛查数值', () => {
  const prompt = buildTrialPrompt({ minimumAge: '5 Years', eligibility: '稳定使用激素至少24周；PUL ≥20分；FVC ≥60%' }, {}, {
    registry: { reportedSafety: { description: '安全性资料'.repeat(1200), treatment: '治疗组严重事件2人，对照组0人' } },
    adverseReports: [{ name: 'TEST', status: 'no_reports', dataUpdatedAt: '2026-09-30' }]
  });
  for (const text of ['治疗组严重事件2人，对照组0人', '当前该数据源未检索到公开报告', '2026-09-30', '24周', 'PUL ≥20分', 'FVC ≥60%', '结构化最低年龄：5 Years']) assert.ok(prompt.includes(text), text);
  assert.ok(!prompt.includes('{{'));
});
