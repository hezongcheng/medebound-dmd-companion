import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ChefHat, Loader2, Plus, RefreshCw, Search, ShoppingBag, X
} from 'lucide-react';
import type { FoodItem } from '../utils/dietLog';
import foodsUrl from '../foods_library(1).json?url';

/**
 * 标准食物库（选择库）
 * ------------------------------------------------------------------
 * 版式参照「标准食物库」设计稿：顶部场景切换 / 左侧分类 / 右侧子类筛选 + 卡片列表。
 * 差异点（按需求调整）：
 *   1. 去掉食物图片，只保留名称与热量、营养素；
 *   2. 右侧心型收藏键改为「＋」添加键：点一次加入今日记录、按钮变「✓」；再点一次还原「＋」并删除该条记录；
 *   3. 左侧分类栏只用文字，不加图标/缩略图；
 *   4. 增加搜索（1805 条数据必须用），搜索时跨场景全库匹配。
 */

type SceneId = 'home_kitchen' | 'takeout';

const SCENES: { id: SceneId; label: string; icon: React.ElementType }[] = [
  { id: 'home_kitchen', label: '家庭厨房', icon: ChefHat },
  { id: 'takeout', label: '外卖快餐', icon: ShoppingBag },
];

const PAGE_SIZE = 60;

interface Bucket {
  name: string;
  items: FoodItem[];
  subs: string[];
}

/** 模块级缓存：同一会话内只拉一次 1.4MB JSON */
let foodCache: FoodItem[] | null = null;
let foodRequest: Promise<FoodItem[]> | null = null;

const loadFoods = async (): Promise<FoodItem[]> => {
  if (foodCache) return foodCache;
  if (!foodRequest) {
    foodRequest = fetch(foodsUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: FoodItem[]) => {
        foodCache = Array.isArray(data) ? data : [];
        return foodCache;
      })
      .catch((err) => {
        foodRequest = null;
        throw err;
      });
  }
  return foodRequest;
};

const subKeyOf = (item: FoodItem): string => item.sceneSubgroup || item.subcategory || '其他';

const buildIndex = (foods: FoodItem[]) => {
  const scenes: Record<SceneId, Bucket[]> = { home_kitchen: [], takeout: [] };
  const maps: Record<SceneId, Map<string, Bucket>> = {
    home_kitchen: new Map(),
    takeout: new Map(),
  };
  const subCounts = new Map<string, number>();

  foods.forEach((item) => {
    const scene: SceneId = item.scene === 'takeout' ? 'takeout' : 'home_kitchen';
    const groupName = item.sceneGroup || item.category || '其他';
    let bucket = maps[scene].get(groupName);
    if (!bucket) {
      bucket = { name: groupName, items: [], subs: [] };
      maps[scene].set(groupName, bucket);
      scenes[scene].push(bucket);
    }
    bucket.items.push(item);
    const sub = subKeyOf(item);
    if (!bucket.subs.includes(sub)) bucket.subs.push(sub);
    const countKey = `${scene}|${groupName}|${sub}`;
    subCounts.set(countKey, (subCounts.get(countKey) || 0) + 1);
  });

  // 子类按条目数从多到少排列，数量少的（如「杂豆类」）自然沉到后面，与设计稿顺序一致
  (Object.keys(scenes) as SceneId[]).forEach((scene) => {
    scenes[scene].forEach((bucket) => {
      bucket.subs.sort(
        (a, b) => (subCounts.get(`${scene}|${bucket.name}|${b}`) || 0) - (subCounts.get(`${scene}|${bucket.name}|${a}`) || 0)
      );
    });
  });

  return scenes;
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** 加入今日记录；份量取该食物的首个份量预设（数据里通常为 100 g） */
  onAdd: (item: FoodItem) => void;
  /** 从今日记录中删除该食物的全部记录（再点一次「✓」触发） */
  onRemove: (item: FoodItem) => void;
  /** foodId -> 今日已添加克数，用于「＋」键已选态 */
  addedGrams: Record<string, number>;
}

