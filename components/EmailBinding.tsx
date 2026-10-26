import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import React, { useState } from 'react';
import { Mail, Send, CheckCircle, Loader2, ArrowRight } from 'lucide-react';
import { Logo } from './Logo';
import { clearUserData, API_BASE } from '../services/apiClient';

interface EmailBindingProps {
  onBindingSuccess: (email: string) => void;
}

// 检查 token 是否失效
const checkTokenExpired = (res: Response): boolean => {
  if (res.status === 401 || res.status === 403) {
    console.warn('Token 已失效，正在清除用户信息并跳转登录页...');
    clearUserData();
    window.location.reload();
    return true;
  }
  return false;
};

export const EmailBinding: React.FC<EmailBindingProps> = ({ onBindingSuccess }) => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  const getToken = () => localStorage.getItem('hanzhi_auth_token');

  // 发送验证码
  const handleSendCode = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/email/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ email })
      });

      if (checkTokenExpired(res)) return;

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '发送失败');
      }

      setStep('verify');
      // 开始60秒倒计时
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 验证验证码
  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      setError('请输入6位验证码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/email/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ code })
      });

      if (checkTokenExpired(res)) return;

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '验证失败');
      }

      onBindingSuccess(data.email);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 重新发送验证码
  const handleResend = async () => {
    if (countdown > 0) return;
    await handleSendCode();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Logo />
        </div>

        {/* 卡片 */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          {/* 标题 */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-100 rounded-full mb-4">
              <Mail className="w-8 h-8 text-brand-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{t("ui.link.email")}</h2>
            <p className="text-gray-500 mt-2 text-sm">
              {t("ui.link.an.email.address.to.help.secure.your.account")}</p>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {translateText(error)}
            </div>
          )}

          {/* 步骤1: 输入邮箱 */}
          {step === 'email' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("ui.email.address")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("ui.enter.your.email.address")}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  disabled={loading}
                />
              </div>

              <button
                onClick={handleSendCode}
                disabled={loading || !email}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t("ui.sending")}</>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    {t("ui.send.code")}</>
                )}
              </button>
            </div>
          )}

          {/* 步骤2: 输入验证码 */}
          {step === 'verify' && (
            <div className="space-y-4">
              <div className="text-center mb-4">
                <p className="text-sm text-gray-600">
                  {t("ui.verification.code.sent.to")}</p>
                <p className="font-medium text-brand-600">{translateText(email)}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("ui.verification.code")}</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t("ui.enter.the.6.digit.verification.code")}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors text-center text-2xl tracking-widest font-mono"
                  maxLength={6}
                  disabled={loading}
                />
              </div>

              <button
                onClick={handleVerify}
                disabled={loading || code.length !== 6}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t("ui.verifying")}</>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    {t("ui.confirm.email")}</>
                )}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => {
                    setStep('email');
                    setCode('');
                    setError('');
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  {t("ui.change.email")}</button>
                <button
                  onClick={handleResend}
                  disabled={countdown > 0}
                  className={`${countdown > 0 ? 'text-gray-400 cursor-not-allowed' : 'text-brand-600 hover:text-brand-700'}`}
                >
                  {translateText(countdown > 0 ? `${countdown}秒后可重发` : '重新发送')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <p className="text-center text-xs text-gray-400 mt-6">
          {t("ui.your.linked.email.can.receive.important.notices.and.help")}</p>
      </div>
    </div>
  );
};
