const { pool } = require('./db');

let aliasCache = null;
let aliasCacheExpires = 0;

const keyOf = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en');
const unsafeAliasPairs = new Set(['prednisone|prednisolone', 'prednisone|泼尼松龙']);
const genericNames = new Set(['placebo', 'drug', 'medicine', 'steroid', 'steroids', 'glucocorticoid', 'glucocorticoids',
  'corticosteroid', 'corticosteroids', 'gene therapy', 'cell therapy', 'aav', 'dmd', '安慰剂', '药物', '激素', '基因治疗', '细胞治疗']);
const isUnsafeAlias = row => unsafeAliasPairs.has(`${keyOf(row.canonical_name)}|${keyOf(row.alias_name)}`);

function containsName(text, name) {
  const source = keyOf(text);
  const needle = keyOf(name);
  if (!needle || needle.length < 3) return false;
  if (/^[a-z0-9\s-]+$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(source);
  }
  return source.includes(needle);
}

async function getDrugAliases() {
  if (aliasCache && aliasCacheExpires > Date.now()) return aliasCache;
  try {
    const [rows] = await pool.execute('SELECT canonical_name, alias_name FROM dmd_drug_aliases');
    aliasCache = rows.filter(row => row.canonical_name && row.alias_name && !isUnsafeAlias(row));
    aliasCacheExpires = Date.now() + 5 * 60 * 1000;
  } catch (error) {
    console.warn('加载药物别名失败:', error.message);
    aliasCache = [];
    aliasCacheExpires = Date.now() + 60 * 1000;
  }
  return aliasCache;
}

function normalizeDrugNames(extracted, sourceText, aliases = []) {
  const source = String(sourceText || '');
  const map = new Map();
  for (const { canonical_name, alias_name } of aliases) {
    if (isUnsafeAlias({ canonical_name, alias_name })) continue;
    const aliasKey = keyOf(alias_name);
    if (!aliasKey) continue;
    if (!map.has(aliasKey)) map.set(aliasKey, new Set());
    map.get(aliasKey).add(String(canonical_name).trim());
  }

  // 已维护的别名可补回 AI 漏提的药名；有歧义的别名不能单独决定具体药物。
  const candidates = Array.isArray(extracted) ? extracted.slice(0, 20) : [];
  for (const [alias, canonicals] of map) {
    if (canonicals.size === 1 && containsName(source, alias)) candidates.push(alias);
  }

  const names = [];
  const seen = new Set();
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const name = raw.normalize('NFKC').trim();
    if (name.length < 3 || name.length > 120 || genericNames.has(keyOf(name)) || /[\r\n,，;；]/.test(name)) continue;
    const canonicals = map.get(keyOf(name));
    if (canonicals?.size > 1) continue;
    let canonical = name;
    if (canonicals?.size === 1) {
      canonical = [...canonicals][0];
      const evidence = aliases.some(row => !isUnsafeAlias(row) && row.canonical_name === canonical &&
        map.get(keyOf(row.alias_name))?.size === 1 && containsName(source, row.alias_name));
      if (!evidence) continue;
    } else if (!containsName(source, name)) {
      continue;
    }
    const key = keyOf(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(canonical);
    if (names.length >= 20) break;
  }
  return names;
}

async function articleDrugNames(extracted, title, abstract) {
  const aliases = await getDrugAliases();
  return normalizeDrugNames(extracted, `${title || ''}\n${abstract || ''}`, aliases);
}

module.exports = { articleDrugNames, normalizeDrugNames, containsName, isUnsafeAlias };
