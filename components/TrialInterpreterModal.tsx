import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import { InterpretationShare } from './InterpretationShare';
import React, { useState, useEffect, useRef } from 'react';
import { ClinicalTrial, UserProfile, ChatMessage } from '../types';
import { analyzeTrial, chatWithTrial } from '../services/geminiService';
import { fetchTrialMatches, fetchTrialSites, TrialMatchResult, TrialSite } from '../services/trialService';
import { saveInquiry } from '../services/authService';
import { AdverseEventPanel } from './AdverseEventPanel';
import { X, Send, Bot, User, Microscope, Save, Check, MapPin, Info, Loader2, ChevronDown, ChevronUp, Building2, Phone, Mail, Sparkles, CircleHelp, CircleX } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Props {
  trial: ClinicalTrial;
  profile: UserProfile;
  onClose: () => void;
}

const phaseText = (phases: string[]) => phases.map(phase => {
  const early = phase.match(/^EARLY_PHASE(\d+)$/i);
  const standard = phase.match(/^PHASE(\d+)$/i);
  return early ? `早期${early[1]}期` : standard ? `${standard[1]}期` : phase.replace(/_/g, ' ');
}).join('、') || '未提供';
const statusText: Record<string, string> = {
  RECRUITING: '正在招募', NOT_YET_RECRUITING: '尚未招募', ACTIVE_NOT_RECRUITING: '活跃，未招募',
  COMPLETED: '已完成', TERMINATED: '已终止', SUSPENDED: '已暂停', ENROLLING_BY_INVITATION: '仅邀请入组'
};

