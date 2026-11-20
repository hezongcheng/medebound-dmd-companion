/**
 * 营养管理（趋势看板）数据层
 * ------------------------------------------------------------------
 * 本文件只服务「饮食 → 营养管理」这一个页签，两个数据来源互相独立：
 *
 * 1. 身体测量历史（身高 / 体重 / BMI 走势）
 *    - 数据来自「我的档案」：用户每次保存档案若身高或体重有变化，就追加一条带时间戳
 *      的快照（同一天多次保存只保留最后一条），走势图的横轴即这些保存时间。
 *    - 时间戳即真实保存时间（Date.now()）。
 *    - 读取时丢弃「晚于当前时刻」的快照：早期测试时钟写入的未来日期点位不会被画出来
 *      （存量数据由 utils/storageCleanup.ts 一次性清掉）。
 *
 * 2. 近一周营养（蛋白质 / 碳水 / 脂肪 / 钠 / 钙 / 纤维 / 饮水）
 *    - 只读「今日记录」已落盘的 localStorage（dmd_diet_foods_v1 / dmd_diet_water_v1）；
 *    - 某天没有记录就是空值（柱子为 0），不做任何填充或估算。
 *
 * 日期一律取系统日期（本地时区），不存在任何可切换的时间轴。
 */

import { readLogStore, readWater, sumNutrients } from './dietLog';
import { bmiReference, computeDietTargets } from './dietTargets';
import type { DietProfile, DietTargets } from './dietTargets';

/* ============================ 日期工具 ============================ */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD'（本地时区，与 dietLog 的 todayKey 同格式） */
export const dateKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** '11/3' 形式（图表横轴） */
export const shortDate = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}`;

/** '11 月 3 日 · 周二' 形式（文案） */
export const longDate = (d: Date): string => {
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`;
};

