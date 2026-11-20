import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, Bone, Droplets, Info, Ruler, Scale, Wheat
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {
  BMI_BANDS,
  bmiBandOf,
  buildNutritionTrends,
  ensureBodySeed
} from '../utils/nutritionTrends';
import type { BmiBands, DaySeries, TrendPoint } from '../utils/nutritionTrends';
import type { DietProfile } from '../utils/dietTargets';

interface Props {
  /** 「我的档案」里的年龄 / 身高 / 体重 / 激素与钙剂状态（全部可选） */
  profile?: DietProfile | null;
}

const COLORS = {
  protein: '#8b5cf6',
  carbs: '#3b82f6',
  fat: '#f59e0b',
  sodium: '#10b981',
  calcium: '#06b6d4',
  fiber: '#84cc16',
  water: '#0d9488',
  height: '#0d9488',
  weight: '#14b8a6',
  bmi: '#2563eb'
};

const TOOLTIP_STYLE: React.CSSProperties = {
  fontSize: 11,
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  padding: '6px 8px',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)'
};

const AXIS_TICK = { fontSize: 10, fill: '#9ca3af' };

/**
 * 走势图纵轴刻度：按「1 / 2 / 2.5 / 5 × 10ⁿ」取整步长，
 * 保证刻度是 62 / 64 / 66 这种整数间隔，不会出现 20.4 / 22.4 / 24.9 这种不等距标签；
 * digits = 0（身高）时步长强制为 ≥1 的整数，避免两个刻度都四舍五入成「172」。
 */
const buildAxis = (min: number, max: number, digits: 0 | 1): { domain: [number, number]; ticks: number[] } => {
  const span = Math.max(max - min, digits === 0 ? 2 : 1);
  const rawStep = (span * 1.35) / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const mults = digits === 0 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = (mults.find((m) => m * pow >= rawStep) ?? 10) * pow;
  const finalStep = digits === 0 ? Math.max(1, step) : step;
  const start = Math.floor((min - span * 0.15) / finalStep) * finalStep;
  const end = Math.ceil((max + span * 0.15) / finalStep) * finalStep;
  const ticks: number[] = [];
  for (let value = start; value <= end + finalStep / 1000; value += finalStep) {
    ticks.push(Number(value.toFixed(2)));
  }
  if (ticks.length < 2) ticks.push(Number((start + finalStep).toFixed(2)));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
};

/* ============================ BMI 表盘 ============================ */

const GAUGE_W = 300;
// 高度要容得下量程端点数字（基线在 GAUGE_CY + 22 = 170），否则会被 viewBox 裁掉半个字
const GAUGE_H = 180;
const GAUGE_CX = GAUGE_W / 2;
const GAUGE_CY = 148;
/** 弧线半径（描边宽 18，圆头要留出 9 的余量，否则会被 viewBox 裁掉） */
const GAUGE_R = 108;

const polar = (radius: number, deg: number): { x: number; y: number } => {
  const rad = (deg * Math.PI) / 180;
  return { x: GAUGE_CX + radius * Math.cos(rad), y: GAUGE_CY - radius * Math.sin(rad) };
};

