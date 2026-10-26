import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import React, { useEffect, useState } from 'react';
import { Activity, ExternalLink, Loader2 } from 'lucide-react';
import { AdverseEventSummary, AEMS_DASHBOARD_URL, fetchAdverseEventSummary } from '../services/adverseEventService';

interface Props {
  names: string[];
  context: 'drug' | 'trial';
}

export const AdverseEventPanel: React.FC<Props> = ({ names, context }) => {
  const [results, setResults] = useState<AdverseEventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const lookupNames = Array.from(new Set(names.map(name => name.trim()).filter(name => name && !/placebo|安慰剂/i.test(name)))).slice(0, 3);
  const key = lookupNames.join('|');

  useEffect(() => {
    let active = true;
    setResults([]);
    if (!lookupNames.length) { setLoading(false); return; }
    setLoading(true);
    Promise.all(lookupNames.map(fetchAdverseEventSummary)).then(items => {
      if (active) setResults(items);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key]);

  return <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
    <h3 className="flex items-center gap-2 text-base font-bold text-gray-900"><Activity className="h-5 w-5 text-teal-600" />{t("ui.fda.adverse.event.reports")}</h3>
    <p className="mt-2 text-xs leading-5 text-gray-600">{t("ui.these.figures.come.from.the.openfda.drug.adverse.event")}</p>
    {context === 'trial' && <p className="mt-2 text-xs leading-5 text-gray-600">{t("ui.only.drugs.named.in.this.trial.are.queried.against")}</p>}
    {!lookupNames.length ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-gray-600">{t("ui.this.trial.does.not.list.interventions.that.can.be")}</p> : loading ? <p className="mt-3 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />{t("ui.loading.public.reports")}</p> : <div className="mt-3 space-y-3">
      {results.map(result => <div key={result.name} className="rounded-lg bg-slate-50 p-3 text-sm text-gray-700">
        <p className="font-semibold text-gray-900">{translateText(result.name)}</p>
        {result.status === 'available' ? <>
          <p className="mt-1">{t("ui.reports.matching.this.name")}{translateText(result.total == null ? '数量未提供' : `${result.total.toLocaleString(getLocale())} 份`)}</p>
          {result.dataUpdatedAt && <p className="mt-1 text-xs text-gray-500">{t("ui.openfda.data.updated")}{translateText(result.dataUpdatedAt)}</p>}
          {result.reactions.length > 0 && <p className="mt-1 text-xs leading-5 text-gray-600">{t("ui.more.frequently.reported.events")}{translateText(result.reactions.map(item => `${item.term}（${item.count.toLocaleString(getLocale())}）`).join('、'))}{t("ui.a.report.may.include.multiple.drugs.and.events")}</p>}
        </> : <p className="mt-1 text-xs text-gray-600">{translateText(result.status === 'no_reports' ? '未检索到该名称的公开报告；这不代表没有风险。' : '公开报告暂时无法获取，请到 FDA 仪表板核对。')}</p>}
        {result.sourceUrl && <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-teal-700 hover:underline">{t("ui.view.the.original.openfda.query")}<ExternalLink className="h-3 w-3" /></a>}
      </div>)}
    </div>}
    <a href={AEMS_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:underline">{t("ui.open.the.public.fda.aems.dashboard")}<ExternalLink className="h-4 w-4" /></a>
    <p className="mt-1 text-xs text-gray-500">{t("ui.the.aems.dashboard.is.updated.more.frequently.this.site")}</p>
  </section>;
};
