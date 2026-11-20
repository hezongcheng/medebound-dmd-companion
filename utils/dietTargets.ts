/**
 * 每日营养目标推算（今日记录用）
 * ------------------------------------------------------------------
 * 依据《DMD 饮食营养指标参考 v1.2》，逐项口径：
 * 1. 能量
 *    - 独立行走 / 辅助行走：Schofield 体重方程 REE = 17.7 × 体重(kg) + 657（kcal/日），
 *      来源 Elliott 2012（PMID 22497714）+ 2018 国际共识（PMID 29395989）；
 *      公式仅验证于独走期，故不乘活动系数时即为静息值，界面注明「基础（REE）」。
 *    - 其他阶段（轮椅过渡 / 依赖轮椅）：用间接测热法实测 REE 年龄段值
 *      （Shimizu-Fujiwara 2012，PMID 21632191，77 例 10–37 岁）：
 *      10–11 岁 1,123 / 12–14 岁 1,186 / 15–17 岁 1,146 / 18–29 岁 1,006 / ≥30 岁 1,023 kcal。
 *      该研究未覆盖 10 岁以下，10 岁以下无实测对照值，退回公式并标注。
 * 2. 蛋白质：不康复 1.0 g/kg、规律康复 1.5 g/kg（文档 2.1「保肌目标 ≥1.0」「高需求 1.2–1.5」取整）。
 *    BMI 超过同年龄第 85 百分位（成人取中国超重线 24）时，改用理想体重 IBW 计算——
 *    脂肪组织不产生蛋白需求，按实际体重给量会过量（文档 3.4）。
 *    IBW = 同年龄性别 BMI 第 50 百分位 × 身高(m)²。
 * 3. 脂肪上限 = 能量 × 30% ÷ 9（激素期保守上限）；碳水 = 能量 × 55% ÷ 4。
 * 4. 钙：按年龄查表，激素治疗期另有一套更高的推荐值（见 CALCIUM_BANDS）。
 *    非激素（男性）1–3 岁 600、4–8 岁 800、9–18 岁 1,100、≥19 岁 800 mg/日；
 *    激素期 1–3 岁 700、4–8 岁 1,100、9–18 岁 1,300、≥19 岁 1,100 mg/日。
 *    统计口径含补充剂：目标值不变，食物只需补足「目标 − 补充剂元素钙」。
 * 5. 钠上限 2,300 mg（超 2,000 预警）；膳食纤维按年龄：4–8 岁 25 g、9–13 岁 31 g、≥14 岁 38 g。
 * 6. 水按体重（Holliday–Segar 体重法）：1–10 kg 100 mL/kg；11–20 kg 1,000 + 50 × (kg − 10)；
 *    >20 kg 1,500 + 20 × (kg − 20)。体重未填时不外推，界面提示补体重。
 */

import type { UserProfile } from '../types';

/** 「我的档案」里与本页目标相关的字段（全部可选，缺项时退回默认口径） */
export interface DietProfile {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  mobilityStage?: UserProfile['mobilityStage'];
  ambulatoryStatus?: UserProfile['ambulatoryStatus'];
  rehabTraining?: UserProfile['rehabTraining'];
  calciumSupplement?: UserProfile['calciumSupplement'];
  calciumDoseMg?: number;
  /** 旧字段：是否在用激素 */
  onSteroids?: UserProfile['onSteroids'];
  /** 新字段：激素状态 */
  steroidStatus?: UserProfile['steroidStatus'];
}

/** 绝对目标：钠上限 2,300 mg、2,000 mg 起橙色预警 */
export const ABS_TARGETS = {
  sodium: 2300,
  sodiumWarn: 2000
};

/**
 * 钙推荐量（mg/日，男性按年龄；激素治疗期取更高一档）
 * 非激素：1–3 岁 600、4–8 岁 800、9–18 岁 1,100、≥19 岁 800
 * 激素期：1–3 岁 700、4–8 岁 1,100、9–18 岁 1,300、≥19 岁 1,100
 */