/** 从左（180°）经顶部（90°）到右（0°）的顺时针圆弧 */
const arcPath = (from: number, to: number, radius = GAUGE_R): string => {
  const a = polar(radius, from);
  const b = polar(radius, to);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

const BmiGauge: React.FC<{ bmi?: number; bands: BmiBands }> = ({ bmi, bands }) => {
  const angleOf = (value: number): number => {
    const norm = Math.min(1, Math.max(0, (value - bands.min) / (bands.max - bands.min)));
    return 180 - norm * 180;
  };

  const segments = [
    { from: bands.min, to: bands.thin, color: BMI_BANDS.thin.color },
    { from: bands.thin, to: bands.normal, color: BMI_BANDS.healthy.color },
    { from: bands.normal, to: bands.over, color: BMI_BANDS.over.color },
    { from: bands.over, to: bands.max, color: BMI_BANDS.obese.color }
  ].filter((seg) => seg.to > seg.from);

  const GAP = 1.8;
  const clamped = bmi == null ? undefined : Math.min(bands.max, Math.max(bands.min, bmi));
  const needleDeg = clamped == null ? undefined : angleOf(clamped);
  const tip = needleDeg == null ? undefined : polar(GAUGE_R - 20, needleDeg);
  const baseA = needleDeg == null ? undefined : polar(8, needleDeg + 90);
  const baseB = needleDeg == null ? undefined : polar(8, needleDeg - 90);

  return (
    <svg
      viewBox={`0 0 ${GAUGE_W} ${GAUGE_H}`}
      className="mx-auto w-full max-w-[320px]"
      role="img"
      aria-label={bmi == null ? 'BMI 表盘：尚未填写身高体重' : `BMI 表盘：${bmi.toFixed(1)}`}
    >
      {segments.map((seg, index) => (
        <path
          key={seg.color + index}
          d={arcPath(
            angleOf(seg.from) - (index === 0 ? 0 : GAP),
            angleOf(seg.to) + (index === segments.length - 1 ? 0 : GAP)
          )}
          stroke={seg.color}
          strokeWidth={18}
          strokeLinecap="round"
          fill="none"
        />
      ))}

      {/* 量程端点数字 */}
      <text x={GAUGE_CX - GAUGE_R} y={GAUGE_CY + 22} textAnchor="middle" fontSize={10} fill="#9ca3af">
        {bands.min}
      </text>
      <text x={GAUGE_CX + GAUGE_R} y={GAUGE_CY + 22} textAnchor="middle" fontSize={10} fill="#9ca3af">
        {bands.max}
      </text>

      {/* 指针 */}
      {tip && baseA && baseB && (
        <>
          <polygon
            points={`${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${baseA.x.toFixed(2)},${baseA.y.toFixed(2)} ${baseB.x.toFixed(2)},${baseB.y.toFixed(2)}`}
            fill="#111827"
          />
          <circle cx={GAUGE_CX} cy={GAUGE_CY} r={6} fill="#111827" />
          <circle cx={GAUGE_CX} cy={GAUGE_CY} r={2.4} fill="#ffffff" />
        </>
      )}
    </svg>
  );
};

/* ======================== 走势图（通用） ======================== */

interface TrendCardProps {
  title: string;
  icon: React.ElementType;
  points: TrendPoint[];
  dataKey: 'height' | 'weight' | 'bmi';
  color: string;
  unit: string;
  digits: 0 | 1;
  /** 右上角显示的「当前值」：取「我的档案」里的当前值 */
  current?: number;
  /** 参考线（超标线 / 理想体重 / 第 50 百分位） */
  refLines?: { y: number; label: string; color: string; includeInDomain?: boolean }[];
  note: string;
  /** 没有任何可用数据时的占位文案 */
  emptyHint: string;
}

const TrendCard: React.FC<TrendCardProps> = ({
  title,
  icon: Icon,
  points,
  dataKey,
  color,
  unit,
  digits,
  current,
  refLines = [],
  note,
  emptyHint
}) => {
  const values = points
    .map((point) => point[dataKey])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const gradId = `grad-${dataKey}`;
  const latest = current ?? (values.length ? values[values.length - 1] : undefined);

  // 量程：默认按数据范围上下留白；带 includeInDomain 的参考线（超标线 / 理想体重）一并纳入，
  // 否则参考线会落在坐标区外被裁掉。身高的整岁刻度用整数，避免出现两个相同的「172」。
  const scaleValues = [...values, ...refLines.filter((line) => line.includeInDomain).map((line) => line.y)];
  const axis = buildAxis(
    scaleValues.length ? Math.min(...scaleValues) : 0,
    scaleValues.length ? Math.max(...scaleValues) : 1,
    digits
  );


  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
            <Icon className="h-4 w-4" />
          </span>
          <h4 className="text-sm font-bold text-gray-900">{title}</h4>
        </div>
        {latest != null && (
          <div className="flex items-baseline gap-1 tabular-nums">
            <span className="text-lg font-bold" style={{ color }}>
              {latest.toFixed(digits)}
            </span>
            <span className="text-[10px] text-gray-400">{unit}</span>
          </div>
        )}
      </div>

      {values.length === 0 ? (
        <div className="mt-3 flex h-[150px] items-center justify-center rounded-lg bg-gray-50 px-4 text-center text-[11px] leading-relaxed text-gray-400">
          {emptyHint}
        </div>
      ) : (
        <div className="mt-1 h-[150px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 16, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                domain={axis.domain}
                ticks={axis.ticks}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={42}
                allowDecimals={digits === 1}
                tickFormatter={(value: number) => value.toFixed(digits)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ fontSize: 10, color: '#6b7280' }}
                formatter={(value: number) => [`${Number(value).toFixed(digits)} ${unit}`, title]}
              />
              {refLines.map((line) => (
                <ReferenceLine
                  key={line.label}
                  y={line.y}
                  stroke={line.color}
                  strokeDasharray="5 4"
                  strokeWidth={1.4}
                  label={{ value: line.label, position: 'insideTopRight', fontSize: 9, fill: line.color }}
                />
              ))}
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2.4}
                fill={`url(#${gradId})`}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mt-1 text-[10px] leading-relaxed text-gray-400">{note}</p>
    </div>
  );
};

