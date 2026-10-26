/**
 * 邮件文献推送服务
 * 用于向已绑定邮箱的用户推送最新文献
 */

const nodemailer = require('nodemailer');
const cron = require('node-cron');
const crypto = require('crypto');
const { pool } = require('./db');
const { buildEmailVisitUrl } = require('./emailVisitService');
require('dotenv').config();

const PUSH_SCHEDULE = {
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
  monthly: '0 9 1 * *'
};
const DEFAULT_TIMEZONE = process.env.PUSH_TIMEZONE || process.env.TZ || 'Asia/Shanghai';
let schedulerInitialized = false;

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.exmail.qq.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPushEmailHtml(user, article) {
  const platformUrl = escapeHtml(buildEmailVisitUrl(user.id, article.id));
  const username = escapeHtml(user.username || '用户');
  const title = escapeHtml(article.title_zh || article.title || '未命名文献');
  const abstract = article.abstract_zh || article.abstract || '暂无摘要';
  const briefAbstract = escapeHtml(abstract.length > 300 ? `${abstract.substring(0, 300)}...` : abstract);
  const journal = article.journal ? escapeHtml(article.journal) : '';
  const publishDate = article.publication_date
    ? new Date(article.publication_date).toLocaleDateString('zh-CN')
    : '';

  return `
    <!DOCTYPE html>
    <html>
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
          .mail-article-box { padding: 18px !important; }
          .mail-article-title { font-size: 16px !important; }
          .mail-btn {
            width: 100% !important;
            box-sizing: border-box !important;
            padding: 12px 16px !important;
            font-size: 14px !important;
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
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold; letter-spacing: -0.5px;">罕知 DMD 研究助手</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px; letter-spacing: 1px;">最新文献推送</p>
                </td>
              </tr>

              <tr>
                <td class="mail-body" style="padding: 40px;">
                  <p style="color: #374151; font-size: 16px; margin: 0 0 12px 0; font-weight: 500;">${username}，您好，</p>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">为您推送一篇最新 DMD 相关研究文献：</p>

                  <div class="mail-article-box" style="background: linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 100%); border: 2px solid #0d9488; border-radius: 12px; padding: 24px; margin: 0 0 24px 0; box-shadow: 0 2px 8px rgba(13, 148, 136, 0.15);">
                    <p style="color: #0d9488; font-size: 13px; font-weight: 600; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">文献标题</p>
                    <p class="mail-article-title" style="color: #1f2937; font-size: 18px; line-height: 1.5; margin: 0 0 16px 0; font-weight: 700;">${title}</p>

                    <div style="background: #ffffff; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
                      <p style="color: #4b5563; font-size: 14px; line-height: 1.7; margin: 0;">${briefAbstract}</p>
                    </div>

                    <p style="color: #6b7280; font-size: 12px; margin: 0; line-height: 1.6;">
                      ${journal ? `期刊：${journal}${publishDate ? ' | ' : ''}` : ''}${publishDate ? `发表日期：${publishDate}` : ''}
                    </p>
                  </div>

                  <div style="text-align: center; margin: 0 0 24px 0;">
                    <a class="mail-btn" href="${platformUrl}" style="display: inline-block; background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-size: 15px; font-weight: 700;">前往平台查看详情</a>
                  </div>

                  <p style="color: #9ca3af; font-size: 13px; line-height: 1.6; margin: 0;">
                    如需查看更多 DMD 文献、临床试验和药物信息，可登录平台继续浏览。
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
                    此邮件由罕知 DMD 研究助手自动发送，请勿回复
                  </p>
                  <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                    如有问题，请访问 <a href="https://dmd.medebound.com" style="color: #0d9488; text-decoration: none;">dmd.medebound.com</a>
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

async function getUsersWithEmail() {
  try {
    const [users] = await pool.execute(`
      SELECT
        u.id,
        u.username,
        u.email,
        up.age,
        up.genetic_profile,
        up.literature_push_enabled
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.is_active = TRUE
        AND u.email IS NOT NULL
        AND u.email != ''
      GROUP BY u.id, u.username, u.email, up.age, up.genetic_profile, up.literature_push_enabled
      ORDER BY u.id ASC
    `);

    // Legacy data may contain multiple user rows bound to the same mailbox.
    // A literature push is mailbox-scoped, so keep only one recipient per
    // normalized address even when account data is duplicated.
    const uniqueUsers = [];
    const seenEmails = new Set();
    for (const user of users) {
      const normalizedEmail = normalizeEmail(user.email);
      if (!normalizedEmail || seenEmails.has(normalizedEmail)) continue;
      seenEmails.add(normalizedEmail);
      uniqueUsers.push({ ...user, email: normalizedEmail });
    }

    console.log(`📧 找到 ${users.length} 个已绑定邮箱的用户，去重后 ${uniqueUsers.length} 个收件邮箱`);
    return uniqueUsers;
  } catch (error) {
    console.error('获取用户列表错误:', error.message);
    return [];
  }
}

async function hasUserReceivedArticle(userId, articleId) {
  try {
    const [rows] = await pool.execute(`
      SELECT id FROM email_push_logs
      WHERE user_id = ? AND article_id = ? AND status = 'success'
    `, [userId, articleId]);

    return rows.length > 0;
  } catch (error) {
    console.error('检查推送记录错误:', error.message);
    return false;
  }
}

async function getUserReceivedArticleIdSet(userId) {
  try {
    const [rows] = await pool.execute(`
      SELECT article_id FROM email_push_logs
      WHERE user_id = ? AND status = 'success'
    `, [userId]);

    return new Set(rows.map((row) => String(row.article_id)));
  } catch (error) {
    console.error('加载用户已推送文章集合错误:', error.message);
    return new Set();
  }
}

async function hasUserReceivedSuccessfulPushToday(userId) {
  try {
    const [rows] = await pool.execute(`
      SELECT id FROM email_push_logs
      WHERE user_id = ?
        AND status = 'success'
        AND DATE(pushed_at) = CURRENT_DATE()
      LIMIT 1
    `, [userId]);

    return rows.length > 0;
  } catch (error) {
    console.error('检查当日推送记录错误:', error.message);
    return false;
  }
}

async function hasEmailReceivedSuccessfulPushToday(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;

  try {
    const [rows] = await pool.execute(`
      SELECT id FROM email_push_logs
      WHERE LOWER(TRIM(email)) = ?
        AND status = 'success'
        AND DATE(pushed_at) = CURRENT_DATE()
      LIMIT 1
    `, [normalizedEmail]);

    return rows.length > 0;
  } catch (error) {
    console.error('检查邮箱当日推送记录错误:', error.message);
    return false;
  }
}

async function getMatchingArticleForUser(userProfile, userId) {
  try {
    const now = new Date().toISOString().split('T')[0];
    const receivedSet = await getUserReceivedArticleIdSet(userId);

    const [articles] = await pool.execute(`
      SELECT id, title, abstract, title_zh, abstract_zh, publication_date, journal
      FROM articles_cache
      WHERE publication_date <= ?
      ORDER BY publication_date DESC, fetched_at DESC
    `, [now]);

    if (articles.length === 0) {
      return null;
    }

    const geneticProfile = (userProfile?.genetic_profile || '').toLowerCase();
    const exonNumbers = [];
    const exonMatch = geneticProfile.match(/(\d+)/g);
    if (exonMatch) {
      exonNumbers.push(...exonMatch);
    }

    for (const article of articles) {
      const alreadyReceived = receivedSet.has(String(article.id));
      if (alreadyReceived) continue;

      if (exonNumbers.length > 0) {
        const titleLower = (article.title || '').toLowerCase();
        const abstractLower = (article.abstract || '').toLowerCase();
        const titleZhLower = (article.title_zh || '').toLowerCase();
        const abstractZhLower = (article.abstract_zh || '').toLowerCase();
        const content = `${titleLower} ${abstractLower} ${titleZhLower} ${abstractZhLower}`;

        let isMatch = false;
        for (const exon of exonNumbers) {
          if (
            content.includes(`exon ${exon}`) ||
            content.includes(`exon${exon}`) ||
            content.includes(`外显子 ${exon}`) ||
            content.includes(`外显子${exon}`)
          ) {
            isMatch = true;
            console.log(`  🎯 匹配到外显子 ${exon} 相关文章: ${article.title_zh || article.title}`);
            break;
          }
        }

        if (isMatch) {
          return article;
        }
      }
    }

    for (const article of articles) {
      const alreadyReceived = receivedSet.has(String(article.id));
      if (!alreadyReceived) {
        console.log(`  📄 未找到精准匹配，使用最新未推送文章: ${article.title_zh || article.title}`);
        return article;
      }
    }

    return null;
  } catch (error) {
    console.error('获取匹配文章错误:', error.message);
    return null;
  }
}

async function getRandomUnpushedArticleForUser(userId) {
  try {
    const now = new Date().toISOString().split('T')[0];
    const receivedSet = await getUserReceivedArticleIdSet(userId);
    const [articles] = await pool.execute(`
      SELECT id, title, abstract, title_zh, abstract_zh, publication_date, journal
      FROM articles_cache
      WHERE publication_date <= ?
      ORDER BY RAND()
      LIMIT 80
    `, [now]);

    for (const article of articles) {
      if (!receivedSet.has(String(article.id))) {
        return article;
      }
    }

    return null;
  } catch (error) {
    console.error('获取随机未推送文献错误:', error.message);
    return null;
  }
}

async function logEmailPush(userId, articleId, email, status, errorMessage = null) {
  try {
    await pool.execute(`
      INSERT INTO email_push_logs (user_id, article_id, email, status, error_message)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        error_message = VALUES(error_message),
        pushed_at = NOW()
    `, [userId, articleId, email, status, errorMessage]);
  } catch (error) {
    console.error('记录推送日志错误:', error.message);
  }
}

async function acquirePushLock(lockKey, timeoutSeconds = 0) {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [lockKey, timeoutSeconds]);
    if (rows?.[0]?.acquired === 1) {
      return { connection, lockKey };
    }
    connection.release();
    return null;
  } catch (error) {
    if (connection) connection.release();
    console.error('获取推送锁失败:', error.message);
    return null;
  }
}

async function releasePushLock(lockHandle) {
  if (!lockHandle?.connection) return;
  try {
    await lockHandle.connection.execute('SELECT RELEASE_LOCK(?)', [lockHandle.lockKey]);
  } catch (error) {
    console.error('释放推送锁失败:', error.message);
  } finally {
    lockHandle.connection.release();
  }
}

async function sendArticleEmail(user, article) {
  const transporter = createTransporter();

  const mailOptions = {
    from: `"罕知DMD研究助手" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: '【罕知】最新 DMD 研究文献推送',
    html: buildPushEmailHtml(user, article)
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`  ✅ 已推送给 ${user.email}`);
    return true;
  } catch (error) {
    console.error(`  ❌ 推送失败 ${user.email}:`, error.message);
    return false;
  }
}

