import { LanguageSelector } from './LanguageSelector';
import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import React, { useState, useEffect } from 'react';
import { sendLoginCode, loginWithCode, getWechatAuthUrl, wechatLogin } from '../services/authService';
import { Logo } from './Logo';
import { Loader2 } from 'lucide-react';

interface LoginProps {
    onLoginSuccess: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSendingCode, setIsSendingCode] = useState(false);
    const [wechatLoading, setWechatLoading] = useState(false);
    const [showAccountLogin, setShowAccountLogin] = useState(false);
    const [countdown, setCountdown] = useState(0);
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

    // 倒计时效果
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);

    // 发送验证码
    const handleSendCode = async () => {
        if (!email) {
            setError('请输入邮箱地址');
            return;
        }
        
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setError('请输入有效的邮箱地址');
            return;
        }
        
        setError('');
        setSuccess('');
        setIsSendingCode(true);
        
        try {
            const result = await sendLoginCode(email);
            if (result.success) {
                setSuccess(result.message);
                setCodeSent(true);
                setCountdown(60);
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError('发送验证码失败，请稍后重试');
        } finally {
            setIsSendingCode(false);
        }
    };

    // 验证码登录
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsLoading(true);
        
        try {
            const success = await loginWithCode(email, code);
            if (success) {
                onLoginSuccess();
            } else {
                setError('验证码错误或已过期');
                setIsLoading(false);
            }
        } catch (err) {
            setError('登录服务暂时不可用');
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-brand-50 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-8 animate-in fade-in zoom-in duration-500">
                <div className="flex flex-col items-center text-center">
                    <Logo className="mb-6 transform scale-125" />
                    <h2 className="text-2xl font-bold text-gray-900 mt-2">{t("ui.welcome.back")}</h2>
                    <p className="text-gray-500 mt-2 text-sm">{t("ui.sign.in.to.your.personalized.global.dmd.research.platform")}</p>
                </div>

                {error && (
                    <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg flex items-center animate-in fade-in slide-in-from-top-2">
                        <svg className="w-4 h-4 mr-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {translateText(error)}
                    </div>
                )}

                {success && (
                    <div className="text-green-500 text-sm bg-green-50 p-3 rounded-lg flex items-center animate-in fade-in slide-in-from-top-2">
                        <svg className="w-4 h-4 mr-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {translateText(success)}
                    </div>
                )}

                <LanguageSelector />
                {/* 微信登录按钮（优先） */}
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={handleWechatLogin}
                        disabled={isLoading || wechatLoading}
                        className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-[#07C160] hover:bg-[#06AD56] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all hover:shadow-lg hover:shadow-green-500/30 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {wechatLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                {t("ui.signing.in.with.wechat")}</>
                        ) : (
                            <>
                                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.406-.032zm-2.184 3.154c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.857 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" fill="white"/>
                                </svg>
                                {t("ui.sign.in.with.wechat")}</>
                        )}
                    </button>
                    <p className="text-xs text-gray-500 text-center">
                        {t("ui.open.in.wechat.to.use.this.option")}</p>
                </div>

                {/* 账号登录按钮或表单 */}
                {!showAccountLogin ? (
                    <button
                        type="button"
                        onClick={() => setShowAccountLogin(true)}
                        disabled={isLoading || wechatLoading}
                        className="w-full flex justify-center items-center py-3 px-4 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {t("ui.sign.in.with.email")}</button>
                ) : (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-200"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-4 bg-white text-gray-500">{t("ui.email.verification.sign.in")}</span>
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t("ui.email.address")}</label>
                                <input 
                                    type="email" 
                                    required
                                    placeholder={t("ui.enter.an.email.address")}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={isLoading}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-brand-500 focus:ring-brand-500 p-3 border transition-colors disabled:bg-gray-100"
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t("ui.verification.code")}</label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input 
                                        type="text" 
                                        required
                                        placeholder={t("ui.enter.the.6.digit.verification.code")}
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                        disabled={isLoading}
                                        maxLength={6}
                                        className="w-full sm:flex-1 border-gray-300 rounded-lg shadow-sm focus:border-brand-500 focus:ring-brand-500 p-3 border transition-colors disabled:bg-gray-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSendCode}
                                        disabled={isSendingCode || isLoading || countdown > 0}
                                        className="w-full sm:w-auto px-4 py-3 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    >
                                        {isSendingCode ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin mr-2 inline" />
                                                {t("ui.sending")}</>
                                        ) : (
                                            countdown > 0 ? `${countdown}秒` : codeSent ? '重新发送' : '获取验证码'
                                        )}
                                    </button>
                                </div>
                            </div>

                            <button 
                                type="submit"
                                disabled={isLoading || wechatLoading}
                                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-all hover:shadow-lg hover:shadow-brand-500/30 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                        {t("ui.signing.in")}</>
                                ) : (
                                    '立即登录'
                                )}
                            </button>
                        </form>

                        <button
                            type="button"
                            onClick={() => setShowAccountLogin(false)}
                            className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors"
                        >
                            {t("ui.back")}</button>
                    </div>
                )}
            </div>
        </div>
    );
};