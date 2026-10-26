import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import React, { useRef, useState } from 'react';
import { Share2, X } from 'lucide-react';
import { apiPost } from '../services/apiClient';

export function InterpretationShare({ title, sourceId, kind, disabled }: { title: string; sourceId: string; kind: 'article' | 'drug' | 'trial'; disabled: boolean }) {
  const [publicContent, setPublicContent] = useState({ title: '', summary: '' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const plainSummary = publicContent.summary
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  const characters = Array.from(plainSummary);
  const excerpt = characters.slice(0, 300).join('') + (characters.length > 300 ? '…' : '');
  const shareText = translateText(`罕知 · AI 解读\n${publicContent.title}\n\n${excerpt}\n\n公开资料节选，登录进入专属 AI 咨询：\n${url}`);

  const prepare = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await apiPost<{ id: string; title: string; summary: string }>('/api/interpretation-shares', { sourceId, kind }, { throwOnHttpError: true });
      if (!result) throw new Error('请重新登录后重试');
      const target = new URL(window.location.href);
      target.search = ''; target.hash = `/feed?share=${result.id}`;
      setPublicContent({ title: result.title, summary: result.summary });
      setUrl(target.toString());
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setMessage('解读节选和链接已复制，请粘贴到微信群或好友聊天。');
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      setMessage('请长按或复制已选中的文字，内容中已包含直达链接。');
    }
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title, text: shareText });
      else await copy();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMessage('当前浏览器无法调起分享，请点击“复制解读和链接”后粘贴到聊天。');
    }
  };
  return <>
    <button aria-label={t("ui.share.analysis")} disabled={disabled} onClick={() => setOpen(true)} className="p-2 text-brand-700 rounded-lg hover:bg-brand-50 disabled:opacity-40"><Share2 className="w-5 h-5" /></button>
    {open && <div role="dialog" aria-modal="true" aria-label={t("ui.share.analysis")} className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl p-4 w-full max-w-lg max-h-[95dvh] overflow-y-auto text-gray-800">
        <div className="flex justify-between mb-3"><h3 className="font-bold">{t("ui.share.ai.analysis")}</h3><button aria-label={t("ui.close.share.dialog")} onClick={() => setOpen(false)}><X /></button></div>
        <p className="text-sm text-gray-500 mb-3">{t("ui.only.public.information.and.a.link.are.shared.your")}</p>
        {url ? <>
          <label htmlFor="interpretation-share-text" className="text-sm font-medium">{t("ui.share.content")}</label>
          <textarea id="interpretation-share-text" ref={textRef} readOnly value={shareText} onFocus={e => e.target.select()} className="mt-2 w-full h-72 border rounded-xl p-4 text-sm leading-relaxed" />
        </> : <div className="bg-gray-50 p-4 border rounded-xl whitespace-pre-wrap break-words text-sm leading-relaxed">
          <h4 className="font-bold mb-3">{translateText(title)}</h4>{t("ui.share.content.will.be.generated.from.this.item.s")}</div>}
        <div className="flex flex-wrap gap-3 mt-4">
          {!url && <button disabled={busy} onClick={prepare} className="bg-brand-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">{translateText(busy ? '正在生成…' : '生成分享内容和链接')}</button>}
          {url && <>
            <button onClick={copy} className="bg-brand-600 text-white rounded-lg px-4 py-2">{t("ui.copy.excerpt.and.link")}</button>
            <button onClick={share} className="border rounded-lg px-4 py-2">{t("ui.share.via.device")}</button>
          </>}
        </div>
        <p role="status" className="text-sm mt-3">{translateText(message)}</p>
      </div>
    </div>}
  </>;
}
