import { t } from '../i18n/runtime';
import React, { useEffect, useState } from 'react';
import {
  AlertCircle, Apple, Bone, ChevronRight, Droplets, Info, Scale, Salad, Utensils, Wind
} from 'lucide-react';
import { UserDatabaseEntry } from '../types';
import { DietLogPanel } from './DietLogPanel';
import { NutritionManagePanel } from './NutritionManagePanel';
import { purgeTestResidue } from '../utils/storageCleanup';
import { calciumTarget, fiberTarget, waterRecommendation } from '../utils/dietTargets';
import type { CalciumRecommendation } from '../utils/dietTargets';

interface Props {
  userData?: UserDatabaseEntry | null;
}

type DietTab = 'guide' | 'log' | 'manage';

const TAB_LABELS: { id: DietTab; label: string }[] = [
  { id: 'guide', label: '营养要点' },
  { id: 'log', label: '今日记录' },
  { id: 'manage', label: '营养管理' },
];

/** 顶部速查：可量化的核心指标（钙 / 纤维随档案年龄与激素状态变，液体随档案体重变） */
const buildKeyMetrics = (
  calcium: CalciumRecommendation,
  fiber: { value: number; label: string; exact: boolean },
  water: { ml: number; label: string; exact: boolean }
): { label: string; value: string; unit: string; note: string }[] => [
  { label: '蛋白质', value: '1.0–1.5', unit: 'g/kg/日', note: '不康复 1.0 / 康复 1.5' },
  { label: '脂肪', value: '<30', unit: '% 总热量', note: '激素治疗期上限' },
  { label: '碳水', value: '45–65', unit: '% 总热量', note: '优先低 GI' },
  {
    label: '钙',
    value: calcium.value.toLocaleString(),
    unit: 'mg/日',
    note: `${calcium.label}${calcium.exact ? '' : '（年龄未填）'}${calcium.steroid ? ' · 激素期' : ''}，含补充剂`
  },
  { label: '维生素 D', value: '≥600', unit: 'IU/日', note: '可至 600–1,000' },
  { label: '钠', value: '≤2,300', unit: 'mg/日', note: '建议 <2,000（约 5 g 盐）' },
  {
    label: '膳食纤维',
    value: String(fiber.value),
    unit: 'g/日',
    note: `${fiber.label}${fiber.exact ? '' : '（年龄未填）'}`
  },
  {
    label: '液体总量',
    value: water.exact ? water.ml.toLocaleString() : '按体重',
    unit: 'mL/日',
    note: water.exact ? `Holliday–Segar：${water.label}` : 'Holliday–Segar 体重法，填体重后自动计算'
  },
];

