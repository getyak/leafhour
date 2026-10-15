> 当前交付入口已迁移到唯一公开仓库 `getyak/marginalia-reader`，按 [自动检查与发布](../docs/ci-cd.md) 直接部署。下文保留此前部署与验收历史，旧镜像关系已停用。

# 2026-10-13 云端发布接续

用户明确授权更新远程并部署，确认沿用 Vercel + Supabase；发现 SMTP 未配置后，用户选择先上线官网和公版试读，邮箱服务稍后补齐。夜间心跳保持 PAUSED。

本机完整实现已提交 35a0099 并推到私有远程分支。云端适配新增独立 reader_documents 和私人 reader-originals，旧单书匿名接口已关闭，网页/MCP 共用领域服务；原有 reader_books/reader_states 不迁移、不公开。

本地 127 tests 全通过，build:vercel 与 diff 检查通过。真实 Supabase 已执行新增迁移；两个独立服务同时保存两条合成笔记均保留，下载原件字节相同，另一账户 404，签名直接上传 200，重复内容只保留一书。没有调用模型生成新的译文。

发布范围：美观官网、三本许可清楚的完整英文原文试读、云端账户/私人存储/授权适配源码。邮箱发送入口 READER_EMAIL_ENABLED=false，真实邮件投递尚未验收；不能宣称普通用户注册和私人上传已开放。MCP 的云配置需 public v0.2.0 标签先发布。

云端原文件支持 20 MB，但提取书籍 JSON 限 350 万字节，超出在入库前拒绝；JSON 响应限 400 万字节并明确报错，云端大备份仍需本机恢复。原件验证后签发一分钟私人下载地址。限制与临时上传清理说明见 deploy/README.md。

正式地址：https://reader.cubxxw.com/ 。原地址 https://marginalia-reader-deploy.vercel.app/ 以 308 跳转到正式地址，保留路径和查询参数。私有归档、受控公开源码和 Vercel 部署镜像均通过各自 PR 更新；公开源码 v0.2.0 标签已发布，MCP 客户端源文件与当前实现一致。部署仓库 main 已包含嵌套路由与 PDF worker 修复，不能回退到旧单书接口。

实际部署发现并修复两项本机测试无法证明的故障：Vercel 对嵌套 /api/auth/session、按书路径返回平台 404，增加显式 function 与 rewrite 后三本书全部返回 200；PDF.js 动态加载 worker 未进入函数产物，合法合成 PDF 返回 422，显式导入 worker 后正式服务成功提取。127 tests 仍全通过，各镜像远程 CI 通过。

真实浏览器在正式地址验证首页、书架和爱丽丝正文；390px 手机首页、正文均为 scrollWidth=390，没有横向溢出。邮箱按钮禁用并明确显示“邮箱登录准备中”。截图位于 local/verification/production-home.png、production-mobile-home.png、production-mobile-reader.png、production-auth-disabled.png。

使用 Supabase 管理端生成的合成账户验证码验证服务，未发送邮件；这证明身份验证、会话和云端领域服务连接，不能证明真实 SMTP 投递。正式服务的真实合成 PDF 签名上传、提取、独立实例并发两条笔记、另一账户 404、原件一分钟签名下载及字节一致、官方 SDK 通过 HTTPS 读取授权原文、拒绝未授权笔记、撤回立即失效、四本书导出 200、退出后会话撤销，均取得明确通过结果。原文未生成假译文；本轮没有调用模型，AI 翻译质量与新实例完整迁移不据此升级验收状态。原始证据 local/verification/production-flow-evidence.json 的 mailSent 与 modelCalled 都是 false。

当前发布仅向普通用户开放官网与三本公版试读。邮箱发送、普通用户注册以及据此进入私人上传和 AI 翻译，等待生产邮件服务配置；大型 JSON 云端迁移仍受 4.5 MB 平台限制，需使用本机恢复。原有本机 .env、私人样书和个人记录的 SHA-256 与发布前快照一致。

## 2026-10-14 正式域名

用户授权使用 `reader.cubxxw.com`。Cloudflare 新增 CNAME，目标为 Vercel 为本项目返回的 `48a672b75e261fcd.vercel-dns-017.com`，采用 DNS only。Vercel 已验证解析，生产环境 `READER_PUBLIC_ORIGIN` 更新为 `https://reader.cubxxw.com`，使用原生产部署的同一份代码重新部署，状态为 READY。

