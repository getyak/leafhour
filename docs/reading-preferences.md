# 阅读偏好：每本书的阅读方式与账户级新书默认

## 每本书的阅读方式

在书页打开“阅读工具” → “阅读设置”，可以分别选择阅读目标、深读优先语言、阅读方式与中文译法。

- **未设置 · 原文开场**：保留原来的习惯，每次打开先看原文。
- **深入理解**：切换到你选择的原文或中文；没有对应译文时仍可读原文，并显示缺译提示。
- **语言学习**：先看原文，按需核对已有译文。

原文、中文译文和对照仍可单独切换；直译、意译各自使用自己的已存版本。更换目标不会改写原文或生成译文，缺少直译时也不会借意译填充。中文原文书没有另一语言译文时，继续显示中文原文。

重新打开一本书时，按以下优先级决定最初的阅读方式与排版：

1. 显式入口（引用链接、试读链接等）指定的文本层；
2. 这本书自己保存的阅读方式与排版（包括手动选择的对照或中文视图，重新打开时会记住）；
3. 账户的阅读习惯（见下节）；
4. 访客与旧记录的安全默认（原文开场）。

没有保存阅读方式的旧记录继续原文优先；只含原文的书（中文原文书尚无译文）始终显示原文。切换前后的书、章、段落位置保持对应。恢复阅读外观只重置排版与纸面，保留目标、优先语言与阅读方式。

每本书保留自己的选择：书页里的调整只随这本书的阅读位置保存，不会改写账户的阅读习惯。登录后，偏好随阅读位置保存并进入现有阅读备份；访客只保留在当前浏览器。离开前确认阅读位置已保存；浏览器不能持久保存或服务暂时无法同步时，按书页提示重试或另存待同步记录。显示译文和重新打开书页不代表译文已被人工校对，也不能证明已经理解。

## 账户的阅读习惯（新书默认）

书房设置新增“阅读习惯”分类：可以选择新书默认的阅读方式（原文 / 译文 / 对照，默认对照）、深读优先语言（原文 / 中文）、字号与现有纸面、字体控件。界面会说明：译文目前提供简体中文；只含原文的书仍显示原文，不会自动生成译文。紧凑表单只显示基础字段，保存时仍会保留完整快照里的其余排版字段（行距、留白、对照风格等；这些仍在书页的“阅读设置”里调整）。

- 登录后首次进入书房，会看到一张小而安静的邀请卡“设置阅读习惯”，可随时打开同一表单，也可以“暂不设置”；它不是不可跳过的弹窗，也不打断正在阅读的书页。“暂不设置”会持久记录；完成保存后邀请消失，之后在设置里随时可改。
- 书页“阅读设置”里有明确的“设为新书默认”：把当前这本书的阅读方式与排版存为账户默认。当前书的章节位置、锚点与记录保持不变；每本书自己的选择仍然优先。保存失败或版本冲突（409）时保留可见的选择并如实报错，不会把本机改动当成云端已保存。
- 冲突后可点只读的“读取最新版本”：它只读取最新账户快照，绝不自动重发写入；你改过的选项保留，未改与隐藏字段取最新值，并提示需手动再保存一次确认。同一账户的刷新/重新打开会同样采用新版本且不丢你的改动；换账户或迟到的响应绝不会串写。

### 存储与接口

账户阅读习惯保存在账号目录的 `reading-preferences.json`（与阅读记录同级），不在头像/登录身份里，也不随书保存。文档是一份严格、有限的 v1 全量快照：16 个既有排版字段 + `mode`（en/zh/parallel）+ `variant`（literal/interpretive）+ `onboarding`（pending/completed/dismissed），另有持久化 `revision` 与服务端 `updatedAt`。

- `GET /api/account/reading-preferences`：只读，不创建任何状态；未登录只返回空视图（`preferences:null`），永远不含他人或访客数据。
- `POST /api/account/reading-preferences`：必须是已登录的当前账户，请求体 ≤ 8 KiB，只允许 `{baseRevision, preferences}` 两个字段；`preferences` 必须是完整的已知键值（未知键、缺键、越界或枚举外取值一律 400）。账户归属只来自会话，不能从请求体或自定义头挑选。
- 保存用 `revision` 做 CAS：`baseRevision` 与持久化版本不一致时 409，原子递增；并发保存只有一个成功；版本永不回退。恢复备份替换内容时，版本至少前进到恢复前 CAS 之后（且不低于备份自带版本），避免恢复前发出的旧写入覆盖恢复结果；`preserveExisting` 保留已配置目标时是不变更的空操作，超出安全整数范围会拒绝而不是绕回。`updatedAt` 时间戳最多64字符（先检查长度再解析）；超长或未知字段的备份元数据在任何恢复写入前整包拒绝。
- 请求经过既有的来源（Origin）与属主（`X-Reader-Owner`）校验；属主不匹配返回 409 并带 `X-Reader-Session-Changed: 1`。`/api/auth/session` 可以带当前账户的同一份规范化快照，避免阅读页启动多一次请求；只含当前登录账户的数据。
- 阅读页的 `/api/account/...` 请求不做按书路径改写（`reader-api.mjs` 明确放行账户与登录接口）。

