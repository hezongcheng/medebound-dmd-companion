const crypto = require('crypto');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

function normalizePhone(value) {
  const phone = typeof value === 'string' ? value.trim().replace(/^\+86/, '') : '';
  if (!/^1[3-9]\d{9}$/.test(phone)) throw Object.assign(new Error('请输入有效的中国大陆手机号'), { status: 400 });
  return phone;
}
function codeHash(scope, code, secret) {
  return crypto.createHmac('sha256', secret).update(`${scope}:${code}`).digest('hex');
}
async function sendSms(phone, code) {
  const { ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, ALIYUN_SMS_SIGN_NAME } = process.env;
  if (!ALIYUN_ACCESS_KEY_ID || !ALIYUN_ACCESS_KEY_SECRET || !ALIYUN_SMS_SIGN_NAME) {
    throw Object.assign(new Error('短信服务尚未配置，请联系管理员'), { status: 503 });
  }
  const Sms = require('@alicloud/dysmsapi20170525');
  const OpenApi = require('@alicloud/openapi-client');
  const client = new Sms.default(new OpenApi.Config({
    accessKeyId: ALIYUN_ACCESS_KEY_ID, accessKeySecret: ALIYUN_ACCESS_KEY_SECRET,
    endpoint: 'dysmsapi.aliyuncs.com', readTimeout: 10000, connectTimeout: 5000
  }));
  const result = await client.sendSms(new Sms.SendSmsRequest({ phoneNumbers: phone,
    signName: ALIYUN_SMS_SIGN_NAME, templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || 'SMS_254515002',
    templateParam: JSON.stringify({ code }) }));
  if (result.body?.code !== 'OK') throw Object.assign(new Error('短信发送失败，请稍后重试'), { status: 502 });
}
module.exports = { normalizePhone, codeHash, sendSms };
