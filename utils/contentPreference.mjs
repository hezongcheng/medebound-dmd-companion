export const DEFAULT_CONTENT_PREFERENCE = 40;
export const CONTENT_TYPES = [
  { key: 'guideline', label: '指南/共识', position: 10 },
  { key: 'clinical', label: '人体临床数据', position: 20 },
  { key: 'case', label: '病例报告', position: 30 },
  { key: 'product', label: '药械分析', position: 40 },
  { key: 'review', label: '综述', position: 55 },
  { key: 'animal', label: '动物实验', position: 75 },
  { key: 'vitro', label: '体外实验', position: 90 }
];

export function normalizeContentPreference(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(100, value))) : DEFAULT_CONTENT_PREFERENCE;
}

// Only existing structured labels are used; ambiguous/untagged research stays neutral.
export function classifyContent(article) {
  const stage = String(article.researchStage || '').trim();
  const explicit = CONTENT_TYPES.find(type => type.label === stage || (type.key === 'guideline' && stage === '指南共识'));
  if (explicit) return explicit.key;
  const text = [...(article.tags || []), ...(article.subTags || []), article.researchStage || ''].join(' ').toLowerCase();
  if (/指南|共识|guideline|consensus/.test(text)) return 'guideline';
  if (/病例报告|个案报告|case[ _-]?reports?/.test(text)) return 'case';
  if (/人体|患者|临床试验|临床研究|临床数据|clinical[ _-]?(trial|study|data)|human|patient|phase[ _-]?[1-4iv]+|[一二三四1234ⅠⅡⅢⅣ]期/.test(text)) return 'clinical';
  if (/综述|荟萃|review|meta[ -]?analysis/.test(text)) return 'review';
  if (/动物|小鼠|大鼠|犬模型|animal|mouse|mice|murine|in[ _-]?vivo/.test(text)) return 'animal';
  if (/体外|细胞|in[ _-]?vitro|cell[ _-]?(culture|model|study)|organoid/.test(text)) return 'vitro';
  if (/药械|药物分析|器械|drug[ _-]?analysis|device/.test(text)) return 'product';
  return 'unknown';
}

export function recommendArticles(articles, preference = DEFAULT_CONTENT_PREFERENCE) {
  const p = normalizeContentPreference(preference);
  const types = [...CONTENT_TYPES, { key: 'unknown', position: 50 }];
  const queues = new Map(types.map(type => [type.key, []]));
  const seen = new Set();
  const timestamp = article => Date.parse(article.publicationDate) || 0;
  for (const article of [...articles].sort((a, b) => timestamp(b) - timestamp(a) || String(a.id).localeCompare(String(b.id)))) {
    if (seen.has(article.id)) continue;
    seen.add(article.id);
    queues.get(classifyContent(article)).push(article);
  }
  const offsets = new Map(types.map(type => [type.key, 0]));
  const credits = new Map(types.map(type => [type.key, 0]));
  const result = [];
  let basicCredit = 0;
  const isBasic = type => type.key === 'animal' || type.key === 'vitro';
  while (result.length < seen.size) {
    const index = result.length;
    // Clinical endpoint: 4:1 in the first 20, then gradually reach 40% basic at 100.
    const depth = Math.min(1, Math.max(0, (index - 20) / 80));
    const basicShare = 0.2 + 0.5 * p / 100 + 0.2 * (1 - p / 100) * depth;
    basicCredit += basicShare;
    const wantsBasic = basicCredit >= 1 - 1e-9;
    const available = types.filter(type => offsets.get(type.key) < queues.get(type.key).length);
    let candidates = available.filter(type => isBasic(type) === wantsBasic);
    if (!candidates.length) candidates = available;
    const weights = candidates.map(type => Math.exp(-Math.abs(type.position - p) / 30));
    const total = weights.reduce((sum, value) => sum + value, 0);
    candidates.forEach((type, i) => credits.set(type.key, credits.get(type.key) + weights[i] / total));
    const chosen = candidates.reduce((best, type) => credits.get(type.key) > credits.get(best.key) ? type : best);
    credits.set(chosen.key, credits.get(chosen.key) - 1);
    const offset = offsets.get(chosen.key);
    result.push(queues.get(chosen.key)[offset]);
    offsets.set(chosen.key, offset + 1);
    // Do not accumulate debt when a group runs out.
    basicCredit = candidates.some(isBasic) === wantsBasic
      ? basicCredit - (wantsBasic ? 1 : 0) : 0;
  }
  return result;
}
