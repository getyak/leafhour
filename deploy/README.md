# Vercel + Supabase 托管

本机新增听读服务；当前托管配置不运行进程内语音队列，也不把音频写入函数临时目录。听读能力接口明确返回暂不可用，书籍和原有功能继续运行。启用前需要私人音频对象存储、数据库任务状态及持久 worker，另外验收取消与授权撤回。本轮不部署此功能。

官网 `/`、书房 `/library` 和阅读页 `/read?book=ID` 使用同一套网页与领域服务。默认三本公版书可匿名试读，许可与出处见 `catalog/manifest.json`。私人样书不会迁移到公开入口；旧单书 `/api/book`、`/api/records` 等接口返回 404。

应用先执行 `supabase/migrations/202610130001_hosted_library.sql`。它新增 `reader_documents` 与只供服务端调用的比较写入函数，并创建 20 MB 限制的私人 `reader-originals` 存储桶；不修改现有 `reader_books` 和 `reader_states`。RLS 开启，匿名和普通认证角色无数据表权限。

服务端配置 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISHABLE_KEY`、`READER_PUBLIC_ORIGIN`。密钥只留在 Vercel 的受保护环境变量，不能提交。可选 `DEEPSEEK_API_KEY` 提供显式的当前段落及邻段双译草稿，以及官方 DeepSeek Harness 阅读对话。对话临时运行文件使用函数临时目录，问题和回答按账号保存在共享领域存储。每次生成最多 45 秒、费用预留最多 0.10 元；每个账号每小时最多 10 次提问，同书只允许一个运行中的请求；全服务最多同时 2 项、每小时 100 项、每天 500 项。关闭窗口保留任务，停止操作通过共享状态通知运行实例。费用预留不是供应商结算金额，费用参照过期时拒绝生成。构建时按部署平台提取官方 SDK、最小 profile 与实际插件依赖，生成不公开的 `.reader-runtime/`，并在无真实密钥、零模型请求的条件下启动一次真实子进程。不得把本机生成的原生绑定直接复制到其他平台。

Linux x64 托管运行包同时携带固定的官方 Node 22.23.3 二进制和完整许可证。当前官方原生绑定无法识别 AWS Node 22/24 发行构建的内部 getter；相同依赖在官方 Node 发行版中通过。构建器逐项校验二进制与许可证的 SHA256，只复制运行文件；SDK 用 `dshBin` 入口在原子进程中 `execve` 到随包运行器，保留原 PID、标准输入输出、EOF 与停止语义，不创建中转进程，也不调整沙箱或模型工具权限。Linux 运行包约 128.2 MiB，生成后必须低于 200 MiB；CI 额外在固定 AWS Lambda 24 镜像中断网启动并关闭真实 SDK，确认进程回收与零模型请求。平台 Node、原生绑定或随包版本变更时必须重新验收，不能只依据开发机或 Ubuntu 上的通过结果。

托管版默认用邮箱与密码登录，密码直接交给 Supabase Auth 验证，不写入应用数据。验证码登录继续可用；新建书房使用邮箱验证码确认身份后设置密码，找回密码使用 Supabase recovery 验证码后设置密码。新密码至少八个字符，已有密码登录兼容旧长度。密码尝试按邮箱与全站共享限流，供应商故障保留可重试提示。仅配置 SMTP 的本机实例保留原有验证码与本机书房入口。

生产验证码为六位、十分钟有效，同一邮箱至少六十秒后重发。服务端保留六到八位输入兼容。发信未配置时保留匿名试读和已配置的密码登录，禁用发信入口。默认 Supabase 邮件只供项目团队成员使用，不能视为生产注册服务。

Resend 先验证自己的发件域名。按控制台返回的真实类型和内容添加发信用途的 DNS 记录；用于域名验证的 CNAME 保持 DNS only。保留现有邮箱接收记录，不要把根域的接收 MX 改成 Resend。使用仅限该域名的发信密钥，在 Supabase Auth 的 Custom SMTP 设置 `smtp.resend.com`、端口 `465`、用户名 `resend`、密码为该密钥，发件名称和地址使用自己的产品配置。将 `deploy/auth-email.html` 同时用于确认注册与 Magic Link 模板，两个模板都要保留实际 `{{ .Token }}`。在 Supabase 设置 `mailer_otp_length=6`、`mailer_otp_exp=600`、`smtp_max_frequency=60`，邮件发送额度与本站每小时三十次总额度匹配。真实收信、验证和退出通过后，再设 `READER_EMAIL_ENABLED=true`。

将 `deploy/auth-recovery-email.html` 用于 Reset Password 邮件模板，标题可设为“Leafhour · Reset your password / 重设密码验证码”。模板必须包含 `{{ .Token }}`，默认重设链接无法填入本站的验证码表单。设置密码需要当前会话与本次验证返回的独立凭据同时匹配，十分钟内有效；普通登录会话不能调用改密入口。凭据在首次派发改密前消费，响应不确定时需重新验证，避免重复修改。

Google 与 Apple 从 Supabase 公共能力配置读取实际启用状态，未配置的入口显示“准备中”。Google 使用网站 OAuth 客户端，授权来源为本站正式 HTTPS 来源，授权回调为 `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`，只申请登录所需的身份资料。Supabase 的 Site URL 设为本站正式来源，额外跳转白名单加入精确的 `https://YOUR_READER/api/auth/callback`；浏览器不保存供应商令牌。本站用一次性事务、浏览器 Cookie 和 PKCE 交换授权码，成功后继续使用随机会话 Cookie。

