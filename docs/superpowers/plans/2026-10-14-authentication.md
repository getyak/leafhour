# 旁读登录体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for implementation in the current chat, or superpowers:subagent-driven-development if the user explicitly selects delegated execution. Steps use checkbox syntax for tracking.

**Goal:** 在 `reader.cubxxw.com` 完成 Resend 邮箱验证码、Google 和 Apple 登录，提供简洁且可恢复的登录体验。

**Architecture:** Supabase 管理身份，Resend 经 SMTP 投递验证码。本站服务器持有供应商令牌与一次性授权事务，浏览器继续使用随机会话 Cookie；三种登录共用现有私人书房隔离和授权。

**Tech Stack:** 现有 Node.js 22.13.0+、原生 HTML/CSS/JavaScript、Vercel、Supabase Auth、持久化文档版本比较写入。继续使用现有测试工具，按需使用官方客户端，不引入前端框架迁移。

**Spec:** `docs/superpowers/specs/2026-10-14-authentication-design.md`

## Global Constraints

- 发件与真实收信测试地址均为 `hi@cubxxw.com`；展示发件人 `旁读 <hi@cubxxw.com>`。
- 默认六位验证码，十分钟有效，同邮箱重发至少间隔六十秒；生产配置、接口和界面必须一致。
- 保留七天的本站会话；访问与刷新令牌仅保存在服务器。
- 匿名试读继续开放；私人记录始终按 Supabase 用户 ID 隔离。
- 保留安全的阅读返回地址、本机登录以及账户变化时的私人界面清除。
- 未配置或未完成真实验证的方法如实记录状态；不购买服务，不调用翻译模型。
- 发布镜像沿用既有受控源码范围；私人样书、原有记录和配置不进入发布包。

## Review Focus

- 邮件迟到、关闭后重开、快速更换邮箱：旧请求不能覆盖新输入，重发限制不能重置。
- 从书页或上传入口登录：第三方返回后仍回到允许的原入口，不接受外站地址。
- 同一账户多个标签页或多个服务实例同时刷新：仅一个请求使用旧刷新凭据。
- 网络超时与供应商拒绝：不能把不确定的邮件投递报告成已收到，也不能把网络错误当成验证码错误。
- Apple 隐藏邮箱：尊重服务端身份，不根据姓名或猜测的邮箱合并私人书房。

---

### Task 1: 验证码限制、能力状态与会话刷新

**Files:** Modify `deploy/hosted-auth.mjs`, `server/email-auth.mjs`; create `server/auth-policy.mjs`, `tests/auth-fixture.mjs`, `tests/auth-policy.test.mjs`; extend `tests/hosted.test.mjs`.

**Interfaces:** `auth.requestCode(email, context?) -> {sent, expiresIn:600, retryAfter:60}`；`auth.capabilities() -> {email:boolean, providers:{google:boolean,apple:boolean}, otp:{digits,expiresIn,retryAfter}}`；保持 `verifyCode`, `userFor`, `logout` 的现有接口。`normalizeAuthEmail(value)` 验证并规范邮箱；`safeAuthReturn(value)` 仅接受 `/library`、允许的上传意图和既有 `safeReaderReturn` 的结果。

- [ ] 写入失败测试：两个独立认证实例同时请求同邮箱时最多发送一次；一分钟内返回限流及实际剩余等待时间；发送超时不返回成功。
- [ ] 写入失败测试：并发刷新只调用一次供应商刷新接口；另一实例可读到新结果；刷新与退出并发时撤销优先；过期租约可恢复；短暂上游错误不清除有效账户资料。
- [ ] 运行 `node --test tests/auth-policy.test.mjs tests/hosted.test.mjs`，确认新测试因缺少行为而失败。
- [ ] 在已有文档存储中持久化请求预留和刷新租约。版本比较写入的回调必须无网络和随机生成等副作用；所有供应商调用在成功预留后执行。根据供应商错误码区分验证码错误、限流和暂时不可用，保留安全的中文提示。
- [ ] 查询并短期缓存 Supabase 公共能力配置；本机认证返回明确的本机能力。会话响应不返回密钥或完整供应商错误正文。
- [ ] 重跑上述测试，通过后提交本任务涉及的文件。

### Task 2: 一次性第三方授权与正式回调

**Files:** Modify `deploy/hosted-auth.mjs`, `server/portal.mjs`, `api/[...path].js`; create `tests/oauth.test.mjs`; extend `tests/vercel-route.test.mjs`, `tests/portal.test.mjs`.

**Interfaces:** `auth.beginOAuth(provider,next) -> {transactionToken,authorizeUrl,expiresIn:600}`；`auth.finishOAuth(transactionToken,code) -> {token,user,next}`；`auth.cancelOAuth(transactionToken)`。`POST /api/auth/oauth` 只接受 `google|apple` 和安全返回地址，返回 `{url}`；`GET /api/auth/callback` 完成授权并重定向；`GET /api/auth/session` 增加 Task 1 的能力字段。

- [ ] 写入失败测试：固定本站回调、随机校验材料与一次性消费；禁止未知供应商、伪造或过期事务、缺少 Cookie、重复回调和外站返回地址；供应商取消后清除事务并允许重试。
- [ ] 写入失败测试：第三方返回用户沿用供应商确认的 ID；Apple 隐藏邮箱不与其他用户合并；令牌不进入浏览器响应；嵌套认证路径能通过 Vercel 路由。
- [ ] 运行 `node --test tests/oauth.test.mjs tests/portal.test.mjs tests/vercel-route.test.mjs`，确认失败。
- [ ] 实现服务器端授权码校验和交换。供应商生成的授权状态由 Supabase 校验；本站额外持久化随机事务及校验材料，临时 Cookie 使用 `HttpOnly; Secure; SameSite=Lax` 和十分钟期限。Supabase 令牌交换成功后创建现有本站会话，临时 Cookie 清除。
- [ ] 回调使用固定生产来源构造跳转，不依赖请求传入的任意主机名。认证 POST 保留来源校验并限制请求体大小；取消与错误返回 `/library?login=1` 的安全错误状态。
- [ ] 将返回入口写入事务；上传意图只保存布尔状态，不传文件或私人文本。重跑测试并提交。

