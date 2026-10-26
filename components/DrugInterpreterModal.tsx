import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import { InterpretationShare } from './InterpretationShare';
import React, { useState, useEffect, useRef } from 'react';
import { FDADrug, UserProfile, ChatMessage, CHINA_STATUS_LABELS, CHINA_STATUS_COLORS } from '../types';
import { analyzeDrug, chatWithDrug } from '../services/geminiService';
import { saveInquiry } from '../services/authService';
import { AdverseEventPanel } from './AdverseEventPanel';
import { X, Send, Bot, User, ShieldCheck, Save, Check, Pill, Microscope, Loader2, AlertTriangle, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Props {
  drug: FDADrug;
  profile: UserProfile;
  onClose: () => void;
}

export const DrugInterpreterModal: React.FC<Props> = ({ drug, profile, onClose }) => {
  const locale = getLocale();
  const [analysis, setAnalysis] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInfoCard, setShowInfoCard] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      setLoading(true);
      const result = await analyzeDrug(drug, profile);
      if (isMounted) {
        setAnalysis(result);
        setLoading(false);
      }
    };
    init();
    return () => { isMounted = false; };
  }, [drug, profile, locale]);

  useEffect(() => {
    if (chatHistory.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, chatLoading]);

  const handleSend = async () => {
    if (!input.trim() || chatLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: input };
    const updatedHistory = [...chatHistory, userMsg];
    setChatHistory(updatedHistory);
    setInput('');
    setChatLoading(true);

    try {
      const responseText = await chatWithDrug(updatedHistory, input, drug, profile);
      const botMsg: ChatMessage = { role: 'model', text: responseText };
      setChatHistory(prev => [...prev, botMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSave = async () => {
      setSaving(true);
      await saveInquiry({
          id: `drug-${drug.brandName}-${Date.now()}`,
          date: new Date().toLocaleDateString(getLocale()),
          articleId: drug.brandName,
          articleTitle: `药物适配: ${contentText(drug.brandName, drug.brandNameCn)}`,
          summary: analysis,
          chatHistory: chatHistory,
          type: 'drug'
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
            <div className="p-2 bg-brand-100 rounded-xl shrink-0">
                <Pill className="w-5 h-5 text-brand-600" />
            </div>
            <h2 className="truncate font-bold text-gray-900 text-base sm:text-lg">{t("ui.drug.suitability.analysis")}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <InterpretationShare title={translateText(contentText(drug.brandName, drug.brandNameCn))} sourceId={drug.brandName} kind="drug" disabled={loading} />
            <button
                onClick={handleSave}
                disabled={loading || saved || saving}
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

          {/* Scrollable upper area: Drug Info + AI Analysis */}
          <div >

            {/* 1. Drug Info Card (Collapsible) */}
            <div className="p-4 pb-0">
              <button
                onClick={() => setShowInfoCard(!showInfoCard)}
                className="w-full flex items-center justify-between bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-gray-300 transition-colors"
              >
                <h3 className="flex items-center text-xs font-bold text-gray-400 uppercase tracking-wider">
                  <Pill className="w-3 h-3 mr-1" /> {t("ui.drug.information")}</h3>
                {showInfoCard ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {showInfoCard && (
                <div className="bg-white px-4 pb-4 rounded-b-xl border-l border-r border-b border-gray-200 -mt-px space-y-4">
                  <div className="flex items-center justify-between pt-3">
                    <h3 className="text-xl font-black text-gray-900">
                      {translateText(contentText(drug.brandName, drug.brandNameCn))}
                      <span className="block text-sm font-medium text-gray-400 font-sans tracking-tight">{translateText(drug.brandName)}</span>
                    </h3>
                    <div className="bg-brand-600 text-white px-3 py-1 rounded-lg text-xs font-bold shadow-sm">FDA {translateText(drug.approvalYear)}</div>
                  </div>
                  <div className="space-y-3 text-sm border-t border-gray-100 pt-3">
                    <div className="flex items-start gap-2">
                      <Microscope className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                      <p className="text-gray-700 font-medium">{translateText(contentText(drug.indication, drug.indicationZh))}</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                      <p className="text-gray-700">{t("ui.dosage")}{translateText(contentText(drug.dosage, drug.dosageZh))}</p>
                    </div>
                  </div>

                  {/* 中国地区可用性 */}
                  <div className={`p-4 rounded-xl border ${CHINA_STATUS_COLORS[drug.chinaStatus || 'unknown']}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4" />
                      <h4 className="text-sm font-bold">{t("ui.availability.in.china")}</h4>
                    </div>
                    <p className="text-sm font-semibold mb-1">
                      {translateText(CHINA_STATUS_LABELS[drug.chinaStatus || 'unknown'])}
                    </p>
                    {drug.chinaStatusNote && (
                      <p className="text-xs leading-relaxed mt-1 opacity-80">{translateText(drug.chinaStatusNote)}</p>
                    )}
                    {!drug.chinaStatusNote && (
                      <p className="text-xs leading-relaxed mt-1 opacity-60">
                        {translateText(drug.chinaStatus === 'approved' ? '该药物已在中国获批上市，患者可在医生指导下使用。' :
                         drug.chinaStatus === 'clinical_trial' ? '该药物正在中国进行临床试验，尚未正式上市。' :
                         drug.chinaStatus === 'nda_review' ? '该药物已提交中国药监局审评，等待获批。' :
                         drug.chinaStatus === 'not_available' ? '该药物暂未在中国上市，需通过其他渠道了解获取方式。' :
                         '暂未收录该药物在中国的可用性信息，建议咨询主治医生了解获取途径。')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 pt-4"><AdverseEventPanel names={[drug.brandName]} context="drug" /></div>

            {/* 2. AI Analysis (Collapsible) */}
            <div className="p-4">
              <button
                onClick={() => setShowAnalysis(!showAnalysis)}
                className="w-full flex items-center justify-between mb-4"
              >
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center">
                  <span className="w-2 h-2 rounded-full bg-brand-500 mr-2"></span>
                  {t("ui.ai.suitability.analysis")}</h3>
                {showAnalysis ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {showAnalysis && (
                <>
                  {loading ? (
                    <div className="space-y-4 animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-4 bg-gray-200 rounded w-full"></div>
                      <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                      <div className="h-32 bg-gray-200 rounded w-full mt-6"></div>
                      <p className="text-center text-gray-400 text-sm mt-4">{t("ui.ai.is.analyzing.drug.suitability")}</p>
                    </div>
                  ) : (
                    <div className="bg-gray-50/50 rounded-xl p-5 border border-gray-100">
                      <div className="prose prose-xs prose-brand max-w-none text-gray-700 leading-relaxed text-xs break-words [overflow-wrap:anywhere]">
                        <ReactMarkdown>{translateText(analysis)}</ReactMarkdown>
                      </div>
                      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 items-start">
                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 leading-5">
                          {t("ui.this.ai.generated.analysis.helps.explain.the.information.and")}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t-2 border-gray-200 mx-4"></div>

          {/* 3. Chat / Consultation Area */}
          <div className="bg-white min-w-0">
            <div className="px-4 pt-3 pb-1">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center">
                <span className="w-2 h-2 rounded-full bg-brand-500 mr-2"></span>
                {t("ui.ask.the.assistant")}</h3>
            </div>
            <div className="p-4 space-y-4 break-words [overflow-wrap:anywhere]">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0 border-2 border-white shadow-sm"><Bot className="w-5 h-5 text-brand-600" /></div>
                <div className="bg-gray-100 rounded-2xl p-4 text-sm text-gray-800 shadow-sm max-w-[85%]">
                  {t("ui.i.am.your.ai.assistant.what.would.you.like")}{translateText(drug.brandName)}{t("ui.message")}</div>
              </div>
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
              {chatLoading && <div className="text-xs text-gray-400 italic ml-12">{t("ui.ai.is.analyzing.the.drug.label")}</div>}
            </div>
            <div className="absolute inset-x-0 bottom-0 z-20 border-t border-gray-100 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:p-4">
              <div className="flex gap-3 relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={t("ui.ask.a.question.e.g.does.this.drug.require")}
                  className="min-w-0 flex-1 border border-gray-200 bg-gray-50 rounded-xl px-5 py-3 pr-12 focus:ring-2 focus:ring-brand-500 outline-none"
                />
                <button onClick={handleSend} disabled={!input.trim() || chatLoading} className="absolute right-2 top-2 p-1.5 bg-brand-600 text-white rounded-lg disabled:opacity-50">
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