/** 营养要点卡片（数值依据见页末来源清单） */
const GUIDE_CARDS: {
  id: string;
  icon: React.ElementType;
  tone: string;
  title: string;
  headline: string;
  points: string[];
}[] = [
  {
    id: 'protein',
    icon: Salad,
    tone: 'bg-emerald-50 text-emerald-600',
    title: '蛋白质：先守住底线，再谈上限',
    headline: '保肌底线 ≥1.0 g/kg/日，国内活动期常用 1.2–1.5',
    points: [
      '国际共识并未显示 DMD 需要显著高于健康人群的蛋白摄入，首要目标是不低于底线：≥1.0 g/kg/日。',
      '国内活动期/康复期方案多用 1.2–1.5 g/kg/日。',
      
      '均匀分配到三餐 + 1 次加餐，每餐 20–30 g，比集中在晚餐一次吃完更有利于肌肉蛋白合成。',
      '优质蛋白优先：瘦禽肉、鱼类（三文鱼/金枪鱼/沙丁鱼）、鸡蛋、低脂奶及酸奶、豆腐与豆制品、扁豆、藜麦；避免高钠加工肉制品。',
    ],
  },
  {
    id: 'energy',
    icon: Scale,
    tone: 'bg-amber-50 text-amber-600',
    title: '能量与体重：双相风险，两头都要盯',
    headline: 'REE = 17.7 × 体重(kg) + 657 kcal/日',
    points: [
      '静息能量消耗（REE）用 Schofield 体重方程估算（2018 国际共识推荐）',
      '「今日记录」的能量目标分两条路：独立行走 / 辅助行走用公式 REE = 17.7 × 体重 + 657；轮椅阶段改用实测年龄段值——非独走期直接套公式会因体成分改变而系统性高估。',
      
      
      '间接测热法实测参考：12–14 岁约 1,186、15–17 岁约 1,146、18–29 岁约 1,006 kcal/日——青少年期「低 REE + 低活动」正是肥胖高发的原因。',
      '目标 BMI 维持在同年龄第 10–85 百分位；每月测体重，连续上升或短期内明显下降都需就诊。',
    ],
  },
  {
    id: 'fat',
    icon: Apple,
    tone: 'bg-rose-50 text-rose-600',
    title: '脂肪与碳水：激素期取保守上限',
    headline: '脂肪 20–35% 总热量，激素期 <30%',
    points: [
      '一般上限为脂肪供能比 20–35%；使用泼尼松/地夫可特期间取保守上限 <30% 总热量',
      '换算：每日脂肪上限(g) = 每日总热量(kcal) × 30% ÷ 9。示例：1,600 kcal → 约 53 g/日。',
      '碳水化合物占 45–65% 总热量（4–18 岁蛋白质供能建议占 10–30%），优先低升糖指数来源：全谷物、豆类、非淀粉蔬菜、浆果。',
      '油炸食品、奶油点心与含糖饮料既推高脂肪占比，又挤掉蛋白摄入，是激素期最需要先减掉的一类。',
    ],
  },
  {
    id: 'calcium',
    icon: Bone,
    tone: 'bg-sky-50 text-sky-600',
    title: '钙与维生素D：对冲激素性骨丢失',
    headline: '非激素期 600–1,100；激素期 700–1,300 mg/日',
    points: [
      '钙（非激素治疗男性）：1–3 岁 600、4–8 岁 800、9–18 岁 1,100、19 岁以上 800 mg/日。',
      '激素治疗期推荐更高：1–3 岁 700、4–8 岁 1,100、9–18 岁 1,300、19 岁以上 1,100 mg/日；长期激素者按此档执行并定期监测骨密度。',
      '维生素 D ≥600 IU/日（部分建议 600–1,000 IU）；先查血清 25(OH)D 再定剂量，国内资料显示即使补充 >1,000 IU 仍有超过 20% 的患者缺乏。',
      '钙以食物为主：奶及奶制品、豆腐/豆干、深绿色蔬菜、带骨小鱼虾；不足部分再用补充剂补齐。',
      '钙过量有结石风险，勿盲目叠加。',
      '钙剂与激素、铁剂、部分抗生素错开 2 小时以上服用，避免相互干扰吸收。',
    ],
  },
  {
    id: 'sodium',
    icon: Droplets,
    tone: 'bg-teal-50 text-teal-600',
    title: '钠与液体：别让水肿掩盖问题',
    headline: '钠 ≤2,300 mg/日（建议 <2,000）；液体按体重算（Holliday–Segar）',
    points: [
      '钠上限 ≤2,300 mg/日（约 5.8 g 盐，≈1 平茶匙）；日常建议控制在 2,000 mg/日以内（约 5 g 盐）。激素期严格限钠可减轻体液潴留与「满月脸」外观。',
      '警惕隐形钠：酱油、腌制品、火腿肠等加工肉、方便面、外卖汤汁。',
      '液体按 Holliday–Segar 体重法：1–10 kg 为 100 mL/kg；11–20 kg 为 1,000 + 50 × (kg − 10)；>20 kg 为 1,500 + 20 × (kg − 20)。',
      
      '出现水肿、夜间憋醒、短期体重骤增时，需由医生重新评估液体与钠的限量，不可自行加用利尿剂；心衰或用利尿剂者以心内科限液量为准。',
    ],
  },
  {
    id: 'fiber',
    icon: Utensils,
    tone: 'bg-lime-50 text-lime-600',
    title: '膳食纤维与便秘：DMD 高发但常被忽略',
    headline: '4–8 岁 25、9–13 岁 31、14 岁以上 38 g/日',
    points: [
      '膳食纤维推荐：4–8 岁 25 g、9–13 岁 31 g、14 岁以上 38 g/日，应尽量吃够；「今日记录」按档案年龄自动取目标值。',
      '可溶性纤维（燕麦、火龙果、南瓜、香蕉）+ 足量饮水，比单纯大量粗纤维更温和，也不易腹胀。',
      '规律如厕（餐后 20–30 分钟利用胃结肠反射）、顺时针腹部按摩可辅助；活动量低者尤其需要主动安排。',
      '超过 3 天未排便或伴腹痛、呕吐需就医，不要长期自行使用刺激性泻药。',
    ],
  },
  {
    id: 'swallow',
    icon: Wind,
    tone: 'bg-indigo-50 text-indigo-600',
    title: '吞咽与进食安全',
    headline: '呛咳是肌肉力量问题，不是「吃太快」',
    points: [
      '出现进食呛咳、餐后声音湿哑、反复低热或肺炎，应尽早做吞咽功能评估（言语吞咽治疗师）。',
      '质地调整：软食 → 细软碎食 → 糊状；液体可增稠。避免干、散、黏、带皮带刺以及圆颗粒食物。',
      '进食时坐直、下巴微收、每口少量、完全咽下再下一口，餐后保持坐位 30 分钟。',
      '使用夜间无创通气者，餐前先休息/通气一段时间，避免进食时呼吸肌疲劳导致误吸。',
    ],
  },
  {
    id: 'monitor',
    icon: AlertCircle,
    tone: 'bg-slate-100 text-slate-600',
    title: '监测与营养干预升级',
    headline: '体重下降 >10%/年 须立即干预',
    points: [
      '每次随访评估营养状态、体重与 BMI 百分位（目标第 10–85 百分位），并记录进食量与吞咽情况。',
      '独走期首要风险是超重与肥胖，非独走期首要风险是营养不良与体重下降——两个方向都要同时盯。',
      '经口摄入不足时按阶梯升级：口服营养补充（ONS）→ 鼻胃/肠管 → PEG/PEJ（预计需 >4 周者直接考虑造瘘）。',
      '使用激素、利尿剂、抗凝药或合并心/肾功能异常者，饮食方案须由医生与注册营养师（RDN）共同确定。',
    ],
  },
];