### Task 3: 登录面板和可恢复交互

**Files:** Create `app/auth-flow.mjs`, `app/auth-dialog.mjs`, `app/auth.css`, `tests/auth-flow.test.mjs`; modify `app/home.html`, `app/portal.js`, `app/reader.js`, `app/reader-translation.js`, `server/portal.mjs`.

**Interfaces:** `createAuthFlow({clock})` 提供邮箱步骤、验证码步骤、请求序号、绝对重发截止时间与有效请求判断；`mountAuthDialog({dialog,api,getSession,onAuthenticated,getReturnTo}) -> {open,close,reset,updateCapabilities}`。书房只处理认证成功后的刷新和入口恢复，不管理验证码控件。

- [ ] 写入失败测试：重发倒计时按绝对时间计算；关闭再打开保留同邮箱冷却；更换邮箱清除验证码并使旧响应失效；连续提交最多发起一个有效请求；成功后不能被迟到错误覆盖。
- [ ] 运行 `node --test tests/auth-flow.test.mjs`，确认失败。
- [ ] 实现“进入你的书房”约 380px 的暖白面板，提供正式 Google/Apple 品牌入口和“或使用邮箱”。验证码单输入支持粘贴、手机自动填充和回车；具备更换邮箱、重发倒计时、错误恢复、取消和成功状态。
- [ ] 用专用模块替换原书房脚本中的认证事件；新增本机服务静态映射，Vercel 构建继续自动复制应用资源。阅读页判断登录能力时包含已配置的第三方入口。
- [ ] 160–220ms 动效、减少动态效果、44px 触摸尺寸、焦点返回和状态播报均落到真实 DOM。先按供应商实际配置呈现可用状态。
- [ ] 重跑状态测试；在本机浏览器检查 390px 和桌面真实操作，模拟接口仅用于错误和取消分支，证据明确标记。提交本任务。

### Task 4: Resend 与身份供应商配置

**Files:** Extend `.env.hosted.example`, `deploy/README.md`; add protected operational evidence under ignored `local/verification/`.

**Interfaces:** 使用既有 Supabase 项目和 Vercel 项目；只修改本设计所需的认证配置，不迁移书房数据。

- [ ] 读取当前 Resend 域名、Supabase 邮件与供应商配置，并保存脱敏前置状态。复用已有凭据；如果缺失，取得受保护的本机文件位置或按工具要求完成具体凭据创建确认。
- [ ] 核对 `cubxxw.com` 的 Resend 域名与已有邮件解析。按 Resend 返回的真实值添加缺失记录，验证完成后接入 `smtp.resend.com:465`，发件人 `旁读 <hi@cubxxw.com>`。
- [ ] 配置六位、十分钟的 Supabase 验证码模板与发送限制，保证模板包含实际验证码变量。先验证真实收信，再开启 `READER_EMAIL_ENABLED=true`；以实际响应和收件记录判断发送结果。
- [ ] 读取并复用 Google 网站客户端配置，登记 Supabase 官方回调及本站回调白名单。读取并复用 Apple 网站服务和签名配置，确认隐藏邮箱发信来源与密钥有效期。缺少供应商资料时继续完成独立代码工作，保留该方法不可用状态。
- [ ] 用户完成官方登录页的身份验证与授权后，验证回到同一书房。任何新密钥、扩大权限或接受条款的动作遵守工具确认要求，不购买会员。
- [ ] 更新部署说明中的必要配置、失败恢复和 Apple 密钥维护要求，并提交可公开的说明；证据和凭据保持在发布包之外。

### Task 5: 复核、上线与真实登录验收

**Files:** Update `docs/superpowers/specs/2026-10-14-authentication-design.md`, `_briefs/hosted-release.md`; save evidence under `local/verification/`.

- [ ] 执行 `npm test`、`npm run build:vercel`、`git diff --check`；确认正式应用静态资源不含服务器凭据。
- [ ] 复核本次差异和主要认证失败分支，解决实际发现的问题。独立复核按用户选择的执行方式进行。
- [ ] 通过既有受控镜像和候选部署验证，再切换 `reader.cubxxw.com`。保持历史生产与预览保护；保留原有本机私人文件和配置。
- [ ] 在真实邮箱完成验证码注册、登录、刷新和退出；验证验证码过期、重复使用和重发限制。Google、Apple 各自完成真实授权返回；用户需要完成的密码、二次验证和授权页交由用户操作。
- [ ] 验证从阅读页登录后返回同书同段，从上传入口登录后恢复上传入口，切换账户不会显示他人的私人记录。
- [ ] 检查手机和桌面界面；记录真实收到、授权通过、只配置完成、缺少资料四种边界，截图与结论一致后交付。

## 自查

每项设计要求已归入上面五项任务；所有网络调用均放在持久化版本比较写入之外。服务和界面共同使用同一组验证码参数，回调不向前端下发供应商令牌。Resend、Google 和 Apple 的外部资料与验收单独记录，未用可点击界面替代真实可用性。
