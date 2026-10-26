import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import { InterpretationShare } from './InterpretationShare';
import React, { useState, useEffect, useRef } from 'react';
import { Article, UserProfile, ChatMessage, SavedInquiry } from '../types';
import { analyzeArticle, chatWithArticle, getRecommendedQuestions } from '../services/geminiService';
import { saveInquiry } from '../services/authService';
import { apiGet } from '../services/apiClient';
import { X, Send, Bot, User, Sparkles, AlertTriangle, Save, Check, FileText, Users, BookOpen, Loader2, Eye, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Props {
  article: Article;
  profile: UserProfile;
  onClose: () => void;
}

export const AIInterpreterModal: React.FC<Props> = ({ article, profile, onClose }) => {
  const locale = getLocale();
  const [summary, setSummary] = useState<string>('');
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showOriginalContent, setShowOriginalContent] = useState(false);
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [showInfoCard, setShowInfoCard] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [recommendedQuestions, setRecommendedQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
      setLoadingSummary(true);
      const [analysisResult] = await Promise.all([
        analyzeArticle(article, profile),
        fetchArticleContent()
      ]);
      if (isMounted) {
        setSummary(analysisResult);
        setLoadingSummary(false);
      }
    };
    init();
    return () => { isMounted = false; };
  }, [article, profile, locale]);

  const fetchArticleContent = async () => {
    try {
      setLoadingContent(true);
      const data = await apiGet<{ content: string }>(`/api/articles/${article.id}/content`);
      if (data) {
        setOriginalContent(data.content || '');
      }
    } catch (error) {
      console.error('获取原文内容失败:', error);
    } finally {
      setLoadingContent(false);
    }
  };

  useEffect(() => {
    if (chatHistory.length === 0 && !chatLoading) return;

    const frame = window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatHistory, chatLoading]);

  // 分析完成后获取推荐问题
  useEffect(() => {
    if (loadingSummary || !summary) return;
    let isMounted = true;
    const fetchQuestions = async () => {
      setLoadingQuestions(true);
      const questions = await getRecommendedQuestions(article, profile);
      if (isMounted) {
        setRecommendedQuestions(questions);
        setLoadingQuestions(false);
      }
    };
    fetchQuestions();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSummary, locale]);

  const handleSend = async () => {
    if (!input.trim() || chatLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: input };
    const updatedHistory = [...chatHistory, userMsg];
    setChatHistory(updatedHistory);
    setInput('');
    setChatLoading(true);

    try {
      const responseText = await chatWithArticle(updatedHistory, userMsg.text, article, profile);
      const botMsg: ChatMessage = { role: 'model', text: responseText };
      setChatHistory(prev => [...prev, botMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleQuestionClick = async (question: string) => {
    if (chatLoading) return;
    const userMsg: ChatMessage = { role: 'user', text: question };
    const updatedHistory = [...chatHistory, userMsg];
    setChatHistory(updatedHistory);
    setChatLoading(true);

    try {
      const responseText = await chatWithArticle(updatedHistory, question, article, profile);
      const botMsg: ChatMessage = { role: 'model', text: responseText };
      setChatHistory(prev => [...prev, botMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSave = async () => {
      setSaving(true);
      const inquiry: SavedInquiry = {
          id: Date.now().toString(),
          date: new Date().toLocaleDateString(getLocale()),
          articleId: article.id,
          articleTitle: contentText(article.title, article.titleZh),
          summary: summary,
          chatHistory: chatHistory,
          type: 'article'
      };
      await saveInquiry(inquiry);
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-gray-900/70 backdrop-blur-sm">
      <div className="relative bg-white w-full max-w-4xl h-[100dvh] sm:h-[90vh] rounded-none sm:rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 min-w-0">

        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-gray-100 flex items-center justify-between gap-2 bg-white shrink-0">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="p-2 bg-brand-100 rounded-xl shrink-0">
                <Sparkles className="w-5 h-5 text-brand-600" />
            </div>
            <h2 className="truncate font-bold text-gray-900 text-base sm:text-lg">{t("ui.ai.reading.assistant")}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <InterpretationShare title={translateText(contentText(article.title, article.titleZh))} sourceId={article.id} kind="article" disabled={loadingSummary} />
            <button
                onClick={handleSave}
                disabled={loadingSummary || saved || saving}
                className={`flex items-center px-2.5 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    saved
                    ? 'bg-green-100 text-green-700'
                    : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                }`}
            >
                {saving ? (
                   <Loader2 className="w-4 h-4 mr-1 animate-spin"/>
                ) : saved ? (
                   <Check className="w-4 h-4 mr-1"/>
                ) : (
                   <Save className="w-4 h-4 mr-1"/>
                )}
                <span className="hidden sm:inline">{translateText(saved ? '已保存' : saving ? '保存中...' : '保存记录')}</span>
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content Area — unified vertical flow */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain min-h-0 scroll-smooth pb-[calc(5rem+env(safe-area-inset-bottom))]"
        >

          {/* Scrollable upper area: Info Card + AI Analysis */}
          <div>

            {/* 1. Original Article Info (Collapsible) */}
            <div className="p-4 pb-0">
              <button
                onClick={() => setShowInfoCard(!showInfoCard)}
                className="w-full flex items-center justify-between bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-gray-300 transition-colors"
              >
                <h3 className="flex items-center text-xs font-bold text-gray-400 uppercase tracking-wider">
                  <FileText className="w-3 h-3 mr-1" /> {t("ui.source.information")}</h3>
                {showInfoCard ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {showInfoCard && (
                <div className="bg-white px-4 pb-4 rounded-b-xl border-l border-r border-b border-gray-200 -mt-px">
                  <div className="space-y-3">
                    <h4 className="font-bold text-gray-900 text-lg leading-tight break-words [overflow-wrap:anywhere]">
                      {translateText(contentText(article.title, article.titleZh))}
                    </h4>
                    <div className="flex items-start gap-2 text-sm text-gray-600">
                      <Users className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{translateText(article.authors.join(', '))}</span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-brand-700 font-medium">
                      <BookOpen className="w-4 h-4 shrink-0" />
                      <span className="min-w-0 break-words italic [overflow-wrap:anywhere]">{translateText(article.journal)}</span>
                      <span className="text-gray-400 font-normal">| {translateText(article.publicationDate)}</span>
                    </div>
                    <button
                      onClick={() => setShowOriginalContent(true)}
                      disabled={loadingContent && !originalContent}
                      className="mt-3 inline-flex items-center px-3 py-1.5 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {loadingContent && !originalContent ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <Eye className="w-4 h-4 mr-1.5" />
                      )}
                      {t("ui.view.source")}</button>
                  </div>
                </div>
              )}
            </div>

            {/* 2. AI Analysis (Collapsible) */}
            <div className="p-4">
              <button
                onClick={() => setShowAnalysis(!showAnalysis)}
                className="w-full flex items-center justify-between mb-4"
              >
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center">
                  <span className="w-2 h-2 rounded-full bg-brand-500 mr-2"></span>
                  {t("ui.ai.detailed.analysis")}</h3>
                {showAnalysis ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {showAnalysis && (
                <>
                  {loadingSummary ? (
                    <div className="space-y-4 animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-4 bg-gray-200 rounded w-full"></div>
                      <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                      <div className="h-32 bg-gray-200 rounded w-full mt-6"></div>
                      <p className="text-center text-gray-400 text-sm mt-4">{t("ui.ai.is.reading.and.preparing.your.personalized.analysis")}</p>
                    </div>
                  ) : (
                    <div className="bg-gray-50/50 rounded-xl p-5 border border-gray-100">
                      <div className="prose prose-xs prose-brand max-w-none text-gray-700 leading-relaxed text-xs">
                        <ReactMarkdown>{translateText(summary)}</ReactMarkdown>
                      </div>
                      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 items-start">
                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 leading-5">
                          {t("ui.this.ai.generated.summary.helps.explain.the.research.and")}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t-2 border-gray-200 mx-4"></div>

          {/* 3. Chat / Consultation Area — always visible, takes remaining space */}
          <section className="bg-white" aria-labelledby="article-chat-heading">
            <div className="px-4 pt-3 pb-1">
              <h3 id="article-chat-heading" className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center">
                <span className="w-2 h-2 rounded-full bg-brand-500 mr-2"></span>
                {t("ui.ask.the.assistant")}</h3>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0 border-2 border-white shadow-sm">
                  <Bot className="w-5 h-5 text-brand-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-none p-4 text-sm text-gray-800 shadow-sm max-w-[85%]">
                  {t("ui.i.have.read.this.article.what.would.you.like")}</div>
              </div>

              {/* 推荐问题 */}
              {!loadingQuestions && recommendedQuestions.length > 0 && (
                <div className="ml-12 space-y-2">
                  <p className="text-xs text-gray-400 font-medium">{t("ui.try.these.questions")}</p>
                  {recommendedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuestionClick(q)}
                      disabled={chatLoading}
                      className="block w-full text-left px-4 py-2.5 text-sm text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-xl transition-colors disabled:opacity-50"
                    >
                      {translateText(q)}
                    </button>
                  ))}
                </div>
              )}

              {loadingQuestions && (
                <div className="ml-12 flex items-center gap-2 text-xs text-gray-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t("ui.generating.suggested.questions")}</div>
              )}

              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 border-white shadow-sm ${msg.role === 'user' ? 'bg-gray-800' : 'bg-brand-100'}`}>
                    {msg.role === 'user' ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-brand-600" />}
                  </div>
                  <div className={`max-w-[85%] min-w-0 break-words [overflow-wrap:anywhere] rounded-2xl p-4 text-sm shadow-sm ${
                    msg.role === 'user'
                    ? 'bg-gray-900 text-white rounded-tr-none'
                    : 'bg-gray-100 text-gray-800 rounded-tl-none'
                  }`}>
                    <ReactMarkdown>{translateText(msg.text)}</ReactMarkdown>
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0 border-2 border-white shadow-sm">
                    <Bot className="w-5 h-5 text-brand-600" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-tl-none p-4 text-sm text-gray-500 shadow-sm">
                    <span className="animate-pulse flex items-center gap-1">
                      {t("ui.thinking")}<span className="animate-bounce">.</span><span className="animate-bounce delay-100">.</span><span className="animate-bounce delay-200">.</span>
                    </span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} className="h-px" aria-hidden="true" />
            </div>
          </section>
        </div>

        {/* Keep the composer pinned while article analysis and chat share one scroll flow. */}
        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-gray-100 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:p-4">
          <div className="relative flex min-w-0 gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={t("ui.ask.a.question.e.g.is.this.research.safe")}
              className="min-w-0 flex-1 border border-gray-200 bg-gray-50 rounded-xl px-4 sm:px-5 py-3 pr-12 focus:ring-2 focus:ring-brand-500 focus:outline-none transition-shadow"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || chatLoading}
              className="absolute right-2 top-2 p-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm"
              aria-label={t("ui.send.question")}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* 原文内容弹窗 */}
      {showOriginalContent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full max-w-4xl h-[100dvh] sm:h-[85vh] flex flex-col overflow-hidden min-w-0">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-gray-50 shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-gray-800 truncate pr-2 sm:pr-4">
                {translateText(contentText(article.title, article.titleZh))}
              </h3>
              <div className="flex items-center gap-2">
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors"
                  title={t("ui.view.source")}
                >
                  <ExternalLink className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("ui.source.link")}</span>
                </a>
                <button
                  onClick={() => setShowOriginalContent(false)}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {loadingContent ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-4" />
                  <p>{t("ui.loading.article.content")}</p>
                </div>
              ) : originalContent ? (
                <div className="prose prose-sm max-w-none break-words text-gray-700 [overflow-wrap:anywhere]">
                  <ReactMarkdown>{translateText(originalContent)}</ReactMarkdown>
                  <div className="mt-8 pt-6 border-t border-gray-200 not-prose">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t("ui.view.the.full.source.on.pubmed")}</a>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <FileText className="w-12 h-12 mb-4 text-gray-300" />
                  <p className="text-center">{t("ui.source.content.unavailable")}</p>
                  <p className="text-sm text-gray-400 mt-2">{t("ui.full.text.may.not.be.available.please.visit.pubmed")}</p>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors"
                  >
                    {t("ui.go.to.pubmed")}</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
