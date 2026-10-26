const IMPORT_BATCH_SIZE = 40;
const PREFERRED_QUOTA = 32;

// Search hints select candidates; the actual research stage is still determined from content.
const publicationTypes = ['Clinical Trial', 'Randomized Controlled Trial', 'Observational Study', 'Review', 'Systematic Review', 'Meta-Analysis', 'Guideline', 'Practice Guideline', 'Consensus Development Conference', 'Case Reports'];
const clinicalTerms = ['patients', 'cohort', 'clinical outcomes', 'natural history', 'real-world', 'case report', 'case series', 'consensus'];
const regulatoryTerms = ['regulatory approval', 'drug approval', 'benefit-risk', 'cost-effectiveness', 'health technology assessment', 'medical device'];

const PUBMED_PREFERRED_FILTER = `(${[
  ...publicationTypes.map(type => `"${type}"[Publication Type]`),
  `((${clinicalTerms.map(term => `"${term}"[Title/Abstract]`).join(' OR ')}) NOT ("Animals"[MeSH Terms] NOT "Humans"[MeSH Terms]))`,
  ...regulatoryTerms.map(term => `"${term}"[Title/Abstract]`)
].join(' OR ')})`;
const EUROPE_PMC_PREFERRED_FILTER = `(${[
  ...publicationTypes.map(type => `PUB_TYPE:"${type}"`),
  ...clinicalTerms.concat(regulatoryTerms).map(term => `TITLE_ABS:"${term}"`)
].join(' OR ')})`;

function selectArticleCandidates(preferred, general, key = item => item) {
  const unique = items => [...new Map(items.map(item => [key(item), item])).values()];
  const priority = unique(preferred);
  const preferredKeys = new Set(priority.map(key));
  const other = unique(general).filter(item => !preferredKeys.has(key(item)));
  // Reserve some room for early research, then fill unused slots from either pool.
  return [...priority.slice(0, PREFERRED_QUOTA), ...other.slice(0, IMPORT_BATCH_SIZE - PREFERRED_QUOTA),
    ...priority.slice(PREFERRED_QUOTA), ...other.slice(IMPORT_BATCH_SIZE - PREFERRED_QUOTA)]
    .slice(0, IMPORT_BATCH_SIZE);
}

module.exports = { IMPORT_BATCH_SIZE, PUBMED_PREFERRED_FILTER, EUROPE_PMC_PREFERRED_FILTER, selectArticleCandidates };