换账户时本机的账户级状态会被清理；迟到的响应不会被写进另一个账户，也不会覆盖正在进行的手势。

## 换机与备份（可选元数据）

账户阅读习惯作为可选的 `readingPreferences` 元数据（`{kind,schemaVersion:1,revision,updatedAt,preferences}`）进入：

- 完整书房导出（`/api/library/export`）与导出清单（`/api/library/export/manifest`）；
- 浏览器分段导出 `exportLibraryInParts` 的结果；
- 当前 ZIP 内容包格式的 `manifest.json`（无需抬高 schema 版本）。

恢复前会严格校验：未知字段、缺键、越界数值或错误枚举会整包拒绝，不会部分写入。没有该元数据的旧备份依然有效，并且不会改动目标账户的默认值；全新实例恢复后可以拿回这套默认值。`preserveExisting:true`（ZIP 恢复路径）保留目标账户已经配置好的阅读习惯，且恢复永不把 `revision` 向后重置。赠书阅读包与“选定记录”导出都不包含账户阅读习惯；头像与登录身份也从不进入导出。

## 限制

- 译文目前只提供简体中文；不虚构其他目标语言，也不改变译文存储与模型契约。
- 打开设置、首次邀请或书页都不会自动生成译文或发起计费操作；缺少的译文始终明确显示为缺失。
- 显示译文不代表人工校对，也不能证明已经理解。
- 访客与无偏好记录沿用原文开场的安全默认；新书默认（对照）只写入你明确保存的账户快照。

## 验证

本次实现执行过的命令（工作副本，临时目录按任务指定）：

```bash
TMPDIR=/private/tmp/ai-test-get-162.Wa35X5 node --test --test-concurrency=4 \
  tests/reading-preferences.test.mjs tests/account-reading-preferences.test.mjs \
  tests/library-reading-preferences.test.mjs tests/reader-settings.test.mjs \
  tests/library-export.test.mjs tests/library-export-http.test.mjs \
  tests/library-portability.test.mjs tests/library-portability-http.test.mjs \
  tests/library-portability-restore.test.mjs
TMPDIR=/private/tmp/ai-test-get-162.Wa35X5 node --test --test-concurrency=4 \
  tests/hosted.test.mjs tests/vercel-route.test.mjs tests/library-profile-shell.test.mjs \
  tests/reader-pagination.test.mjs tests/reading-view.test.mjs tests/owner-scope.test.mjs \
  tests/book-gifts.test.mjs tests/library-gift-receive.test.mjs tests/library-personal-http.test.mjs \
  tests/account-profile.test.mjs tests/library.test.mjs tests/reader-controls.test.mjs \
  tests/reader-immersion.test.mjs tests/reader-web-build.test.mjs
git diff --check
```

覆盖：服务端跨进程持久化与目录隔离、两人隔离/匿名/属主不匹配、严格字段与 CAS 409、GET 不写状态、设置/暂不设置/重开、账户切换的迟到响应、恢复后版本前进（fs 与 dataStore，含溢出拒绝）、冲突后的只读“读取最新版本”恢复（保留改动、手动再存、失败可重试、迟到读取不串账户、同账户刷新不丢改动）、挂起保存释放下个账户（成功/失败/切到访客/新账户）、超长时间戳在解析前拒绝且恢复前不写任何状态、阅读方式优先级（显式入口 > 本书已存（含手动对照/中文）> 账户默认 > 访客默认）与只含原文的书、既有位置冲突恢复不变、导出清单 → 分段 → ZIP → 全新恢复拿回默认值、已配置目标保留且版本不回退、旧备份不受影响、赠书与选定记录不含偏好、表单全量快照与错误提示。未在本次执行：完整测试套件、真实浏览器与线上服务（由上级汇总执行）。