/** 按活动能力分层速查 */
const STAGE_ROWS: { dim: string; walker: string; nonWalker: string }[] = [
  { dim: '首要风险', walker: '超重 / 肥胖', nonWalker: '营养不良 / 体重下降' },
  { dim: '总能量', walker: '健康同龄推荐量 × 80%', nonWalker: '健康同龄 × 70%（经验值 1,000–1,500 kcal/日）' },
  { dim: '蛋白质', walker: '不康复 1.0、规律康复 1.5 g/kg/日', nonWalker: '维持同等或略高，防瘦体重流失' },
  { dim: '脂肪上限', walker: '<30% 总热量（激素期）', nonWalker: '<30% 总热量（激素期）' },
  { dim: '监测重点', walker: '每次随访评估营养状态', nonWalker: '体重下降 >10%/年 须立即干预' },
  { dim: '干预升级', walker: '限能量 + 安全范围内的活动', nonWalker: 'ONS → 鼻胃/肠管 → PEG/PEJ（>4 周）' },
];

const SOURCES: { label: string; cite: string }[] = [
  { label: '国际共识指南（营养/吞咽/胃肠管理）', cite: 'Birnkrant DJ, et al. Lancet Neurol. 2018;17(3):251-67. PMID: 29395989' },
  { label: 'DMD 营养挑战综述', cite: 'Salera S, et al. Nutrients. 2017;9(6):594. PMID: 28604599' },
  { label: 'REE 预测方程验证', cite: 'Elliott SA, et al. Eur J Paediatr Neurol. 2012;16(6):631-5. PMID: 22497714' },
  { label: 'DMD 实测静息能量消耗', cite: 'Shimizu-Fujiwara M, et al. Brain Dev. 2012;34(3):206-12. PMID: 21632191' },
  { label: '4–18 岁摄入与体重关系', cite: 'Dietvorst CAW, et al. J Neuromuscul Dis. 2022;9(6):701-711. PMID: 36214005' },
  { label: 'BMI 在丧失独走前已升高', cite: 'Houwen-van Opstal SLS, et al. Neuromuscul Disord. 2022;32(3):236-244. PMID: 35232615' },
  { label: 'DMD 儿童营养问题横断面', cite: 'Wernio E, et al. Nutrients. 2024;16(13):2143. PMID: 38999890' },
  { label: '激素治疗期营养注意事项', cite: 'Muscular Dystrophy Association (MDA) 患者教育资料' },
  { label: '一般人群膳食参考摄入量', cite: 'NASEM / IOM Dietary Reference Intakes；NIH ODS Fact Sheets' },
];