const CALCIUM_BANDS: { from: number; to: number; label: string; plain: number; steroid: number }[] = [
  { from: 1, to: 3, label: '1–3 岁', plain: 600, steroid: 700 },
  { from: 4, to: 8, label: '4–8 岁', plain: 800, steroid: 1100 },
  { from: 9, to: 18, label: '9–18 岁', plain: 1100, steroid: 1300 },
  { from: 19, to: 200, label: '≥19 岁', plain: 800, steroid: 1100 }
];

/** 膳食纤维推荐量（g/日，男性按年龄；<4 岁无参考值，取 4–8 岁档） */
const FIBER_BANDS: { from: number; to: number; label: string; value: number }[] = [
  { from: 4, to: 8, label: '4–8 岁', value: 25 },
  { from: 9, to: 13, label: '9–13 岁', value: 31 },
  { from: 14, to: 200, label: '≥14 岁', value: 38 }
];

export interface CalciumRecommendation {
  value: number;
  /** 年龄段标签，如「9–18 岁」 */
  label: string;
  /** 是否按激素治疗期取值 */
  steroid: boolean;
  /** 是否由年龄表直接命中 */
  exact: boolean;
}

/** 钙推荐量：年龄未填时按 9–18 岁档兜底（DMD 人群主体），界面标注 */
export const calciumTarget = (age?: number, onSteroid = false): CalciumRecommendation => {
  const pick = (band: (typeof CALCIUM_BANDS)[number]) => (onSteroid ? band.steroid : band.plain);
  if (age == null || !Number.isFinite(age) || age <= 0) {
    const band = CALCIUM_BANDS[2];
    return { value: pick(band), label: band.label, steroid: onSteroid, exact: false };
  }
  const band = CALCIUM_BANDS.find((row) => age >= row.from && age <= row.to) ?? CALCIUM_BANDS[0];
  return { value: pick(band), label: band.label, steroid: onSteroid, exact: true };
};

/** 膳食纤维推荐量：年龄未填时按 ≥14 岁 38 g 兜底 */
export const fiberTarget = (age?: number): { value: number; label: string; exact: boolean } => {
  if (age == null || !Number.isFinite(age) || age <= 0) {
    return { value: 38, label: '≥14 岁', exact: false };
  }
  const band = FIBER_BANDS.find((row) => age >= row.from && age <= row.to) ?? FIBER_BANDS[0];
  return { value: band.value, label: band.label, exact: true };
};

/** Schofield 体重方程 REE（独走期，kcal/日） */
export const reeFromWeight = (weightKg: number): number => 17.7 * weightKg + 657;

/** 实测 REE 年龄段参考值（间接测热法，Shimizu-Fujiwara 2012） */
const MEASURED_REE: { from: number; to: number; ree: number; label: string }[] = [
  { from: 10, to: 11, ree: 1123, label: '10–11 岁' },
  { from: 12, to: 14, ree: 1186, label: '12–14 岁' },
  { from: 15, to: 17, ree: 1146, label: '15–17 岁' },
  { from: 18, to: 29, ree: 1006, label: '18–29 岁' },
  { from: 30, to: 200, ree: 1023, label: '≥30 岁' }
];

/**
 * 男孩 BMI-for-age 第 50 / 85 百分位（WHO 2007 Growth Reference，整岁值）。
 * 用途：① 判断「BMI 超标」的年龄别阈值（第 85 百分位，文档 3.4）；
 *      ② 估算理想体重（第 50 百分位 × 身高²）。
 * 成人（≥18 岁）按中国成人标准：超重线 24，理想体重取 18 岁参考值。
 */
const BMI_REF: { age: number; p50: number; p85: number }[] = [
  { age: 5, p50: 15.3, p85: 16.4 },
  { age: 6, p50: 15.5, p85: 16.6 },
  { age: 7, p50: 15.6, p85: 17.0 },
  { age: 8, p50: 15.8, p85: 17.4 },
  { age: 9, p50: 16.0, p85: 18.1 },
  { age: 10, p50: 16.4, p85: 19.0 },
  { age: 11, p50: 16.9, p85: 20.1 },
  { age: 12, p50: 17.5, p85: 21.2 },
  { age: 13, p50: 18.2, p85: 22.3 },
  { age: 14, p50: 19.0, p85: 23.3 },
  { age: 15, p50: 19.8, p85: 24.2 },
  { age: 16, p50: 20.5, p85: 25.0 },
  { age: 17, p50: 21.1, p85: 25.6 },
  { age: 18, p50: 21.7, p85: 26.2 }
];

