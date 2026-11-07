/**
 * 饮食记录（今日记录）数据层
 * ------------------------------------------------------------------
 * 数据源：项目根目录 foods_library(1).json（1805 条标准食物库）
 * 存储：localStorage 单键 dmd_diet_foods_v1，按日期分桶，不落后端
 * 说明：记录条目会把「每 100g 营养」快照存进去，因此「今日记录」
 *      渲染时不依赖 1.4MB 食物库是否已加载。
 * 日期：todayKey() 取系统日期（本地时区）。
 */

export interface FoodServing {
  description: string;
  weightG: number;
}

/** foods_library(1).json 单条结构（只声明用到的字段） */
export interface FoodItem {
  id: number | string;
  name: string;
  nameEn?: string;
  caloriesPer100g: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatPer100g?: number;
  fiberPer100g?: number;
  sodiumPer100g?: number;
  calciumPer100g?: number;
  scene?: string;
  sceneGroup?: string;
  sceneSubgroup?: string;
  category?: string;
  subcategory?: string;
  servings?: FoodServing[];
  isLiquid?: boolean;
}

export interface FoodNutrients {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number;
  calcium: number;
}

export interface DietLogEntry {
  /** 记录行唯一键（同一食物多次添加会合并，键保持不变） */
  key: string;
  foodId: number | string;
  name: string;
  grams: number;
  per100: FoodNutrients;
  servings: FoodServing[];
  isLiquid: boolean;
  /**
   * 当前选中的份量预设对应的克数（= 1 个该量词的重量）。
   * null / undefined 表示「自定义克数」，此时按克数直接编辑。
   */
  servingGrams?: number | null;
}

const STORAGE_KEY = 'dmd_diet_foods_v1';
const WEIGHT_KEY = 'dmd_diet_weight_v1';
const WATER_KEY = 'dmd_diet_water_v1';
const WATER_LIMIT_KEY = 'dmd_diet_water_limit_v1';

const num = (value: number | undefined | null): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** 取每 100g 营养快照 */
export const per100Of = (item: FoodItem): FoodNutrients => ({
  calories: num(item.caloriesPer100g),
  protein: num(item.proteinPer100g),
  carbs: num(item.carbsPer100g),
  fat: num(item.fatPer100g),
  fiber: num(item.fiberPer100g),
  sodium: num(item.sodiumPer100g),
  calcium: num(item.calciumPer100g),
});

/** 由食物库条目构造一条今日记录 */
export const entryFromFood = (
  item: FoodItem,
  grams: number,
  servingGrams: number | null = null
): DietLogEntry => ({
  key: `${item.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
  foodId: item.id,
  name: item.name,
  grams,
  per100: per100Of(item),
  servings: Array.isArray(item.servings) ? item.servings : [],
  isLiquid: Boolean(item.isLiquid),
  servingGrams,
});

/**
 * 加入时的默认份量：取该食物的第一个有效份量预设（数据里基本都是「100克」），
 * 这样食物库点「＋」的语义与之前一致（约 100 g），且份量框能对上预设。
 */
export const defaultPortionOf = (item: FoodItem): { grams: number; servingGrams: number | null } => {
  const first = Array.isArray(item.servings)
    ? item.servings.find((serving) => Number(serving.weightG) > 0)
    : undefined;
  if (first) {
    const grams = Math.round(first.weightG);
    return { grams, servingGrams: grams };
  }
  return { grams: 100, servingGrams: null };
};

/** 按实际克数换算营养 */
export const nutrientsOf = (entry: DietLogEntry): FoodNutrients => {
  const ratio = entry.grams / 100;
  return {
    calories: entry.per100.calories * ratio,
    protein: entry.per100.protein * ratio,
    carbs: entry.per100.carbs * ratio,
    fat: entry.per100.fat * ratio,
    fiber: entry.per100.fiber * ratio,
    sodium: entry.per100.sodium * ratio,
    calcium: entry.per100.calcium * ratio,
  };
};

export const sumNutrients = (entries: DietLogEntry[]): FoodNutrients =>
  entries.reduce<FoodNutrients>((acc, entry) => {
    const n = nutrientsOf(entry);
    return {
      calories: acc.calories + n.calories,
      protein: acc.protein + n.protein,
      carbs: acc.carbs + n.carbs,
      fat: acc.fat + n.fat,
      fiber: acc.fiber + n.fiber,
      sodium: acc.sodium + n.sodium,
      calcium: acc.calcium + n.calcium,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, calcium: 0 });

/** 「今天」的日期键（系统日期，本地时区） */
export const todayKey = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 「11 月 6 日 · 周五」形式的当前日期 */
export const formatToday = (): string => {
  const d = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`;
};

type LogStore = Record<string, DietLogEntry[]>;

/**
 * 量词识别
 * ------------------------------------------------------------------
 * 「一碗 / 一个 / 一根」这类笼统量词 → 份量按「个数 × 每份克数」编辑；
 * 「100 克 / 250 毫升 / 200g」是精确单位 → 仍按克数直接编辑。
 * 返回 null 表示精确单位（或识别不出量词）。
 */
const PRECISE_UNIT_RE = /(克|g|毫升|ml|升|l|千克|kg)\s*$/i;
const MEASURE_WORDS = [
  '碗', '个', '根', '盘', '份', '块', '杯', '条', '片', '只', '串', '把', '勺', '匙',
  '盒', '瓶', '袋', '包', '张', '颗', '粒', '棵', '枚', '听', '罐', '支', '卷', '球',
];

export const measureUnitOf = (description: string): string | null => {
  const text = (description || '').trim();
  if (!text || PRECISE_UNIT_RE.test(text)) return null;
  // 取「最先出现」的量词：量词紧跟数词（一碗红薯块 → 碗，而不是名词里的「块」）
  let best: { word: string; index: number } | null = null;
  MEASURE_WORDS.forEach((word) => {
    const index = text.indexOf(word);
    if (index >= 0 && (!best || index < best.index)) best = { word, index };
  });
  return best ? best.word : null;
};

/** 旧数据补齐 servingGrams：克数正好等于某个预设时，视为选中了该预设 */
const normalizeEntry = (entry: DietLogEntry): DietLogEntry => {
  if (entry.servingGrams !== undefined) return entry;
  const hit = (entry.servings || []).find(
    (serving) => Number(serving.weightG) > 0 && Math.round(serving.weightG) === Math.round(entry.grams)
  );
  return { ...entry, servingGrams: hit ? Math.round(hit.weightG) : null };
};

const isEntry = (value: unknown): value is DietLogEntry => {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<DietLogEntry>;
  return typeof e.key === 'string' && typeof e.name === 'string' && typeof e.grams === 'number' && Boolean(e.per100);
};

export const readLogStore = (): LogStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: LogStore = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([date, list]) => {
      if (Array.isArray(list)) out[date] = list.filter(isEntry).map(normalizeEntry);
    });
    return out;
  } catch {
    return {};
  }
};

