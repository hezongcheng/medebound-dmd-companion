import { LanguageSelector } from './LanguageSelector';
import { t, translateText } from '../i18n/runtime';
import React, { useState, useEffect } from 'react';
import { sendLoginCode, loginWithCode, sendPhoneLoginCode, loginWithPhoneCode, getWechatAuthUrl } from '../services/authService';
import { Logo } from './Logo';
import { ArrowLeft, Loader2, Mail, Smartphone } from 'lucide-react';

interface LoginProps {
    onLoginSuccess: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [loginMode, setLoginMode] = useState<'phone' | 'email' | 'wechat'>('phone');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSendingCode, setIsSendingCode] = useState(false);
    const [wechatLoading, setWechatLoading] = useState(false);
    const [countdowns, setCountdowns] = useState({ phone: 0, email: 0 });
    const countdown = loginMode === 'wechat' ? 0 : countdowns[loginMode];
    const busy = isLoading || isSendingCode || wechatLoading;
    const [codeSent, setCodeSent] = useState(false);

    // 处理微信登录回调
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const wechatToken = urlParams.get('wechat_token');
        const wechatUsername = urlParams.get('wechat_username');
        const wechatError = urlParams.get('wechat_error');
        
        // 清除URL参数
        if (wechatToken || wechatError) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        
        if (wechatError) {
            const errorMessages: Record<string, string> = {
                'missing_code': '微信授权失败，缺少授权码。',
                'token_failed': '微信授权失败，请重试。',
                'userinfo_failed': '获取微信用户信息失败。',
                'server_error': '服务器错误，请稍后重试。'
            };
            setLoginMode('wechat');
            setError(errorMessages[wechatError] || '微信登录失败，请重试。');
            return;
        }
        
        if (wechatToken && wechatUsername) {
            // 保存token和用户名到localStorage
            localStorage.setItem('hanzhi_auth_token', wechatToken);
            localStorage.setItem('hanzhi_current_user', wechatUsername);
            onLoginSuccess();
        }
    }, [onLoginSuccess]);

    // 微信登录
    const handleWechatLogin = async () => {
        setError('');
        setWechatLoading(true);
        
        try {
            const authUrl = await getWechatAuthUrl();
            if (authUrl) {
                window.location.href = authUrl;
            } else {
                setError('获取微信授权链接失败。');
                setWechatLoading(false);
            }
        } catch (err) {
            setError('微信登录服务暂时不可用。');
            setWechatLoading(false);
        }
    };

    // Keep each method's resend cooldown when switching between login forms.
    useEffect(() => {
        if (!countdowns.phone && !countdowns.email) return;
        const timer = setTimeout(() => setCountdowns(value => ({
            phone: Math.max(0, value.phone - 1), email: Math.max(0, value.email - 1)
        })), 1000);
        return () => clearTimeout(timer);
    }, [countdowns]);

    const switchMode = (mode: 'phone' | 'email' | 'wechat') => {
        if (busy) return;
        setLoginMode(mode);
        setEmail('');
        setCode('');
        setError('');
        setSuccess('');
        setCodeSent(false);
    };

    const handleSendCode = async () => {
        if (busy || countdown > 0 || loginMode === 'wechat') return;
        const identifier = email.trim();
        const valid = loginMode === 'phone' ? /^1[3-9]\d{9}$/.test(identifier) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
        if (!valid) {
            setError(loginMode === 'phone' ? '请输入有效的中国大陆手机号' : '请输入有效的邮箱地址');
            return;
        }
        setError('');
        setSuccess('');
        setIsSendingCode(true);
        try {
            const result = await (loginMode === 'phone' ? sendPhoneLoginCode(identifier) : sendLoginCode(identifier));
            if (result.success) {
                setSuccess(result.message);
                setCodeSent(true);
                setCountdowns(value => ({ ...value, [loginMode]: 60 }));
            } else setError(result.message);
        } catch {
            setError('发送验证码失败，请稍后重试');
        } finally { setIsSendingCode(false); }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy || loginMode === 'wechat') return;
        setError('');
        setSuccess('');
        setIsLoading(true);
        try {
            const authenticated = await (loginMode === 'phone' ? loginWithPhoneCode(email.trim(), code) : loginWithCode(email.trim(), code));
            if (authenticated) onLoginSuccess();
            else setError('验证码错误或已过期');
        } catch (err) {
            setError(err instanceof Error ? err.message : '登录服务暂时不可用');
        } finally { setIsLoading(false); }
    };

    const wechatIcon = (className: string) => (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.406-.032zm-2.184 3.154c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.857 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" />
        </svg>
    );

    return (
        <div className="min-h-screen bg-brand-50 flex flex-col items-center justify-center px-4 py-8">
            <div className="w-full max-w-md rounded-3xl border border-white bg-white p-6 shadow-xl shadow-brand-900/5 sm:p-8">
                <div className="flex justify-end mb-5"><LanguageSelector /></div>
                <div className="flex flex-col items-center text-center mb-8">
                    <Logo className="mb-5 transform scale-110" />
                    <h1 className="text-2xl font-bold text-gray-900">{t("ui.welcome.back")}</h1>
                    <p className="text-gray-500 mt-2 text-sm leading-relaxed">{t("ui.sign.in.to.your.personalized.global.dmd.research.platform")}</p>
                </div>

                <section aria-labelledby="login-method-title" className="space-y-5">
                    <div className="flex items-center gap-3">
                        {loginMode !== 'phone' && (
                            <button type="button" onClick={() => switchMode('phone')} disabled={busy}
                                aria-label="返回手机号登录" title="返回手机号登录"
                                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50">
                                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                            </button>
                        )}
                        <div>
                            <h2 id="login-method-title" className="font-semibold text-gray-900">
                                {loginMode === 'phone' ? '手机号验证码登录' : loginMode === 'email' ? '邮箱验证码登录' : '微信登录'}
                            </h2>
                            <p className="mt-1 text-xs leading-relaxed text-gray-500">
                                {loginMode === 'phone' ? '未注册手机号验证后自动注册' : loginMode === 'email' ? '使用已绑定邮箱登录原账号' : '在微信内打开，授权后即可登录'}
                            </p>
                        </div>
                    </div>

                    {error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{translateText(error)}</div>}
                    {success && <div role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">{translateText(success)}</div>}

                    {loginMode === 'wechat' ? (
                        <div className="space-y-5 rounded-2xl bg-green-50/60 px-5 py-7 text-center">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-[#07C160] shadow-sm">
                                {wechatIcon('h-9 w-9')}
                            </div>
                            <p className="text-sm leading-relaxed text-gray-600">点击下方按钮，前往微信授权登录</p>
                            <button type="button" onClick={handleWechatLogin} disabled={busy}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#07C160] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#06AD56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:opacity-60">
                                {wechatLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : wechatIcon('h-5 w-5')}
                                {wechatLoading ? t("ui.signing.in.with.wechat") : '微信授权登录'}
                            </button>
                        </div>
                    ) : (
                        <form key={loginMode} onSubmit={handleSubmit} className="space-y-5">
                            <div>
                                <label htmlFor="login-identifier" className="mb-2 block text-sm font-medium text-gray-700">
                                    {loginMode === 'phone' ? '手机号' : t("ui.email.address")}
                                </label>
                                <div className="flex items-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                                    {loginMode === 'phone' && <span className="ml-4 border-r border-gray-200 pr-3 text-sm text-gray-600">+86</span>}
                                    <input id="login-identifier" type={loginMode === 'phone' ? 'tel' : 'email'}
                                        inputMode={loginMode === 'phone' ? 'numeric' : 'email'} autoComplete={loginMode === 'phone' ? 'tel-national' : 'email'}
                                        required maxLength={loginMode === 'phone' ? 11 : 254}
                                        placeholder={loginMode === 'phone' ? '请输入手机号' : t("ui.enter.an.email.address")}
                                        value={email} onChange={e => { setEmail(loginMode === 'phone' ? e.target.value.replace(/\D/g, '').slice(0, 11) : e.target.value); setCode(''); }}
                                        disabled={busy}
                                        className="min-w-0 w-full bg-transparent p-3.5 text-sm outline-none disabled:opacity-60" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="login-code" className="mb-2 block text-sm font-medium text-gray-700">{t("ui.verification.code")}</label>
                                <div className="flex items-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                                    <input id="login-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                                        required placeholder="请输入6位验证码" value={code} maxLength={6}
                                        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy}
                                        className="min-w-0 w-full flex-1 bg-transparent p-3.5 text-sm outline-none disabled:opacity-60" />
                                    <button type="button" onClick={handleSendCode} disabled={busy || countdown > 0 || !email}
                                        className="mr-3 flex shrink-0 items-center gap-1 border-l border-gray-200 pl-3 text-xs font-medium text-brand-600 transition hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:text-gray-400 sm:text-sm">
                                        {isSendingCode && <Loader2 className="h-4 w-4 animate-spin" />}
                                        {isSendingCode ? t("ui.sending") : countdown > 0 ? `${countdown}秒后重发` : codeSent ? '重新发送' : '获取验证码'}
                                    </button>
                                </div>
                            </div>
                            <button type="submit" disabled={busy || !email || code.length !== 6}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                                {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
                                {isLoading ? t("ui.signing.in") : '登录'}
                            </button>
                        </form>
                    )}
                </section>

                <div className="mt-8 border-t border-gray-100 pt-5">
                    <p className="mb-4 text-center text-xs text-gray-400">其他登录方式</p>
                    <div className="flex justify-center gap-9">
                        <button type="button" onClick={() => switchMode('wechat')} disabled={busy} aria-pressed={loginMode === 'wechat'} aria-label="微信登录" title="微信登录"
                            className={`group flex flex-col items-center gap-2 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50 ${loginMode === 'wechat' ? 'text-green-600' : 'text-gray-500'}`}>
                            <span className={`flex h-12 w-12 items-center justify-center rounded-full border transition group-hover:border-green-200 group-hover:bg-green-50 ${loginMode === 'wechat' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                {wechatIcon('h-6 w-6 text-[#07C160]')}
                            </span>
                            <span className="text-xs">微信</span>
                        </button>
                        <button type="button" onClick={() => switchMode('email')} disabled={busy} aria-pressed={loginMode === 'email'} aria-label="邮箱登录" title="邮箱登录"
                            className={`group flex flex-col items-center gap-2 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${loginMode === 'email' ? 'text-brand-600' : 'text-gray-500'}`}>
                            <span className={`flex h-12 w-12 items-center justify-center rounded-full border transition group-hover:border-brand-200 group-hover:bg-brand-50 ${loginMode === 'email' ? 'border-brand-200 bg-brand-50' : 'border-gray-200 bg-white'}`}>
                                <Mail className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <span className="text-xs">邮箱</span>
                        </button>
                    </div>
                    {loginMode !== 'phone' && (
                        <button type="button" onClick={() => switchMode('phone')} disabled={busy}
                            className="mx-auto mt-5 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-gray-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50">
                            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />返回手机号登录
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
