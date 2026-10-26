// Normalize only simple exon descriptions; leave HGVS variants and distinct ranges intact.
function normalizeTrialMutation(value) {
  const text = String(value || '');
  const match = text.match(/^(\s*(?:(?:外显子|exons?)\s*)?)(\d{1,2})\s*[-–—－/／]\s*(\d{1,2})(\s*(?:号)?\s*(?:缺失|重复|突变|变异|deletion|duplication)?\s*)$/i);
  if (!match || Number(match[2]) !== Number(match[3]) || Number(match[2]) < 1 || Number(match[2]) > 79) return text;
  return `${match[1]}${Number(match[2])}${match[4]}`;
}

module.exports = { normalizeTrialMutation };
