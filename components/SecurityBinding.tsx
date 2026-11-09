import React, { useEffect, useState } from 'react';
import { ChevronLeft, CheckCircle2, Loader2, Mail, Phone, ShieldCheck } from 'lucide-react';
import { apiPost } from '../services/apiClient';
import { checkEmailStatus, checkPhoneStatus } from '../services/authService';
import { translateText } from '../i18n/runtime';

type Method = 'email' | 'phone';
type BindingStatus = { bound: boolean; value: string | null };

function BindingCard({ method }: { method: Method }) {
  const isPhone = method === 'phone';
  const label = isPhone ? '手机号' : '邮箱';
  const Icon = isPhone ? Phone : Mail;
  const [status, setStatus] = useState<BindingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (isPhone) {
        const result = await checkPhoneStatus();
        if (!result) throw new Error('手机号状态加载失败，请重试');
        setStatus({ bound: result.bound, value: result.phone });
      } else {
        const result = await checkEmailStatus();
        if (!result) throw new Error('邮箱状态加载失败，请重试');
        setStatus({ bound: result.bound, value: result.email });
      }
    } catch (err) { setLoadError(err instanceof Error ? err.message : '绑定状态加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [method]);
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (busy || countdown > 0) return;
    const identifier = value.trim();
    if (!(isPhone ? /^1[3-9]\d{9}$/.test(identifier) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier))) {
      setError(isPhone ? '请输入有效的中国大陆手机号' : '请输入有效的邮箱地址');
      return;
    }
    setBusy('send'); setError(''); setMessage('');
    try {
      const result = await apiPost<{ message: string }>(`/api/${method}/send-code`, { [method]: identifier }, { throwOnHttpError: true });
      if (!result) return;
      setSentTo(identifier); setCode(''); setCountdown(60);
      setMessage(result.message || '验证码已发送');
    } catch (err) { setError(err instanceof Error ? err.message : '验证码发送失败'); }
    finally { setBusy(null); }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!sentTo || sentTo !== value.trim()) { setError('请先获取当前绑定地址的验证码'); return; }
    setBusy('verify'); setError(''); setMessage('');
    try {
      const result = await apiPost<{ email?: string; phone?: string }>(`/api/${method}/verify`, { [method]: sentTo, code }, { throwOnHttpError: true });
      if (!result) return;
      // Do not retain the full identifier in the account overview.
      const masked = isPhone ? sentTo.replace(/^(\d{3})\d{4}/, '$1****') : sentTo.replace(/(.{2})(.*)(@.*)/, '$1***$3');
      setStatus({ bound: true, value: masked }); setEditing(false);
      setValue(''); setCode(''); setSentTo(''); setMessage(`${label}绑定成功`);
      void load();
    } catch (err) { setError(err instanceof Error ? err.message : '绑定失败，请重试'); }
    finally { setBusy(null); }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900">{translateText(label)}</h3>
          <p className="mt-1 break-all text-sm text-gray-500">{loading ? '正在获取绑定状态…' : loadError ? '暂时无法获取绑定状态' : status?.bound ? status.value : '未绑定'}</p>
        </div>
        {!loading && !loadError && status?.bound && <span className="flex shrink-0 items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-4 w-4" />已绑定</span>}
        {!loading && !loadError && status && !status.bound && !editing && <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">去绑定</button>}
      </div>
      {loadError && <div role="alert" className="mt-4 text-sm text-red-600">{translateText(loadError)}<button type="button" onClick={load} className="ml-3 underline">重试</button></div>}
      {message && <p role="status" className="mt-4 text-sm text-green-700">{translateText(message)}</p>}
      {editing && !status?.bound && !loadError && (
        <form onSubmit={verify} className="mt-5 space-y-4 border-t border-gray-100 pt-5">
          <div>
            <label htmlFor={`bind-${method}`} className="mb-2 block text-sm text-gray-700">{translateText(label)}</label>
            <input id={`bind-${method}`} type={isPhone ? 'tel' : 'email'} inputMode={isPhone ? 'numeric' : 'email'} autoComplete={isPhone ? 'tel-national' : 'email'} required
              value={value} onChange={event => { setValue(isPhone ? event.target.value.replace(/\D/g, '').slice(0, 11) : event.target.value); setCode(''); setError(''); setMessage(''); }} disabled={!!busy}
              placeholder={isPhone ? '请输入中国大陆手机号' : '请输入邮箱地址'} className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </div>
          <div>
            <label htmlFor={`bind-${method}-code`} className="mb-2 block text-sm text-gray-700">验证码</label>
            <div className="flex gap-2">
              <input id={`bind-${method}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={!!busy} placeholder="6位验证码"
                className="min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              <button type="button" onClick={sendCode} disabled={!!busy || countdown > 0 || !value.trim()} className="shrink-0 rounded-xl border border-gray-200 px-3 text-sm text-brand-600 disabled:text-gray-400">
                {busy === 'send' ? '发送中…' : countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
              </button>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{translateText(error)}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={!!busy || code.length !== 6 || sentTo !== value.trim() || !sentTo} className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy === 'verify' && <Loader2 className="h-4 w-4 animate-spin" />}确认绑定
            </button>
            <button type="button" disabled={!!busy} onClick={() => { setEditing(false); setError(''); setMessage(''); }} className="px-3 py-2 text-sm text-gray-500">取消</button>
          </div>
        </form>
      )}
    </section>
  );
}

export function SecurityBinding({ onBack }: { onBack: () => void }) {
  return <div className="mx-auto max-w-2xl animate-in fade-in duration-300">
    <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600"><ChevronLeft className="h-4 w-4" />返回我的</button>
    <div className="mb-6 flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-brand-600" /><h2 className="text-2xl font-bold text-gray-900">安全绑定</h2></div>
    <p className="mb-6 text-sm text-gray-500">查看账号绑定信息，验证邮箱或手机号后即可绑定。</p>
    <div className="space-y-4"><BindingCard method="phone" /><BindingCard method="email" /></div>
  </div>;
}