/* ==================== 钠 / 钙 / 纤维 小柱状图 ==================== */

interface MiniBarProps {
  title: string;
  icon: React.ElementType;
  color: string;
  dataKey: 'sodium' | 'calcium' | 'fiber';
  week: DaySeries[];
  target: number;
  unit: string;
  digits: 0 | 1;
  /** true = 上限（越低越好），false = 目标（越高越好） */
  limit?: boolean;
}

const MiniBar: React.FC<MiniBarProps> = ({ title, icon: Icon, color, dataKey, week, target, unit, digits, limit }) => {
  const values = week.map((day) => Number(day[dataKey]) || 0);
  const recorded = values.filter((value) => value > 0);
  const hits = recorded.filter((value) => (limit ? value <= target : value >= target)).length;
  const maxValue = Math.max(target, ...values, 1);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" style={{ color }} />
          <span className="text-xs font-bold text-gray-800">{title}</span>
        </div>
        <span className="text-[10px] text-gray-400">
          {limit ? '上限' : '目标'} {target.toLocaleString()}
          {unit}
        </span>
      </div>

      <div className="mt-1 h-[92px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={week} margin={{ top: 8, right: 2, bottom: 0, left: 2 }} barCategoryGap="32%">
            <XAxis dataKey="short" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={0} />
            <YAxis hide domain={[0, Math.ceil(maxValue * 1.15)]} />
            <ReferenceLine y={target} stroke="#cbd5e1" strokeDasharray="4 3" strokeWidth={1.2} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ fontSize: 10, color: '#6b7280' }}
              formatter={(value: number) => [`${Number(value).toFixed(digits)} ${unit}`, title]}
            />
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
        <span>{limit ? '不超上限' : '达到目标'} {hits}/{recorded.length || 0} 天</span>
        <span>
          均{' '}
          {recorded.length
            ? `${(recorded.reduce((a, b) => a + b, 0) / recorded.length).toFixed(digits)} ${unit}`
            : '无记录'}
        </span>
      </div>
    </div>
  );
};

/* ============================== 主面板 ============================== */

