import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, Lock, Play, RefreshCw } from 'lucide-react';
import { t, translateText } from '../i18n/runtime';
import { fetchLessons, startLesson, completeLesson, stopLesson, LessonCatalog, RehabLesson } from '../services/rehabLessonService';
import { watchedSeconds } from '../utils/rehabPlayback.mjs';

interface Props {
  onBack: () => void;
  onProgress: () => void | Promise<void>;
}

export const RehabLessons: React.FC<Props> = ({ onBack, onProgress }) => {
  const [catalog, setCatalog] = useState<LessonCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ sessionId: number; video: RehabLesson } | null>(null);
  const [completed, setCompleted] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [watched, setWatched] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const watchedRef = useRef(0);
  const completing = useRef(false);
  const starting = useRef(false);
  const activeSession = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const result = await fetchLessons();
    if (!result) throw new Error(t('rehab.lessons.loadError'));
    setCatalog(result);
  }, []);

  useEffect(() => {
    reload().catch(() => setError(t('rehab.lessons.loadError'))).finally(() => setLoading(false));
    return () => {
      // 直接离开模块时关闭未提交的记录，正常返回入口会先保存已达标的学习。
      if (activeSession.current) void stopLesson(activeSession.current).catch(() => {});
    };
  }, [reload]);

  const start = async (video: RehabLesson) => {
    if (starting.current || busy) return;
    starting.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await startLesson(video.id);
      if (!result) throw new Error(t('rehab.lessons.startError'));
      activeSession.current = result.sessionId;
      watchedRef.current = 0;
      setWatched(0);
      setCompleted(false);
      setMediaError(false);
      setSession(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rehab.lessons.startError'));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };

  const finish = async (exitAfterSave = false) => {
    if (!session || completing.current || completed) return;
    const minimum = session.video.required_watch_seconds;
    if (videoRef.current) watchedRef.current = watchedSeconds(videoRef.current.played);
    if (watchedRef.current < minimum) {
      setError(t('rehab.lessons.watchFull'));
      return;
    }
    completing.current = true;
    videoRef.current?.pause();
    setBusy(true);
    setError('');
    try {
      const result = await completeLesson(session.sessionId, watchedRef.current);
      if (!result?.success) throw new Error(t('rehab.lessons.saveError'));
      activeSession.current = null;
      setCompleted(true);
      if (exitAfterSave) {
        setSession(null);
        setNotice(t('rehab.lessons.saved'));
      }
      try {
        await reload();
        await onProgress();
      } catch {
        setError(t('rehab.lessons.refreshError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rehab.lessons.saveError'));
    } finally {
      completing.current = false;
      setBusy(false);
    }
  };

  const leavePlayer = async () => {
    if (busy) return;
    if (session && activeSession.current) {
      if (videoRef.current) watchedRef.current = watchedSeconds(videoRef.current.played);
      if (watchedRef.current >= session.video.required_watch_seconds) {
        await finish(true);
        return;
      }
    }
    setBusy(true);
    try {
      if (activeSession.current) {
        const result = await stopLesson(activeSession.current);
        if (!result?.success) throw new Error(t('rehab.lessons.saveError'));
      }
      activeSession.current = null;
      setSession(null);
      setError('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rehab.lessons.loadError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <button type="button" disabled={busy} onClick={() => session ? void leavePlayer() : onBack()}
        className="flex min-h-11 items-center gap-2 font-bold text-gray-500 hover:text-brand-600 disabled:opacity-50">
        <ArrowLeft className="h-5 w-5" />{session ? t('rehab.lessons.backToList') : t('ui.back.to.dashboard')}
      </button>
      {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-4 text-red-700">{error}</div>}
      {notice && <p role="status" className="rounded-xl bg-brand-50 p-4 font-bold text-brand-700">{notice}</p>}
      {session ? (
        <section className="space-y-5 rounded-3xl border border-gray-100 bg-white p-5 sm:p-8">
          <div>
            <p className="text-sm text-gray-500">{translateText(catalog?.categories.find(c => c.code === session.video.training_category)?.title)}</p>
            <h2 className="mt-1 text-2xl font-black text-gray-900">{translateText(session.video.title)}</h2>
            {session.video.video_version && <span className="mt-2 inline-block rounded-lg bg-brand-50 px-2 py-1 text-sm font-bold text-brand-700">{session.video.video_version}</span>}
          </div>
          <video key={session.sessionId} ref={videoRef} controls={!completed} autoPlay playsInline preload="metadata"
            src={session.video.video_url || undefined} poster={session.video.thumbnail_url || undefined}
            className="aspect-video w-full rounded-2xl bg-black" aria-label={translateText(session.video.title)}
            onError={() => setMediaError(true)}
            onTimeUpdate={event => {
              watchedRef.current = watchedSeconds(event.currentTarget.played);
              setWatched(watchedRef.current);
            }}
            onEnded={event => {
              watchedRef.current = watchedSeconds(event.currentTarget.played);
              setWatched(watchedRef.current);
              void finish();
            }}
          />
          {mediaError && <p role="alert" className="text-sm text-red-600">{t('rehab.lessons.mediaError')}</p>}
          {!completed && <p className="text-sm text-gray-500">{t('rehab.lessons.watchHint', { watched, required: session.video.required_watch_seconds })}</p>}
          {completed ? (
            <div role="status" className="space-y-4 rounded-2xl bg-brand-50 p-5">
              <p className="flex items-center gap-2 font-bold text-brand-700"><CheckCircle className="h-5 w-5" />{t('rehab.lessons.saved')}</p>
              <p className="text-sm text-gray-600">{t('rehab.lessons.completedCount', {
                count: catalog?.videos.find(v => v.id === session.video.id)?.completed_count ?? session.video.completed_count + 1
              })}</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={busy} onClick={() => void start(session.video)} className="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white disabled:opacity-50">{t('rehab.lessons.repeat')}</button>
                <button type="button" disabled={busy} onClick={() => void leavePlayer()} className="rounded-xl bg-white px-5 py-3 font-bold text-brand-700 disabled:opacity-50">{t('rehab.lessons.backToList')}</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy || watched < session.video.required_watch_seconds} onClick={() => void finish(true)}
                className="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? t('ui.processing') : t('rehab.lessons.saveCompletion')}</button>
            </div>
          )}
        </section>
      ) : (
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-black text-gray-900">{t('rehab.lessons.heading')}</h2>
            <p className="mt-2 leading-relaxed text-gray-500">{t('rehab.lessons.rules')}</p>
          </div>
          {loading && <p role="status" className="py-8 text-center text-gray-400">{t('ui.loading.videos')}</p>}
          {!loading && !catalog && <button type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await reload(); setError(''); } catch { setError(t('rehab.lessons.loadError')); } finally { setBusy(false); }
          }} className="flex items-center gap-2 rounded-xl bg-brand-50 px-5 py-3 font-bold text-brand-700"><RefreshCw className="h-4 w-4" />{t('rehab.lessons.retry')}</button>}
          {catalog?.categories.map(category => {
            const videos = catalog.videos.filter(video => video.training_category === category.code);
            return (
              <section key={category.code} className="rounded-3xl border-2 border-[#20b5b0] bg-[#f2fcfc] p-5 sm:p-7" aria-labelledby={`rehab-category-${category.code}`}>
                <h3 id={`rehab-category-${category.code}`} className="border-b border-brand-100 pb-4 text-xl font-black text-[#102b42]">{translateText(category.title)}</h3>
                {videos.length === 0 ? <p className="py-5 text-gray-500">{t(category.code === 'upper_limb' ? 'rehab.lessons.upperPending' : 'rehab.lessons.empty')}</p> : (
                  <ol className="mt-4 space-y-3">
                    {videos.map(video => (
                      <li key={video.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-white p-4 sm:p-5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="break-words text-base font-bold text-[#102b42]">{translateText(video.title)}</h4>
                            {video.video_version && <span className="rounded-lg bg-[#e8faf7] px-2 py-1 text-sm font-bold text-[#269f99]">{video.video_version}</span>}
                          </div>
                          {video.completed_count > 0 && <p className="mt-2 text-sm text-gray-500">{t('rehab.lessons.completedCount', { count: video.completed_count })}</p>}
                          {!video.is_unlocked && <p className="mt-2 text-sm text-amber-700">{
                            video.prerequisite_required > video.prerequisite_count
                              ? t('rehab.lessons.lockReason', { count: video.prerequisite_required - video.prerequisite_count })
                              : t('rehab.lessons.completeEarlier')
                          }</p>}
                        </div>
                        <button type="button" disabled={!video.is_unlocked || busy} onClick={() => void start(video)}
                          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-brand-600 px-5 py-2 font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500">
                          {video.is_unlocked ? <Play className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                          {video.is_unlocked ? t('rehab.lessons.study') : t('ui.locked')}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
