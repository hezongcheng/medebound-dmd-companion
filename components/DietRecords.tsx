import React, { useEffect, useRef, useState } from 'react';
import { DietLogPanel } from './DietLogPanel';
import { NutritionManagePanel } from './NutritionManagePanel';
import { getDietRecords, saveDietRecord } from '../services/dietRecords';
import type { DietRecordDay } from '../services/dietRecords';
import { readLogStore } from '../utils/dietLog';
import type { DietLogEntry } from '../utils/dietLog';
import type { DietProfile } from '../utils/dietTargets';
import { dateKeyOf } from '../utils/nutritionTrends';

export function DietRecords({ tab, profile }: { tab: 'log' | 'manage'; profile?: DietProfile | null }) {
  const [today] = useState(() => new Date());
  const date = dateKeyOf(today);
  const from = dateKeyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
  const [days, setDays] = useState<DietRecordDay[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmImport, setConfirmImport] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const writing = useRef(false);
  const active = useRef(false);
  const [legacy] = useState(() => Object.entries(readLogStore()).filter(([day, entries]) => day <= date && entries.length));

  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    setLoadError(false);
    getDietRecords(from, date, controller.signal)
      .then(result => { if (!controller.signal.aborted) setDays(result); })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [from, date, attempt]);

  const current = days?.find(day => day.date === date);
  const updateDay = (day: DietRecordDay) => {
    setDays(previous => [...(previous || []).filter(item => item.date !== day.date), day]);
  };

  const runWrite = async (action: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    setMessage('');
    try {
      await action();
    } catch {
      setMessage('无法确认保存结果，请重试。');
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };

  const updateEntries = (apply: (entries: DietLogEntry[]) => DietLogEntry[]) => {
    void runWrite(async () => {
      const result = await saveDietRecord(date, current?.version ?? 0, apply(current?.entries ?? []));
      updateDay(result.day);
      if (!result.saved) setMessage('这一天的记录已在其他页面更新，已载入最新记录，请重新操作。');
    });
  };

  const importLegacy = () => {
    void runWrite(async () => {
      let imported = 0;
      for (const [day, entries] of legacy) {
        if (!active.current) return;
        const result = await saveDietRecord(day, 0, entries);
        if (result.saved) imported += 1;
        if (day >= from) updateDay(result.day);
      }
      setConfirmImport(false);
      setImportDone(true);
      setMessage(`已导入 ${imported} 天记录，跳过已有记录的日期。`);
    });
  };

  if (!days) {
    return loadError ? (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm" role="alert">
        饮食记录加载失败。
        <button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-2 font-bold text-brand-700">重试</button>
      </div>
    ) : <p role="status" className="p-4 text-sm text-gray-500">正在加载饮食记录…</p>;
  }

  return (
    <>
      {tab === 'log' && legacy.length > 0 && !importDone && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-white p-3 text-sm">
          {confirmImport ? (
            <>
              <p className="mb-2">请确认这台浏览器的旧饮食记录属于当前账号。导入只补充账号中没有记录的日期。</p>
              <button type="button" disabled={saving} onClick={importLegacy} className="font-bold text-brand-700 disabled:opacity-50">确认导入</button>
              <button type="button" disabled={saving} onClick={() => setConfirmImport(false)} className="ml-3 text-gray-600">取消</button>
            </>
          ) : (
            <button type="button" disabled={saving} onClick={() => setConfirmImport(true)} className="font-bold text-brand-700 disabled:opacity-50">导入本机旧饮食记录</button>
          )}
        </div>
      )}
      {(saving || message) && (
        <p role="status" className="mb-3 text-sm text-gray-700">{saving ? '正在保存饮食记录…' : message}</p>
      )}
      {tab === 'log' ? (
        <DietLogPanel profile={profile} dateKey={date} entries={current?.entries ?? []}
          onEntriesChange={updateEntries} saving={saving} saveMessage={message} />
      ) : (
        <NutritionManagePanel profile={profile} today={today}
          dietEntries={Object.fromEntries(days.map(day => [day.date, day.entries]))} />
      )}
    </>
  );
}