export const TrialInterpreterModal: React.FC<Props> = ({ trial, profile, onClose }) => {
  const locale = getLocale();
  const [analysis, setAnalysis] = useState<string>('');
  const [analysisForKey, setAnalysisForKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInfoCard, setShowInfoCard] = useState(true);
  const [showMatch, setShowMatch] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [selectedSite, setSelectedSite] = useState(0);
  const [sites, setSites] = useState<TrialSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [matchResult, setMatchResult] = useState<TrialMatchResult | null>(null);
  const [matchLoading, setMatchLoading] = useState(true);
  const analysisCache = useRef(new Map<string, string>());

  const scrollRef = useRef<HTMLDivElement>(null);
  const centerNames = sites.length ? sites.map(site => site.facility || [site.city, site.country].filter(Boolean).join(', ')) : trial.locations;
  const selectedLocation = centerNames[selectedSite];
  const site = sites[selectedSite];
  const selectedCenterKey = `${locale}|${trial.nctId}|${selectedSite}|${site?.facility || selectedLocation || ''}|${site?.city || ''}|${site?.country || ''}`;
  const activeCenterKey = useRef(selectedCenterKey);
  activeCenterKey.current = selectedCenterKey;
  const activeMatchResult = matchResult?.selectedCenterKey === selectedCenterKey ? matchResult : null;
  const matching = matchLoading || sitesLoading || (!!matchResult && !activeMatchResult);
  const currentAnalysisKey = activeMatchResult ? JSON.stringify({ locale, trial: trial.nctId, phase: trial.phase,
    summary: trial.summary, profile, criteria: activeMatchResult.criteria,
    studyPhases: activeMatchResult.studyPhases, rows: activeMatchResult.rows,
    centerRequirements: activeMatchResult.centerSpecialRequirements }) : '';
  const matchRows = activeMatchResult?.rows || [];
  const matchCount = matchRows.filter(row => row.state === 'match').length;
  const pendingCount = matchRows.filter(row => row.state === 'pending').length;
  const mismatchCount = matchRows.filter(row => row.state === 'mismatch').length;
  const unknownCount = matchRows.filter(row => row.state === 'unknown').length;
  const contact = site?.contacts?.[0];
  const address = site ? [site.city, site.state, site.zip, site.country].filter(Boolean).join(', ') : '';
  const trialStatus = site?.status === 'RECRUITING' ? '该中心招募中' : statusText[site?.status || trial.status] || (site?.status || trial.status)?.replace(/_/g, ' ') || '状态未提供';
  const materials = (trial.suggestedMaterials || []).map(value => String(value || '').trim()).filter(Boolean);
  const materialsText = materials
    .filter((value, index, values) => values.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index)
    .join('、') || '无';

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    if (sitesLoading) return;
    let isMounted = true;
    setMatchLoading(true);
    setMatchResult(null);
    setLoading(true);
    fetchTrialMatches(trial.nctId, profile, site ? { facility: site.facility, city: site.city, country: site.country } : selectedLocation).then(result => {
      if (isMounted) {
        setMatchResult(result ? { ...result, selectedCenterKey } : null);
        setMatchLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, [trial.nctId, profile, selectedLocation, selectedSite, selectedCenterKey, sitesLoading]);

  useEffect(() => {
    if (matching) return;
    if (!activeMatchResult) {
      setAnalysis('请先取得试验入排标准及患者条件匹配结果，再生成个性化介绍。');
      setLoading(false);
      return;
    }
    let isMounted = true;
    const cached = analysisCache.current.get(currentAnalysisKey);
    if (cached) {
      setAnalysis(cached);
      setAnalysisForKey(currentAnalysisKey);
      setLoading(false);
      return;
    }
    const init = async () => {
      setLoading(true);
      const result = await analyzeTrial(trial, profile, activeMatchResult.rows,
        site ? { facility: site.facility, city: site.city, country: site.country } : selectedLocation);
      if (isMounted) {
        if (!/^(服务暂时不可用|登录已过期|网络连接出现问题|抱歉)/.test(result)) analysisCache.current.set(currentAnalysisKey, result);
        setAnalysis(result);
        setAnalysisForKey(currentAnalysisKey);
        setLoading(false);
      }
    };
    init();
    return () => { isMounted = false; };
  }, [trial, profile, selectedLocation, selectedSite, activeMatchResult, matching, currentAnalysisKey]);

  useEffect(() => {
    let active = true;
    setSitesLoading(true);
    setSites([]);
    setSelectedSite(0);
    fetchTrialSites(trial.nctId).then(result => { if (active) { setSites(result); setSitesLoading(false); } });
    return () => { active = false; };
  }, [trial.nctId]);

  useEffect(() => {
    setChatHistory([]);
  }, [selectedCenterKey]);

  useEffect(() => {
    if (chatHistory.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, chatLoading]);

  const handleSend = async () => {
    if (!input.trim() || chatLoading || matching || !activeMatchResult || loading) return;

    const userMsg: ChatMessage = { role: 'user', text: input };
    const updatedHistory = [...chatHistory, userMsg];
    setChatHistory(updatedHistory);
    setInput('');
    setChatLoading(true);
    const questionCenterKey = selectedCenterKey;

    try {
      const responseText = await chatWithTrial(chatHistory, input, trial, profile,
        site ? { facility: site.facility, city: site.city, country: site.country } : selectedLocation);
      const botMsg: ChatMessage = { role: 'model', text: responseText };
      if (activeCenterKey.current === questionCenterKey) setChatHistory(prev => [...prev, botMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSave = async () => {
      if (matching || !activeMatchResult || loading || analysisForKey !== currentAnalysisKey) return;
      setSaving(true);
      await saveInquiry({
          id: `trial-${trial.nctId}-${Date.now()}`,
          date: new Date().toLocaleDateString(getLocale()),
          articleId: trial.nctId,
          articleTitle: `临床试验匹配: ${contentText(trial.title, trial.titleZh)}`,
          summary: analysis,
          chatHistory: chatHistory,
          type: 'trial'
      });
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-gray-900/70 backdrop-blur-sm">
      <div className="relative bg-white w-full min-w-0 max-w-4xl h-[100dvh] sm:h-[90vh] rounded-none sm:rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-gray-100 flex items-center justify-between gap-2 bg-white shrink-0">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="p-2 bg-purple-100 rounded-xl shrink-0">
                <Microscope className="w-5 h-5 text-purple-600" />
            </div>
            <h2 className="truncate font-bold text-gray-900 text-base sm:text-lg">{t("ui.clinical.trial.eligibility.analysis")}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <InterpretationShare title={translateText(contentText(trial.title, trial.titleZh))} sourceId={trial.nctId} kind="trial" disabled={matching || !activeMatchResult || loading || analysisForKey !== currentAnalysisKey} />
            <button
                onClick={handleSave}
                disabled={matching || !activeMatchResult || loading || analysisForKey !== currentAnalysisKey || saved || saving}
                className={`flex items-center px-2.5 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    saved ? 'bg-green-100 text-green-700' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                }`}
            >
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin"/> : saved ? <Check className="w-4 h-4 mr-1"/> : <Save className="w-4 h-4 mr-1"/>}
                <span className="hidden sm:inline">{translateText(saved ? '已保存' : '保存记录')}</span>
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content Area — unified vertical flow */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain min-h-0 pb-[calc(6rem+env(safe-area-inset-bottom))]">
          <div className="space-y-3 px-4 py-3 sm:px-6 sm:py-5">
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <button onClick={() => setShowInfoCard(!showInfoCard)} className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left">
                <span className="flex items-center gap-3 text-base font-bold text-gray-900"><Building2 className="h-5 w-5 text-teal-600" />{t("ui.trial.and.study.sites")}</span>
                {showInfoCard ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
              </button>
              {showInfoCard && <div className="space-y-3 px-4 py-3">
                <div className="flex items-center justify-between gap-3"><span className="text-xs text-gray-500">{translateText(trial.nctId)}</span><span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{translateText(trialStatus)}</span></div>
                <h3 className="text-lg font-bold leading-7 text-gray-900">{translateText(contentText(trial.title, trial.titleZh))}</h3>
                <div className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-gray-600">
                  <span className="flex items-center gap-2"><Info className="h-4 w-4 text-teal-600" />{t("ui.trial.phase")}{translateText(phaseText(activeMatchResult?.studyPhases || trial.phase))}</span>
                  <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-teal-600" />{t("ui.site")}{translateText(centerNames.length ? `${centerNames.length} 个试验中心` : '未提供')}</span>
                </div>
                <div>
                  <label htmlFor="trial-site" className="mb-1 block text-sm font-medium text-gray-600">{t("ui.select.region.study.site")}</label>
                  <select id="trial-site" value={selectedSite} onChange={event => setSelectedSite(Number(event.target.value))} disabled={!centerNames.length} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-gray-50">
                    {centerNames.length ? centerNames.map((name, index) => <option key={`${name}-${index}`} value={index}>{translateText(sites[index]?.country ? `${sites[index].country} · ` : '')}{translateText(name)}</option>) : <option>{t("ui.no.study.site.information")}</option>}
                  </select>
                </div>
                <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-3 text-sm text-gray-600">
                  <p className="flex gap-3"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" /><span>{t("ui.institution")}{translateText(selectedLocation || '未提供')}</span></p>
                  <p className="flex gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" /><span>{t("ui.address")}{translateText(address || '未提供')}</span></p>
                  <p className="flex gap-3"><User className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" /><span>{t("ui.contact")}{translateText(contact?.name || '未提供')}</span></p>
                  <p className="flex gap-3"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" /><span>{t("ui.phone")}{translateText(contact?.phone || '未提供')}</span></p>
                  <p className="flex gap-3"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" /><span>{t("ui.email")}{translateText(contact?.email || '未提供')}</span></p>
                </div>
              </div>}
              <div className="border-t border-gray-100" />
              <button onClick={() => setShowMatch(!showMatch)} className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left">
                <span className="flex items-center gap-3 text-base font-bold text-gray-900"><User className="h-5 w-5 text-teal-600" />{t("ui.patient.eligibility.matching")}</span>
                {showMatch ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
              </button>
              {showMatch && <div className="px-3 pb-3 pt-1 sm:px-4">
                {matching && <p className="py-3 text-sm text-gray-500">{t("ui.checking.the.selected.site.and.trial.eligibility.criteria")}</p>}
                {!matching && !activeMatchResult && <p className="py-3 text-sm text-amber-700">{t("ui.trial.criteria.are.temporarily.unavailable.please.retry.later.unverified")}</p>}
                {activeMatchResult && <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[510px] text-left text-xs sm:text-sm">
                    <thead className="bg-slate-50 text-gray-600"><tr><th className="px-2 py-2 font-medium">{t("ui.item")}</th><th className="px-2 py-2 font-medium">{t("ui.my.situation")}</th><th className="px-2 py-2 font-medium">{t("ui.trial.requirement")}</th><th className="px-2 py-2 font-medium">{t("ui.match.result")}</th></tr></thead>
                    <tbody>{matchRows.map(row => <tr key={row.label} className="border-b border-gray-100 last:border-0"><th className="px-2 py-2 font-semibold text-gray-800">{translateText(row.label)}</th><td className="px-2 py-2 text-gray-600">{translateText(row.patient)}</td><td title={translateText(row.sourceQuote ? `登记依据：${row.sourceQuote}` : undefined)} className="max-w-[360px] px-2 py-2 text-gray-600 break-words">{translateText(row.requirement)}</td><td className={`whitespace-nowrap px-2 py-2 font-medium ${row.state === 'match' ? 'text-teal-700' : row.state === 'mismatch' ? 'text-red-600' : row.state === 'pending' ? 'text-amber-600' : 'text-gray-500'}`}><span className="inline-flex items-center gap-1">{row.state === 'match' ? <Check className="h-4 w-4 rounded-full bg-teal-500 p-0.5 text-white" /> : row.state === 'mismatch' ? <CircleX className="h-4 w-4" /> : <CircleHelp className="h-4 w-4" />}{translateText(row.state === 'match' ? '初步符合' : row.state === 'mismatch' ? '初步不符合' : row.state === 'pending' ? '待确认' : '未知')}</span></td></tr>)}</tbody>
                  </table>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 px-2 py-3 text-center text-xs font-medium sm:grid-cols-4">
                  <span className="text-teal-700">✓ {translateText(matchCount)} {t("ui.potential.matches")}</span><span className="text-amber-600">? {translateText(pendingCount)} {t("ui.need.confirmation")}</span><span className="text-gray-500">? {translateText(unknownCount)} {t("ui.unknown.2")}</span><span className="text-red-600">× {translateText(mismatchCount)} {t("ui.potential.mismatches")}</span>
                </div>
                <p className="mt-2 flex gap-2 rounded-lg bg-slate-50 px-3 py-3 text-xs leading-5 text-gray-600"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("ui.evidence")}{translateText(activeMatchResult.source)}{t("ui.this.is.ai.assisted.preliminary.screening.the.study.site")}<span className="whitespace-pre-line break-words">{translateText(materialsText)}</span></span></p>
                </>}
              </div>}
            </section>

            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <button onClick={() => setShowAnalysis(!showAnalysis)} className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left">
                <span className="flex items-center gap-3 text-base font-bold text-gray-900"><Sparkles className="h-5 w-5 text-teal-600" />{t("ui.ai.personalized.introduction")}</span>
                {showAnalysis ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
              </button>
              {showAnalysis && <div className="p-4">{matching ? <p className="text-sm text-gray-500">{t("ui.updating.matching.results.for.the.selected.site")}</p> : !activeMatchResult ? <p className="text-sm text-amber-700">{t("ui.retrieve.trial.matching.results.before.generating.a.personalized.introduction")}</p> : loading || analysisForKey !== currentAnalysisKey ? <p className="animate-pulse text-sm text-gray-500">{t("ui.ai.is.analyzing.the.trial.information")}</p> : <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm leading-6 text-gray-700"><div className="prose prose-sm max-w-none break-words"><ReactMarkdown>{translateText(analysis)}</ReactMarkdown></div><p className="mt-3 text-xs text-gray-500">{t("ui.final.eligibility.is.determined.by.formal.screening.at.the")}</p></div>}</div>}
            </section>
            <AdverseEventPanel names={(trial.interventionNames || []).filter((_, index) => ['DRUG', 'BIOLOGICAL'].includes((trial.interventionTypes || [])[index]?.toUpperCase()))} context="trial" />
          </div>

          {/* 3. Chat / Consultation Area */}
          <div className="bg-white min-w-0">
            <div className="p-4 space-y-4 break-words [overflow-wrap:anywhere]">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 border-white ${msg.role === 'user' ? 'bg-gray-800' : 'bg-brand-100'}`}>
                    {msg.role === 'user' ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-brand-600" />}
                  </div>
                  <div className={`max-w-[85%] rounded-2xl p-4 text-sm shadow-sm ${msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}>
                    <ReactMarkdown>{translateText(msg.text)}</ReactMarkdown>
                  </div>
                </div>
              ))}
              {chatLoading && <div className="text-xs text-gray-400 italic ml-12">{t("ui.ai.is.analyzing.trial.data")}</div>}
            </div>
            <div className="absolute inset-x-0 bottom-0 z-20 border-t border-gray-100 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:p-4">
              <div className="flex gap-3 relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={t("ui.ask.a.question.e.g.what.are.the.trial")}
                  className="min-w-0 flex-1 border border-gray-200 bg-gray-50 rounded-xl px-5 py-3 focus:ring-2 focus:ring-brand-500 outline-none"
                />
                <button onClick={handleSend} disabled={!input.trim() || chatLoading || matching || !activeMatchResult || loading} aria-label={t("ui.send.question")} className="absolute right-2 top-2 p-1.5 bg-teal-600 text-white rounded-lg disabled:opacity-50">
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
