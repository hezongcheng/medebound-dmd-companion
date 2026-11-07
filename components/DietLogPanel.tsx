import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ChevronRight, Minus, Plus, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { FoodLibrary } from './FoodLibrary';
import {
  addEntry, defaultPortionOf, entryFromFood, formatToday, measureUnitOf, nutrientsOf, readEntries,
  readWater, readWaterLimit, readWeight, round0, round1, sumNutrients, todayKey, writeEntries, writeWater,
  writeWaterLimit
} from '../utils/dietLog';
import type { DietLogEntry, FoodItem, FoodServing } from '../utils/dietLog';
import { computeDietTargets } from '../utils/dietTargets';
import type { DietProfile } from '../utils/dietTargets';

/**
 * 今日记录面板
 * ------------------------------------------------------------------
 * 1. 「添加食物」打开标准食物库（FoodLibrary），「＋」把食物加入今日清单；
 *    已加入的食物再点一次「✓」→ 按钮还原「＋」且删除该食物记录；
 * 2. 清单行份量：精确单位（克/毫升）直接改克数；笼统量词（碗/个/根…）改为
 *    「个数」编辑，0.5 起、步长 0.5，旁边显示折算克数；
 * 3. 合计卡（图 2 样式）：
 *    - 热量：大字「摄入」+ 粗进度条 + 「摄入 / 目标」；
 *    - 营养素：3 列格位，每格「摄入 / 目标」+ 彩色条 + 百分比，6 项（蛋白 / 碳水 / 脂肪 /
 *      钙 / 钠 / 膳食纤维）；口径小字统一收进标题右侧的「>」展开面板；
 *    - 水：大字「摄入 / 上限」+「记一笔饮水」+ 禁（⊘）+ 刻度杯；「记一笔饮水」弹层放
 *      玻璃杯(250) / 矿泉水瓶(500) / 保温杯(400) 三个容器，拖液面到实际喝的高度（实时显示 mL，
 *      步进 25 mL），点「加入」才计入；禁（⊘）弹层设自定义上限（限液医嘱，跨天保留），
 *      超过上限时杯内百分比与数值转红；
 * 4. 目标口径见 utils/dietTargets.ts：
 *    - 热量：独立/辅助行走用 REE = 17.7 × 体重 + 657；轮椅阶段用实测 REE 年龄段值；
 *    - 蛋白：不康复 1.0 g/kg、规律康复 1.5 g/kg，BMI 超标改用理想体重；
 *    - 钙按年龄 + 激素状态取推荐值（含补充剂，食物补差额）、钠 ≤2,300（超 2,000 转橙）、
 *      纤维按年龄 25 / 31 / 38 g、水按体重（Holliday–Segar：1–10 kg 100 mL/kg；
 *      11–20 kg 1,000 + 50 × (kg − 10)；>20 kg 1,500 + 20 × (kg − 20)）；
 * 5. 记录只落 localStorage（食物 dmd_diet_foods_v1、饮水 dmd_diet_water_v1、饮水上限
 *    dmd_diet_water_limit_v1 全局键），不调后端；
 *    体重统一取自「我的档案」，不再在此处单独填写。
 */

const GRAM_STEP = 25;
const UNIT_STEP = 0.5;
const UNIT_MIN = 0.5;

interface NutrientTileProps {
  label: string;
  value: number;
  target: number;
  unit: string;
  /** 常态条色（上限型指标在预警 / 超标时会被覆盖） */
  color: string;
  /** 小数位，0 或 1 */
  digits?: 0 | 1;
  /** 上限型指标（钠、脂肪）：超标标红 */
  limit?: boolean;
  /** 预警阈值（钠：>2,000 mg 先转橙，>上限才转红） */
  warnOver?: number;
}

/** 营养素格：标签 + 「摄入 / 目标」 + 彩色条 + 百分比（图 2 样式） */
const NutrientTile: React.FC<NutrientTileProps> = ({
  label, value, target, unit, color, digits = 0, limit, warnOver
}) => {
  const ready = target > 0;
  const pct = ready ? (value / target) * 100 : 0;
  const over = limit && pct > 100;
  const warn = !over && typeof warnOver === 'number' && value > warnOver;
  const barColor = over ? '#e11d48' : warn ? '#f59e0b' : color;
  const shown = digits ? round1(value) : Math.round(value).toLocaleString();
  const goal = ready ? Math.round(target).toLocaleString() : '—';
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] leading-tight text-gray-500">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1 tabular-nums">
        <span
          className={`text-base font-bold leading-none ${
            over ? 'text-rose-600' : warn ? 'text-amber-600' : ready ? 'text-gray-900' : 'text-gray-400'
          }`}
        >
          {shown}
        </span>
        {ready ? (
          <span className="whitespace-nowrap text-[11px] leading-none text-gray-400">
            /{goal}
            <span className="ml-0.5 text-[10px]">{unit}</span>
          </span>
        ) : (
          <span className="text-[11px] leading-none text-gray-400">{unit}</span>
        )}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: barColor }}
        />
      </div>
      <div className={`mt-1 text-[10px] leading-none tabular-nums ${over ? 'text-rose-500' : 'text-gray-400'}`}>
        {ready ? `${Math.round(pct)}%` : '待填体重'}
      </div>
    </div>
  );
};