export const FoodLibrary: React.FC<Props> = ({ open, onClose, onAdd, onRemove, addedGrams }) => {
  const [foods, setFoods] = useState<FoodItem[] | null>(foodCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneId>('home_kitchen');
  const [groupName, setGroupName] = useState('');
  const [sub, setSub] = useState('全部');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [reloadToken, setReloadToken] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 打开时拉数据（首次）并锁定页面滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (foodCache) {
      setFoods(foodCache);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    loadFoods()
      .then((data) => {
        if (alive) setFoods(data);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, reloadToken]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const index = useMemo(() => (foods ? buildIndex(foods) : { home_kitchen: [], takeout: [] }), [foods]);
  const groups = index[scene];

  // 切换场景后回到第一个分类
  useEffect(() => {
    setGroupName(groups[0]?.name || '');
    setSub('全部');
    setLimit(PAGE_SIZE);
  }, [scene, foods]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeGroup = useMemo(
    () => groups.find((g) => g.name === groupName) || groups[0],
    [groups, groupName]
  );

  const keyword = query.trim().toLowerCase();

  const list = useMemo(() => {
    if (keyword) {
      return (foods || []).filter(
        (item) =>
          item.name.toLowerCase().includes(keyword) ||
          (item.nameEn || '').toLowerCase().includes(keyword)
      );
    }
    if (!activeGroup) return [];
    return sub === '全部' ? activeGroup.items : activeGroup.items.filter((i) => subKeyOf(i) === sub);
  }, [keyword, foods, activeGroup, sub]);

  // 条件变化时列表回到顶部
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setLimit(PAGE_SIZE);
  }, [keyword, groupName, sub, scene]);

  if (!open) return null;

  const addedCount = Object.keys(addedGrams).length;
  const visible = list.slice(0, limit);
  /** 同一按键切换：未加入 → 加入；已加入 → 取消并删除该记录 */
  const toggle = (item: FoodItem) => {
    if (addedGrams[String(item.id)]) onRemove(item);
    else onAdd(item);
  };
  /** 整行点击只做「加入」；已加入时不再累加，避免误触删掉已调好的克数 */
  const addOnly = (item: FoodItem) => {
    if (!addedGrams[String(item.id)]) onAdd(item);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-gray-900/40 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-[#f7f8f7] shadow-2xl sm:h-[86vh] sm:rounded-2xl">
        {/* 顶栏 */}
        <div className="flex flex-none items-center gap-1 bg-white px-2 py-2.5">
          <button
            type="button"
            aria-label="返回"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-brand-700 transition hover:bg-brand-50"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h3 className="flex-1 text-center text-base font-bold text-gray-900">标准食物库</h3>
          <div className="flex h-9 items-center justify-end pr-2 text-xs font-medium text-brand-700">
            {addedCount ? `已加 ${addedCount}` : ''}
          </div>
        </div>

        {/* 场景切换 */}
        <div className="flex-none bg-white px-3 pb-3">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
            {SCENES.map((item) => {
              const Icon = item.icon;
              const on = scene === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScene(item.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition-all ${
                    on
                      ? 'bg-white font-bold text-brand-700 shadow-sm'
                      : 'font-medium text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${on ? 'text-brand-600' : 'text-gray-400'}`} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 主体：左侧分类 + 右侧列表 */}
        <div className="flex min-h-0 flex-1">
          <aside className="w-[78px] flex-none overflow-y-auto border-r border-gray-100 bg-[#f2f4f2] sm:w-[96px]">
            {groups.map((group) => {
              const on = activeGroup?.name === group.name && !keyword;
              return (
                <button
                  key={group.name}
                  type="button"
                  onClick={() => {
                    setGroupName(group.name);
                    setSub('全部');
                    setQuery('');
                  }}
                  className={`relative flex w-full items-center justify-center px-1.5 py-4 text-center transition-colors ${
                    on ? 'bg-white' : 'hover:bg-white/60'
                  }`}
                >
                  {on && <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-brand-500" />}
                  <span
                    className={`break-all text-[12px] leading-snug ${
                      on ? 'font-bold text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {group.name}
                  </span>
                </button>
              );
            })}
            {!groups.length && !loading && !error && (
              <div className="p-2 text-center text-[11px] text-gray-400">暂无分类</div>
            )}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col bg-white">
            {/* 搜索 */}
            <div className="flex-none px-2.5 pt-2.5">
              <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
                <Search className="h-4 w-4 flex-none text-gray-400" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  type="search"
                  placeholder="搜索食物名称 / 英文名"
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                />
                {query && (
                  <button type="button" aria-label="清空搜索" onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 子类筛选 */}
            <div className="flex-none">
              {keyword ? (
                <div className="px-3 py-2 text-[11px] text-gray-500">
                  全库搜索「{query.trim()}」，命中 <span className="font-bold text-brand-700">{list.length}</span> 种
                </div>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto scrollbar-hide px-2.5 py-2">
                  {['全部', ...(activeGroup?.subs || [])].map((item) => {
                    const on = sub === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setSub(item)}
                        className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-all ${
                          on
                            ? 'border-brand-200 bg-brand-50 font-bold text-brand-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200 hover:text-brand-600'
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 食物列表 */}
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
                  正在载入食物库…
                </div>
              )}

              {error && !loading && (
                <div className="py-14 text-center">
                  <p className="text-sm text-gray-600">食物库加载失败（{error}）</p>
                  <button
                    type="button"
                    onClick={() => setReloadToken((n) => n + 1)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700"
                  >
                    <RefreshCw className="h-4 w-4" /> 重试
                  </button>
                </div>
              )}

              {!loading && !error && !visible.length && (
                <div className="py-16 text-center text-sm text-gray-500">没有匹配的食物</div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visible.map((item) => {
                  const added = addedGrams[String(item.id)] || 0;
                  return (
                    <div
                      key={String(item.id)}
                      onClick={() => addOnly(item)}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-brand-200 active:scale-[0.995]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[15px] font-bold text-gray-900">{item.name}</span>
                          {keyword && item.scene === 'takeout' && (
                            <span className="flex-none rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">外卖</span>
                          )}
                          {added > 0 && (
                            <span className="flex-none rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                              今日 {added}g
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          <span className="font-bold text-gray-800">{Math.round(item.caloriesPer100g)}</span>
                          <span className="text-gray-500"> 千卡/100g</span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-gray-400">
                          蛋白 {(item.proteinPer100g ?? 0).toFixed(1)}g
                          {typeof item.calciumPer100g === 'number' ? ` · 钙 ${Math.round(item.calciumPer100g)}mg` : ''}
                          <span className="hidden sm:inline">
                            {' '}· 碳水 {(item.carbsPer100g ?? 0).toFixed(1)} · 脂肪 {(item.fatPer100g ?? 0).toFixed(1)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={added > 0 ? `取消 ${item.name}` : `添加 ${item.name}`}
                        title={added > 0 ? '再点一次取消并删除该记录' : '加入今日记录'}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(item);
                        }}
                        className={`inline-flex h-9 w-9 flex-none items-center justify-center rounded-full border transition-all active:scale-90 ${
                          added > 0
                            ? 'border-brand-600 bg-brand-600 text-white shadow-sm hover:border-rose-500 hover:bg-rose-500'
                            : 'border-brand-200 bg-white text-brand-600 hover:bg-brand-50'
                        }`}
                      >
                        {added > 0 ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>

              {list.length > visible.length && (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                  className="mt-3 w-full rounded-lg border border-gray-200 bg-white py-2 text-xs font-medium text-gray-600 hover:border-brand-200 hover:text-brand-600"
                >
                  加载更多（剩余 {list.length - visible.length} 种）
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 底部：完成后回到今日记录 */}
        <div className="flex flex-none items-center justify-between gap-3 border-t border-gray-100 bg-white px-4 py-2.5">
          <div className="min-w-0 text-[11px] leading-tight text-gray-500">
            <div>
              今日已添加 <span className="font-bold text-brand-700">{addedCount}</span> 项，点「＋」加入，再点「✓」取消并删除
            </div>
            <div className="mt-0.5 text-gray-400">热量按每 100 g 折算，份量可在今日记录里调整</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-none rounded-lg bg-brand-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