实测 HTTPS 首页、书房、中文试读页面、会话与书架接口、三本公版书接口均返回 200；浏览器从首页点击中文试读后显示爱丽丝的六段中文草稿。新来源的无会话退出请求返回 200，其他来源返回 403；旧单书接口仍返回 404，原部署保护配置保持 `prod_deployment_urls_and_all_previews`。旧域名的书页链接返回 308，跳转保留路径及查询参数。

验证记录在 `local/verification/reader-domain-evidence.json`，解析、首页与正文截图分别为 `reader-domain-dns.png`、`reader-domain-home.png`、`reader-domain-reading.png`。本次只调整域名与正式地址配置，没有调用模型或发送邮件；邮箱功能仍未开放。

## 发布保护操作错误与纠正

发布时曾短暂将 Vercel 保护范围设为 preview，可能让旧生产版本地址失去平台保护。这是本次操作错误，不能写成“私人内容从未暴露”。随后已恢复官方 Standard Protection：prod_deployment_urls_and_all_previews；正式主域名公开，历史生产与预览部署地址要求 Vercel 登录。旧私人版本 /api/book 匿名请求实测 302 跳转登录，正式新版旧 /api/book 和 /api/records 为 404。现有旧版本一小时查询没有返回日志记录，这不足以排除短暂窗口中的访问。证据 local/verification/old-deployment-protection.json 和 old-deployment-access.jsonl。

调试时一个合成测试账户的 Cookie 曾出现在命令失败信息中，已立即在服务端撤销；它只关联本轮的合成 PDF 和笔记，不是用户现有账户、密钥或私人书籍。测试账户及上传对象将在验收结束清理。

## 2026-10-14 登录优化

验证码限流、会话续期、Google/Apple 的一次性服务器回调和两步登录面板已实现。新增 32 项验证，完整 166 项测试及构建通过；独立复核发现的退出、迟到 Cookie、刷新租约与回调重试位置问题已用失败复现测试修复。桌面及 390px 本机真实页面验收通过，供应商响应使用受控测试，不能记作真实登录。

Supabase 已保存 Resend SMTP、发件人“旁读 <hi@cubxxw.com>”、六位十分钟验证码、六十秒重发间隔、每小时三十封、注册/登录邮件模板，以及 reader.cubxxw.com 的精确回调白名单。Resend 的 cubxxw.com 已 Verified；权威 DNS 核对三条真实发送解析通过。旁读专用密钥只允许该域发信，已替换 SMTP 密码；DayPage 既有密钥单独保留。实际收到验证码，供应商验证、刷新、退出及重复验证码拒绝通过。生产邮件入口为 true；真实网站过期阻止、重发收信、登录、刷新保持登录、退出及退出后刷新通过。Google 与 Apple 已接入并完成下方真实验收。

用户本次明确允许在 Systems & Automations 保存登录凭据。已补充现有 Resend 密钥、权限、待办与真实投递结果，并为 Google/Apple 关联旁读和登记缺失项。未新增收费服务、未调用翻译模型、未复制私人样书或记录到镜像。

## 2026-10-15 三种登录正式验收

邮箱验证码、Google 和 Apple 均在正式网站完成真实登录、刷新保持登录、退出和退出后刷新。Apple 从真实书页的登录入口发起，返回指定爱丽丝段落与笔记面板；Supabase 的独立身份记录确认 Apple 与 Google 关联同一已验证邮箱账户。邮箱别名不会被猜测合并。证据分别为 `reader-real-browser-auth-checks.json`、`google-real-browser-auth-checks.json`、`apple-real-browser-auth-checks.json` 和 `apple-real-provider-identity-check.json`，位于忽略的 `local/verification/`。

Google 仅请求 openid、邮箱与基本资料，专用网站客户端的来源及官方回调已核对，真实验收后控制台已发布 In production。Apple 专用主标识、网站标识和签名材料均已接入；私密邮箱转发服务登记 `hi@cubxxw.com`，SPF 检查通过，但隐藏邮箱实际收信尚未单独测试。Apple 客户端签名于 `2027-04-12T15:48:35Z` 到期，维护信息和实际凭据按用户授权保存到既有 Notion 服务记录，已回读确认。

隐私说明 `/privacy` 已上线，说明身份、私人书籍与生成上下文边界；匿名 HTTP 测试先复现 404，修复后通过，完整 166 项测试和构建通过。受控公开仓库 PR6、部署镜像 PR5 已合并，生产部署 `dpl_4GQPNp63tj62bHCfvDcpxmXy2bdQ` 为 READY，提交为 `3c61329f5d2cf761425a4a49cb404f58a3489cb9`；线上能力接口确认三种登录均可用。真实手机、屏幕阅读器、私人书籍上传、翻译质量和完整迁移仍使用各自独立的验收记录。
