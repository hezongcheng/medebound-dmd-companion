const { localizeMessage, getRequestLocale } = require('./localeService');
﻿/**
 * 邮件发送服务
 * 使用 nodemailer 发送邮箱绑定验证码和登录验证码
 */
const nodemailer = require('nodemailer');

// 验证码缓存（生产建议改为 Redis）
const verificationCodes = new Map();
const loginVerificationCodes = new Map();

// 验证码有效期：10 分钟
const CODE_EXPIRY = 10 * 60 * 1000;

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildAuthEmailHtml({ subtitle, intro, code, tip }) {
  subtitle = localizeMessage(subtitle); intro = localizeMessage(intro); tip = localizeMessage(tip);
  return `
    <!DOCTYPE html>
    <html lang="${getRequestLocale()}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @media only screen and (max-width: 600px) {
          .mail-wrap { padding: 16px !important; }
          .mail-card { border-radius: 12px !important; }
          .mail-header { padding: 24px !important; }
          .mail-body { padding: 24px !important; }
          .mail-divider { padding: 0 24px !important; }
          .mail-footer { padding: 16px 24px !important; }
          .mail-code-box { padding: 20px !important; }
          .mail-code {
            font-size: 30px !important;
            letter-spacing: 6px !important;
          }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: 'Microsoft YaHei', 'PingFang SC', Arial, sans-serif;">
      <table class="mail-wrap" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table class="mail-card" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <tr>
                <td class="mail-header" style="background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); padding: 40px; text-align: center;">
                  <div style="display: inline-block; width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 12px; margin-bottom: 16px; position: relative;">
                    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4" />
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" opacity="0.9"/>
                    </svg>
                  </div>
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold; letter-spacing: -0.5px;">${localizeMessage("罕知 DMD 研究助手")}</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px; letter-spacing: 1px;">${subtitle}</p>
                </td>
              </tr>

              <tr>
                <td class="mail-body" style="padding: 40px;">
                  <p style="color: #374151; font-size: 16px; margin: 0 0 12px 0; font-weight: 500;">${localizeMessage("您好，")}</p>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 32px 0;">${intro}</p>

                  <div class="mail-code-box" style="background: linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 100%); border: 2px solid #0d9488; border-radius: 12px; padding: 32px; text-align: center; margin: 0 0 32px 0; box-shadow: 0 2px 8px rgba(13, 148, 136, 0.15);">
                    <p style="color: #0d9488; font-size: 13px; font-weight: 600; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">${localizeMessage('验证码')}</p>
                    <div class="mail-code" style="font-size: 42px; font-weight: bold; letter-spacing: 12px; color: #0d9488; font-family: 'Courier New', monospace; text-shadow: 0 2px 4px rgba(13, 148, 136, 0.1);">${code}</div>
                  </div>

                  <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
                    <p style="color: #92400e; font-size: 14px; margin: 0; line-height: 1.5;">
                      <strong>${localizeMessage("有效期：")}</strong>${localizeMessage("验证码有效期为")} <strong>${localizeMessage("10分钟")}</strong>${localizeMessage("，请尽快完成操作。")}
                    </p>
                  </div>

                  <p style="color: #9ca3af; font-size: 13px; line-height: 1.6; margin: 0;">
                    ${tip}
                  </p>
                </td>
              </tr>

              <tr>
                <td class="mail-divider" style="padding: 0 40px;">
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;">
                </td>
              </tr>

              <tr>
                <td class="mail-footer" style="padding: 24px 40px; text-align: center; background: #f9fafb;">
                  <p style="color: #9ca3af; font-size: 12px; margin: 0 0 8px 0;">
                    ${localizeMessage('此邮件由罕知 DMD 研究助手自动发送，请勿回复')}
                  </p>
                  <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                    ${localizeMessage("如有问题，请访问")} <a href="https://dmd.medebound.com" style="color: #0d9488; text-decoration: none;">dmd.medebound.com</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

async function sendVerificationCode(email, userId) {
  const existing = verificationCodes.get(userId);
  if (existing && Date.now() - existing.createdAt < 60000) {
    const waitSeconds = Math.ceil((60000 - (Date.now() - existing.createdAt)) / 1000);
    return { success: false, message: `请等待 ${waitSeconds} 秒后再试` };
  }

  const code = generateCode();

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"罕知DMD研究助手" <${process.env.SMTP_USER}>`,
      to: email,
      subject: localizeMessage('【罕知】邮箱绑定验证码'),
      html: buildAuthEmailHtml({
        subtitle: '邮箱绑定验证',
        intro: '您正在绑定邮箱地址，请使用以下验证码完成验证：',
        code,
        tip: '如非本人操作，请忽略此邮件。为了您的账户安全，请勿将验证码透露给他人。'
      })
    });

    verificationCodes.set(userId, {
      code,
      email,
      createdAt: Date.now(),
      attempts: 0
    });

    console.log(`📧 验证码已发送到 ${email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`);
    return { success: true, message: '验证码已发送' };
  } catch (error) {
    console.error('发送邮件失败:', error);
    return { success: false, message: '邮件发送失败，请检查邮箱地址或稍后再试' };
  }
}

