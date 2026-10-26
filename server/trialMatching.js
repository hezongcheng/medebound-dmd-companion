const labels = {
  mutation: '基因突变', mobility: '身体阶段', respiratory: '呼吸支持',
  heart: '心脏射血分数', steroid: '激素使用'
};

const patterns = {
  mutation: /exon|mutation|genetic|variant|genotype|dystrophin|外显子|突变|变异|基因/i,
  mobility: /ambulatory|ambulation|walk|wheelchair|10.meter|upper limb|\bPUL\b|行走|轮椅|步行|上肢/i,
  respiratory: /respirat|ventilat|\bFVC\b|pulmonary|呼吸|通气|肺活量|肺功能/i,
  heart: /ejection fraction|\bLVEF\b|cardiac function|射血分数|心功能/i,
  steroid: /steroid|corticosteroid|glucocorticoid|deflazacort|prednisone|prednisolone|vamorolone|激素|地夫可特|泼尼松|伐美洛龙/i
};

const stageText = { independent: '独立行走期', assisted: '辅助行走期', wheelchair_transition: '轮椅过渡期', wheelchair_dependent: '轮椅依赖期', ambulatory: '可行走', mixed: '混合状态', wheelchair: '使用轮椅' };
const respiratoryText = { none: '不需要', night: '夜间使用', day_and_night: '日夜使用', continuous: '持续使用' };
const steroidText = { current: '正在使用', stopped: '已停止', never: '从未使用', unsure: '不清楚', yes: '正在使用', no: '未使用' };

function ageInYears(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)\s*(Years?|Months?|Weeks?)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return /^month/i.test(match[2]) ? amount / 12 : /^week/i.test(match[2]) ? amount / 52 : amount;
}

function parseCriteria(criteria) {
  let kind = 'unspecified';
  const entries = [];
  for (const raw of String(criteria || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/\\([<>])/g, '$1');
    if (!line) continue;
    if (/^(inclusion criteria|inclusion|入选标准|纳入标准)\s*:?$/i.test(line)) { kind = 'inclusion'; continue; }
    if (/^(exclusion criteria|exclusion|排除标准)\s*:?$/i.test(line)) { kind = 'exclusion'; continue; }
    const text = line.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (text) entries.push({ kind, text });
  }
  return entries;
}

function patientValues(profile) {
  const steroidStatus = profile.steroidStatus || profile.onSteroids;
  return {
    mutation: profile.geneticProfile || '未登记',
    mobility: stageText[profile.mobilityStage] || stageText[profile.ambulatoryStatus] || '未登记',
    respiratory: respiratoryText[profile.respiratorySupport] || '未登记',
    heart: Number.isFinite(profile.ejectionFraction) ? `${profile.ejectionFraction}%` : '未登记',
    steroid: steroidText[steroidStatus] || '未登记'
  };
}

function describeRules(entries) {
  const selected = entries.slice(0, 4);
  const description = selected.map(entry => `${entry.kind === 'exclusion' ? '排除：' : entry.kind === 'inclusion' ? '入选：' : ''}${entry.text}`).join('；');
  return entries.length > selected.length ? `${description}；另有 ${entries.length - selected.length} 条相关条件，见入排标准` : description;
}

function compare(value, operator, threshold) {
  if (operator === '<') return value < threshold;
  if (operator === '<=') return value <= threshold;
  if (operator === '>') return value > threshold;
  return value >= threshold;
}

function numericLvefMatch(entry, value) {
  if (/cohort|队列|unless|except|如经|除非/i.test(entry.text)) return null;
  const match = entry.text.match(/(?:\bLVEF\b|left ventricular ejection fraction|左心室射血分数|心脏射血分数)[^\n]{0,90}?(less than or equal to|greater than or equal to|less than|greater than|at least|more than|<=|>=|≤|≥|<|>)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (!match) return null;
  const operators = { 'less than or equal to': '<=', 'greater than or equal to': '>=', 'less than': '<', 'greater than': '>', 'at least': '>=', 'more than': '>', '≤': '<=', '≥': '>=' };
  const operator = operators[match[1].toLowerCase()] || match[1];
  const passesRule = compare(value, operator, Number(match[2]));
  return entry.kind === 'exclusion' ? !passesRule : entry.kind === 'inclusion' ? passesRule : null;
}

function buildTrialMatches(trial, profile) {
  const entries = parseCriteria(trial.eligibility);
  const patients = patientValues(profile);
  const minimum = ageInYears(trial.minimumAge);
  const maximum = ageInYears(trial.maximumAge);
  const ageKnown = Number.isFinite(profile.age);
  const ageOutside = ageKnown && ((minimum !== null && profile.age < minimum) || (maximum !== null && profile.age > maximum));
  const ageRules = entries.filter(entry => /\b(?:age|years?|months?)\b|年龄|岁/i.test(entry.text));
  const cohortAge = ageRules.some(entry => /cohort|队列/i.test(entry.text));
  const structuredAge = minimum !== null || maximum !== null;
  const rows = [{
    label: '年龄', patient: ageKnown ? `${profile.age}岁` : '未登记',
    requirement: structuredAge ? `${trial.minimumAge || '不限'}–${trial.maximumAge || '不限'}${cohortAge ? '；另有队列年龄条件' : ''}` : ageRules.length ? describeRules(ageRules) : '登记资料未列明年龄范围',
    state: !ageKnown || (!structuredAge && !ageRules.length) ? 'unknown' : ageOutside ? 'mismatch' : !structuredAge || cohortAge ? 'pending' : 'match'
  }];

  for (const [key, label] of Object.entries(labels)) {
    const rules = entries.filter(entry => patterns[key].test(entry.text));
    const patient = patients[key];
    let state = !rules.length || patient === '未登记' || patient === '不清楚' ? 'unknown' : 'pending';
    if (key === 'heart' && rules.length === 1 && Number.isFinite(profile.ejectionFraction)) {
      const result = numericLvefMatch(rules[0], profile.ejectionFraction);
      if (result !== null) state = result ? 'match' : 'mismatch';
    }
    if (key === 'steroid' && profile.steroidStatus === 'never' &&
        rules.some(rule => rule.kind === 'inclusion' && /(?:treatment with|receiving|currently taking|正在使用|接受.*治疗)/i.test(rule.text) && patterns.steroid.test(rule.text))) {
      state = 'mismatch';
    }
    rows.push({
      label, patient,
      requirement: rules.length ? describeRules(rules) : '登记资料未列明具体要求',
      state
    });
  }

  return { rows, criteria: trial.eligibility || '', source: trial.eligibility ? 'ClinicalTrials.gov 入排标准原文' : '未取得入排标准原文' };
}

module.exports = { buildTrialMatches, parseCriteria, ageInYears };