async function executePushTask() {
  console.log('\n========================================');
  console.log('📧 开始执行邮件文献推送任务（个性化匹配模式）');
  console.log('时间:', new Date().toLocaleString('zh-CN'));
  console.log('========================================\n');

  const taskLockKey = 'email_push_task_lock';
  const taskLock = await acquirePushLock(taskLockKey, 0);
  if (!taskLock) {
    console.log('⏭️ 本轮邮件推送已在其他实例执行，跳过重复任务');
    return { success: true, message: '任务已在执行中，已跳过' };
  }

  try {
    const users = await getUsersWithEmail();
    if (users.length === 0) {
      console.log('❌ 没有找到绑定邮箱的用户');
      return { success: false, message: '没有绑定邮箱的用户' };
    }

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      console.log(`\n👤 处理用户: ${user.username || user.email}`);
      console.log(`   基因档案: ${user.genetic_profile || '未填写'}`);
      const alreadyReceivedTodayBeforeLock = await hasEmailReceivedSuccessfulPushToday(user.email);
      if (alreadyReceivedTodayBeforeLock) {
        console.log(`  ⏭️ 跳过 ${user.email} (今天已经推送过)`);
        skippedCount++;
        continue;
      }

      const article = await getMatchingArticleForUser(
        { genetic_profile: user.genetic_profile },
        user.id
      );

      if (!article) {
        console.log(`  ⏭️ 跳过 ${user.email} (没有可推送的文章)`);
        skippedCount++;
        continue;
      }

      const emailLockKey = `email_push:${crypto.createHash('sha1').update(normalizeEmail(user.email)).digest('hex')}`;
      const emailLock = await acquirePushLock(emailLockKey, 0);
      if (!emailLock) {
        console.log(`  ⏭️ 跳过 ${user.email} (该用户正在由其他实例处理)`);
        skippedCount++;
        continue;
      }

      try {
        const alreadyReceivedToday = await hasEmailReceivedSuccessfulPushToday(user.email);
        if (alreadyReceivedToday) {
          console.log(`  ⏭️ 跳过 ${user.email} (今天已经推送过)`);
          skippedCount++;
          continue;
        }

        console.log(`  📄 匹配文章: ${article.title_zh || article.title}`);
        const success = await sendArticleEmail(user, article);

        if (success) {
          await logEmailPush(user.id, article.id, user.email, 'success');
          successCount++;
        } else {
          await logEmailPush(user.id, article.id, user.email, 'failed', '发送失败');
          failCount++;
        }
      } finally {
        await releasePushLock(emailLock);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n========================================');
    console.log(`📧 邮件推送完成: 成功 ${successCount}, 失败 ${failCount}, 跳过 ${skippedCount}`);
    console.log('========================================\n');

    return {
      success: true,
      message: `推送完成: 成功 ${successCount}, 失败 ${failCount}, 跳过 ${skippedCount}`,
      successCount,
      failCount,
      skippedCount
    };
  } catch (error) {
    console.error('邮件推送任务错误:', error);
    return { success: false, message: error.message };
  } finally {
    await releasePushLock(taskLock);
  }
}

function initScheduler() {
  if (schedulerInitialized) {
    console.log('⏭️ 邮件推送定时任务已初始化，跳过重复注册');
    return;
  }
  schedulerInitialized = true;

  const frequency = String(process.env.EMAIL_PUSH_FREQUENCY || process.env.WECHAT_PUSH_FREQUENCY || 'weekly').toLowerCase();
  const schedule = PUSH_SCHEDULE[frequency] || PUSH_SCHEDULE.weekly;
  const { fetchAndCacheArticles } = require('./articleFetchService');

  console.log(`📮 邮件推送定时任务已启动: ${frequency} (${schedule}), timezone=${DEFAULT_TIMEZONE}`);

  cron.schedule('0 2 * * *', async () => {
    console.log('\n⏰ 定时文献抓取任务触发 (02:00)');
    try {
      const count = await fetchAndCacheArticles();
      console.log(`📚 定时文献抓取完成，本次处理 ${count || 0} 篇`);
    } catch (error) {
      console.error('定时文献抓取任务错误:', error);
    }
  }, { timezone: DEFAULT_TIMEZONE });
  console.log(`📚 文献抓取定时任务已启动: daily (0 2 * * *), timezone=${DEFAULT_TIMEZONE}`);

  cron.schedule(schedule, async () => {
    console.log('\n⏰ 定时邮件推送任务触发');
    await executePushTask();
  }, { timezone: DEFAULT_TIMEZONE });
}

async function manualPush() {
  return executePushTask();
}

module.exports = {
  buildPushEmailHtml,
  initScheduler,
  manualPush,
  getUsersWithEmail,
  getMatchingArticleForUser,
  getRandomUnpushedArticleForUser,
  sendArticleEmail,
  hasUserReceivedArticle,
  hasUserReceivedSuccessfulPushToday,
  hasEmailReceivedSuccessfulPushToday,
  logEmailPush
};