const CYL_TOP = 12;
const CYL_BOTTOM = 120;

/** 饮水刻度杯：液面按摄入比例上升，杯内含百分比胶囊（超上限转红） */
const WaterCylinder: React.FC<{ pct: number }> = ({ pct }) => {
  const over = pct > 100;
  const clamped = Math.max(0, Math.min(100, pct));
  const surface = CYL_BOTTOM - (clamped / 100) * (CYL_BOTTOM - CYL_TOP);
  return (
    <svg viewBox="0 0 64 130" className="h-[112px] w-[54px] flex-none" role="img" aria-label={`饮水进度 ${Math.round(pct)}%`}>
      <defs>
        <clipPath id="dmd-water-clip">
          <rect x="11" y="12" width="42" height="108" rx="14" />
        </clipPath>
      </defs>
      <rect
        x="11"
        y="12"
        width="42"
        height="108"
        rx="14"
        fill={over ? '#fff1f2' : '#f8fafc'}
        stroke={over ? '#fda4af' : '#e2e8f0'}
        strokeWidth="1.5"
      />
      <g clipPath="url(#dmd-water-clip)">
        <rect x="11" y={surface} width="42" height={Math.max(0, 126 - surface)} fill={over ? '#fda4af' : '#7dd3fc'} />
        {clamped > 1 && (
          <ellipse cx="32" cy={surface} rx="21" ry="3.5" fill={over ? '#fb7185' : '#38bdf8'} opacity="0.5" />
        )}
      </g>
      <ellipse cx="32" cy="13" rx="21" ry="4.5" fill="#ffffff" stroke={over ? '#fda4af' : '#e2e8f0'} strokeWidth="1.5" />
      {[0.15, 0.3, 0.45, 0.6, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1="14"
          x2="22"
          y1={CYL_TOP + ratio * (CYL_BOTTOM - CYL_TOP)}
          y2={CYL_TOP + ratio * (CYL_BOTTOM - CYL_TOP)}
          stroke="#cbd5e1"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
      <rect x="15" y="92" width="34" height="17" rx="8.5" fill={over ? '#ffe4e6' : '#e0f2fe'} opacity="0.94" />
      <text x="32" y="104" textAnchor="middle" fontSize="10" fontWeight="700" fill={over ? '#e11d48' : '#0284c7'}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
};

type VesselKind = 'glass' | 'bottle' | 'thermos';

interface VesselSpec {
  kind: VesselKind;
  /** 容器名 */
  name: string;
  /** 满容量 mL */
  capacity: number;
  /** 液体区间上沿（viewBox 0 0 64 140 的 y 坐标） */
  top: number;
  /** 液体区间下沿 */
  bottom: number;
  /** 外轮廓路径：既作液体裁剪区，又作描边轮廓 */
  shape: string;
}

/** 三种常见容器：玻璃杯 250 / 矿泉水瓶 500 / 保温杯 400（满容量） */
const VESSELS: VesselSpec[] = [
  {
    kind: 'glass',
    name: '玻璃杯',
    capacity: 250,
    top: 24,
    bottom: 126,
    shape: 'M12 22 L52 22 L47 126 Q47 129 42 129 L22 129 Q17 129 17 126 Z'
  },
  {
    kind: 'bottle',
    name: '矿泉水瓶',
    capacity: 500,
    top: 46,
    bottom: 127,
    shape: 'M27 14 L37 14 L37 24 Q37 34 46 44 L48 116 Q48 128 36 128 L28 128 Q16 128 16 116 L18 44 Q27 34 27 24 Z'
  },
  {
    kind: 'thermos',
    name: '保温杯',
    capacity: 400,
    top: 40,
    bottom: 126,
    shape: 'M16 34 L48 34 L46 120 Q46 128 38 128 L26 128 Q18 128 18 120 Z'
  }
];

/** 拖动步进 25 mL：玻璃杯 10 档、矿泉水瓶 20 档、保温杯 16 档，数字不会出现 137 这类零头 */
const WATER_STEP = 25;

/** 容器图形：液体按 ml 比例上升，裁剪区与轮廓共用同一条路径 */
const VesselArt: React.FC<{ spec: VesselSpec; ml: number; active: boolean }> = ({ spec, ml, active }) => {
  const pct = Math.max(0, Math.min(1, ml / spec.capacity));
  const span = spec.bottom - spec.top;
  const surface = spec.bottom - pct * span;
  const clipId = `dmd-vessel-clip-${spec.kind}`;
  const waterId = `dmd-vessel-water-${spec.kind}`;
  const ink = active ? '#0284c7' : '#cbd5e1';
  return (
    <svg viewBox="0 0 64 140" className="h-[140px] w-full" role="img" aria-label={`${spec.name} ${ml} 毫升`}>
      <defs>
        <clipPath id={clipId}>
          <path d={spec.shape} />
        </clipPath>
        <linearGradient id={waterId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      <path d={spec.shape} fill={active ? '#f0f9ff' : '#f8fafc'} />

      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y={surface} width="64" height={140 - surface} fill={`url(#${waterId})`} />
        {pct > 0.02 && <ellipse cx="32" cy={surface} rx="30" ry="2.4" fill="#bae6fd" opacity="0.9" />}
        {pct > 0.15 && (
          <rect
            x="19"
            y={surface + 8}
            width="3"
            height={Math.max(0, span * pct - 16)}
            rx="1.5"
            fill="#ffffff"
            opacity="0.35"
          />
        )}
      </g>

      <path d={spec.shape} fill="none" stroke={ink} strokeWidth="1.8" strokeLinejoin="round" />

      {spec.kind === 'glass' && (
        <>
          <ellipse cx="32" cy="22" rx="20" ry="3.2" fill="#ffffff" stroke={ink} strokeWidth="1.4" />
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1="15"
              x2="22"
              y1={spec.bottom - ratio * span}
              y2={spec.bottom - ratio * span}
              stroke="#cbd5e1"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          ))}
        </>
      )}

      {spec.kind === 'bottle' && (
        <>
          <rect x="24" y="4" width="16" height="10" rx="2.5" fill="#bae6fd" stroke="#7dd3fc" strokeWidth="1.2" />
          <line x1="27.5" y1="22" x2="36.5" y2="22" stroke="#cbd5e1" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="14" y="86" width="36" height="26" fill="#eff6ff" opacity="0.85" clipPath={`url(#${clipId})`} />
          <line x1="22" y1="96" x2="42" y2="96" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
          <line x1="22" y1="103" x2="42" y2="103" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {spec.kind === 'thermos' && (
        <>
          <rect x="14" y="12" width="36" height="22" rx="6" fill="#e2e8f0" stroke={ink} strokeWidth="1.6" />
          <rect x="26" y="6" width="12" height="7" rx="3.5" fill="#cbd5e1" />
        </>
      )}
    </svg>
  );
};

interface VesselPickerProps {
  spec: VesselSpec;
  ml: number;
  active: boolean;
  onActivate: () => void;
  onPick: (ml: number) => void;
}

/**
 * 可拖拽容器：按住上下拖动改液面（触屏 / 鼠标同源，Pointer Events），
 * 点按某一高度直接设值；键盘 ↑↓ 每次 ±25 mL。
 * 像素 → 比例只换算容器「液体区间」那一段，所以拖到杯口正好是满杯、拖到一半正好半杯。
 */
const VesselPicker: React.FC<VesselPickerProps> = ({ spec, ml, active, onActivate, onPick }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  /** 是否正在拖（比 pointer capture 更可靠：合成事件、老浏览器都能用） */
  const draggingRef = useRef(false);

  const fromPointer = (clientY: number) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const topPx = rect.top + (spec.top / 140) * rect.height;
    const bottomPx = rect.top + (spec.bottom / 140) * rect.height;
    const ratio = (bottomPx - clientY) / Math.max(1, bottomPx - topPx);
    const clamped = Math.max(0, Math.min(1, ratio));
    const stepped = Math.round((clamped * spec.capacity) / WATER_STEP) * WATER_STEP;
    onPick(Math.max(0, Math.min(spec.capacity, stepped)));
  };

  const bump = (direction: 1 | -1) => {
    onActivate();
    onPick(Math.max(0, Math.min(spec.capacity, ml + direction * WATER_STEP)));
  };

  return (
    <div className="flex flex-col items-center">
      <div
        ref={boxRef}
        role="slider"
        tabIndex={0}
        aria-label={`${spec.name}液面`}
        aria-valuemin={0}
        aria-valuemax={spec.capacity}
        aria-valuenow={ml}
        aria-valuetext={`${ml} 毫升`}
        onPointerDown={(event) => {
          onActivate();
          draggingRef.current = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* 合成事件 / 不支持捕获时忽略，靠 draggingRef 兜底 */
          }
          fromPointer(event.clientY);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          fromPointer(event.clientY);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault();
            bump(1);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault();
            bump(-1);
          }
        }}
        className={`mx-auto w-[72px] max-w-full cursor-ns-resize touch-none select-none rounded-xl outline-none transition ${
          active ? 'bg-sky-50 ring-1 ring-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400' : 'hover:bg-gray-50'
        }`}
      >
        <VesselArt spec={spec} ml={ml} active={active} />
      </div>
      <div className={`mt-1 text-[13px] font-bold tabular-nums ${ml > 0 ? 'text-sky-700' : 'text-gray-300'}`}>
        {ml} <span className="text-[10px] font-normal text-gray-400">mL</span>
      </div>
      <div className="text-[10px] text-gray-400">
        {spec.name} {spec.capacity} mL
      </div>
    </div>
  );
};

