// 分词召回；通用修饰词不作为独立命中条件，避免匹配所有医学文章。
const genericTerms = new Set(['的', '了', '和', '与', '及', '有关', '关于', '最新', '新', '进展', '研究', '治疗', '疗法', '方法', '文章', '文献', '相关', '效果', '如何', '是否', 'the', 'a', 'of', 'and', 'for', 'in', 'study', 'research', 'treatment']);
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
// 通用分词器会拆散部分医学词，优先保护这些完整概念。
const medicalTerms = /外显子跳跃|外显子缺失|外显子重复|外显子|心肌病|心肌纤维化|基因治疗|杜氏肌营养不良|肌营养不良|抗肌萎缩蛋白|微型抗肌萎缩蛋白|糖皮质激素|呼吸功能|心脏功能/g;

function searchTerms(query = '') {
  const normalized = String(query).normalize('NFKC').trim().toLowerCase();
  const chunks = normalized.match(/[\p{L}\p{N}-]+/gu) || [];
  const terms = chunks.flatMap(chunk => {
    if (!/\p{Script=Han}/u.test(chunk)) return [chunk];
    const protectedTerms = chunk.match(medicalTerms) || [];
    const remaining = chunk.replace(medicalTerms, ' ');
    return [...protectedTerms, ...Array.from(segmenter.segment(remaining))
      .filter(part => part.isWordLike).map(part => part.segment)];
  }).filter(term => !genericTerms.has(term) && (!/\p{Script=Han}/u.test(term) || term.length > 1));
  // 只输入通用词时仍可搜索原词；标点不变成 SQL 通配符。
  return [...new Set(terms.length ? terms : chunks)].slice(0, 12);
}

function appendKeywordGroupsToWhere(condition, params, groups) {
  const terms = [...new Set(groups.flat())];
  if (!terms.length) return condition;
  const clause = "(title LIKE ? OR title_zh LIKE ? OR abstract LIKE ? OR abstract_zh LIKE ? OR ai_summary LIKE ? OR JSON_SEARCH(sub_tags, 'one', ?) IS NOT NULL OR JSON_SEARCH(drug_names, 'one', ?) IS NOT NULL)";
  for (const term of terms) {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(...Array(7).fill(pattern));
  }
  return condition + (condition ? ' AND (' : ' WHERE (') + terms.map(() => clause).join(' OR ') + ')';
}

module.exports = { searchTerms, appendKeywordGroupsToWhere };