/** 中国成人超重线（BMI ≥ 24） */
export const ADULT_OVERWEIGHT_BMI = 24;

const bmiRefOf = (age?: number): { p50: number; p85: number } => {
  if (age == null || !Number.isFinite(age)) return { p50: 21.7, p85: ADULT_OVERWEIGHT_BMI };
  if (age >= 18) return { p50: 21.7, p85: ADULT_OVERWEIGHT_BMI };
  const hit = BMI_REF.find((row) => row.age === Math.round(age)) || BMI_REF.slice(-1)[0];
  return { p50: hit.p50, p85: hit.p85 };
};

/**
 * BMI 参考线（营养管理 → BMI 走势 / 表盘分档用）
 * 年龄未填或 ≥18 岁返回 { p50: 21.7, p85: 24 }（中国成人超重线）。
 */
export const bmiReference = (age?: number): { p50: number; p85: number } => bmiRefOf(age);

/**
 * 液体推荐量（Holliday–Segar 体重法，mL/日）
 * 1–10 kg：100 mL/kg；11–20 kg：1,000 + 50 × (kg − 10)；>20 kg：1,500 + 20 × (kg − 20)。
 * 三段在 10 kg / 20 kg 处连续（均得 1,000 / 1,500 mL），不会出现断点。
 */
export const waterFromWeight = (weightKg?: number): number | undefined => {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return undefined;
  if (weightKg <= 10) return Math.round(100 * weightKg);
  if (weightKg <= 20) return Math.round(1000 + 50 * (weightKg - 10));
  return Math.round(1500 + 20 * (weightKg - 20));
};

/** 液体推荐量 + 口径文案：体重未填时 ml = 0、exact = false（界面提示补体重） */
export const waterRecommendation = (weightKg?: number): { ml: number; label: string; exact: boolean } => {
  const ml = waterFromWeight(weightKg);
  if (ml == null || weightKg == null) {
    return { ml: 0, label: '填体重后自动计算', exact: false };
  }
  const kg = round1(weightKg);
  const label =
    weightKg <= 10
      ? `100 mL/kg × ${kg} kg`
      : weightKg <= 20
        ? `1,000 + 50 × (${kg} − 10)`
        : `1,500 + 20 × (${kg} − 20)`;
  return { ml, label, exact: true };
};

const measuredReeOf = (age?: number) =>
  age == null ? undefined : MEASURED_REE.find((row) => age >= row.from && age <= row.to);

export interface DietTargets {
  /** 是否填了有效体重 */
  hasWeight: boolean;
  /** 每日能量目标 kcal；0 表示暂不可算 */
  energy: number;
  /** 能量口径说明（展示在合计卡） */
  energyBasis: string;
  energySource: 'formula' | 'measured' | 'none';
  /** 蛋白质目标 g */
  protein: number;
  /** 采用的 g/kg */
  proteinPerKg: number;
  /** 蛋白质计算所用的体重 */
  proteinWeightKg: number;
  /** 蛋白质体重基准 */
  proteinWeightBasis: 'actual' | 'ibw';
  /** BMI 与超标阈值（有身高才有） */
  bmi?: number;
  bmiLine?: number;
  /** 理想体重 */
  ibw?: number;
  fat: number;
  carbs: number;
  /** 钙目标（按年龄 + 激素状态，含补充剂） */
  calcium: number;
  /** 钙目标对应的年龄段标签 */
  calciumLabel: string;
  /** 年龄段是否由档案年龄直接命中（false = 年龄未填，按该档兜底） */
  calciumExact: boolean;
  /** 是否按激素治疗期取值 */
  calciumSteroid: boolean;
  /** 补充剂提供的元素钙 */
  calciumSupplement: number;
  /** 食物需补足的钙 = max(0, 目标 − 补充剂) */
  calciumFoodNeed: number;
  sodium: number;
  sodiumWarn: number;
  fiber: number;
  /** 纤维目标对应的年龄段标签 */
  fiberLabel: string;
  /** 纤维年龄段是否命中（false = 年龄未填） */
  fiberExact: boolean;
  /** 液体目标 mL（Holliday–Segar 体重法；体重未填时为 0） */
  waterMl: number;
  waterBasis: string;
  /** 液体目标是否由体重算出（false = 体重未填） */
  waterExact: boolean;
}