interface WaterTileProps {
  value: number;
  /** 生效上限：自定义上限优先，否则按体重推荐量（体重未填时为 0） */
  target: number;
  customLimit: number | null;
  onOpenAdd: () => void;
  onOpenLimit: () => void;
}

/** 水（液体）：大字「摄入 / 上限」+「记一笔饮水」+ 禁止（限液）按钮，右侧刻度杯 */
const WaterTile: React.FC<WaterTileProps> = ({ value, target, customLimit, onOpenAdd, onOpenLimit }) => {
  const pct = target > 0 ? (value / target) * 100 : 0;
  const over = target > 0 && value > target;
  const stepButton =
    'inline-flex h-8 w-8 items-center justify-center rounded-full border text-gray-500 transition active:scale-95';
  return (
    <div className="mt-3 flex items-center gap-3 border-t border-gray-100 pt-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[11px] text-gray-500">
          水（液体）
          {customLimit ? (
            <span className="rounded-full bg-rose-50 px-1.5 py-px text-[9px] font-medium text-rose-600">自定义上限</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1 tabular-nums">
          <span className={`text-2xl font-bold leading-none ${over ? 'text-rose-600' : 'text-gray-900'}`}>
            {round0(value)}
          </span>
          <span className="text-[11px] text-gray-400">/ {target > 0 ? `${round0(target)} mL` : '— mL'}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenAdd}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700 active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            记一笔饮水
          </button>
          <button
            type="button"
            aria-label="设置每日饮水上限（限液医嘱）"
            onClick={onOpenLimit}
            className={`${stepButton} ${
              customLimit
                ? 'border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300'
                : 'border-gray-200 hover:border-rose-200 hover:text-rose-600'
            }`}
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className={`mt-1.5 text-[10px] leading-tight ${over ? 'text-rose-500' : 'text-gray-400'}`}>
          {over
            ? `超出上限 ${round0(value - target)} mL，按医嘱限液`
            : target > 0
              ? '点「记一笔饮水」，把杯子拖到实际喝的液面再加入'
              : '填体重后自动给出目标，也可用 ⊘ 设自定义上限'}
        </div>
      </div>
      <WaterCylinder pct={pct} />
    </div>
  );
};

type WaterSheetMode = 'add' | 'limit';

interface WaterSheetProps {
  mode: WaterSheetMode;
  value: number;
  /** 当前生效上限 */
  target: number;
  /** 按体重的推荐摄入（限液面板用于「恢复默认」） */
  defaultTarget: number;
  defaultBasis: string;
  customLimit: number | null;
  onApplyDelta: (ml: number) => void;
  onApplyLimit: (ml: number | null) => void;
  /** 清空今日饮水记录（归零） */
  onClearToday: () => void;
  onClose: () => void;
}

/** 饮水弹层：加 → 三个容器拖液面后「加入」；禁止符号 → 设置每日上限 */
const WaterSheet: React.FC<WaterSheetProps> = ({
  mode, value, target, defaultTarget, defaultBasis, customLimit, onApplyDelta, onApplyLimit, onClearToday, onClose
}) => {
  const [draft, setDraft] = useState(() => (mode === 'limit' && customLimit ? String(customLimit) : ''));
  const [fills, setFills] = useState<Record<VesselKind, number>>({ glass: 0, bottle: 0, thermos: 0 });
  const [activeVessel, setActiveVessel] = useState<VesselKind>('glass');
  /** 清空今日记录的两步确认 */
  const [clearArmed, setClearArmed] = useState(false);

  const isLimit = mode === 'limit';
  const title = isLimit ? '每日饮水上限' : '记一笔饮水';
  const totalMl = fills.glass + fills.bottle + fills.thermos;

  const submitLimit = () => {
    const ml = Math.round(Number(draft));
    if (!Number.isFinite(ml) || ml <= 0) return;
    onApplyLimit(Math.max(100, Math.min(8000, ml)));
    onClose();
  };

  const resetFills = () => setFills({ glass: 0, bottle: 0, thermos: 0 });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-gray-900">{title}</div>
            <div className="mt-0.5 text-[11px] text-gray-500">
              已记 {round0(value)} / {round0(target)} mL
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLimit ? (
          <div className="mt-3">
            <label htmlFor="water-limit-input" className="text-[11px] text-gray-500">
              每日上限（mL）
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="water-limit-input"
                type="number"
                inputMode="numeric"
                min={100}
                max={8000}
                step={50}
                value={draft}
                placeholder={
                  defaultTarget > 0 ? `如 1,500（按体重 ${Math.round(defaultTarget).toLocaleString()}）` : '如 1,500'
                }
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitLimit();
                }}
                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm font-bold tabular-nums text-gray-900 placeholder:font-normal placeholder:text-gray-400 focus:border-rose-300 focus:outline-none"
              />
              <span className="flex-none text-xs text-gray-500">mL</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">常用</span>
              {[1000, 1500, 2000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDraft(String(preset))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition ${
                    draft === String(preset)
                      ? 'border-rose-300 bg-rose-50 text-rose-600'
                      : 'border-gray-200 text-gray-500 hover:border-rose-200 hover:text-rose-500'
                  }`}
                >
                  {preset.toLocaleString()}
                </button>
              ))}
            </div>
            <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-[10px] leading-relaxed text-amber-700">
              如有特殊限液需求请遵循医嘱（心衰、使用利尿剂或医生已开具限液量时，以医嘱为准）。设置后本页按该上限计算百分比，超出即转红。
            </p>
            <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
              <span>
                {defaultTarget > 0
                  ? `按体重推荐摄入 ${round0(defaultTarget)} mL（Holliday–Segar：${defaultBasis}）`
                  : '体重未填：在「我的档案」补上体重后自动给出推荐量'}
              </span>
              {customLimit ? (
                <button
                  type="button"
                  onClick={() => {
                    onApplyLimit(null);
                    onClose();
                  }}
                  className="font-medium text-gray-500 underline decoration-dotted underline-offset-2 hover:text-gray-700"
                >
                  恢复按体重
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={submitLimit}
              disabled={!draft.trim()}
              className={`mt-3 w-full rounded-lg px-3 py-2.5 text-sm font-bold transition ${
                draft.trim()
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'cursor-not-allowed bg-gray-100 text-gray-400'
              }`}
            >
              保存上限
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-[11px] leading-relaxed text-gray-500">
              按住容器上下拖动，液面到哪就是喝了多少：拖到杯口＝满杯、拖到一半＝半杯/半瓶，数字实时显示。
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {VESSELS.map((spec) => (
                <VesselPicker
                  key={spec.kind}
                  spec={spec}
                  ml={fills[spec.kind]}
                  active={activeVessel === spec.kind}
                  onActivate={() => setActiveVessel(spec.kind)}
                  onPick={(ml) => setFills((prev) => ({ ...prev, [spec.kind]: ml }))}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-sky-50 px-3 py-2">
              <span className="text-[11px] text-sky-700">本次加入</span>
              <span className="text-lg font-bold leading-none tabular-nums text-sky-700">
                {totalMl}
                <span className="ml-1 text-[10px] font-normal">mL</span>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={totalMl <= 0}
                onClick={() => {
                  onApplyDelta(totalMl);
                  resetFills();
                  onClose();
                }}
                className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
                  totalMl > 0
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400'
                }`}
              >
                加入{totalMl > 0 ? ` ${totalMl} mL` : ''}
              </button>
              <button
                type="button"
                onClick={resetFills}
                disabled={totalMl <= 0}
                className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                  totalMl > 0
                    ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    : 'cursor-not-allowed border-gray-100 text-gray-300'
                }`}
              >
                清空
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
              容器按常见规格取满杯 250 mL、满瓶 500 mL、满保温杯 400 mL，拖动步进 25 mL；实际量以量杯刻度为准。
            </p>
            {value > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (!clearArmed) {
                    setClearArmed(true);
                    return;
                  }
                  onClearToday();
                  setClearArmed(false);
                  onClose();
                }}
                className={`mt-2 w-full rounded-lg border border-dashed px-3 py-1.5 text-[11px] font-medium transition ${
                  clearArmed
                    ? 'border-rose-300 bg-rose-50 text-rose-600'
                    : 'border-gray-200 text-gray-400 hover:border-rose-200 hover:text-rose-500'
                }`}
              >
                {clearArmed ? `再点一次确认：清空今日 ${round0(value)} mL` : `清空今天已记的 ${round0(value)} mL`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const formatCount = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

interface PortionProps {
  entry: DietLogEntry;
  presets: FoodServing[];
  onGrams: (grams: number) => void;
  onPreset: (serving: FoodServing) => void;
}

/**
 * 份量控件
 * - 选中「一小碗 / 一个 / 一根」这类量词预设 → 输入框填个数，单位随量词变化，0.5 起、步长 0.5，右侧显示克数；
 * - 选中「100 克 / 250 毫升」或自定义 → 输入框直接填克数，步长 25 g。
 */
const PortionControl: React.FC<PortionProps> = ({ entry, presets, onGrams, onPreset }) => {
  const [draft, setDraft] = useState<string | null>(null);

  const matched = useMemo(
    () =>
      entry.servingGrams
        ? presets.find((serving) => Math.round(serving.weightG) === Math.round(entry.servingGrams as number))
        : undefined,
    [entry.servingGrams, presets]
  );
  const unit = matched ? measureUnitOf(matched.description) : null;
  const base = matched && unit ? Number(matched.weightG) : 0;
  const count = base > 0 ? entry.grams / base : 0;

  const bump = (direction: 1 | -1) => {
    setDraft(null);
    if (unit && base > 0) {
      const next = Math.max(UNIT_MIN, Math.round((count + direction * UNIT_STEP) * 2) / 2);
      onGrams(Math.round(next * base));
    } else {
      onGrams(Math.max(1, entry.grams + direction * GRAM_STEP));
    }
  };

  const commit = (raw: string) => {
    setDraft(raw);
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    if (unit && base > 0) {
      if (value < UNIT_MIN) return;
      onGrams(Math.round(value * base));
    } else {
      onGrams(Math.round(value));
    }
  };

  const displayValue = draft ?? (unit ? formatCount(count) : String(entry.grams));

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <select
        value={matched ? String(Math.round(matched.weightG)) : 'custom'}
        onChange={(event) => {
          const picked = presets.find((serving) => String(Math.round(serving.weightG)) === event.target.value);
          if (picked) {
            setDraft(null);
            onPreset(picked);
          }
        }}
        className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:border-brand-300 focus:outline-none"
      >
        {presets.map((preset) => (
          <option key={preset.weightG} value={String(Math.round(preset.weightG))}>
            {preset.description}（{Math.round(preset.weightG)} g）
          </option>
        ))}
        <option value="custom">{entry.grams} g（自定义）</option>
      </select>

      <button
        type="button"
        aria-label="减少份量"
        onClick={() => bump(-1)}
        className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:border-brand-200 hover:text-brand-600"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <input
        type="number"
        inputMode="decimal"
        step={unit ? UNIT_STEP : GRAM_STEP}
        min={unit ? UNIT_MIN : 1}
        max={unit ? 99 : 5000}
        value={displayValue}
        onChange={(event) => commit(event.target.value)}
        onBlur={() => setDraft(null)}
        aria-label={unit ? `份数（${unit}）` : '克数'}
        className="h-7 w-11 flex-none rounded-lg border border-gray-200 text-center text-xs font-bold text-gray-800 focus:border-brand-300 focus:outline-none"
      />
      <span className="flex-none text-[11px] text-gray-500">{unit || 'g'}</span>

      <button
        type="button"
        aria-label="增加份量"
        onClick={() => bump(1)}
        className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:border-brand-200 hover:text-brand-600"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {unit && (
        <span className="w-12 flex-none text-right text-[11px] text-gray-400">{round0(entry.grams)} g</span>
      )}
    </div>
  );
};

interface Props {
  /** 「我的档案」里的临床概况：年龄 / 身高 / 体重 / 身体阶段 / 康复训练 / 钙补充剂剂量 */
  profile?: DietProfile | null;
}

export const DietLogPanel: React.FC<Props> = ({ profile }) => {
  /** 当前记录日期：系统日期（进页面时取一次，与改动前一致） */
  const dateKey = useMemo(() => todayKey(), []);
  const [entries, setEntries] = useState<DietLogEntry[]>(() => readEntries(todayKey()));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [waterMl, setWaterMl] = useState<number>(() => readWater(todayKey()));
  /** 自定义饮水上限（限液医嘱，跨天保留）；null = 按体重推荐摄入 */
  const [waterLimit, setWaterLimit] = useState<number | null>(() => readWaterLimit());
  const [waterSheet, setWaterSheet] = useState<WaterSheetMode | null>(null);

  // 日期固定为进入页面时的系统日期（不跟随时钟，故无需按天切换数据）
  useEffect(() => {
    writeEntries(dateKey, entries);
  }, [dateKey, entries]);

  useEffect(() => {
    writeWater(dateKey, waterMl);
  }, [dateKey, waterMl]);

  useEffect(() => {
    writeWaterLimit(waterLimit);
  }, [waterLimit]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const totals = useMemo(() => sumNutrients(entries), [entries]);

  // 体重统一取「我的档案」；档案没填时退回旧版本机记录（历史用户不丢目标值）
  const effectiveWeight = useMemo(() => {
    const fromProfile = Number(profile?.weightKg);
    if (Number.isFinite(fromProfile) && fromProfile >= 10 && fromProfile <= 120) return fromProfile;
    // 旧版本机体重（输入框已下线）：仅作为档案未填时的兜底，避免老用户目标值突然消失
    const stored = readWeight();
    const storedNum = Number(stored);
    if (stored.trim() !== '' && Number.isFinite(storedNum) && storedNum >= 10 && storedNum <= 120) return storedNum;
    return undefined;
  }, [profile?.weightKg]);

  // 目标口径集中在 utils/dietTargets.ts（能量按行走阶段、蛋白按康复、钙扣补充剂、水按体重）
  const targets = useMemo(() => computeDietTargets(profile, effectiveWeight), [profile, effectiveWeight]);
  const hasWeight = Boolean(effectiveWeight);
  const energyTarget = targets.energy;
  const proteinTarget = targets.protein;
  const fatTarget = targets.fat;
  const carbTarget = targets.carbs;
  const calciumTotal = totals.calcium + targets.calciumSupplement;
  // 钙 / 纤维的口径标签：年龄未填时标注出来，避免把兜底档当成实际年龄段
  const calciumBasis = `${targets.calciumLabel}${targets.calciumExact ? '' : '（年龄未填）'}${targets.calciumSteroid ? ' · 激素期' : ''}`;
  const calciumFoodGap = Math.max(0, targets.calciumFoodNeed - totals.calcium);
  const fiberBasis = `${targets.fiberLabel}${targets.fiberExact ? '' : '（年龄未填）'}`;
  const energyPct = energyTarget > 0 ? Math.min(100, (totals.calories / energyTarget) * 100) : 0;
  const energyLeft = Math.max(0, Math.round(energyTarget - totals.calories));
  /** 生效上限：手动设置的限液量优先，否则用按体重的推荐摄入（体重未填时为 0） */
  const waterTarget = waterLimit ?? targets.waterMl;
  const proteinBasis =
    targets.proteinWeightBasis === 'ibw'
      ? `BMI ${round1(targets.bmi || 0)} 超过同龄第 85 百分位 ${round1(targets.bmiLine || 0)}，改按理想体重 ${round1(targets.proteinWeightKg)} kg 计`
      : targets.bmi
        ? `按实际体重 ${round1(targets.proteinWeightKg)} kg 计（BMI ${round1(targets.bmi)}）`
        : '体重未填，暂按 1.0 g/kg 无法换算';
  const weightNote = hasWeight
    ? `体重取自我档案 ${round1(effectiveWeight as number)} kg，可在「我的 → 我的档案」修改`
    : '体重未填写：在「我的 → 我的档案」补上身高体重后，蛋白质 / 脂肪 / 碳水目标自动算出';

  const addedGrams = useMemo(
    () =>
      entries.reduce<Record<string, number>>((acc, entry) => {
        const key = String(entry.foodId);
        acc[key] = (acc[key] || 0) + entry.grams;
        return acc;
      }, {}),
    [entries]
  );

  const handleAdd = useCallback((item: FoodItem) => {
    const portion = defaultPortionOf(item);
    setEntries((prev) => addEntry(prev, entryFromFood(item, portion.grams, portion.servingGrams)));
  }, []);

  /** 食物库里再点一次「✓」：删除该食物的记录（同一食物只保留一行，所以整行移除） */
  const handleRemove = useCallback((item: FoodItem) => {
    setEntries((prev) => prev.filter((entry) => String(entry.foodId) !== String(item.id)));
  }, []);

  const setGrams = (key: string, grams: number) => {
    const next = Math.max(1, Math.min(5000, Math.round(grams)));
    setEntries((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, grams: next } : entry))
    );
  };

  const setPreset = (key: string, serving: FoodServing) => {
    const grams = Math.max(1, Math.round(Number(serving.weightG)));
    setEntries((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, grams, servingGrams: grams } : entry))
    );
  };

  const removeEntry = (key: string) => setEntries((prev) => prev.filter((entry) => entry.key !== key));

  return (
    <div className="animate-in fade-in duration-300">
      {/* 头部：日期 + 入口 */}
      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-gray-900">今日记录</div>
          <div className="text-[11px] text-gray-500">
            {formatToday()}
            {entries.length ? ` · 已记 ${entries.length} 项` : ' · 还没有记录'}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirmClear) {
                  setEntries([]);
                  setConfirmClear(false);
                } else {
                  setConfirmClear(true);
                }
              }}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                confirmClear
                  ? 'border-rose-200 bg-rose-50 text-rose-600'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-rose-200 hover:text-rose-600'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmClear ? '确认清空' : '清空'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            添加食物
          </button>
        </div>
      </div>

      {/* 合计卡 */}
      {entries.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {/* 热量：大字 + 粗条 + 摄入/目标 */}
          <div className="text-[11px] text-gray-500">今日总能量</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 tabular-nums">
            <span className="text-3xl font-bold leading-none text-gray-900">{round0(totals.calories)}</span>
            <span className="text-xs text-gray-500">千卡</span>
            {hasWeight && <span className="ml-1 text-[11px] text-gray-400">还剩 {energyLeft.toLocaleString()}</span>}
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${energyPct}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] tabular-nums text-gray-400">
            {round0(totals.calories)} / {hasWeight ? Math.round(energyTarget).toLocaleString() : '—'}
            {hasWeight ? ' 千卡' : ' · 待填体重'}
          </div>

          {/* 营养素：3 列格位，口径收进「>」 */}
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setNotesOpen((prev) => !prev)}
              aria-expanded={notesOpen}
              aria-label={notesOpen ? '收起口径说明' : '展开口径说明'}
              className="flex items-center gap-0.5 text-sm font-bold text-gray-900"
            >
              营养素
              <ChevronRight
                className={`h-4 w-4 text-gray-400 transition-transform ${notesOpen ? 'rotate-90' : ''}`}
              />
            </button>

            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-4 min-[380px]:grid-cols-3">
              <NutrientTile label="蛋白质" value={totals.protein} target={proteinTarget} unit="g" digits={1} color="#8b5cf6" />
              <NutrientTile label="碳水" value={totals.carbs} target={carbTarget} unit="g" digits={1} color="#3b82f6" />
              <NutrientTile label="脂肪（上限）" value={totals.fat} target={fatTarget} unit="g" digits={1} color="#f59e0b" limit />
              <NutrientTile label="钙（含补充剂）" value={calciumTotal} target={targets.calcium} unit="mg" color="#06b6d4" />
              <NutrientTile
                label="钠（上限）"
                value={totals.sodium}
                target={targets.sodium}
                unit="mg"
                color="#10b981"
                limit
                warnOver={targets.sodiumWarn}
              />
              <NutrientTile label="膳食纤维" value={totals.fiber} target={targets.fiber} unit="g" color="#84cc16" />
            </div>

            {notesOpen && (
              <div className="mt-3 space-y-1.5 rounded-lg bg-gray-50 p-3 text-[10px] leading-relaxed text-gray-500">
                <p>
                  <b className="text-gray-700">热量</b>：
                  {hasWeight ? `目标 ${Math.round(energyTarget).toLocaleString()} 千卡 · ${targets.energyBasis}` : '待填体重后计算'}
                </p>
                <p>
                  <b className="text-gray-700">蛋白质</b>：{targets.proteinPerKg.toFixed(1)} g/kg（{targets.proteinPerKg >= 1.5 ? '规律康复' : '不康复'}），{proteinBasis}
                </p>
                <p>
                  <b className="text-gray-700">脂肪</b>：上限 = 目标能量 × 30% ÷ 9；<b className="text-gray-700">碳水</b> = 目标能量 × 55% ÷ 4
                </p>
                <p>
                  <b className="text-gray-700">钙</b>：目标 {round0(targets.calcium)} mg · {calciumBasis}；
                  {targets.calciumSupplement > 0
                    ? `食物 ${round0(totals.calcium)} + 钙剂 ${round0(targets.calciumSupplement)} = ${round0(calciumTotal)}，${
                        calciumFoodGap > 0 ? `食物还需补 ${round0(calciumFoodGap)} mg` : '食物部分无需再补'
                      }`
                    : `钙片剂量在「我的档案 → 钙补充剂」里填，食物需补足 ${round0(targets.calciumFoodNeed)} mg`}
                </p>
                <p>
                  <b className="text-gray-700">钠</b>：上限 {targets.sodium.toLocaleString()} mg，超过 {targets.sodiumWarn.toLocaleString()} mg 转橙预警
                </p>
                <p>
                  <b className="text-gray-700">膳食纤维</b>：按年龄推荐 {round0(targets.fiber)} g（{fiberBasis}）
                </p>
                <p>
                  <b className="text-gray-700">水</b>：{waterLimit
                    ? `当前按自定义上限 ${round0(waterLimit)} mL 计（点 ⊘ 里的「恢复按体重」回到推荐量${
                        targets.waterMl > 0 ? ` ${round0(targets.waterMl)} mL` : ''
                      }）`
                    : targets.waterMl > 0
                      ? `按体重推荐 ${round0(targets.waterMl)} mL（Holliday–Segar：${targets.waterBasis}）`
                      : '体重未填，在「我的档案」补上体重后按 Holliday–Segar 自动换算'}；
                  点 ＋ / − 可选一杯、一瓶、一勺或自定义毫升；心衰或用利尿剂者按心内科限液，超上限百分比转红
                </p>
                <p>
                  <b className="text-gray-700">体重</b>：{weightNote}
                </p>
              </div>
            )}
          </div>

          <WaterTile
            value={waterMl}
            target={waterTarget}
            customLimit={waterLimit}
            onOpenAdd={() => setWaterSheet('add')}
            onOpenLimit={() => setWaterSheet('limit')}
          />
        </div>
      )}

      {/* 清单 */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
          <UtensilsCrossed className="mx-auto h-7 w-7 text-brand-400" />
          <p className="mt-2 text-sm font-bold text-gray-700">今天还没有记录饮食</p>
          <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-gray-500">
            从标准食物库中选择食物，自动折算热量、蛋白、钙、钠与膳食纤维。
          </p>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700"
          >
            <Plus className="h-4 w-4" />
            打开食物库
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const n = nutrientsOf(entry);
            const presets = entry.servings.reduce<FoodServing[]>((acc, preset) => {
              if (preset.weightG > 0 && !acc.some((p) => Math.round(p.weightG) === Math.round(preset.weightG))) {
                acc.push(preset);
              }
              return acc;
            }, []);
            return (
              <div key={entry.key} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-gray-900">{entry.name}</div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {round0(n.calories)} 千卡 · 蛋白 {round1(n.protein)} g · 钙 {round0(n.calcium)} mg · 钠{' '}
                      {round0(n.sodium)} mg
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`移除 ${entry.name}`}
                    onClick={() => removeEntry(entry.key)}
                    className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-gray-400 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <PortionControl
                  entry={entry}
                  presets={presets}
                  onGrams={(grams) => setGrams(entry.key, grams)}
                  onPreset={(serving) => setPreset(entry.key, serving)}
                />
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        食物库营养值为每 100 g 参考值，实际摄入以称重或份量估算为准；饮食记录与饮水只保存在本机浏览器，不会上传。
      </p>

      {waterSheet && (
        <WaterSheet
          key={waterSheet}
          mode={waterSheet}
          value={waterMl}
          target={waterTarget}
          defaultTarget={targets.waterMl}
          defaultBasis={targets.waterBasis}
          customLimit={waterLimit}
          onApplyDelta={(ml) => setWaterMl((prev) => Math.max(0, prev + ml))}
          onApplyLimit={(ml) => setWaterLimit(ml)}
          onClearToday={() => setWaterMl(0)}
          onClose={() => setWaterSheet(null)}
        />
      )}

      <FoodLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onAdd={handleAdd}
        onRemove={handleRemove}
        addedGrams={addedGrams}
      />
    </div>
  );
};
