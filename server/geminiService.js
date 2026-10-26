const { getRequestLocale } = require('./localeService');
const { buildArticlePrompt, buildArticlePublicPrompt, buildArticlePersonalPrompt } = require('./articlePrompt');
const { buildTrialPrompt } = require('./trialPrompt');
/**
 * Gemini API 服务 - 使用 HTTP 直接调用 (兼容旧版 Node.js)
 */
const https = require('https');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_URL = `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DISCLAIMER = "免责声明：这是由人工智能根据文章摘要生成的解释。研究处于早期阶段，可能不适用于每一位患者。它不能替代医生的建议。请务必咨询专业医疗人员。";

// 重试配置
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 2000; // 2秒

function looksLikeHtml(text) {
    return /^\s*</.test(text || '');
}

function summarizeNonJsonResponse(text) {
    var trimmed = (text || '').replace(/\s+/g, ' ').trim();
    return trimmed ? trimmed.slice(0, 160) : '空响应';
}

function decodeHtmlEntities(text) {
    var entityMap = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' '
    };

    return String(text || '')
        .replace(/&#x([0-9a-f]+);/gi, function(match, hex) {
            var codePoint = parseInt(hex, 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        })
        .replace(/&#(\d+);/g, function(match, num) {
            var codePoint = parseInt(num, 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        })
        .replace(/&([a-z]+);/gi, function(match, name) {
            return Object.prototype.hasOwnProperty.call(entityMap, name.toLowerCase())
                ? entityMap[name.toLowerCase()]
                : match;
        });
}

function sanitizePromptText(value, fallback, maxLength) {
    var text = decodeHtmlEntities(value || fallback || '')
        .replace(/<[^>]*>/g, '')
        .replace(/([。！？.!?])nn(?=\S)/g, '$1\n\n')
        .replace(/\s+/g, ' ')
        .trim();

    if (maxLength && text.length > maxLength) {
        return text.slice(0, maxLength) + '...';
    }
    return text;
}

function getCleanArticleForPrompt(article) {
    article = article || {};
    return {
        title: sanitizePromptText(article.title || article.titleZh, '未提供标题', 1000),
        abstract: sanitizePromptText(article.abstract || article.abstractZh, 'No abstract available.', 12000)
    };
}

/**
 * 延迟函数
 */
function delay(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

/**
 * 调用 Gemini API (单次)
 */
function callGeminiAPIOnce(contents) {
    return new Promise(function(resolve, reject) {
        var url = GEMINI_API_URL + '?key=' + API_KEY;
        
        var requestBody = JSON.stringify({
            contents: contents
        });
        
        var urlObj = new URL(url);
        var options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };
        
        var req = https.request(options, function(res) {
            var chunks = [];
            
            res.on('data', function(chunk) {
                chunks.push(chunk);
            });
            
            res.on('end', function() {
                var data = Buffer.concat(chunks).toString('utf8');
                var statusCode = res.statusCode || 0;
                var contentType = (res.headers && res.headers['content-type']) || '';

                if (statusCode < 200 || statusCode >= 300) {
                    try {
                        var errorJson = JSON.parse(data);
                        reject(new Error((errorJson.error && errorJson.error.message) || ('Gemini API错误: HTTP ' + statusCode)));
                    } catch (parseError) {
                        var upstreamMessage = looksLikeHtml(data)
                            ? 'Gemini API返回了HTML错误页，请检查 GEMINI_BASE_URL、代理或网络连接'
                            : 'Gemini API返回非JSON错误响应: ' + summarizeNonJsonResponse(data);
                        reject(new Error(upstreamMessage + ' (HTTP ' + statusCode + ')'));
                    }
                    return;
                }

                if (contentType && contentType.indexOf('application/json') === -1 && looksLikeHtml(data)) {
                    reject(new Error('Gemini API返回了HTML页面，请检查 GEMINI_BASE_URL、代理或网络连接'));
                    return;
                }

                try {
                    var json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(json.error.message || 'API错误'));
                        return;
                    }
                    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
                        var text = json.candidates[0].content.parts
                            .map(function(p) { return p.text || ''; })
                            .join('');
                        resolve(text);
                    } else {
                        resolve('抱歉，暂时无法生成内容。');
                    }
                } catch (e) {
                    if (looksLikeHtml(data)) {
                        reject(new Error('Gemini API返回了HTML页面，请检查 GEMINI_BASE_URL、代理或网络连接'));
                    } else {
                        reject(new Error('Gemini API返回非JSON响应: ' + summarizeNonJsonResponse(data)));
                    }
                }
            });
        });
        
        req.on('error', function(e) {
            reject(e);
        });
        
        req.write(requestBody);
        req.end();
    });
}

/**
 * 调用 Gemini API (带重试)
 */
async function callGeminiAPI(contents) {
    if (getRequestLocale() === 'en') {
        contents = contents.map((entry, index) => index !== contents.length - 1 ? entry : {
            ...entry, parts: [...entry.parts, { text: '\nOUTPUT LANGUAGE: Write all human-readable explanations, headings, questions and JSON string values in English. This overrides any instruction above requesting Chinese. Preserve all JSON field names, enum codes and verbatim source quotes. Do not change clinical evidence, thresholds, uncertainty or conclusions.' }]
        });
    }
    var lastError = null;
    
    for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await callGeminiAPIOnce(contents);
        } catch (error) {
            lastError = error;
            var errorMsg = error.message || '';
            
            // 检查是否是速率限制错误
            if (errorMsg.includes('Resource exhausted') || errorMsg.includes('429') || errorMsg.includes('quota')) {
                var delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt); // 指数退避: 2s, 4s, 8s
                console.log('⏳ Gemini API 速率限制，' + (delayMs/1000) + '秒后重试 (尝试 ' + (attempt + 1) + '/' + MAX_RETRIES + ')...');
                await delay(delayMs);
            } else {
                // 非速率限制错误，直接抛出
                throw error;
            }
        }
    }
    
    // 所有重试都失败
    throw new Error('AI服务暂时繁忙，请稍后再试。' + (lastError ? ' (' + lastError.message + ')' : ''));
}

// 旧版四段合一调用保留兼容；当前文章接口走下方两次独立生成。
var analyzeArticle = async function(article, profile) {
    var cleanArticle = getCleanArticleForPrompt(article);
    var prompt = buildArticlePrompt(cleanArticle, profile);

    try {
        var contents = [{
            parts: [{ text: prompt }]
        }];
        var result = await callGeminiAPI(contents);
        return result || "抱歉，暂时无法生成摘要。";
    } catch (error) {
        console.error("Gemini Error:", error);
        throw error;
    }
};

function parseArticleParts(answer, keys) {
    var json = String(answer || '').match(/\{[\s\S]*\}/)?.[0];
    var value;
    try { value = JSON.parse(json || ''); } catch { throw new Error('文献解读返回格式不完整，请重试'); }
    var parts = {};
    for (var key of keys) {
        var section = typeof value[key] === 'string' ? value[key].trim() : '';
        if (!section || section.length > 20000) throw new Error('文献解读缺少必要部分，请重试');
        parts[key] = section;
    }
    return parts;
}

async function analyzeArticlePublic(article) {
    var cleanArticle = getCleanArticleForPrompt(article);
    var answer = await callGeminiAPI([{ parts: [{ text: buildArticlePublicPrompt(cleanArticle) }] }]);
    return parseArticleParts(answer, ['quickConclusion', 'detailedReading']);
}

async function analyzeArticlePersonal(article, profile, publicParts) {
    var cleanArticle = getCleanArticleForPrompt(article);
    var answer = await callGeminiAPI([{ parts: [{ text: buildArticlePersonalPrompt(cleanArticle, profile, publicParts) }] }]);
    return parseArticleParts(answer, ['personalizedMeaning', 'familyTakeaway']);
}

var chatWithArticle = async function(history, newMessage, article, profile) {
    var cleanArticle = getCleanArticleForPrompt(article);
    var systemPrompt = '你是DMD研究的AI解读员。你正在与一位家庭成员交谈。\n' +
        '请始终保持友善，使用通俗易懂的中文（15岁理解水平），并基于提供的具体文章进行回答。\n\n' +
        '文章背景:\n' +
        '标题: ' + cleanArticle.title + '\n' +
        '摘要: ' + cleanArticle.abstract + '\n\n' +
        '患者背景:\n' +
        '年龄: ' + profile.age + ' 岁, 状态: ' + profile.ambulatoryStatus + ', 激素使用: ' + profile.onSteroids + '。\n\n' +
        '规则:\n' +
        '- 严格基于文章内容和DMD的一般医学知识回答用户问题。\n' +
        '- 如果文章没有回答该问题，请直说。\n' +
        '- 如果给出任何类似建议的内容，必须包含免责声明: "' + DISCLAIMER + '"';

    try {
        // 构建对话历史
        var contents = [];
        
        // 添加系统提示作为第一条消息
        contents.push({
            role: 'user',
            parts: [{ text: systemPrompt + '\n\n请记住以上背景信息，准备回答用户问题。' }]
        });
        contents.push({
            role: 'model',
            parts: [{ text: '好的，我已经了解了文章背景和患者信息。我会用通俗易懂的中文为您解答关于这篇文章的问题。请问您想了解什么？' }]
        });
        
        // 添加历史对话
        if (history && history.length > 0) {
            history.forEach(function(msg) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                });
            });
        }
        
        // 添加新消息
        contents.push({
            role: 'user',
            parts: [{ text: newMessage }]
        });
        
        var result = await callGeminiAPI(contents);
        return result || "抱歉，无法生成回复。";
    } catch (error) {
        console.error("Gemini Chat Error:", error);
        throw error;
    }
};

var analyzeDrug = async function(drug, profile) {
    var ageDesc = profile.age + ' 岁';
    var ambulatoryDesc = profile.ambulatoryStatus === 'ambulatory' ? '可行走' :
                         profile.ambulatoryStatus === 'wheelchair' ? '轮椅依赖' : '混合状态';
    var steroidDesc = profile.onSteroids === 'yes' ? '是' : profile.onSteroids === 'no' ? '否' : '不确定';

    // 中国可用性状态描述
    var chinaDesc = '';
    if (drug.chinaStatus === 'approved') {
        chinaDesc = '该药物已在中国获批上市（中国已获批）';
    } else if (drug.chinaStatus === 'clinical_trial') {
        chinaDesc = '该药物正在中国进行临床试验，尚未正式上市（中国临床试验中）';
    } else if (drug.chinaStatus === 'nda_review') {
        chinaDesc = '该药物已向中国药监局提交上市申请，正在审评中（中国审评中）';
    } else if (drug.chinaStatus === 'not_available') {
        chinaDesc = '该药物暂未在中国上市（中国暂未上市）';
    } else {
        chinaDesc = '暂未收录该药物在中国的最新可用性信息（中国状态未知）';
    }
    if (drug.chinaStatusNote) {
        chinaDesc += '。补充说明：' + drug.chinaStatusNote;
    }

    var prompt = '作为DMD药物咨询助手，请分析**本种特定FDA获批药物: ' + drug.brandName + '** 与患者的适配情况。\n\n' +
        '患者信息：\n' +
        '- 年龄: ' + ageDesc + '\n' +
        '- 基因突变类型: ' + (profile.geneticProfile || '未填写') + '\n' +
        '- 行动能力: ' + ambulatoryDesc + '\n' +
        '- 是否使用激素: ' + steroidDesc + '\n' +
        '- 所在地区: ' + (profile.region || '未填写') + '\n' +
        (profile.clinicalNotes ? '- 补充说明: ' + profile.clinicalNotes + '\n' : '') + '\n' +
        '药物信息（上下文）：\n' +
        '- 品牌名: ' + drug.brandName + ' (' + (drug.brandNameCn || '无中文名') + ')\n' +
        '- 通用名: ' + drug.genericName + '\n' +
        '- 适应症: ' + drug.indication + '\n' +
        '- 剂量: ' + drug.dosage + '\n' +
        '- 中国可用性: ' + chinaDesc + '\n\n' +
        '任务:\n' +
        '请严格仅针对 ' + drug.brandName + ' 药物进行解读，严禁提及其他无关药物。\n' +
        '**1. 药物简介**\n' +
        '**2. 获批与适应症（年龄/行动状态限制）**\n' +
        '**3. 针对您的病情分析**\n' +
        '   - 核心：基因突变类型是否在该药物适用范围内？\n' +
        '   - 患者年龄(' + profile.age + '岁)是否符合适应症要求？\n' +
        '   - 行动能力状态是否影响用药？\n' +
        '**4. 中国地区可用性**\n' +
        '   - 说明该药物在中国的获批/上市状态、临床试验阶段\n' +
        '   - 如患者所在地区为中国，请针对性地说明如何获取或参与相关临床试验\n' +
        '**5. 给家庭的启示**\n\n' +
        '请加粗小标题，使用通俗易懂的中文。页面已提供固定黄色免责声明，正文无需重复生成免责声明。';


    try {
        var contents = [{
            parts: [{ text: prompt }]
        }];
        var result = await callGeminiAPI(contents);
        return result || "抱歉，暂时无法生成药物分析。";
    } catch (error) {
        console.error("Gemini Drug Error:", error);
        throw error;
    }
};

var chatWithDrug = async function(history, newMessage, drug, profile) {
    var ambulatoryDesc = profile.ambulatoryStatus === 'ambulatory' ? '可行走' :
                         profile.ambulatoryStatus === 'wheelchair' ? '轮椅依赖' : '混合状态';

    // 中国可用性描述
    var chinaDesc = drug.chinaStatus === 'approved' ? '已在中国获批' :
                    drug.chinaStatus === 'clinical_trial' ? '中国临床试验中' :
                    drug.chinaStatus === 'nda_review' ? '中国审评中' :
                    drug.chinaStatus === 'not_available' ? '中国暂未上市' : '状态未知';

    var systemPrompt = '你是DMD药物的AI解读员。你正在与一位家庭成员讨论一种特定的FDA获批药物。\n' +
        '请始终保持友善，使用通俗易懂的中文，并基于提供的具体药物信息进行回答。\n\n' +
        '药物背景:\n' +
        '品牌名: ' + drug.brandName + ' (' + (drug.brandNameCn || '无中文名') + ')\n' +
        '通用名: ' + drug.genericName + '\n' +
        '适应症: ' + drug.indication + '\n' +
        '剂量: ' + drug.dosage + '\n' +
        '中国可用性: ' + chinaDesc + (drug.chinaStatusNote ? '（' + drug.chinaStatusNote + '）' : '') + '\n\n' +
        '患者背景:\n' +
        '年龄: ' + profile.age + ' 岁, 行动能力: ' + ambulatoryDesc + ', 基因突变: ' + (profile.geneticProfile || '未填写') + '\n' +
        (profile.clinicalNotes ? '补充说明: ' + profile.clinicalNotes + '\n' : '') + '\n' +
        '规则:\n' +
        '- 严格基于该药物信息和DMD的一般医学知识回答用户问题。\n' +
        '- 严禁随意扩散到其他无关药物。\n' +
        '- 当用户询问在中国如何获取该药物时，根据中国可用性状态如实告知。\n' +
        '- 页面已提供固定黄色免责声明，回答无需重复生成免责声明。';


    try {
        var contents = [];
        
        contents.push({
            role: 'user',
            parts: [{ text: systemPrompt + '\n\n请记住以上背景信息，准备回答用户问题。' }]
        });
        contents.push({
            role: 'model',
            parts: [{ text: '好的，我已经了解了药物背景和患者信息。我会用通俗易懂的中文为您解答关于这种药物的问题。请问您想了解什么？' }]
        });
        
        if (history && history.length > 0) {
            history.forEach(function(msg) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                });
            });
        }
        
        contents.push({
            role: 'user',
            parts: [{ text: newMessage }]
        });
        
        var result = await callGeminiAPI(contents);
        return result || "抱歉，无法生成回复。";
    } catch (error) {
        console.error("Gemini Drug Chat Error:", error);
        throw error;
    }
};

var analyzeTrial = async function(trial, profile, context) {
    var prompt = buildTrialPrompt(trial, profile, context);


    try {
        var contents = [{
            parts: [{ text: prompt }]
        }];
        var result = await callGeminiAPI(contents);
        return result || "抱歉，暂时无法完成试验分析。";
    } catch (error) {
        console.error("Gemini Trial Error:", error);
        throw error;
    }
};

var chatWithTrial = async function(history, newMessage, trial, profile, context = {}) {
    var ambulatoryDesc = profile.ambulatoryStatus === 'ambulatory' ? '可行走' : 
                         profile.ambulatoryStatus === 'wheelchair' ? '轮椅依赖' : '混合状态';
    
    var systemPrompt = '你是DMD临床试验的AI咨询员。你正在与一位家庭成员讨论一项特定的临床试验。\n' +
        '请始终保持友善，使用通俗易懂的中文，并基于提供的具体试验信息进行回答。\n\n' +
        '试验背景:\n' +
        'NCT ID: ' + trial.nctId + '\n' +
        '标题: ' + trial.title + '\n' +
        '阶段: ' + (trial.phase ? trial.phase.join(', ') : '未知') + '\n' +
        '入排标准: ' + (trial.eligibility || '未提供') + '\n' +
        '当前中心额外要求: ' + (context.centerSpecialRequirements || '未提供明确的中心特殊要求') + '\n' +
        '患者条件匹配: ' + (context.matchRows || []).map(row =>
          `${row.label}：患者 ${row.patient}；要求 ${row.requirement}；结果 ${row.state}`).join('；').slice(0, 6000) + '\n' +
        '摘要: ' + (trial.summary || '未提供') + '\n\n' +
        '患者背景:\n' +
        '年龄: ' + profile.age + ' 岁, 行动能力: ' + ambulatoryDesc + ', 基因突变: ' + (profile.geneticProfile || '未填写') + '\n' +
        (profile.clinicalNotes ? '补充说明: ' + profile.clinicalNotes + '\n' : '') + '\n' +
        '规则:\n' +
        '- 严格基于该试验信息和DMD的一般医学知识回答用户问题。\n' +
        '- 严禁随意扩散到其他无关试验。\n' +
        '- 按当前中心已明确的附加要求回答；未提供的中心要求不得推测，最终资格由研究中心正式筛查。\n' +
        '- 页面已提供固定黄色免责声明，回答无需重复生成免责声明。';


    try {
        var contents = [];
        
        contents.push({
            role: 'user',
            parts: [{ text: systemPrompt + '\n\n请记住以上背景信息，准备回答用户问题。' }]
        });
        contents.push({
            role: 'model',
            parts: [{ text: '好的，我已经了解了该临床试验的背景和患者信息。我会用通俗易懂的中文为您解答关于这项试验的问题。请问您想了解什么？' }]
        });
        
        if (history && history.length > 0) {
            history.forEach(function(msg) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                });
            });
        }
        
        contents.push({
            role: 'user',
            parts: [{ text: newMessage }]
        });
        
        var result = await callGeminiAPI(contents);
        return result || "抱歉，无法生成回复。";
    } catch (error) {
        console.error("Gemini Trial Chat Error:", error);
        throw error;
    }
};

var generateRecommendedQuestions = async function(article, profile) {
    var cleanArticle = getCleanArticleForPrompt(article);
    var prompt = '你是一位富有同情心的DMD医学AI助手。请根据以下文章和患者档案，生成3个患者家属最可能关心的问题。\n\n' +
        '患者档案：\n' +
        '- 年龄: ' + profile.age + ' 岁\n' +
        '- 基因突变: ' + (profile.geneticProfile || '未填写') + '\n' +
        '- 行动能力: ' + profile.ambulatoryStatus + '\n' +
        '- 激素使用: ' + profile.onSteroids + '\n' +
        '- 地区: ' + profile.region + '\n\n' +
        '文章标题: ' + cleanArticle.title + '\n' +
        '摘要: ' + cleanArticle.abstract + '\n\n' +
        '要求:\n' +
        '- 严格用JSON数组格式返回，只返回数组不要其他文字。\n' +
        '- 每个问题不超过30个字。\n' +
        '- 问题要通俗易懂（15岁理解水平）。\n' +
        '- 问题要结合患者具体情况和文章内容。\n' +
        '- 格式示例: ["问题1？", "问题2？", "问题3？"]';

    try {
        var contents = [{
            parts: [{ text: prompt }]
        }];
        var result = await callGeminiAPI(contents);
        // 尝试解析JSON
        var cleaned = result.trim();
        // 去掉可能的markdown代码块标记
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        var questions = JSON.parse(cleaned);
        if (Array.isArray(questions) && questions.length >= 3) {
            return questions.slice(0, 3);
        }
        return questions.slice(0, 3);
    } catch (error) {
        console.error("生成推荐问题失败:", error);
        // 返回默认问题
        return [
            "这项研究对我家孩子有什么意义？",
            "研究中提到的治疗方法安全吗？",
            "我们需要和医生讨论哪些关键点？"
        ];
    }
};

module.exports = {
    analyzeArticle: analyzeArticle,
    analyzeArticlePublic: analyzeArticlePublic,
    analyzeArticlePersonal: analyzeArticlePersonal,
    chatWithArticle: chatWithArticle,
    analyzeDrug: analyzeDrug,
    chatWithDrug: chatWithDrug,
    analyzeTrial: analyzeTrial,
    chatWithTrial: chatWithTrial,
    generateRecommendedQuestions: generateRecommendedQuestions,
    callGeminiAPI: callGeminiAPI
};
