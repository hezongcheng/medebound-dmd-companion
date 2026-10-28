import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import { ageFromBirthDate, businessToday, normalizeProfile } from '../server/profileRules.mjs';
import { normalizeContentPreference } from '../utils/contentPreference.mjs';
import React, { useEffect, useMemo, useState } from 'react';
import { UserProfile, Region, InterestArea } from '../types';
import {
  Accessibility,
  BedSingle,
  Check,
  CheckCircle,
  Footprints,
  HeartPulse,
  HelpCircle,
  Moon,
  Pill,
  Save,
  UserRound,
  Wind
} from 'lucide-react';

interface Props {
  initialData?: UserProfile | null;
  onSave: (profile: UserProfile) => void;
  onLogout?: () => void;
  isInitialSetup?: boolean;
}

type MobilityStage = NonNullable<UserProfile['mobilityStage']>;
type RespiratorySupport = NonNullable<UserProfile['respiratorySupport']>;
type SteroidStatus = NonNullable<UserProfile['steroidStatus']>;
type SteroidMedication = NonNullable<UserProfile['steroidMedication']>;
type MutationType = NonNullable<UserProfile['mutationType']>;

const PROVINCES = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省',
  '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省',
  '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省',
  '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区',
  '香港特别行政区', '澳门特别行政区', '台湾省', '海外'
];

const EXONS = Array.from({ length: 79 }, (_, index) => index + 1);

const mobilityOptions: Array<{ value: MobilityStage; label: string; icon: React.ElementType }> = [
  { value: 'independent', label: '独立行走期', icon: Footprints },
  { value: 'assisted', label: '辅助行走期', icon: UserRound },
  { value: 'wheelchair_transition', label: '轮椅过渡期', icon: Accessibility },
  { value: 'wheelchair_dependent', label: '轮椅依赖期', icon: Accessibility }
];

const respiratoryOptions: Array<{ value: RespiratorySupport; label: string; icon: React.ElementType }> = [
  { value: 'none', label: '不需要呼吸支持', icon: Wind },
  { value: 'night', label: '只需要夜间呼吸支持', icon: Moon },
  { value: 'day_and_night', label: '需要白天晚上使用呼吸支持', icon: BedSingle },
  { value: 'continuous', label: '离不开呼吸支持', icon: Wind }
];

const mutationOptions: Array<{ value: MutationType; label: string; color: string }> = [
  { value: 'deletion', label: '外显子缺失', color: 'bg-teal-600' },
  { value: 'duplication', label: '外显子重复', color: 'bg-blue-600' },
  { value: 'nonsense', label: '无义变异', color: 'bg-red-500' },
  { value: 'splice_site', label: '剪接位点变异', color: 'bg-sky-600' },
  { value: 'indel', label: '小缺失/小插入', color: 'bg-green-600' },
  { value: 'missense', label: '错义变异', color: 'bg-purple-600' },
  { value: 'other', label: '其他', color: 'bg-gray-500' },
  { value: 'unsure', label: '不清楚', color: 'bg-gray-400' }
];

const mutationLabels: Record<MutationType, string> = Object.fromEntries(
  mutationOptions.map(option => [option.value, option.label])
) as Record<MutationType, string>;

function getInitialFormData(initialData?: UserProfile | null): Partial<UserProfile> {
  const fallbackMobility: MobilityStage = initialData?.ambulatoryStatus === 'wheelchair'
    ? 'wheelchair_dependent'
    : initialData?.ambulatoryStatus === 'mixed'
      ? 'assisted'
      : 'independent';
  const fallbackSteroids: SteroidStatus = initialData?.onSteroids === 'yes'
    ? 'current'
    : initialData?.onSteroids === 'no'
      ? 'never'
      : 'unsure';

  return {
    ...initialData,
    contentPreference: normalizeContentPreference(initialData?.contentPreference),
    interests: initialData?.interests || [],
    region: initialData?.region || Region.ASIA,
    mobilityStage: initialData?.mobilityStage || fallbackMobility,
    respiratorySupport: initialData?.respiratorySupport || 'none',
    ejectionFraction: initialData?.ejectionFraction ?? undefined,
    steroidStatus: initialData?.steroidStatus || fallbackSteroids,
    mutationType: initialData?.mutationType || 'unsure'
  };
}

const SectionTitle = ({ number, children }: { number: number; children: React.ReactNode }) => (
  <h3 className="mb-4 flex items-center text-lg font-bold text-slate-900 sm:text-xl">
    <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
      {translateText(number)}
    </span>
    {translateText(children)}
  </h3>
);

