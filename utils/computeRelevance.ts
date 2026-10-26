import { Article, UserProfile, InterestArea } from '../types';

const countKeywordGroups = (textPool: string, groups: string[][]): number => {
  return groups.reduce((count, keywords) => {
    return keywords.some(kw => textPool.includes(kw.toLowerCase())) ? count + 1 : count;
  }, 0);
};

const calculateDailyRelevance = (textPool: string): { score: number; strongHit: boolean } => {
  const dailyKeywordGroups = [
    [
      'rehabilitation', 'physiotherapy', 'physical therapy', 'exercise', 'stretching',
      'mobility', 'contracture', 'gait', 'range of motion',
      '康复', '物理治疗', '训练', '拉伸', '关节挛缩', '步态', '运动', '活动能力'
    ],
    [
      'nutrition', 'diet', 'dietary', 'supplement', 'vitamin', 'calcium', 'protein',
      'weight', 'feeding', 'swallowing',
      '营养', '饮食', '膳食', '补充剂', '维生素', '钙', '蛋白', '体重', '喂养', '吞咽'
    ],
    [
      'drug', 'medication', 'medicine', 'steroid', 'corticosteroid', 'prednisone',
      'deflazacort', 'vamorolone', 'side effect', 'adverse event', 'dosage',
      '药物', '用药', '激素', '类固醇', '副作用', '不良反应', '剂量'
    ],
    [
      'quality of life', 'daily living', 'care', 'caregiver', 'sleep', 'pain',
      'fatigue', 'bladder', 'bowel', 'respiratory care', 'home care',
      '生活质量', '日常', '护理', '照护', '睡眠', '疼痛', '疲劳', '排尿', '排便', '呼吸管理', '居家'
    ]
  ];

  const matchedGroups = countKeywordGroups(textPool, dailyKeywordGroups);
  if (matchedGroups === 0) {
    return { score: 0, strongHit: false };
  }

  return {
    score: Math.min(10 + matchedGroups * 5, 25),
    strongHit: matchedGroups >= 1
  };
};

/**
 * 根据用户档案和文章日常实用性，计算文章与患者的相关性百分比（不保留小数）。
 *
 * 相关性维度：
 * 1. 兴趣领域相关 (25分)
 * 2. 基因突变相关 (20分)
 * 3. 行动能力相关 (10分)
 * 4. 激素/药物使用相关 (10分)
 * 5. 年龄阶段相关 (10分)
 * 6. 日常生活相关 (25分)
 */
