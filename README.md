<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

## 康复视频版本（2026-10-26）

`rehab_videos.video_version VARCHAR(20) NULL` 独立管理每个视频的版本标签（例如 `1.0`、`2.0`、`3.0`）。`video_group` 继续管理 `level1` / `level2` / `level3` 训练分组，两者没有对应关系。同一训练分组中的不同视频可以使用不同版本，页面直接显示数据库版本，不按等级或视频顺序累加。

同步部署前后端并重启后端，启动迁移自动新增该字段，需要 ALTER 权限。也可手工执行 `database/20261026_rehab_video_version.sql`，可重复执行。历史视频的版本初始为空，需要按实际版本填写，留空时页面不显示版本标签。已有版本不会被迁移覆盖，训练分组、播放规则及连续打卡解锁规则保持不变。

例如将视频 5 的版本设为 2.0：

```sql
UPDATE rehab_videos SET video_version = '2.0' WHERE id = 5;
```

数据库修改在重新加载视频列表后生效，接口不缓存版本结果。此前的 `rehab_video_levels` 关联设计已取消，若已建表可保留，应用不再读取。验证：`node --test server/rehabVideos.test.cjs`。

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1oLx1PwUsvuR8gtrRP07L6yRlUrhjJ8to

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
# AI 解读分享

论文、药物和临床试验的解读页均提供分享入口。预览后可生成约 300 字的解读节选和直达链接，一键复制完整分享文字后粘贴到微信群或好友聊天；也可调用系统文字分享。不再生成或分享截图。

分享仅提交条目编号，服务端从公开资料库读取标题和摘要/适应证生成通用介绍。分享文字和链接页面均不使用个性化解读、个人资料或聊天记录。公开资料缺失时拒绝生成分享，不回退到个人解读。接收者先登录，再直接打开原有 AI 咨询窗口，根据接收者自己的档案生成个性化解读。

部署时需要同步发布前后端并重启后端。启动时自动创建 `public_interpretation_shares` 表，数据库账号需要建表权限。测试命令：`node --test server/interpretationShares.test.js`。系统分享能否直接选择微信群取决于浏览器和手机系统，需在目标设备联调。

隐私升级后，旧版分享链接不再返回历史个人解读，需重新生成分享链接；旧表不再被分享接口读取。

个人资料的心脏射血分数支持“不知道，跳过”，未填写时保存为空，重新打开不再填入默认数值。

## 2026-09-16 解读与咨询更新

文献解读提示词位于 `server/articlePrompt.js`，分两次生成四部分：快速结论和研究详细解读按文献及提示词版本缓存，个性化意义和家庭启示按用户、文献、档案及提示词版本缓存。旧版四段合一缓存不再用于文献解读。

分享表自动添加 `source_id` 字段（数据库账号需要 ALTER 权限），分享读取接口只返回公开原始条目，前端复用三类现有咨询窗口。没有来源编号的旧链接需重新分享。登录、邮箱绑定和资料完善后继续打开目标条目。

药物分析和追问接入 openFDA 药品说明书及 Drugs@FDA 审批记录，试验分析和追问接入 ClinicalTrials.gov v2 单项详情。仅发送公开药名/试验编号，6 秒超时，30 分钟内存缓存及并发请求合并；失败不阻断原有咨询。AI 分析缓存按数据源版本与日期更新。

官方接口文档：https://open.fda.gov/apis/drug/label/how-to-use-the-endpoint/ 、https://open.fda.gov/apis/drug/drugsfda/ 、https://clinicaltrials.gov/data-api/api 。

验证：`node --test server/interpretationShares.test.js server/consultationEvidence.test.js`。

## 咨询来源调整（2026-09-20）

已取消五个中国平台的查询接入、官方资料面板和 AI 上下文补充，移除对应后端路由。保留 openFDA、Drugs@FDA 和 ClinicalTrials.gov；更新分析缓存版本，避免复用含已移除来源的旧解读。需同步部署前后端并重启后端，无数据库迁移。

## 出生日期与外显子重复范围

先执行 `database/20260918_profile_birth_date.sql`，再同步发布前后端；后端启动迁移也会幂等补充 `user_profiles.birth_date DATE NULL`。原始数据库导出保持不变，历史 age 和外显子数据不做推算或批量改写。

缺失与重复共用既有 exon_start/exon_end 字段，允许两项同时留空，限制整数1—79且起始不大于终止。切换突变类型会清空旧范围，防止沿用不同突变的数字。服务端重新校验并生成对应基因描述。

新档案填写出生日期，老档案可先保留原年龄并提示补生日。周岁按 Asia/Shanghai 日历日计算，非闰年的2月29日生日在3月1日增长；前端每分钟及窗口重新聚焦时刷新年龄。读取资料和每次 AI 请求均动态计算，生日不传入模型或分享内容；AI 缓存使用重新计算后的年龄。age 列仅保留兼容快照，不依赖每日数据库定时更新。

验证：`node --test server/profileRules.test.mjs`。数据库迁移尚需在目标环境执行验证。

## 药物与临床试验提示词还原（2026-09-20）

药物分析、药物追问、临床试验分析及试验追问已恢复接入额外资料前的提示词框架；临床匹配恢复原版百分比及原因要求。四类回复均不再要求重复免责声明，保留页面黄色提示。已停止在这些提示词中追加外部接口资料及来源规则（包括 FDA 和 ClinicalTrials.gov 补充上下文），原始条目的采集功能保留。旧的资料辅助模块不再被咨询调用。更新独立咨询提示词缓存版本，避免复用此前结果。以上说明取代此前关于咨询继续追加外部资料的描述。
