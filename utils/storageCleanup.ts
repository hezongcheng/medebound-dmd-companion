/**
 * 本地存储的一次性清理（测试残留）
 * ------------------------------------------------------------------
 * 背景：早前为验证「随时间推进」的走势，曾引入过一次「10 秒 = 1 天」的测试时钟
 * （已整体移除）。那段时间写入 localStorage 的数据留下了两类残留：
 *
 * 1. 身体测量快照（dmd_body_metrics_v1）里带有**未来日期**的条目
 *    —— 走势图横轴会跑到今天之后（如今天 11/7，图上却出现 11/15、11/20 的点）；
 * 2. 食物 / 饮水（dmd_diet_foods_v1 / dmd_diet_water_v1）里带有**未来日期**的分桶
 *    —— 当前 7 天窗口看不到，但日期走到那天就会「凭空冒出」记录。
 *
 * 处理原则：只删除「晚于今天」的数据，真实历史一条不动。
 * 正常使用不会产生未来日期的记录，因此这段清理对线上行为无副作用，
 * 也不会误删用户当天及以前的数据。
 *
 * 同时清掉两个已无任何代码读取的旧键（dmd_sim_mode_v1 / dmd_nutrition_clock_v1）。
 */

export interface PurgeResult {
  /** 删掉的未来身体测量快照条数 */
  bodyRemoved: number;
  /** 删掉的食物日期桶（'YYYY-MM-DD'） */
  dietDays: string[];
  /** 删掉的饮水日期桶 */
  waterDays: string[];
  /** 删掉的旧测试键 */
  legacyKeys: string[];
}

const BODY_KEY = 'dmd_body_metrics_v1';
const FOOD_KEY = 'dmd_diet_foods_v1';
const WATER_KEY = 'dmd_diet_water_v1';
/** 测试时钟遗留的死键：现已无任何模块读写 */
const LEGACY_KEYS = ['dmd_sim_mode_v1', 'dmd_nutrition_clock_v1'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

const dateKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const parseJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * 清理测试残留。幂等：没有残留时不写存储，重复调用无副作用。
 * 建议在整个 SPA 生命周期里只调一次（见 DietSection 的 useEffect）。
 */
export const purgeTestResidue = (now: number = Date.now()): PurgeResult => {
  const result: PurgeResult = { bodyRemoved: 0, dietDays: [], waterDays: [], legacyKeys: [] };
  if (typeof window === 'undefined') return result;

  try {
    // 1. 身体测量快照：丢掉 at 晚于当前时刻的条目
    const body = parseJson(BODY_KEY);
    if (Array.isArray(body)) {
      const kept = body.filter(
        (row) => row && typeof (row as { at?: unknown }).at === 'number' && (row as { at: number }).at <= now
      );
      if (kept.length !== body.length) {
        result.bodyRemoved = body.length - kept.length;
        localStorage.setItem(BODY_KEY, JSON.stringify(kept));
      }
    }
  } catch {
    // 存储不可用（隐私模式）：忽略
  }

  // 2. 食物 / 饮水：丢掉晚于今天的日期桶（键都是 'YYYY-MM-DD'，字符串比较即可）
  const todayKey = dateKeyOf(new Date(now));
  const dropFutureDays = (key: string, bucket: 'dietDays' | 'waterDays'): void => {
    try {
      const store = parseJson(key);
      if (!store || typeof store !== 'object' || Array.isArray(store)) return;
      const entries = Object.entries(store as Record<string, unknown>);
      const kept = entries.filter(([date]) => date <= todayKey);
      const dropped = entries.filter(([date]) => date > todayKey).map(([date]) => date);
      if (!dropped.length) return;
      result[bucket] = dropped.sort();
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      // 忽略存储异常
    }
  };
  dropFutureDays(FOOD_KEY, 'dietDays');
  dropFutureDays(WATER_KEY, 'waterDays');

  // 3. 旧测试时钟的死键
  try {
    LEGACY_KEYS.forEach((key) => {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        result.legacyKeys.push(key);
      }
    });
  } catch {
    // 忽略存储异常
  }

  const touched =
    result.bodyRemoved > 0 ||
    result.dietDays.length > 0 ||
    result.waterDays.length > 0 ||
    result.legacyKeys.length > 0;
  if (touched) {
    // 仅在确实清掉东西时留一条痕迹，方便排查；不弹 UI，避免打扰
    console.info('[storage] 已清理测试残留', result);
  }

  return result;
};
