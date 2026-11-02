import { t, translateText } from '../i18n/runtime';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { UserDatabaseEntry } from '../types';
import { 
  Play, CheckCircle, ChevronRight,
  BarChart3, Activity, Dumbbell, Info, ChevronLeft, Calendar, AlertCircle
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { saveRehabStatus, getRehabLevelStats, RehabLevelStats } from '../services/authService';
import { RehabLessons } from './RehabLessons';

interface Props {
  userData: UserDatabaseEntry;
  onUpdate: () => void;
}

type RehabView = 'dashboard' | 'stats' | 'status' | 'training';
type StatsPeriod = 'week' | 'month' | 'year';

const LEVELS = [
  {
    "videoType": "breathing_flexibility",
    "name": "呼吸与柔韧性训练"
  },
  {
    "videoType": "trunk_control",
    "name": "躯干控制训练"
  },
  {
    "videoType": "lower_limb",
    "name": "下肢功能训练"
  },
  {
    "videoType": "upper_limb",
    "name": "上肢功能训练"
  },
  {
    "videoType": "joint_mobility",
    "name": "关节活动度训练"
  },
  {
    "videoType": "level1",
    "name": "10分钟初级1"
  },
  {
    "videoType": "level2",
    "name": "10分钟初级2"
  },
  {
    "videoType": "level3",
    "name": "10分钟初级3"
  }
];

export const RehabSection: React.FC<Props> = ({ userData, onUpdate }) => {
  const [view, setView] = useState<RehabView>('dashboard');
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>('week');
  const [statusForm, setStatusForm] = useState({
    hasJointPain: userData.profile?.hasJointPain ?? false,
    jointPainDetails: userData.profile?.jointPainDetails || '',
    hasJointContracture: userData.profile?.hasJointContracture ?? false,
    jointContractureDetails: userData.profile?.jointContractureDetails || ''
  });
  const [levelStats, setLevelStats] = useState<RehabLevelStats | null>(null);
  const fetchLevelStats = useCallback(async () => {
    const stats = await getRehabLevelStats();
    if (stats) setLevelStats(stats);
  }, []);
  useEffect(() => { void fetchLevelStats(); }, [fetchLevelStats]);

  const statsData = useMemo(() => {
    const history = levelStats?.history || [];
    const now = new Date();

    const getWeekStart = (date: Date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      return d;
    };

    let filterDate: Date;
    if (statsPeriod === 'week') {
      filterDate = getWeekStart(now);
      filterDate.setDate(filterDate.getDate() - 7 * 11);
    } else if (statsPeriod === 'month') {
      filterDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    } else {
      filterDate = new Date(now.getFullYear() - 4, 0, 1);
    }

    const filtered = history.filter(r => {
      const d = new Date(r.checkin_date);
      d.setHours(0, 0, 0, 0);
      return d >= filterDate && d <= now;
    });

    const totalMinutes = filtered.reduce((acc, r) => acc + Math.round((r.duration_actual || 0) / 60), 0);
    const totalSessions = filtered.length;

    const chartDataMap: Record<string, { name: string; minutes: number; count: number; ts: number }> = {};

    filtered.forEach(r => {
      const d = new Date(r.checkin_date);
      let key = '';
      let ts = 0;
      let name = '';

      if (statsPeriod === 'week') {
        const weekStart = getWeekStart(d);
        key = weekStart.toISOString().slice(0, 10);
        ts = weekStart.getTime();
        name = `${weekStart.getMonth() + 1}/${weekStart.getDate()}周`;
      } else if (statsPeriod === 'month') {
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
        key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        ts = monthStart.getTime();
        name = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      } else {
        const yearStart = new Date(d.getFullYear(), 0, 1);
        key = `${d.getFullYear()}`;
        ts = yearStart.getTime();
        name = `${d.getFullYear()}年`;
      }

      if (!chartDataMap[key]) {
        chartDataMap[key] = { name, minutes: 0, count: 0, ts };
      }

      chartDataMap[key].minutes += Math.round((r.duration_actual || 0) / 60);
      chartDataMap[key].count += 1;
    });

    let chartData = Object.values(chartDataMap)
      .sort((a, b) => a.ts - b.ts)
      .map(({ ts, ...rest }) => rest);

    if (chartData.length === 0 && statsPeriod === 'week') {
      chartData = Array.from({ length: 12 }, (_, i) => {
        const weekStart = getWeekStart(now);
        weekStart.setDate(weekStart.getDate() - 7 * (11 - i));
        return { name: `${weekStart.getMonth() + 1}/${weekStart.getDate()}周`, minutes: 0, count: 0 };
      });
    }

    if (chartData.length === 0 && statsPeriod === 'month') {
      chartData = Array.from({ length: 12 }, (_, i) => {
        const m = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        return { name: `${m.getFullYear()}年${m.getMonth() + 1}月`, minutes: 0, count: 0 };
      });
    }

    if (chartData.length === 0 && statsPeriod === 'year') {
      chartData = Array.from({ length: 5 }, (_, i) => {
        const y = now.getFullYear() - (4 - i);
        return { name: `${y}年`, minutes: 0, count: 0 };
      });
    }

    const levelMap: Record<string, number> = {};
    filtered.forEach(r => {
      const groupName = r.video_group || '未分组';
      levelMap[groupName] = (levelMap[groupName] || 0) + 1;
    });
    const levelList = Object.entries(levelMap).map(([name, count]) => ({ name, count }));

    return { totalMinutes, totalSessions, chartData, levelList };
  }, [levelStats, statsPeriod]);

  const handleSaveStatus = async () => {
    await saveRehabStatus({
      date: new Date().toISOString(),
      ...statusForm
    });
    onUpdate();
    setView('dashboard');
  };

  if (view === 'dashboard') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-black text-gray-900">{t("ui.dmd.rehabilitation.center")}</h1>
            <div className="flex items-center gap-2 text-brand-600 bg-brand-50 px-3 py-1 rounded-full text-sm font-bold">
              <Activity className="w-4 h-4" />
              {translateText(levelStats?.todayCompletedGroups && levelStats.todayCompletedGroups.length > 0
                ? '今日已打卡'
                : '今日待打卡')}
            </div>
          </div>
          <p className="text-gray-500 font-medium">{t("ui.personalized.home.rehabilitation.and.check.in.plans.for.your")}</p>
        </div>

        <div className="space-y-6">
          <button 
            onClick={() => setView('training')}
            className="w-full group bg-gradient-to-br from-brand-500 to-brand-700 p-8 rounded-[2rem] shadow-xl shadow-brand-500/20 hover:shadow-brand-500/40 hover:-translate-y-1 transition-all text-left text-white relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Play className="w-32 h-32 fill-current" />
            </div>
            <div className="relative z-10">
              <h3 className="text-3xl font-black mb-2">{t("ui.today.s.guided.training")}</h3>
              <p className="text-lg text-white/80 mb-6">{t('rehab.lessons.dashboardHint')}</p>
              <div className="inline-flex items-center bg-white/20 px-6 py-2 rounded-xl font-bold text-sm backdrop-blur-sm">
                {t("ui.start.now")}<ChevronRight className="w-4 h-4 ml-1" />
              </div>
            </div>
          </button>

          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => setView('stats')}
              className="group bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md hover:-translate-y-1 transition-all text-left"
            >
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mb-3 group-hover:bg-blue-100 transition-colors">
                <BarChart3 className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-1">{t("ui.check.in.history")}</h3>
              <div className="flex items-center text-blue-600 font-bold text-xs">
                {t("ui.view.summary")}<ChevronRight className="w-3 h-3 ml-1" />
              </div>
            </button>

            <button 
              onClick={() => setView('status')}
              className="group bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md hover:-translate-y-1 transition-all text-left"
            >
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center mb-3 group-hover:bg-amber-100 transition-colors">
                <Calendar className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-1">{t("ui.health.update")}</h3>
              <div className="flex items-center text-amber-600 font-bold text-xs">
                {t("ui.record.now")}<ChevronRight className="w-3 h-3 ml-1" />
              </div>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
          <h3 className="font-black text-gray-900 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-brand-500" />
            {t("ui.recent.activity")}</h3>
          <div className="space-y-4">
            {(levelStats?.history || []).slice(0, 3).map((r, idx) => {
              const levelName = LEVELS.find(l => l.videoType === r.video_group)?.name || r.video_group || '跟练';
              return (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                      <Dumbbell className="w-5 h-5 text-brand-600" />
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">{translateText(levelName)}</p>
                      <p className="text-xs text-gray-400">{translateText(new Date(r.checkin_date).toLocaleDateString())}</p>
                    </div>
                  </div>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                </div>
              );
            })}
            {(!levelStats?.history || levelStats.history.length === 0) && (
              <p className="text-center text-gray-400 py-4 italic">{t("ui.no.check.ins.yet.start.your.first.session")}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'stats') {
    return (
      <div className="space-y-6 animate-in fade-in">
        <button onClick={() => setView('dashboard')} className="flex items-center text-gray-500 font-bold hover:text-brand-600 transition-colors">
          <ChevronLeft className="w-5 h-5 mr-1" /> {t("ui.back.to.dashboard")}</button>

        <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
            <div>
              <h2 className="text-2xl font-black text-gray-900">{t("ui.rehabilitation.summary")}</h2>
              <p className="text-gray-500">{t("ui.see.your.progress.through.consistent.practice")}</p>
            </div>
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['week', 'month', 'year'] as StatsPeriod[]).map(p => (
                <button 
                  key={p}
                  onClick={() => setStatsPeriod(p)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statsPeriod === p ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'}`}
                >
                  {translateText(p === 'week' ? '周' : p === 'month' ? '月' : '年')}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-brand-50 p-6 rounded-2xl border border-brand-100">
              <span className="text-brand-600 text-sm font-bold uppercase tracking-wider block mb-1">{t("ui.check.ins.this.period")}</span>
              <span className="text-3xl font-black text-brand-900">{translateText(statsData.totalSessions)} <small className="text-sm font-normal">{t("ui.sessions")}</small></span>
            </div>
            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
              <span className="text-blue-600 text-sm font-bold uppercase tracking-wider block mb-1">{t("ui.training.duration")}</span>
              <span className="text-3xl font-black text-blue-900">{translateText(statsData.totalMinutes)} <small className="text-sm font-normal">{t("ui.minutes")}</small></span>
            </div>
            <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100">
              <span className="text-amber-600 text-sm font-bold uppercase tracking-wider block mb-1">{t('rehab.lessons.totalSessions')}</span>
              <span className="text-3xl font-black text-amber-900">{translateText(levelStats?.totalSessions ?? 0)} <small className="text-sm font-normal">{t("ui.sessions")}</small></span>
            </div>
          </div>

          <div className="h-64 w-full mb-8">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statsData.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis tickFormatter={value => translateText(String(value))} dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <Tooltip 
                  cursor={{ fill: '#f9fafb' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
                  {statsData.chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#14b8a6' : '#0d9488'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div>
            <h4 className="font-black text-gray-900 mb-4">{t("ui.completions.by.level")}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {statsData.levelList.map((ex, i) => {
                const levelName = LEVELS.find(l => l.videoType === ex.name)?.name || ex.name;
                return (
                  <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="font-bold text-gray-700">{translateText(levelName)}</span>
                    <span className="text-brand-600 font-black">{translateText(ex.count)} <small className="text-xs font-normal">{t("ui.sessions")}</small></span>
                  </div>
                );
              })}
              {statsData.levelList.length === 0 && (
                <p className="text-gray-400 italic text-sm">{t("ui.no.check.ins.in.this.period")}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'status') {
    return (
      <div className="space-y-6 animate-in fade-in">
        <button onClick={() => setView('dashboard')} className="flex items-center text-gray-500 font-bold hover:text-brand-600 transition-colors">
          <ChevronLeft className="w-5 h-5 mr-1" /> {t("ui.back.to.dashboard")}</button>

        <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm">
          <h2 className="text-2xl font-black text-gray-900 mb-2">{t("ui.health.status.update")}</h2>
          <p className="text-gray-500 mb-8">{t("ui.record.recent.physical.changes.to.help.tailor.rehabilitation.advice")}</p>

          <div className="space-y-8">
            <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <label className="font-black text-gray-900 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  {t("ui.any.recent.joint.pain")}</label>
                <div className="flex bg-white p-1 rounded-lg border border-gray-200">
                  <button 
                    onClick={() => setStatusForm(prev => ({ ...prev, hasJointPain: true }))}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${statusForm.hasJointPain ? 'bg-amber-500 text-white' : 'text-gray-500'}`}
                  >
                    {t("ui.yes")}</button>
                  <button 
                    onClick={() => setStatusForm(prev => ({ ...prev, hasJointPain: false }))}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${!statusForm.hasJointPain ? 'bg-gray-200 text-gray-700' : 'text-gray-500'}`}
                  >
                    {t("ui.no")}</button>
                </div>
              </div>
              {statusForm.hasJointPain && (
                <textarea 
                  placeholder={t("ui.describe.the.location.and.frequency.of.pain")}
                  className="w-full bg-white border border-gray-200 rounded-xl p-4 focus:ring-2 focus:ring-amber-500 outline-none transition-all h-24"
                  value={statusForm.jointPainDetails}
                  onChange={e => setStatusForm(prev => ({ ...prev, jointPainDetails: e.target.value }))}
                />
              )}
            </div>

            <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <label className="font-black text-gray-900 flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-500" />
                  {t("ui.any.recent.joint.contractures")}</label>
                <div className="flex bg-white p-1 rounded-lg border border-gray-200">
                  <button 
                    onClick={() => setStatusForm(prev => ({ ...prev, hasJointContracture: true }))}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${statusForm.hasJointContracture ? 'bg-blue-500 text-white' : 'text-gray-500'}`}
                  >
                    {t("ui.yes")}</button>
                  <button 
                    onClick={() => setStatusForm(prev => ({ ...prev, hasJointContracture: false }))}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${!statusForm.hasJointContracture ? 'bg-gray-200 text-gray-700' : 'text-gray-500'}`}
                  >
                    {t("ui.no")}</button>
                </div>
              </div>
              {statusForm.hasJointContracture && (
                <textarea 
                  placeholder={t("ui.describe.affected.joints.e.g.ankles.knees")}
                  className="w-full bg-white border border-gray-200 rounded-xl p-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all h-24"
                  value={statusForm.jointContractureDetails}
                  onChange={e => setStatusForm(prev => ({ ...prev, jointContractureDetails: e.target.value }))}
                />
              )}
            </div>

            <button 
              onClick={handleSaveStatus}
              className="w-full bg-brand-600 text-white py-4 rounded-2xl font-black hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20"
            >
              {t("ui.save.and.update")}</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'training') {
    return <RehabLessons onBack={() => setView('dashboard')} onProgress={async () => {
      await fetchLevelStats();
      onUpdate();
    }} />;
  }
  return null;
};