export const readEntries = (date: string): DietLogEntry[] => readLogStore()[date] || [];

export const writeEntries = (date: string, entries: DietLogEntry[]): void => {
  try {
    const store = readLogStore();
    if (entries.length) store[date] = entries;
    else delete store[date];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 隐私模式 / 存储被禁用：退化为仅内存保存，不打断页面
  }
};

/** 合并同一食物：再次点「＋」时累加，不新增一行。选了量词预设则累加 1 个该量词 */
export const addEntry = (entries: DietLogEntry[], next: DietLogEntry): DietLogEntry[] => {
  const hit = entries.find((e) => String(e.foodId) === String(next.foodId));
  if (!hit) return [...entries, next];
  const step = hit.servingGrams && hit.servingGrams > 0 ? hit.servingGrams : next.grams;
  return entries.map((e) => (e === hit ? { ...e, grams: e.grams + step } : e));
};

/** 体重（用于蛋白/脂肪/碳水目标），单独存储，跨天保留 */
export const readWeight = (): string => {
  try {
    return localStorage.getItem(WEIGHT_KEY) || '';
  } catch {
    return '';
  }
};

export const writeWeight = (value: string): void => {
  try {
    if (value) localStorage.setItem(WEIGHT_KEY, value);
    else localStorage.removeItem(WEIGHT_KEY);
  } catch {
    // 忽略存储异常
  }
};

/**
 * 饮水记录（mL，按日期分桶）
 * ------------------------------------------------------------------
 * 食物库没有水的成分数据（饮品按毫升记录但不等于饮水量），因此单独存一个
 * 「今天喝了多少毫升」，只用于「水（液体）」进度条，与食物记录互不影响。
 */
type WaterStore = Record<string, number>;

const readWaterStore = (): WaterStore => {
  try {
    const raw = localStorage.getItem(WATER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: WaterStore = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([date, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[date] = value;
    });
    return out;
  } catch {
    return {};
  }
};

export const readWater = (date: string): number => readWaterStore()[date] || 0;

export const writeWater = (date: string, ml: number): void => {
  try {
    const store = readWaterStore();
    if (ml > 0) store[date] = Math.round(ml);
    else delete store[date];
    localStorage.setItem(WATER_KEY, JSON.stringify(store));
  } catch {
    // 忽略存储异常
  }
};

/**
 * 自定义饮水上限（mL）
 * ------------------------------------------------------------------
 * 限液属于跨天有效的医嘱（心衰 / 利尿剂 / 医生开具限液量），因此不按日期分桶，
 * 单独存一个全局键；null = 未设置，回落到按体重（Holliday–Segar）的推荐摄入目标。
 */
export const readWaterLimit = (): number | null => {
  try {
    const raw = localStorage.getItem(WATER_LIMIT_KEY);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 100 || value > 8000) return null;
    return Math.round(value);
  } catch {
    return null;
  }
};

export const writeWaterLimit = (ml: number | null): void => {
  try {
    if (ml && Number.isFinite(ml) && ml >= 100) localStorage.setItem(WATER_LIMIT_KEY, String(Math.round(ml)));
    else localStorage.removeItem(WATER_LIMIT_KEY);
  } catch {
    // 忽略存储异常
  }
};

export const round1 = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export const round0 = (value: number): string => String(Math.round(value));