const asPositive = (value?: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * 行走能力：独立行走 / 辅助行走 → 走公式；轮椅过渡 / 依赖轮椅 → 走实测值。
 * 档案没填身体阶段时退回旧的「独走 / 轮椅」字段。
 */
const isWalkingStage = (profile?: DietProfile | null): boolean => {
  if (!profile) return true;
  if (profile.mobilityStage) {
    return profile.mobilityStage === 'independent' || profile.mobilityStage === 'assisted';
  }
  if (profile.ambulatoryStatus === 'wheelchair') return false;
  return true;
};

export const computeDietTargets = (
  profile?: DietProfile | null,
  weightOverride?: number
): DietTargets => {
  const weightKg = asPositive(weightOverride) ?? asPositive(profile?.weightKg);
  const heightCm = asPositive(profile?.heightCm);
  const age = asPositive(profile?.age);
  const supplement = asPositive(profile?.calciumSupplement === 'yes' ? profile?.calciumDoseMg : undefined) ?? 0;
  const onSteroid = profile?.onSteroids === 'yes' || profile?.steroidStatus === 'current';
  const calciumRec = calciumTarget(age, onSteroid);
  const fiberRec = fiberTarget(age);
  const waterRec = waterRecommendation(weightKg);

  const walking = isWalkingStage(profile);
  const measured = measuredReeOf(age);

  let energy = 0;
  let energyBasis = '填体重后自动计算';
  let energySource: DietTargets['energySource'] = 'none';

  if (weightKg) {
    if (walking) {
      energy = reeFromWeight(weightKg);
      energyBasis = `公式 17.7 × ${round1(weightKg)} + 657`;
      energySource = 'formula';
    } else if (measured) {
      energy = measured.ree;
      energyBasis = `实测 REE（${measured.label}）`;
      energySource = 'measured';
    } else {
      energy = reeFromWeight(weightKg);
      energyBasis = '公式（10 岁以下无实测值）';
      energySource = 'formula';
    }
  }

  // 蛋白质：康复 1.5 / 不康复 1.0；BMI 超标改用理想体重
  const ref = bmiRefOf(age);
  const bmi = weightKg && heightCm ? weightKg / Math.pow(heightCm / 100, 2) : undefined;
  const ibw = heightCm ? ref.p50 * Math.pow(heightCm / 100, 2) : undefined;
  const overweight = bmi != null && bmi >= ref.p85;
  const proteinPerKg = profile?.rehabTraining === 'yes' ? 1.5 : 1.0;
  const proteinWeightKg = overweight && ibw ? ibw : weightKg ?? 0;

  return {
    hasWeight: Boolean(weightKg),
    energy,
    energyBasis,
    energySource,
    protein: proteinPerKg * proteinWeightKg,
    proteinPerKg,
    proteinWeightKg,
    proteinWeightBasis: overweight && ibw ? 'ibw' : 'actual',
    bmi,
    bmiLine: ref.p85,
    ibw,
    fat: energy * 0.3 / 9,
    carbs: energy * 0.55 / 4,
    calcium: calciumRec.value,
    calciumLabel: calciumRec.label,
    calciumExact: calciumRec.exact,
    calciumSteroid: calciumRec.steroid,
    calciumSupplement: supplement,
    calciumFoodNeed: Math.max(0, calciumRec.value - supplement),
    sodium: ABS_TARGETS.sodium,
    sodiumWarn: ABS_TARGETS.sodiumWarn,
    fiber: fiberRec.value,
    fiberLabel: fiberRec.label,
    fiberExact: fiberRec.exact,
    waterMl: waterRec.ml,
    waterBasis: waterRec.label,
    waterExact: waterRec.exact
  };
};

const round1 = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};