const ChoiceMark = ({ selected }: { selected: boolean }) => (
  <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white'}`}>
    {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
  </span>
);

export const ProfileForm: React.FC<Props> = ({ initialData, onSave, onLogout, isInitialSetup = false }) => {
  const [formData, setFormData] = useState<Partial<UserProfile>>(() => getInitialFormData(initialData));

  const [today, setToday] = useState(businessToday());
  const [formError, setFormError] = useState('');
  useEffect(() => {
    const refresh = () => setToday(businessToday());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const displayedAge = formData.birthDate ? ageFromBirthDate(formData.birthDate, today) : formData.age;
  const canSubmit = useMemo(
    () => displayedAge != null && displayedAge >= 0 && Boolean(formData.birthDate || initialData) && Boolean(formData.province) && Boolean(formData.mobilityStage),
    [displayedAge, formData.birthDate, initialData, formData.province, formData.mobilityStage]
  );

  const handleInterestToggle = (interest: InterestArea) => {
    const current = formData.interests || [];
    setFormData({
      ...formData,
      interests: current.includes(interest) ? current.filter(item => item !== interest) : [...current, interest]
    });
  };

  const selectMobility = (mobilityStage: MobilityStage) => {
    const ambulatoryStatus: UserProfile['ambulatoryStatus'] = mobilityStage === 'independent'
      ? 'ambulatory'
      : mobilityStage === 'wheelchair_dependent'
        ? 'wheelchair'
        : 'mixed';
    setFormData({ ...formData, mobilityStage, ambulatoryStatus });
  };

  const selectSteroidStatus = (steroidStatus: SteroidStatus) => {
    const onSteroids: UserProfile['onSteroids'] = steroidStatus === 'current'
      ? 'yes'
      : steroidStatus === 'unsure'
        ? 'unsure'
        : 'no';
    setFormData({ ...formData, steroidStatus, onSteroids });
  };

  const handleSubmit = async () => {
    if (!canSubmit || !formData.mobilityStage || !formData.steroidStatus || !formData.mutationType) return;

    const mutationDescription = ['deletion', 'duplication'].includes(formData.mutationType) && formData.exonStart && formData.exonEnd
      ? `外显子 ${formData.exonStart}-${formData.exonEnd} ${formData.mutationType === 'duplication' ? '重复' : '缺失'}`
      : mutationLabels[formData.mutationType];

    try {
    setFormError('');
    await onSave(normalizeProfile({
      ...formData,
      isConfigured: true,
      age: Number(formData.age),
      geneticProfile: mutationDescription,
      ambulatoryStatus: formData.ambulatoryStatus || 'ambulatory',
      onSteroids: formData.onSteroids || 'unsure',
      region: formData.province === '海外' ? Region.OTHER : Region.ASIA,
      interests: formData.interests || [],
      clinicalNotes: formData.clinicalNotes || ''
    }, today) as UserProfile);
    } catch (error) { setFormError((error as Error).message); }
  };

  return (
    <div className={`w-full bg-white ${isInitialSetup ? 'mx-auto max-w-4xl rounded-2xl p-4 shadow-xl sm:p-8' : 'p-0'}`}>
      {isInitialSetup && (
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">{t("ui.welcome.to.hanzhi.dmd.companion")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("ui.complete.your.profile.to.receive.more.relevant.research.and")}</p>
        </div>
      )}

      {formError && <p role="alert" className="mb-4 text-sm text-red-600">{translateText(formError)}</p>}
      <div className="space-y-4 sm:space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <SectionTitle number={1}>{t("ui.basic.information")}</SectionTitle>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">{t("ui.date.of.birth")}</span>
              <input
                type="date"
                max={today}
                className="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                value={formData.birthDate || ''}
                onChange={event => setFormData({ ...formData, birthDate: event.target.value || null })}
              />
              <p className="mt-2 text-sm text-slate-500">{translateText(formData.birthDate
                ? (displayedAge == null ? '请选择有效的出生日期' : `当前年龄：${displayedAge} 周岁，生日后自动更新`)
                : (initialData?.age != null ? `历史年龄：${initialData.age} 岁。请补充出生日期以自动更新年龄` : '请选择出生日期，年龄将自动计算'))}</p>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">{t("ui.province.region")}</span>
              <select
                className="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                value={formData.province || ''}
                onChange={event => setFormData({ ...formData, province: event.target.value })}
              >
                <option value="" disabled>{t("ui.select.a.province.or.region")}</option>
                {PROVINCES.map(province => <option key={province} value={province}>{translateText(province)}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <SectionTitle number={2}>{t("ui.clinical.overview")}</SectionTitle>
          <div className="space-y-6">
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-800">{t("ui.mobility.stage")}</p>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
                {mobilityOptions.map(option => {
                  const selected = formData.mobilityStage === option.value;
                  const Icon = option.icon;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={selected}
                      onClick={() => selectMobility(option.value)}
                      className={`relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center transition sm:min-h-28 sm:flex-row sm:gap-4 ${selected ? 'border-teal-600 bg-teal-50/60 text-teal-800 shadow-sm' : 'border-slate-200 bg-white text-slate-800 hover:border-teal-300'}`}
                    >
                      <Icon className={`h-8 w-8 sm:h-10 sm:w-10 ${selected ? 'text-teal-600' : 'text-slate-500'}`} strokeWidth={1.5} />
                      <span className="text-sm font-semibold sm:text-base">{translateText(option.label)}</span>
                      <ChoiceMark selected={selected} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-800">{t("ui.respiratory.support")}</p>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
                {respiratoryOptions.map(option => {
                  const selected = formData.respiratorySupport === option.value;
                  const Icon = option.icon;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={selected}
                      onClick={() => setFormData({ ...formData, respiratorySupport: option.value })}
                      className={`relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center transition sm:min-h-24 sm:flex-row sm:gap-4 ${selected ? 'border-teal-600 bg-teal-50/60 text-teal-800 shadow-sm' : 'border-slate-200 bg-white text-slate-800 hover:border-teal-300'}`}
                    >
                      <Icon className={`h-8 w-8 sm:h-9 sm:w-9 ${selected ? 'text-teal-600' : 'text-slate-500'}`} strokeWidth={1.5} />
                      <span className="max-w-48 text-sm font-semibold sm:text-base">{translateText(option.label)}</span>
                      <ChoiceMark selected={selected} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="ejection-fraction" className="text-sm font-semibold text-slate-800">{t("ui.left.ventricular.ejection.fraction")}</label>
                <output className="min-w-20 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-center font-semibold text-teal-700">
                  {translateText(formData.ejectionFraction == null ? '未填写' : `${formData.ejectionFraction}%`)}
                </output>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-400">10%</span>
                <input
                  id="ejection-fraction"
                  type="range"
                  min="10"
                  max="80"
                  step="1"
                  disabled={formData.ejectionFraction == null}
                  value={formData.ejectionFraction ?? 58}
                  onChange={event => setFormData({ ...formData, ejectionFraction: Number(event.target.value) })}
                  className="h-2 min-w-0 flex-1 cursor-pointer accent-teal-600 disabled:cursor-not-allowed disabled:opacity-40"
                />
                <span className="text-sm font-semibold text-slate-700">80%</span>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={formData.ejectionFraction == null}
                  onChange={event => setFormData({ ...formData, ejectionFraction: event.target.checked ? undefined : 58 })}
                  className="h-4 w-4 accent-teal-600"
                />
                {t("ui.unknown.skip")}</label>
              <p className="mt-1 text-xs text-slate-500">{t("ui.leave.blank.if.unknown.otherwise.use.the.value.from")}</p>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-800">{t("ui.corticosteroid.use")}</p>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => selectSteroidStatus('current')}
                  className={`relative flex w-full items-center gap-3 px-4 py-3 text-left font-semibold transition ${formData.steroidStatus === 'current' ? 'bg-teal-50 text-teal-800' : 'bg-white text-slate-800'}`}
                >
                  <Pill className="h-5 w-5 text-teal-600" />{t("ui.currently.taking")}<ChoiceMark selected={formData.steroidStatus === 'current'} />
                </button>
                {formData.steroidStatus === 'current' && (
                  <div className="border-t border-teal-100 bg-teal-50/40 px-4 py-1 sm:pl-12">
                    {([
                      ['prednisone', '泼尼松/泼尼松龙'],
                      ['deflazacort', '地夫可特'],
                      ['vamorolone', '伐莫洛酮'],
                      ['other', '其他']
                    ] as Array<[SteroidMedication, string]>).map(([value, label]) => (
                      <label key={value} className="flex cursor-pointer items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
                        <span className="flex items-center gap-3 text-sm font-medium text-slate-700"><Pill className="h-4 w-4 text-teal-500" />{translateText(label)}</span>
                        <input
                          type="radio"
                          name="steroid-medication"
                          checked={formData.steroidMedication === value}
                          onChange={() => setFormData({ ...formData, steroidMedication: value })}
                          className="h-5 w-5 accent-teal-600"
                        />
                      </label>
                    ))}
                  </div>
                )}
                {([
                  ['stopped', '过去使用过，现已停用', Pill],
                  ['never', '从未使用', Pill],
                  ['unsure', '不清楚', HelpCircle]
                ] as Array<[SteroidStatus, string, React.ElementType]>).map(([value, label, Icon]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => selectSteroidStatus(value)}
                    className={`relative flex w-full items-center gap-3 border-t border-slate-200 px-4 py-3 text-left font-semibold transition ${formData.steroidStatus === value ? 'bg-teal-50 text-teal-800' : 'bg-white text-slate-800 hover:bg-slate-50'}`}
                  >
                    <Icon className={`h-5 w-5 ${formData.steroidStatus === value ? 'text-teal-600' : 'text-slate-500'}`} />{translateText(label)}
                    <ChoiceMark selected={formData.steroidStatus === value} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <SectionTitle number={3}>{t("ui.mutation.type")}</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            {mutationOptions.map((option, index) => {
              const selected = formData.mutationType === option.value;
              return (
                <React.Fragment key={option.value}>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, mutationType: option.value, exonStart: option.value === formData.mutationType ? formData.exonStart : undefined, exonEnd: option.value === formData.mutationType ? formData.exonEnd : undefined })}
                    className={`relative flex w-full items-center gap-3 px-4 py-3 text-left font-semibold transition ${index > 0 ? 'border-t border-slate-200' : ''} ${selected ? 'bg-teal-50/70 text-teal-900' : 'bg-white text-slate-800 hover:bg-slate-50'}`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded ${option.color} text-white`}>
                      {selected ? <Check className="h-4 w-4" /> : <span className="h-2 w-2 rounded-sm bg-white/80" />}
                    </span>
                    {translateText(option.label)}
                    <ChoiceMark selected={selected} />
                  </button>
                  {['deletion', 'duplication'].includes(option.value) && selected && (
                    <div className="grid grid-cols-2 gap-3 border-t border-teal-100 bg-teal-50/50 px-4 py-4 sm:pl-14 sm:pr-12">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-slate-600">{t("ui.first.exon")}</span>
                        <select
                          value={formData.exonStart || ''}
                          onChange={event => { const start = Number(event.target.value) || undefined; setFormData({ ...formData, exonStart: start, exonEnd: !start || (formData.exonEnd && formData.exonEnd < start) ? undefined : formData.exonEnd }); }}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
                        >
                          <option value="">{t("ui.select")}</option>
                          {EXONS.map(exon => <option key={exon} value={exon}>{t("ui.exon")}{translateText(exon)}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-slate-600">{t("ui.last.exon")}</span>
                        <select
                          value={formData.exonEnd || ''}
                          onChange={event => setFormData({ ...formData, exonEnd: Number(event.target.value) || undefined })}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
                        >
                          <option value="">{t("ui.select")}</option>
                          {EXONS.filter(exon => !formData.exonStart || exon >= formData.exonStart).map(exon => <option key={exon} value={exon}>{t("ui.exon")}{translateText(exon)}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <SectionTitle number={4}>{t("ui.research.interests")}</SectionTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.values(InterestArea).map(area => {
              const selected = formData.interests?.includes(area) || false;
              return (
                <button
                  type="button"
                  key={area}
                  onClick={() => handleInterestToggle(area)}
                  className={`flex items-center justify-between rounded-xl border p-3 text-sm font-medium transition ${selected ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'}`}
                >
                  <span>{translateText(area)}</span>
                  {selected && <CheckCircle className="h-5 w-5 text-teal-600" />}
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex w-full items-center justify-center rounded-xl bg-teal-600 py-4 text-lg font-bold text-white shadow-lg shadow-teal-500/20 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="mr-2 h-5 w-5" />
          {translateText(isInitialSetup ? '保存并开始使用' : '保存设置')}
        </button>

        {!isInitialSetup && onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 py-3 font-medium text-red-600 transition hover:bg-red-100"
          >
            {t("ui.sign.out")}</button>
        )}
      </div>
    </div>
  );
};
