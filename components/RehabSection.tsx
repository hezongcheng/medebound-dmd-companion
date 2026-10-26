import { t, translateText, contentText, getLocale } from '../i18n/runtime';
﻿import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { UserDatabaseEntry, RehabRecord, RehabStatus, RehabExercise } from '../types';
import { 
  Play, Timer, Trophy, CheckCircle, ChevronRight, 
  BarChart3, Activity, Dumbbell, Calendar, 
  Lock, Unlock, ArrowLeft, AlertCircle, Info,
  ChevronLeft, Pause, Maximize, Minimize, Volume2, VolumeX
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import { saveRehabRecord, saveRehabStatus, getRehabVideos, RehabVideoItem, getRehabLevelStats, RehabLevelStats, startRehabCheckin, recordVideoComplete, completeRehabCheckin, stopRehabCheckin } from '../services/authService';

interface Props {
  userData: UserDatabaseEntry;
  onUpdate: () => void;
}

type RehabView = 'dashboard' | 'stats' | 'status' | 'training';
type StatsPeriod = 'week' | 'month' | 'year';

const LEVELS = [
  { id: 1, name: '10分钟初级1', listTitle: '呼吸与柔韧性维护', duration: 10, description: '基础拉伸与呼吸', videoType: 'level1' },
  { id: 2, name: '10分钟初级2', listTitle: '进阶关节活动度', duration: 10, description: '进阶关节活动度', videoType: 'level2' },
  { id: 3, name: '10分钟初级3', listTitle: '全身稳定性训练', duration: 10, description: '全身稳定性训练', videoType: 'level3' },
];
const LEVEL_UNLOCK_DAYS = 5;
const SINGLE_VIDEO_REPEAT_COUNT = 3;
const PLAYLIST_ROUND_COUNT = 2;

export const RehabSection: React.FC<Props> = ({ userData, onUpdate }) => {
  const [view, setView] = useState<RehabView>('dashboard');
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>('week');
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [showCongrats, setShowCongrats] = useState(false);
  const [currentVideoIdx, setCurrentVideoIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [statusForm, setStatusForm] = useState({
    hasJointPain: userData.profile?.hasJointPain ?? false,
    jointPainDetails: userData.profile?.jointPainDetails || '',
    hasJointContracture: userData.profile?.hasJointContracture ?? false,
    jointContractureDetails: userData.profile?.jointContractureDetails || ''
  });

  const [allVideos, setAllVideos] = useState<RehabVideoItem[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [checkinId, setCheckinId] = useState<number | null>(null);
  const [levelStats, setLevelStats] = useState<RehabLevelStats | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isStartingTraining, setIsStartingTraining] = useState(false);
  const [trainingStartTime, setTrainingStartTime] = useState<number | null>(null);
  const [remainingTime, setRemainingTime] = useState<number>(300);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [seekHint, setSeekHint] = useState<'backward' | 'forward' | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const completedPlaybackOrders = useRef<Set<number>>(new Set());
  const hasStartedRef = useRef(false);
  const checkinIdRef = useRef<number | null>(null);
  const webkitVideoFullscreenRef = useRef(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchVideos = useCallback(async () => {
    setVideosLoading(true);
    try {
      const videos = await getRehabVideos();
      setAllVideos(videos);
    } finally {
      setVideosLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  const fetchLevelStats = useCallback(async () => {
    const stats = await getRehabLevelStats();
    if (stats) setLevelStats(stats);
  }, []);

  useEffect(() => {
    fetchLevelStats();
  }, [fetchLevelStats]);

  const videosByGroup = useMemo(() => {
    return allVideos.reduce<Record<string, RehabVideoItem[]>>((acc, video) => {
      for (const key of video.video_groups) {
        if (!acc[key]) acc[key] = [];
        acc[key].push(video);
      }
      return acc;
    }, {});
  }, [allVideos]);

  const currentLevelInfo = LEVELS.find(l => l.id === selectedLevel);
  const currentVideos = useMemo(() => {
    if (!currentLevelInfo) return allVideos;
    return videosByGroup[currentLevelInfo.videoType] || [];
  }, [currentLevelInfo, allVideos, videosByGroup]);

  // 单视频连续播放 3 遍；多视频列表按顺序完整循环 2 轮。
  const playbackQueue = useMemo(() => {
    if (currentVideos.length === 0) return [];
    const rounds = currentVideos.length === 1 ? SINGLE_VIDEO_REPEAT_COUNT : PLAYLIST_ROUND_COUNT;
    return Array.from({ length: rounds }, () => currentVideos).flat();
  }, [currentVideos]);
  const plannedDurationMinutes = useMemo(() => {
    const totalSeconds = playbackQueue.reduce((sum, video) => sum + (video.duration || 0), 0);
    return Math.max(1, Math.ceil(totalSeconds / 60));
  }, [playbackQueue]);

  const formatVideoTime = (seconds: number): string => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const clearSeekTimers = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (seekTimerRef.current) {
      clearInterval(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    setSeekHint(null);
  }, []);

  const adjustVideoCurrentTime = useCallback((deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const next = Math.max(0, Math.min(video.duration, video.currentTime + deltaSeconds));
    video.currentTime = next;
    setVideoProgress(next);
  }, []);

  const startLongPressSeek = useCallback((direction: 'backward' | 'forward', event: React.PointerEvent<HTMLDivElement>) => {
    if (!isFullscreen) return;
    event.stopPropagation();
    event.preventDefault();
    clearSeekTimers();

    longPressTimerRef.current = setTimeout(() => {
      const firstStep = direction === 'backward' ? -3 : 3;
      const repeatStep = direction === 'backward' ? -2 : 2;
      setSeekHint(direction);
      adjustVideoCurrentTime(firstStep);
      seekTimerRef.current = setInterval(() => {
        adjustVideoCurrentTime(repeatStep);
      }, 160);
    }, 320);
  }, [adjustVideoCurrentTime, clearSeekTimers, isFullscreen]);

  const stopLongPressSeek = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    event?.stopPropagation();
    clearSeekTimers();
  }, [clearSeekTimers]);

  useEffect(() => {
    if (!isTraining || timeLeft <= 0 || timerRef.current) return;

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTraining, currentVideoIdx, timeLeft]);

  useEffect(() => {
    if (isTraining && trainingStartTime && remainingTime > 0) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - trainingStartTime) / 1000);
        const remaining = Math.max(0, 300 - elapsed);
        setRemainingTime(remaining);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isTraining, trainingStartTime]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      clearSeekTimers();
    }
  }, [isFullscreen, clearSeekTimers]);

  useEffect(() => {
    setVideoProgress(0);
    setVideoDuration(0);
    clearSeekTimers();
  }, [currentVideoIdx, clearSeekTimers]);

  useEffect(() => {
    return () => {
      clearSeekTimers();
    };
  }, [clearSeekTimers]);

  useEffect(() => {
    const video = videoRef.current as (HTMLVideoElement & {
      webkitDisplayingFullscreen?: boolean;
      webkitEnterFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
    }) | null;
    if (!video) return;

    const handleWebkitBegin = () => {
      webkitVideoFullscreenRef.current = true;
      setIsFullscreen(true);
    };
    const handleWebkitEnd = () => {
      webkitVideoFullscreenRef.current = false;
      setIsFullscreen(false);
    };

    video.addEventListener('webkitbeginfullscreen', handleWebkitBegin as EventListener);
    video.addEventListener('webkitendfullscreen', handleWebkitEnd as EventListener);
    return () => {
      video.removeEventListener('webkitbeginfullscreen', handleWebkitBegin as EventListener);
      video.removeEventListener('webkitendfullscreen', handleWebkitEnd as EventListener);
    };
  }, [isTraining, currentVideoIdx, currentVideos]);

  useEffect(() => {
    if (!isTraining || view !== 'training') return;
    const video = videoRef.current;
    if (!video) return;

    const tryAutoPlay = async () => {
      try {
        await video.play();
      } catch {
        if (!video.muted) {
          video.muted = true;
          setIsMuted(true);
          try {
            await video.play();
          } catch {
            // iOS may still require explicit user interaction in some contexts.
          }
        }
      }
    };

    const timer = window.setTimeout(() => {
      if (video.paused) {
        void tryAutoPlay();
      }
    }, 0);

    const handleCanPlay = () => {
      if (video.paused) {
        void tryAutoPlay();
      }
    };

    video.addEventListener('canplay', handleCanPlay);
    return () => {
      clearTimeout(timer);
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [isTraining, view, currentVideoIdx]);

  useEffect(() => {
    if (isTraining && timeLeft === 0 && hasStartedRef.current) {
      hasStartedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);

      const currentVideo = playbackQueue[currentVideoIdx];
      const playbackOrder = currentVideoIdx + 1;
      if (currentVideo && checkinId && !completedPlaybackOrders.current.has(playbackOrder)) {
        completedPlaybackOrders.current.add(playbackOrder);
        recordVideoComplete(checkinId, {
          videoId: currentVideo.id,
          videoOrder: playbackOrder,
          watchedSeconds: currentVideo.duration
        });
      }

      if (currentVideoIdx < playbackQueue.length - 1) {
        setCurrentVideoIdx(prev => prev + 1);
        setTimeLeft(playbackQueue[currentVideoIdx + 1]?.duration || 150);
        setIsVideoPlaying(true);
        hasStartedRef.current = true;
      } else {
        handleCompleteTraining();
      }
    }
  }, [timeLeft, isTraining]);

  const level1Streak = levelStats?.level1Streak ?? 0;
  const level2Streak = levelStats?.level2Streak ?? 0;
  const level3Streak = levelStats?.level3Streak ?? 0;
  const isLevel2Unlocked = levelStats?.isLevel2Unlocked ?? false;
  const isLevel3Unlocked = levelStats?.isLevel3Unlocked ?? false;

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

  const handleStartTraining = async (levelId = selectedLevel) => {
    const level = LEVELS.find(item => item.id === levelId);
    const isUnlocked = levelId === 1 || (levelId === 2 && isLevel2Unlocked) || (levelId === 3 && isLevel3Unlocked);
    const videos = level ? videosByGroup[level.videoType] || [] : [];
    if (!level || !isUnlocked || videos.length === 0 || isStartingTraining) return;
    const rounds = videos.length === 1 ? SINGLE_VIDEO_REPEAT_COUNT : PLAYLIST_ROUND_COUNT;
    const queue = Array.from({ length: rounds }, () => videos).flat();
    const durationMinutes = Math.max(1, Math.ceil(queue.reduce((sum, video) => sum + (video.duration || 0), 0) / 60));

    setSelectedLevel(level.id);
    setIsStartingTraining(true);
    try {
      const result = await startRehabCheckin({
        durationPlan: durationMinutes,
        videoCount: queue.length,
        videoGroup: level.videoType
      });
      if (result?.checkinId) {
        setCheckinId(result.checkinId);
        checkinIdRef.current = result.checkinId;
      }
      setIsTraining(true);
      setCurrentVideoIdx(0);
      setTimeLeft(queue[0]?.duration || 150);
      setTrainingStartTime(Date.now());
      setRemainingTime(300);
      completedPlaybackOrders.current.clear();
      hasStartedRef.current = true;
    } finally {
      setIsStartingTraining(false);
    }
  };

  const handleCompleteTraining = async () => {
    if (!selectedLevel || !currentLevelInfo) return;

    setIsCompleting(true);
    try {
      await saveRehabRecord({
        date: new Date().toISOString(),
        duration: plannedDurationMinutes,
        level: selectedLevel,
        exercises: currentVideos.map(v => {
          if (Array.isArray(v.exercises) && v.exercises.length > 0) {
            return v.exercises as RehabExercise[];
          }
          return [{ name: v.title, count: 1 }];
        }).flat()
      });

      completedPlaybackOrders.current.clear();
      setTrainingStartTime(null);
      setRemainingTime(300);
      
      await fetchLevelStats();
      onUpdate();
      
      if (checkinId) {
        const durationActual = trainingStartTime ? Math.floor((Date.now() - trainingStartTime) / 1000) : 0;
        await completeRehabCheckin(checkinId, durationActual);
        setCheckinId(null);
        checkinIdRef.current = null;
      }
      
      setShowCongrats(true);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleStopTraining = async () => {
    if (timerRef.current) clearInterval(timerRef.current);

    setIsStopping(true);
    try {
      if (checkinId) {
        const currentVideo = playbackQueue[currentVideoIdx];
        const playbackOrder = currentVideoIdx + 1;
        if (currentVideo && !completedPlaybackOrders.current.has(playbackOrder)) {
          completedPlaybackOrders.current.add(playbackOrder);
          await recordVideoComplete(checkinId, {
            videoId: currentVideo.id,
            videoOrder: playbackOrder,
            watchedSeconds: currentVideo.duration - timeLeft
          });
        }
        await stopRehabCheckin(checkinId, 0);
      }

      setCheckinId(null);
      checkinIdRef.current = null;
      setTrainingStartTime(null);
      setRemainingTime(300);
      completedPlaybackOrders.current.clear();
      await fetchLevelStats();
      onUpdate();
      setIsTraining(false);
    } finally {
      setIsStopping(false);
    }
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
              <p className="text-lg text-white/80 mb-6">{t("ui.start.your.customized.10.minute.rehabilitation.session.consistency.matters")}</p>
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
              <span className="text-amber-600 text-sm font-bold uppercase tracking-wider block mb-1">{t("ui.consecutive.check.ins")}</span>
              <span className="text-3xl font-black text-amber-900">{translateText(level1Streak)} <small className="text-sm font-normal">{t("ui.days")}</small></span>
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
    if (isTraining && selectedLevel) {
      const levelInfo = LEVELS.find(l => l.id === selectedLevel);
      const currentVideo = playbackQueue[currentVideoIdx];
      return (
        <>
        <div className="space-y-6 animate-in zoom-in-95 duration-300">
          <div className="flex items-center gap-3 px-2">
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center border border-gray-100">
                <Timer className="w-6 h-6 text-brand-600 animate-pulse" />
              </div>
              <div>
                <h3 className="font-black text-gray-900">{translateText(levelInfo?.name)}</h3>
                <p className="text-xs text-gray-400">
                  {translateText(currentVideos.length === 1
                    ? `正在播放第 ${currentVideoIdx + 1} / ${SINGLE_VIDEO_REPEAT_COUNT} 遍`
                    : `正在播放第 ${currentVideoIdx + 1} / ${playbackQueue.length} 个视频（第 ${Math.floor(currentVideoIdx / currentVideos.length) + 1} / ${PLAYLIST_ROUND_COUNT} 轮）`)}
                </p>
              </div>
            </div>

          <div ref={containerRef} className="relative aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl group cursor-pointer" onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('button')) return;
            if (videoRef.current) {
              if (videoRef.current.paused) {
                videoRef.current.play();
              } else {
                videoRef.current.pause();
              }
            }
          }}>
            <video 
              ref={videoRef}
              key={`${currentVideo.id}-${currentVideoIdx}`}
              autoPlay 
              muted={isMuted}
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
              onPlay={() => setIsVideoPlaying(true)}
              onPause={() => setIsVideoPlaying(false)}
              onLoadedMetadata={(e) => {
                const video = e.currentTarget;
                setVideoDuration(video.duration || 0);
                setVideoProgress(video.currentTime || 0);
              }}
              onDurationChange={(e) => {
                setVideoDuration(e.currentTarget.duration || 0);
              }}
              onTimeUpdate={(e) => {
                setVideoProgress(e.currentTarget.currentTime || 0);
              }}
              onEnded={() => {
                if (timerRef.current) clearInterval(timerRef.current);
                hasStartedRef.current = false;
                clearSeekTimers();

                const currentVideo = playbackQueue[currentVideoIdx];
                const playbackOrder = currentVideoIdx + 1;
                if (currentVideo && checkinId && !completedPlaybackOrders.current.has(playbackOrder)) {
                  completedPlaybackOrders.current.add(playbackOrder);
                  recordVideoComplete(checkinId, {
                    videoId: currentVideo.id,
                    videoOrder: playbackOrder,
                    watchedSeconds: currentVideo.duration
                  });
                }

                if (currentVideoIdx < playbackQueue.length - 1) {
                  setCurrentVideoIdx(prev => prev + 1);
                  setTimeLeft(playbackQueue[currentVideoIdx + 1]?.duration || 150);
                  setIsVideoPlaying(true);
                  hasStartedRef.current = true;
                } else {
                  void handleCompleteTraining();
                }
              }}
              onError={(e) => {
                console.error('视频加载错误:', e);
                const video = e.target as HTMLVideoElement;
                console.error('视频URL:', currentVideo.video_url);
                console.error('错误代码:', video.error?.code);
                console.error('错误信息:', video.error?.message);
              }}
            >
              <source src={currentVideo.video_url} type="video/mp4" />
            </video>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none"></div>
            {isFullscreen && (
              <div className="absolute inset-0 z-10 flex">
                <div
                  className="w-1/2 h-full flex items-center justify-start pl-6 select-none"
                  onPointerDown={(e) => startLongPressSeek('backward', e)}
                  onPointerUp={stopLongPressSeek}
                  onPointerCancel={stopLongPressSeek}
                  onPointerLeave={stopLongPressSeek}
                >
                  {seekHint === 'backward' && (
                    <span className="text-white font-black bg-black/45 backdrop-blur-sm px-3 py-1.5 rounded-xl">
                      {t("ui.rewinding")}</span>
                  )}
                </div>
                <div
                  className="w-1/2 h-full flex items-center justify-end pr-6 select-none"
                  onPointerDown={(e) => startLongPressSeek('forward', e)}
                  onPointerUp={stopLongPressSeek}
                  onPointerCancel={stopLongPressSeek}
                  onPointerLeave={stopLongPressSeek}
                >
                  {seekHint === 'forward' && (
                    <span className="text-white font-black bg-black/45 backdrop-blur-sm px-3 py-1.5 rounded-xl">
                      {t("ui.fast.forwarding")}</span>
                  )}
                </div>
              </div>
            )}
            {!isVideoPlaying && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="w-16 h-16 bg-white/30 backdrop-blur-sm rounded-full flex items-center justify-center">
                  <Play className="w-8 h-8 text-white fill-current ml-1" />
                </div>
              </div>
            )}
            <div className="absolute bottom-4 left-4 z-20">
              <p className="text-white font-bold text-sm bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-xl">
                {translateText(currentVideo.title)}
              </p>
            </div>
            <div className={`absolute top-4 right-4 z-20 flex items-center gap-2 transition-opacity ${isFullscreen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoRef.current) {
                    const nextMuted = !videoRef.current.muted;
                    videoRef.current.muted = nextMuted;
                    setIsMuted(nextMuted);
                  }
                }}
                className="w-10 h-10 bg-black/50 backdrop-blur-sm rounded-xl flex items-center justify-center text-white hover:bg-black/70 transition-colors"
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  const container = containerRef.current as (HTMLDivElement & {
                    webkitRequestFullscreen?: () => Promise<void> | void;
                  }) | null;
                  const video = videoRef.current as (HTMLVideoElement & {
                    webkitSupportsFullscreen?: boolean;
                    webkitDisplayingFullscreen?: boolean;
                    webkitEnterFullscreen?: () => void;
                    webkitExitFullscreen?: () => void;
                  }) | null;

                  const inStandardFullscreen = Boolean(document.fullscreenElement);
                  const inWebkitVideoFullscreen = Boolean(video?.webkitDisplayingFullscreen) || webkitVideoFullscreenRef.current;

                  if (inStandardFullscreen) {
                    document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
                    return;
                  }

                  if (inWebkitVideoFullscreen && video?.webkitExitFullscreen) {
                    video.webkitExitFullscreen();
                    setIsFullscreen(false);
                    return;
                  }

                  if (container?.requestFullscreen) {
                    container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {
                      if (video?.webkitEnterFullscreen) {
                        video.webkitEnterFullscreen();
                      }
                    });
                    return;
                  }

                  if (container?.webkitRequestFullscreen) {
                    Promise.resolve(container.webkitRequestFullscreen()).then(() => setIsFullscreen(true)).catch(() => {});
                    return;
                  }

                  if (video?.webkitEnterFullscreen) {
                    video.webkitEnterFullscreen();
                  }
                }}
                className="w-10 h-10 bg-black/50 backdrop-blur-sm rounded-xl flex items-center justify-center text-white hover:bg-black/70 transition-colors"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between text-xs text-gray-500 font-bold mb-2">
              <span>{translateText(formatVideoTime(videoProgress))}</span>
              <span>{translateText(formatVideoTime(videoDuration))}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(videoDuration, 0)}
              step={0.1}
              value={Math.min(videoProgress, videoDuration || videoProgress)}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVideoProgress(next);
                if (videoRef.current) {
                  videoRef.current.currentTime = next;
                }
              }}
              className="w-full h-2 rounded-lg accent-brand-600 cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-4 gap-2">
            {playbackQueue.map((_, i) => (
              <div 
                key={i} 
                className={`h-1.5 rounded-full transition-all ${i === currentVideoIdx ? 'bg-brand-600' : i < currentVideoIdx ? 'bg-brand-200' : 'bg-gray-200'}`}
              ></div>
            ))}
          </div>

          <div className="flex justify-center gap-4">
            <button 
              onClick={() => setShowStopConfirm(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl border-2 border-red-200 text-red-400 font-bold text-sm hover:bg-red-50 hover:border-red-300 hover:text-red-500 transition-all"
            >
              {t("ui.end.session")}</button>
            <button 
              onClick={() => setShowCompleteConfirm(true)}
              disabled={remainingTime > 0}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl border-2 font-bold text-sm transition-all ${
                remainingTime <= 0 
                  ? 'border-green-200 text-green-400 hover:bg-green-50 hover:border-green-300 hover:text-green-500' 
                  : 'border-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {translateText(remainingTime > 0 ? `完成训练 (${Math.floor(remainingTime / 60)}:${(remainingTime % 60).toString().padStart(2, '0')})` : '完成训练')}
            </button>
          </div>
        </div>

        {showStopConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-[2.5rem] p-10 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95">
              <div className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-xl shadow-red-500/30">
                <AlertCircle className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-3xl font-black text-gray-900 mb-4">{t("ui.end.this.session")}</h2>
              <p className="text-gray-500 mb-8 font-medium">{t("ui.this.session.will.not.be.recorded.if.you.end")}</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowStopConfirm(false)}
                  disabled={isStopping}
                  className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-2xl font-black hover:bg-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t("ui.cancel")}</button>
                <button 
                  onClick={async () => { 
                    await handleStopTraining();
                    setShowStopConfirm(false);
                  }}
                  disabled={isStopping}
                  className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black hover:bg-red-700 transition-all shadow-lg shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isStopping ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {t("ui.processing")}</>
                  ) : (
                    "确认终止"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {showCompleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-[2.5rem] p-10 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95">
              <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-xl shadow-green-500/30">
                <CheckCircle className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-3xl font-black text-gray-900 mb-4">{t("ui.complete.this.session")}</h2>
              <p className="text-gray-500 mb-8 font-medium">{t("ui.completing.will.record.this.session.and.check.you.in")}</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowCompleteConfirm(false)}
                  disabled={isCompleting}
                  className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-2xl font-black hover:bg-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t("ui.cancel")}</button>
                <button 
                  onClick={async () => { 
                    await handleCompleteTraining();
                    setShowCompleteConfirm(false);
                  }}
                  disabled={isCompleting}
                  className="flex-1 bg-green-600 text-white py-4 rounded-2xl font-black hover:bg-green-700 transition-all shadow-lg shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isCompleting ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {t("ui.processing")}</>
                  ) : (
                    "确认完成"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {showCongrats && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-[2.5rem] p-10 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95">
              <div className="w-24 h-24 bg-brand-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-xl shadow-brand-500/30">
                <Trophy className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-3xl font-black text-gray-900 mb-4">{t("ui.well.done")}</h2>
              <p className="text-gray-500 mb-8 font-medium">{t("ui.this.session.has.been.recorded.you.can.train.again")}</p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setShowCongrats(false);
                    await handleStartTraining();
                  }}
                  disabled={isStartingTraining}
                  className="flex-1 bg-brand-600 text-white py-4 rounded-2xl font-black hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20 disabled:opacity-50"
                >
                  {translateText(isStartingTraining ? '启动中...' : '再练一遍')}
                </button>
                <button 
                  onClick={async () => { 
                    setShowCongrats(false); 
                    setIsTraining(false);
                    await fetchLevelStats(); 
                    setView('dashboard'); 
                  }}
                  className="flex-1 bg-gray-100 text-gray-700 py-4 rounded-2xl font-black hover:bg-gray-200 transition-all"
                >
                  {t("ui.back.to.home")}</button>
              </div>
            </div>
          </div>
        )}
      </>
      );
    }

    return (
      <>
        <div className="space-y-4 sm:space-y-6 animate-in fade-in">
          <button onClick={() => setView('dashboard')} className="flex min-h-11 items-center text-gray-500 font-bold hover:text-brand-600 transition-colors">
            <ChevronLeft className="w-5 h-5 mr-1" /> {t("ui.back.to.dashboard")}</button>

          <div className="rounded-[28px] border border-gray-100 bg-white/90 px-5 py-9 shadow-sm sm:px-8 sm:py-10">
            <h2 className="sr-only">{t("ui.today.s.training")}</h2>
            <p className="mb-6 text-base leading-relaxed text-gray-500 sm:mb-8 sm:text-lg">{t("ui.consecutive.check.ins.unlock.higher.levels.progress.gradually")}</p>

            <div className="space-y-5" aria-busy={videosLoading}>
              {videosLoading && (
                <div role="status" className="text-center py-8 text-gray-400">{t("ui.loading.videos")}</div>
              )}
              {LEVELS.map(level => {
                const isUnlocked = level.id === 1 || (level.id === 2 && isLevel2Unlocked) || (level.id === 3 && isLevel3Unlocked);
                const unlockProgressStreak = level.id === 2 ? level1Streak : level2Streak;
                const levelVideos = videosByGroup[level.videoType] || [];

                return (
                  <section
                    key={level.id}
                    aria-labelledby={`rehab-level-${level.id}`}
                    className={`rounded-[22px] border-2 p-4 sm:rounded-[26px] sm:p-6 ${isUnlocked ? 'border-[#20b5b0] bg-[#f2fcfc]' : 'border-gray-200 bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-[#d9f3ef] pb-4 sm:pb-5">
                      <h3 id={`rehab-level-${level.id}`} className={`min-w-0 text-lg font-black leading-snug sm:text-2xl ${isUnlocked ? 'text-[#102b42]' : 'text-gray-500'}`}>
                        {translateText(level.listTitle)}
                      </h3>
                      {isUnlocked ? (
                        <button
                          type="button"
                          onClick={() => void handleStartTraining(level.id)}
                          disabled={videosLoading || levelVideos.length === 0 || isStartingTraining}
                          aria-label={translateText(`开始${level.listTitle}`)}
                          className="min-h-11 shrink-0 rounded-full bg-[#00ada5] px-5 py-2 text-base font-bold text-white transition-colors hover:bg-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-24 sm:px-6"
                        >
                          {translateText(isStartingTraining && selectedLevel === level.id ? '启动中...' : '开始')}
                        </button>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-gray-400">
                          <Lock className="h-4 w-4" aria-hidden="true" /> {t("ui.locked")}</span>
                      )}
                    </div>
                    {!isUnlocked && (
                      <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3">
                        <p className="text-xs leading-relaxed text-amber-700">{t("ui.complete.consecutively")}{translateText(LEVEL_UNLOCK_DAYS)} {t("ui.days")}{translateText(LEVELS[level.id - 2].name)} {t("ui.to.unlock")}</p>
                        <div className="mt-2 flex items-center gap-3">
                          <div role="progressbar" aria-label={t("ui.unlock.progress")} aria-valuemin={0} aria-valuemax={LEVEL_UNLOCK_DAYS} aria-valuenow={Math.min(LEVEL_UNLOCK_DAYS, unlockProgressStreak)} className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-100">
                            <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, (unlockProgressStreak / LEVEL_UNLOCK_DAYS) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-amber-700">{translateText(unlockProgressStreak)}/{translateText(LEVEL_UNLOCK_DAYS)} {t("ui.days")}</span>
                        </div>
                      </div>
                    )}
                    {!videosLoading && (
                      <>
                        <p className="mb-3 mt-4 text-sm text-gray-500 sm:text-base">{t("ui.includes")}{translateText(levelVideos.length)} {t("ui.training.videos")}</p>
                        {levelVideos.length > 0 ? (
                          <ul className="space-y-3">
                            {levelVideos.map(video => (
                              <li key={video.id} className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-5 shadow-sm sm:px-5">
                                <span className={`min-w-0 break-words text-base font-bold leading-relaxed sm:text-lg ${isUnlocked ? 'text-[#102b42]' : 'text-gray-500'}`}>{translateText(video.title)}</span>
                                <span aria-label={translateText(`等级 ${level.id}.0`)} className="shrink-0 rounded-lg bg-[#e8faf7] px-2 py-1 text-sm font-bold text-[#269f99]">{translateText(level.id)}.0</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="py-5 text-center text-sm text-gray-400">{t("ui.no.videos.in.this.group")}</p>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
};