export const DietSection: React.FC<Props> = ({ userData }) => {
  const [tab, setTab] = useState<DietTab>('guide');

  /**
   * 一次性清理早期测试时钟留下的「未来日期」数据：身体测量快照、食物/饮水日期桶，
   * 以及两个已无代码读取的旧键。只删晚于今天的数据，真实历史一条不动。
   * 放在挂载时执行，可保证「今日记录」「营养管理」两个页签读到的都是干净数据。
   */
  useEffect(() => {
    purgeTestResidue();
  }, []);

  const profile = userData?.profile;
  const steroidHint = profile?.onSteroids === 'yes' || profile?.steroidStatus === 'current';
  const swallowHint = Boolean(profile?.respiratorySupport && profile.respiratorySupport !== 'none');
  // 钙与纤维按档案年龄 / 激素状态取值，液体按档案体重取值；速查卡与提示语都跟着变
  const calciumRec = calciumTarget(profile?.age, steroidHint);
  const fiberRec = fiberTarget(profile?.age);
  const waterRec = waterRecommendation(Number(profile?.weightKg) || undefined);
  const keyMetrics = buildKeyMetrics(calciumRec, fiberRec, waterRec);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* 标题 */}
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-900">{t('ui.diet')}</h2>
        <p className="mt-1 text-sm text-gray-500">
          DMD 的营养管理要防双重风险：早期要防超重，晚期要防消瘦。
        </p>
      </div>

      {/* 分段：营养要点 / 今日记录 */}
      <div className="mb-5 flex gap-2 overflow-x-auto scrollbar-hide">
        {TAB_LABELS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-bold transition-all ${
              tab === item.id
                ? 'border-brand-200 bg-brand-50 text-brand-700 shadow-sm'
                : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200 hover:text-brand-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'guide' && (
        <>
        {/* 个性化提示 */}
        {(steroidHint || swallowHint) && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              {steroidHint && <div>正在使用糖皮质激素：脂肪取 &lt;30% 总热量的保守上限、添加脂肪 ≤3 茶匙/日，蛋白按 1.0（不康复）/1.5（规律康复）g/kg，钙按 {calciumRec.value.toLocaleString()} mg/日（{calciumRec.label} · 激素期）、维生素 D ≥600 IU/日执行，并定期监测骨密度。</div>}
              {swallowHint && <div>存在呼吸支持：进食前先休息/通气，少量慢咽，避免进食疲劳导致呛咳与误吸。</div>}
            </div>
          </div>
        )}

        {/* 指标速查 */}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {keyMetrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-[11px] font-medium text-gray-500">{metric.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-lg font-bold text-brand-700">{metric.value}</span>
                <span className="text-[11px] text-gray-500">{metric.unit}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-gray-400">{metric.note}</div>
            </div>
          ))}
        </div>

        {/* 要点卡片 */}
        <div className="space-y-3">
          {GUIDE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-start gap-3">
                  <span className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl ${card.tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-base font-bold text-gray-900">{card.title}</h3>
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{card.headline}</span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {card.points.map((point) => (
                        <li key={point} className="flex items-start gap-2 text-sm leading-relaxed text-gray-600">
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-400" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 分层速查 */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="text-base font-bold text-gray-900">按活动能力分层速查</h3>
          <p className="mt-0.5 text-xs text-gray-500">同一位患者在不同阶段的目标是不同的，方案要随行走能力调整。</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-500">
                  <th className="pb-2 pr-3 font-medium">维度</th>
                  <th className="pb-2 pr-3 font-medium">独走期（儿童 / 少年）</th>
                  <th className="pb-2 font-medium">非独走期（青少年 / 成人）</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_ROWS.map((row) => (
                  <tr key={row.dim} className="border-t border-gray-100 align-top">
                    <td className="py-2 pr-3 text-xs font-bold text-gray-700">{row.dim}</td>
                    <td className="py-2 pr-3 text-xs leading-relaxed text-gray-600">{row.walker}</td>
                    <td className="py-2 text-xs leading-relaxed text-gray-600">{row.nonWalker}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 来源 */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-slate-50 p-4">
          <h3 className="text-sm font-bold text-gray-700">参考来源</h3>
          <ul className="mt-2 space-y-1">
            {SOURCES.map((source) => (
              <li key={source.cite} className="text-[11px] leading-relaxed text-gray-500">
                <span className="font-medium text-gray-600">{source.label}：</span>
                {source.cite}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-start gap-2 border-t border-gray-200 pt-3 text-[11px] leading-relaxed text-gray-500">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>
              以上为人群平均水平参考，不能替代临床诊疗。所有指标须结合体重、年龄、激素使用、独走能力、BMI、人体成分与合并症（心功能、呼吸功能）由注册营养师（RDN）个体化落实，并在每次随访时复评。
            </span>
          </div>
        </div>
        </>
      )}

      {/* 今日记录：食物库选择 + 今日清单 + 营养合计 */}
      {tab === 'log' && <DietLogPanel profile={profile} />}

      {/* 营养管理：身高/体重/BMI 走势 + 近一周营养（含钠钙纤维）与饮水 */}
      {tab === 'manage' && <NutritionManagePanel profile={profile} />}
    </div>
  );
};