const positive = (value?: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const round1v = (value: number): number => Math.round(value * 10) / 10;

/* ======================= 身体测量历史（档案） ======================= */

const BODY_KEY = 'dmd_body_metrics_v1';
/** 最多保留的快照条数（足够画一整年每月一次的随访） */
const BODY_MAX = 120;

export interface BodySnapshot {
  /** 记录时间戳（ms），即用户保存「我的档案」的时间 */
  at: number;
  heightCm?: number;
  weightKg?: number;
}

const readBodyStore = (): BodySnapshot[] => {
  try {
    const raw = localStorage.getItem(BODY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((row) => row && typeof row.at === 'number')
      // 硬防御：丢弃「未来时间戳」的快照。正常使用不会出现（保存时间只能是过去/现在），
      // 但历史测试数据里存在，若放行会把走势图的横轴拉到今天之后。
      .filter((row) => (row as BodySnapshot).at <= now)
      .map((row) => ({
        at: row.at as number,
        heightCm: positive(row.heightCm as number),
        weightKg: positive(row.weightKg as number)
      }))
      .filter((row) => row.heightCm != null || row.weightKg != null)
      .sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
};

const writeBodyStore = (rows: BodySnapshot[]): void => {
  try {
    localStorage.setItem(BODY_KEY, JSON.stringify(rows.slice(-BODY_MAX)));
  } catch {
    // 忽略存储异常
  }
};

export const readBodyHistory = (): BodySnapshot[] => readBodyStore();

/**
 * 保存「我的档案」时调用：身高或体重有变化才追加一条。
 * 同一天内多次修改只保留最后一条（避免一天堆出十几个点把走势挤在一起）。
 * 时间戳即真实保存时间。
 */
export const recordBodyMetric = (profile?: DietProfile | null): void => {
  const heightCm = positive(profile?.heightCm);
  const weightKg = positive(profile?.weightKg);
  if (heightCm == null && weightKg == null) return;

  const rows = readBodyStore();
  const last = rows[rows.length - 1];
  if (last && last.heightCm === heightCm && last.weightKg === weightKg) return;

  const at = Date.now();
  const dayKey = dateKeyOf(new Date(at));
  const kept = rows.filter((row) => dateKeyOf(new Date(row.at)) !== dayKey);
  kept.push({ at, heightCm, weightKg });
  writeBodyStore(kept);
};

/** 老用户第一次打开本模块：把当前档案补成走势的第一个点 */
export const ensureBodySeed = (profile?: DietProfile | null): void => {
  if (readBodyStore().length) return;
  recordBodyMetric(profile);
};

/* ============================== BMI ============================== */

export const bmiOf = (weightKg?: number, heightCm?: number): number | undefined => {
  const w = positive(weightKg);
  const h = positive(heightCm);
  if (w == null || h == null) return undefined;
  return w / Math.pow(h / 100, 2);
};

export type BmiBandKey = 'thin' | 'healthy' | 'over' | 'obese';

export const BMI_BANDS: Record<BmiBandKey, { label: string; color: string; text: string }> = {
  thin: { label: '偏瘦', color: '#0ea5e9', text: 'text-sky-600' },
  healthy: { label: '健康', color: '#10b981', text: 'text-emerald-600' },
  over: { label: '超重', color: '#f59e0b', text: 'text-amber-600' },
  obese: { label: '肥胖', color: '#ef4444', text: 'text-rose-600' }
};

export interface BmiBands {
  /** 表盘量程下限 / 上限 */
  min: number;
  max: number;
  /** 偏瘦 / 健康 的分界 */
  thin: number;
  /** 同年龄第 50 百分位（成人 21.7，仅作参考线） */
  median: number;
  /** 健康 / 超重 的分界 = 同年龄第 85 百分位（成人取中国超重线 24） */
  normal: number;
  /** 超重 / 肥胖 的分界 */
  over: number;
}

/**
 * BMI 分档阈值
 * - 成人（≥18 岁）：中国标准 18.5 / 24 / 28；
 * - 儿童青少年：健康上限取同年龄第 85 百分位（WHO 2007，与蛋白质口径一致），
 *   偏瘦线取第 50 百分位 −1.5，肥胖线取第 85 百分位 +2.5（近似第 95 百分位）。
 */
export const bmiBands = (age?: number): BmiBands => {
  const ref = bmiReference(age);
  const isChild = age != null && Number.isFinite(age) && age < 18;
  const thin = isChild ? round1v(ref.p50 - 1.5) : 18.5;
  const normal = isChild ? round1v(ref.p85) : 24;
  const over = isChild ? round1v(ref.p85 + 2.5) : 28;
  return {
    min: Math.max(10, Math.floor(thin - 5)),
    max: Math.ceil(over + 5),
    thin,
    median: round1v(ref.p50),
    normal,
    over
  };
};

export const bmiBandOf = (bmi: number, bands: BmiBands): BmiBandKey => {
  if (bmi < bands.thin) return 'thin';
  if (bmi < bands.normal) return 'healthy';
  if (bmi < bands.over) return 'over';
  return 'obese';
};

/* ========================== 近一周营养 ========================== */

export interface DaySeries {
  dateStr: string;
  /** 'M/D'，长图横轴 */
  label: string;
  /** 'D'，小图横轴 */
  short: string;
  /** 距今天的天数（0 = 今天，-6 = 六天前） */
  dayIndex: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sodium: number;
  calcium: number;
  fiber: number;
  water: number;
  /** 该日是否已有「今日记录」的真实数据 */
  hasRecord: boolean;
}

const emptyDay = (date: Date, dayIndex: number): DaySeries => ({
  dateStr: dateKeyOf(date),
  label: shortDate(date),
  short: String(date.getDate()),
  dayIndex,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  sodium: 0,
  calcium: 0,
  fiber: 0,
  water: 0,
  hasRecord: false
});

/**
 * 近 N 天营养序列（默认 7 天，含今天）
 * 只取「今日记录」的真实条目，没有记录的那天各项为 0。
 */
export const buildWeekSeries = (days = 7, today: Date = new Date()): DaySeries[] => {
  const store = readLogStore();
  const out: DaySeries[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const dateStr = dateKeyOf(date);
    const entries = store[dateStr] || [];

    if (entries.length) {
      const sum = sumNutrients(entries);
      out.push({
        ...emptyDay(date, -offset),
        calories: Math.round(sum.calories),
        protein: round1v(sum.protein),
        carbs: round1v(sum.carbs),
        fat: round1v(sum.fat),
        sodium: Math.round(sum.sodium),
        calcium: Math.round(sum.calcium),
        fiber: round1v(sum.fiber),
        water: readWater(dateStr),
        hasRecord: true
      });
      continue;
    }

    out.push(emptyDay(date, -offset));
  }
  return out;
};

/* ======================= 身高 / 体重 / BMI 走势 ======================= */

export interface TrendPoint {
  /** 横轴排序用时间戳 */
  t: number;
  label: string;
  height?: number;
  weight?: number;
  bmi?: number;
}

export interface BodyTrend {
  points: TrendPoint[];
  /** 最近一次（档案当前值）的身高 / 体重 / BMI */
  latest?: { height?: number; weight?: number; bmi?: number; at: number };
}

/**
 * 身高 / 体重 / BMI 走势
 * 真实点：每次保存「我的档案」记一条（recordBodyMetric），横轴为保存时间。
 */
export const buildBodyTrend = (profile?: DietProfile | null): BodyTrend => {
  const points: TrendPoint[] = [];
  const heightNow = positive(profile?.heightCm);
  const weightNow = positive(profile?.weightKg);

  readBodyHistory().forEach((row) => {
    const date = new Date(row.at);
    points.push({
      t: row.at,
      label: shortDate(date),
      height: row.heightCm,
      weight: row.weightKg,
      bmi: bmiOf(row.weightKg, row.heightCm)
    });
  });

  const sorted = points.sort((a, b) => a.t - b.t);
  const last = sorted[sorted.length - 1];

  // 档案里的当前值永远是最新真值，用它作为右上角的「当前值」
  const latest =
    heightNow != null || weightNow != null
      ? {
          height: heightNow,
          weight: weightNow,
          bmi: bmiOf(weightNow, heightNow),
          at: last?.t ?? Date.now()
        }
      : last
        ? { height: last.height, weight: last.weight, bmi: last.bmi, at: last.t }
        : undefined;

  return { points: sorted, latest };
};

/* ============================ 汇总导出 ============================ */

export interface NutritionTrendBundle {
  week: DaySeries[];
  trend: BodyTrend;
  targets: DietTargets;
  bands: BmiBands;
}

export const buildNutritionTrends = (
  profile: DietProfile | null | undefined
): NutritionTrendBundle => {
  const weightKg = positive(profile?.weightKg);
  return {
    week: buildWeekSeries(),
    trend: buildBodyTrend(profile),
    targets: computeDietTargets(profile, weightKg),
    bands: bmiBands(profile?.age)
  };
};