export const NutritionManagePanel: React.FC<Props> = ({ profile }) => {
  /** 补种子后自增一次，触发走势重算（否则首次进入看不到刚写入的点） */
  const [bodySeedTick, setBodySeedTick] = useState(0);

  // 老用户第一次进来没有测量历史：把当前档案补成第一个点，走势图不至于全空
  useEffect(() => {
    ensureBodySeed(profile);
    setBodySeedTick((tick) => tick + 1);
  }, [profile?.heightCm, profile?.weightKg]);

  const { week, trend, targets, bands } = useMemo(
    () => buildNutritionTrends(profile),
    [profile, bodySeedTick]
  );

  const bmiNow = trend.latest?.bmi;
  const band = bmiNow != null ? bmiBandOf(bmiNow, bands) : undefined;
  const bandMeta = band ? BMI_BANDS[band] : undefined;

  const weekCalories = week.reduce((sum, day) => sum + day.calories, 0);
  const recordedDays = week.filter((day) => day.calories > 0).length;

  // 饮水图的量程必须把「目标」也包进去，否则目标虚线会落在坐标区外被裁掉
  const waterTopRaw = Math.max(targets.waterMl, ...week.map((day) => day.water), 500);
  const waterTop = Math.ceil(waterTopRaw / 500) * 500;
  const waterTicks = Array.from({ length: waterTop / 500 + 1 }, (_, index) => index * 500);

  return (
    <div className="animate-in fade-in duration-300">
      {/* 标题 */}
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900">营养管理</h3>
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
            近 7 天 · 按系统日期
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          身高 / 体重 / BMI 的取值时间来自「我的档案」每次保存的时间点；营养摄入与饮水来自「今日记录」。
        </p>
      </div>

      {/* BMI 表盘 */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Activity className="h-4 w-4" />
            </span>
            <h4 className="text-base font-bold text-gray-900">BMI 体质指数</h4>
          </div>
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
            {profile?.age != null ? `${profile.age} 岁适用分档` : '成人分档（年龄未填）'}
          </span>
        </div>

        <BmiGauge bmi={bmiNow} bands={bands} />

        <div className="mt-1 flex items-stretch divide-x divide-gray-100 mx-auto w-full max-w-[420px]">
          <div className="flex-1 pr-3">
            <div className="text-[11px] text-gray-400">BMI</div>
            <div className="mt-0.5 text-3xl font-bold leading-none tabular-nums text-gray-900">
              {bmiNow != null ? bmiNow.toFixed(1) : '—'}
            </div>
          </div>
          <div className="flex-1 pl-4">
            <div className={`text-2xl font-bold leading-none ${bandMeta ? bandMeta.text : 'text-gray-300'}`}>
              {bandMeta ? bandMeta.label : '未填'}
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-gray-400">
              健康区间 {bands.thin.toFixed(1)}–{bands.normal.toFixed(1)}
              {band === 'thin' ? ' · 低于下限' : ''}
              {band === 'over' ? ' · 超过上限' : ''}
              {band === 'obese' ? ' · 明显超标' : ''}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-3 grid w-full max-w-[420px] grid-cols-3 gap-2 border-t border-gray-100 pt-3">
          {[
            { label: '身高', value: trend.latest?.height, unit: 'cm', digits: 0 },
            { label: '体重', value: trend.latest?.weight, unit: 'kg', digits: 1 },
            { label: '超标线', value: bands.normal, unit: 'BMI', digits: 1 }
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-gray-50 px-2 py-1.5">
              <div className="text-[10px] text-gray-400">{item.label}</div>
              <div className="text-sm font-bold tabular-nums text-gray-800">
                {item.value != null ? item.value.toFixed(item.digits) : '—'}
                <span className="ml-0.5 text-[10px] font-normal text-gray-400">{item.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 身高 / 体重 / BMI 走势 */}
      <div className="mb-2 flex items-center gap-1.5">
        <Ruler className="h-4 w-4 text-gray-400" />
        <h4 className="text-sm font-bold text-gray-800">身体测量走势</h4>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <TrendCard
          title="身高走势"
          icon={Ruler}
          points={trend.points}
          dataKey="height"
          color={COLORS.height}
          unit="cm"
          digits={0}
          current={trend.latest?.height}
          emptyHint="还没有身高记录 · 在「我的档案」填写身高并保存后会生成一个点"
          note="横轴为「我的档案」的保存时间：每次修改身高并保存，图上就多一个点。"
        />
        <TrendCard
          title="体重走势"
          icon={Scale}
          points={trend.points}
          dataKey="weight"
          color={COLORS.weight}
          unit="kg"
          digits={1}
          current={trend.latest?.weight}
          emptyHint="还没有体重记录 · 在「我的档案」填写体重并保存后会生成一个点"
          refLines={
            targets.ibw
              ? [{ y: Number(targets.ibw.toFixed(1)), label: `理想 ${targets.ibw.toFixed(1)}`, color: '#10b981', includeInDomain: true }]
              : []
          }
          note={
            targets.ibw
              ? `理想体重 ${targets.ibw.toFixed(1)} kg = 第 50 百分位 BMI × 身高²，虚线为参考线。`
              : '体重取「我的档案」；填了身高后可显示理想体重参考线。'
          }
        />
        <div className="sm:col-span-2">
          <TrendCard
            title="BMI 走势"
            icon={Activity}
            points={trend.points}
            dataKey="bmi"
            color={COLORS.bmi}
            unit=""
            digits={1}
            current={trend.latest?.bmi}
            emptyHint="身高和体重都记录后才会算出 BMI · 去「我的档案」补齐再保存"
            refLines={[
              { y: bands.normal, label: `超标线 ${bands.normal.toFixed(1)}`, color: '#f59e0b', includeInDomain: true },
              { y: bands.median, label: `第 50 百分位 ${bands.median.toFixed(1)}`, color: '#cbd5e1' }
            ]}
            note="BMI = 体重(kg) ÷ 身高(m)²，按同一次档案保存的身高体重要点计算；超标线为同年龄第 85 百分位（成人 24）。"
          />
        </div>
      </div>

      {/* 近一周营养摄入 */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <BarChart3 className="h-4 w-4" />
            </span>
            <h4 className="text-base font-bold text-gray-900">近一周营养摄入</h4>
          </div>
          <div className="text-[10px] text-gray-400">
            {recordedDays === 0
              ? '近 7 天无记录'
              : `有数据 ${recordedDays}/7 天 · 合计 ${weekCalories.toLocaleString()} 千卡`}
          </div>
        </div>

        <div className="mt-2 h-[210px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={week} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="38%">
              <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(value: number) => `${value}g`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ fontSize: 10, color: '#6b7280' }}
                formatter={(value: number, name: string) => [`${Math.round(Number(value))} g`, name]}
              />
              <Bar dataKey="protein" name="蛋白质" stackId="macro" fill={COLORS.protein} isAnimationActive={false} />
              <Bar dataKey="carbs" name="碳水" stackId="macro" fill={COLORS.carbs} isAnimationActive={false} />
              <Bar
                dataKey="fat"
                name="脂肪"
                stackId="macro"
                fill={COLORS.fat}
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-4 text-[11px] text-gray-500">
          {[
            { color: COLORS.protein, label: '蛋白质' },
            { color: COLORS.carbs, label: '碳水' },
            { color: COLORS.fat, label: '脂肪' }
          ].map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1">
              <span className="h-1.5 w-4 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
          <span className="text-gray-400">(g)</span>
        </div>
      </div>

      {/* 钠 / 钙 / 纤维 */}
      <div className="mb-2 flex items-center gap-1.5">
        <Wheat className="h-4 w-4 text-gray-400" />
        <h4 className="text-sm font-bold text-gray-800">近一周钠 · 钙 · 膳食纤维</h4>
        <span className="text-[10px] text-gray-400">虚线为目标值</span>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniBar
          title="钠"
          icon={Droplets}
          color={COLORS.sodium}
          dataKey="sodium"
          week={week}
          target={targets.sodium}
          unit="mg"
          digits={0}
          limit
        />
        <MiniBar
          title="钙"
          icon={Bone}
          color={COLORS.calcium}
          dataKey="calcium"
          week={week}
          target={targets.calcium}
          unit="mg"
          digits={0}
        />
        <MiniBar
          title="膳食纤维"
          icon={Wheat}
          color={COLORS.fiber}
          dataKey="fiber"
          week={week}
          target={targets.fiber}
          unit="g"
          digits={0}
        />
      </div>

      {/* 近一周饮水量 */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
              <Droplets className="h-4 w-4" />
            </span>
            <h4 className="text-base font-bold text-gray-900">近一周饮水量</h4>
          </div>
          <span className="text-[10px] text-gray-400">
            {targets.waterMl > 0 ? `目标 ${(targets.waterMl / 1000).toFixed(1)} L · ${targets.waterBasis}` : '填体重后显示目标'}
          </span>
        </div>

        <div className="mt-2 h-[190px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={week} margin={{ top: 10, right: 8, bottom: 0, left: -8 }} barCategoryGap="42%">
              <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              <YAxis
                domain={[0, waterTop]}
                ticks={waterTicks}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={38}
                tickFormatter={(value: number) => `${(value / 1000).toFixed(1)}L`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ fontSize: 10, color: '#6b7280' }}
                formatter={(value: number) => [`${Math.round(Number(value))} mL`, '饮水']}
              />
              {targets.waterMl > 0 && (
                <ReferenceLine
                  y={targets.waterMl}
                  stroke="#94a3b8"
                  strokeDasharray="6 4"
                  strokeWidth={1.4}
                  label={{ value: '目标', position: 'insideTopRight', fontSize: 10, fill: '#64748b' }}
                />
              )}
              <Bar dataKey="water" fill={COLORS.water} radius={[5, 5, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 口径说明 */}
      <div className="rounded-xl border border-gray-200 bg-slate-50 p-3">
        <div className="flex items-start gap-2 text-[10px] leading-relaxed text-gray-500">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <div className="space-y-1">
            <p>
              <b className="text-gray-700">时间口径</b>：一律按系统日期（本地时区）结算，
              「今日记录」按天分桶、图表横轴取最近 7 个自然日（含今天）；
              「我的档案」每次保存若身高或体重有变化就记一个点，同一天多次保存只保留最后一次。
            </p>
            <p>
              <b className="text-gray-700">数据来源</b>：营养摄入与饮水只取「今日记录」里真实录入的条目与饮水量，
              没记的日子为空（柱子为 0），不做任何估算或填充。
            </p>
            <p>
              <b className="text-gray-700">目标值</b>：钠上限 {targets.sodium.toLocaleString()} mg、钙 {targets.calcium.toLocaleString()} mg
              （{targets.calciumLabel}{targets.calciumSteroid ? ' · 激素期' : ''}）、膳食纤维 {targets.fiber} g
              （{targets.fiberLabel}）、饮水 {targets.waterMl > 0 ? `${targets.waterMl.toLocaleString()} mL` : '待填体重'}，与「今日记录」同一套口径。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