function verifyCode(userId, code) {
  const stored = verificationCodes.get(userId);

  if (!stored) {
    return { success: false, message: '请先获取验证码' };
  }

  if (Date.now() - stored.createdAt > CODE_EXPIRY) {
    verificationCodes.delete(userId);
    return { success: false, message: '验证码已过期，请重新获取' };
  }

  if (stored.attempts >= 5) {
    verificationCodes.delete(userId);
    return { success: false, message: '验证码错误次数过多，请重新获取' };
  }

  if (stored.code !== code) {
    stored.attempts++;
    return { success: false, message: `验证码错误，还剩 ${5 - stored.attempts} 次机会` };
  }

  const verifiedEmail = stored.email;
  verificationCodes.delete(userId);

  return { success: true, email: verifiedEmail, message: '验证成功' };
}

async function sendLoginVerificationCode(email) {
  const existing = loginVerificationCodes.get(email);
  if (existing && Date.now() - existing.createdAt < 60000) {
    const waitSeconds = Math.ceil((60000 - (Date.now() - existing.createdAt)) / 1000);
    return { success: false, message: `请等待 ${waitSeconds} 秒后再试` };
  }

  const code = generateCode();

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"罕知DMD研究助手" <${process.env.SMTP_USER}>`,
      to: email,
      subject: localizeMessage('【罕知】登录验证码'),
      html: buildAuthEmailHtml({
        subtitle: '安全登录验证',
        intro: '您正在登录罕知 DMD 研究助手，请使用以下验证码完成登录：',
        code,
        tip: '如非本人操作，请忽略此邮件。为了您的账户安全，请勿将验证码透露给他人。'
      })
    });

    loginVerificationCodes.set(email, {
      code,
      createdAt: Date.now(),
      attempts: 0
    });

    console.log(`📧 登录验证码已发送到 ${email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`);
    return { success: true, message: '验证码已发送' };
  } catch (error) {
    console.error('发送邮件失败:', error);
    return { success: false, message: '邮件发送失败，请检查邮箱地址或稍后再试' };
  }
}

function verifyLoginCode(email, code) {
  const stored = loginVerificationCodes.get(email);

  if (!stored) {
    return { success: false, message: '请先获取验证码' };
  }

  if (Date.now() - stored.createdAt > CODE_EXPIRY) {
    loginVerificationCodes.delete(email);
    return { success: false, message: '验证码已过期，请重新获取' };
  }

  if (stored.attempts >= 5) {
    loginVerificationCodes.delete(email);
    return { success: false, message: '验证码错误次数过多，请重新获取' };
  }

  if (stored.code !== code) {
    stored.attempts++;
    return { success: false, message: `验证码错误，还剩 ${5 - stored.attempts} 次机会` };
  }

  loginVerificationCodes.delete(email);
  return { success: true, message: '验证成功' };
}

function cleanupExpiredCodes() {
  const now = Date.now();

  for (const [userId, data] of verificationCodes.entries()) {
    if (now - data.createdAt > CODE_EXPIRY) {
      verificationCodes.delete(userId);
    }
  }

  for (const [email, data] of loginVerificationCodes.entries()) {
    if (now - data.createdAt > CODE_EXPIRY) {
      loginVerificationCodes.delete(email);
    }
  }
}

setInterval(cleanupExpiredCodes, 5 * 60 * 1000);

module.exports = {
  buildAuthEmailHtml,
  sendVerificationCode,
  verifyCode,
  sendLoginVerificationCode,
  verifyLoginCode
};