Apple 使用网站 Services ID，与启用 Sign in with Apple 的主 App ID 关联，登记 Supabase 域名及上述供应商回调。网站登录需要专用签名密钥、Team ID 与六个月内有效的客户端密钥；iOS 分发密钥不能直接当作网站凭据。记录到期时间并在到期前更新 Supabase 配置，再做一次真实授权返回。使用隐藏邮箱时保留 Apple 给出的身份，不能按猜测的真实邮箱合并书房；如要向隐藏邮箱发信，先登记合法发信来源。

会话在本站最多保留七天；令牌只留在服务端，多个实例共同持有刷新租约。退出先撤销本站会话，再通知供应商。网络或供应商短暂不可用显示可重试的错误，避免把服务故障当成错误验证码。登录返回只允许书房、上传入口及经过验证的阅读地址，不接受任意外站跳转。回调被取消或过期时可重新选择登录方式。

验收分别记录“配置已保存”“邮件已发出”“邮箱实际收到”“登录已完成”。Google、Apple 必须各自经过官方授权页并返回本站，不能用测试响应或按钮可点击代替真实验证。维护凭据和验收记录时遵守实例拥有者指定的存储位置，勿进入发布镜像。

PDF / TXT / Markdown 原文件通过短期签名直接上传私人存储，避免 Vercel 请求大小限制，处理完成后保存内容哈希验证的原件。原文件上限 20 MB，PDF 限 500 页和 200 万字；云端提取书籍 JSON 另限 350 万字节，超出时在加入书房前明确拒绝，需按章拆分。原件校验后使用一分钟有效的私人下载链接，避免函数响应体大小限制。扫描件需另做 OCR。每个账户每小时最多开始 6 次上传、每天 20 次；未完成的临时上传有一小时应用有效期，存储服务的签名本身有效期由 Supabase 控制，过期临时对象需运维清理。

笔记、位置、译文与授权使用数据库版本比较写入，跨 Vercel 实例不会靠进程内队列猜顺序。按段翻译全服务最多同时两项；每个账户每小时最多 10 项、每天 50 项，全服务每小时 100 项、每天 500 项。失败请求也占用额度，以限制重复计费。限制不是订阅或购买。

网页与 MCP 共用授权，云端接入配置从开源 `v0.3.0` 包启动 stdio 客户端，显式连接 HTTPS 书房。令牌按指定书与正文、笔记、阅读活动、写评论范围生效，七天过期，可撤回。

Vercel 的 JSON 请求和响应仍受平台限制（当前 4.5 MB）；网页整库导出使用带SHA256校验的逐书分段传输，每份响应最多1MiB原始字节，浏览器合成普通JSON。旧整库导出接口供现有本机客户端兼容，仍受托管响应上限约束。单份备份最多100本；云端恢复仍受单书、单次请求与文档上限约束，特别大的单本备份应在本机恢复。原文件上传走直接存储通道，20 MB 上传不经过函数请求体。

发布前运行 `npm run verify:deploy`，执行测试、构建与发布边界检查；`release-files.json` 和 `.vercelignore` 共同限定发布内容，排除私人资料、记录与凭据。源代码与开发文档统一在公开仓库维护，Vercel 直接连接该仓库的 `main`；不再同步源码或部署镜像。发布流程与回退方式见 [自动检查与发布](../docs/ci-cd.md)。正式域名更新后，自动检查源提交与匿名访问；账户隔离、原件校验、并发记录和授权撤回仍需另外验收。

## Leafhour production domain

The managed service uses `https://leafhour.com`. Set `READER_PUBLIC_ORIGIN` to that exact origin and allow `https://leafhour.com/api/auth/callback` in Supabase. Keep the provider callback at the existing Supabase project; update Google web origin and Apple web domain/Private Email Relay sources separately. The user's self-hosted installation must use its own origin and provider configuration.

Before selecting `Leafhour <hello@leafhour.com>` as SMTP sender, verify its Resend domain with the provider's exact DKIM and SPF records, retain the existing SMTP credential, and apply both source templates. Confirmation and magic-link subjects: `Leafhour · Your verification code / 邮箱验证码`; recovery: `Leafhour · Reset your password / 重设密码`. Keep six-digit, ten-minute codes and the existing rate limits. A successful send response does not prove inbox delivery.

Changing the origin requires a fresh sign-in; the account ID and stored library remain stable. Local browser drafts belong to each origin. Preserve access to the former host for recovering or exporting unsynced drafts. Do not configure a blanket redirect that forwards posted passwords or authorization codes. See `docs/superpowers/specs/2026-10-16-leafhour-brand-launch-design.md` for the design and launch gates.

For the Leafhour transition, set `READER_ADDITIONAL_WEB_ORIGINS=https://reader.cubxxw.com` in the production environment. This is an explicit HTTPS-origin allowlist for legacy password/email login and draft recovery; it never changes the canonical OAuth callback. Extra origins with paths, wildcards, credentials, query/fragment, or plain HTTP are rejected. Third-party buttons are hidden on noncanonical hosts, and OAuth starts there are rejected before provider state is created. Neither the request Host nor forwarded-origin headers grant authorization.