export function computeRelevance(article: Article, profile: UserProfile | null | undefined): number {
  const textPool = [
    article.title,
    article.titleZh || '',
    article.abstract,
    article.abstractZh || '',
    article.aiSummary || '',
    ...(article.subTags || []),
    ...(article.tags || [])
  ].join(' ').toLowerCase();

  const dailyRelevance = calculateDailyRelevance(textPool);
  if (!profile || !profile.isConfigured) {
    return dailyRelevance.strongHit ? Math.max(dailyRelevance.score, 35) : 0;
  }

  let score = 0;

  const interestKeywords: Record<string, string[]> = {
    [InterestArea.MEDICATIONS]: [
      'drug', 'trial', 'clinical', 'therapy', 'treatment', 'phase',
      '药', '临床', '试验', '治疗', '新药', 'fda', 'ema', 'approval'
    ],
    [InterestArea.DAILY_CARE]: [
      'care', 'rehabilitation', 'physiotherapy', 'quality of life', 'exercise',
      '护理', '康复', '日常', '生活质量', '运动', '物理治疗'
    ],
    [InterestArea.HEART_LUNGS]: [
      'cardiac', 'heart', 'pulmonary', 'respiratory', 'lung', 'cardiomyopathy', 'ventilat',
      '心脏', '肺', '呼吸', '心肌'
    ],
    [InterestArea.GENE_THERAPY]: [
      'gene therapy', 'gene editing', 'crispr', 'aav', 'exon skipping', 'antisense',
      'dystrophin', 'micro-dystrophin', '基因治疗', '基因编辑', '外显子跳跃', '载体'
    ],
    [InterestArea.BASIC_SCIENCE]: [
      'mechanism', 'pathway', 'model', 'mouse', 'mdx', 'in vitro', 'cell', 'molecular',
      '机制', '通路', '模型', '小鼠', '细胞', '分子'
    ]
  };

  if (profile.interests && profile.interests.length > 0) {
    let matchedInterests = 0;
    for (const interest of profile.interests) {
      const keywords = interestKeywords[interest] || [];
      if (keywords.some(kw => textPool.includes(kw.toLowerCase()))) {
        matchedInterests++;
      }
    }
    score += Math.round((matchedInterests / Math.max(profile.interests.length, 1)) * 25);
  }

  if (profile.geneticProfile) {
    const gp = profile.geneticProfile.toLowerCase();
    const exonNumbers = gp.match(/\d+/g) || [];
    const hasExonMention = textPool.includes('exon') || textPool.includes('外显子');
    const mutationTypes = [
      'deletion', 'duplication', 'nonsense', 'point mutation', 'frameshift',
      '缺失', '重复', '无义', '点突变', '移码'
    ];
    const matchesMutationType = mutationTypes.some(mt => gp.includes(mt) && textPool.includes(mt));
    const matchesExon = exonNumbers.some(n => {
      const patterns = [`exon ${n}`, `exon${n}`, `外显子${n}`, `外显子 ${n}`, `exons ${n}`, `exon ${n}-`, `exon ${n} `];
      return patterns.some(p => textPool.includes(p));
    });

    if (matchesExon) {
      score += 20;
    } else if (matchesMutationType) {
      score += 12;
    } else if (hasExonMention) {
      score += 6;
    }
  }

  const ambulatoryKeywords: Record<string, string[]> = {
    ambulatory: ['ambulatory', 'walking', 'gait', 'ambulation', '行走', '步态', '可行走'],
    wheelchair: ['wheelchair', 'non-ambulatory', 'scoliosis', 'upper limb', '轮椅', '非行走', '脊柱侧弯', '上肢'],
    mixed: ['ambulatory', 'non-ambulatory', 'transition', 'progression', '行走', '进展']
  };
  const ambKeywords = ambulatoryKeywords[profile.ambulatoryStatus] || [];
  if (ambKeywords.some(kw => textPool.includes(kw))) {
    score += 10;
  }

  const steroidKeywords = [
    'steroid', 'corticosteroid', 'prednisone', 'deflazacort', 'vamorolone',
    '激素', '类固醇', '泼尼松', '地夫可特'
  ];
  const articleMentionsSteroids = steroidKeywords.some(kw => textPool.includes(kw));
  if (profile.onSteroids === 'yes' && articleMentionsSteroids) {
    score += 10;
  } else if (profile.onSteroids === 'no' && !articleMentionsSteroids) {
    score += 4;
  }

  const age = profile.age;
  const ageKeywords: string[] = [];
  if (age <= 5) {
    ageKeywords.push('early', 'infant', 'young', 'pediatric', 'early-stage', '早期', '幼儿', '儿童');
  } else if (age <= 12) {
    ageKeywords.push('pediatric', 'child', 'school-age', 'boys', '儿童', '学龄', '男孩');
  } else if (age <= 18) {
    ageKeywords.push('adolescent', 'teenage', 'young adult', '青少年', '青年');
  } else {
    ageKeywords.push('adult', 'older', 'long-term', '成人', '成年', '长期');
  }
  if (ageKeywords.some(kw => textPool.includes(kw))) {
    score += 10;
  }

  score += dailyRelevance.score;

  if (dailyRelevance.strongHit) {
    score = Math.max(score, 35);
  }

  return Math.min(Math.round(score), 100);
}
