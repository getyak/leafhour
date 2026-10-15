# 旁读听读实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** 在现有阅读页实现准确的选文朗读、可收起的播放器、声音偏好、带出处的双人讲解，以及同权限的 Agent 调用。

**Architecture:** 新增听读领域服务，复用书房的内容读取和授权；供应商调用、原子存储及网页播放器分别成模块。首版在本机完成闭环，托管端尚无持久任务执行能力时明确报告不可用，不部署。

**Tech Stack:** Node.js 22.13+、现有原生 HTML/CSS/ES modules、Node test runner、DeepSeek 官方文字接口、OpenRouter Gemini TTS 接口；不更换前端框架。

**Spec:** [已认可的听读设计](audio-reading-design.md)。实现前完整阅读项目 AGENTS.md 及该规格。

## Global Constraints

- 文字生成使用 DeepSeek；语音默认 `google/gemini-3.8-flash-tts`；图片配置 `google/gemini-nano-banana-2.1`，本轮不新增图片生成入口。
- 单次讲稿上下文最多 30,000 字符、80 段，输出最多 24 轮、6,000 字符；超限明确拒绝并允许缩小范围。
- 本地播放速度范围 0.75–1.5；操作目标至少 44px；动效约 140–180ms，服从降低动态效果的系统偏好。
- 原文、两种译文、AI 讲解和用户修改稿分别保存；未翻译内容不伪造；使用稳定段落 ID 和内容版本。
- 首次点击生成才调用收费接口，重复请求幂等；402 不自动重试，不自动换供应商；取消不保证供应商未计费。
- API 密钥只放被 Git 忽略的本机环境文件；不进入前端、测试输出、导出或日志。
- 保留已有 `_briefs/hosted-release.md` 未提交修改；不重译全书，不部署，不创建通知。

## Review Focus

- 跨段或中英对照选区：只朗读真实选中文本，UTF-16 范围与来源一致；Task 1、Task 6 验证。
- 用户换账号、换书或撤回 Agent 授权：旧音频停止，后续读取拒绝；Task 4、Task 6、Task 7 验证。
- 同时点击生成、超时后再次提交：同一幂等键只生成一次，同键异文拒绝；Task 3 验证。
- 页面刷新或进程退出：保留已完成片段与位置，中断任务不自动再次收费；Task 3、Task 5 验证。
- 译文修改而内容版本未变：实际文本哈希仍使旧缓存失效，不能读出旧译文；Task 1、Task 3 验证。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `server/media-config.mjs` | 供应商和模型默认值，公开能力中剔除凭据 |
| `server/audio-content.mjs` | 原文与译文选择、选区核验、讲稿出处和缓存标识 |
| `server/audio-provider.mjs` | TTS 请求、超时、二进制音频和供应商错误 |
| `server/dialogue-generator.mjs` | DeepSeek 有界讲稿生成 |
| `server/audio-store.mjs` | 本机元数据原子写入、音频读写及恢复包 |
| `server/audio-service.mjs` | 生成状态、幂等、队列、取消、偏好及播放位置 |
| `server/audio-routes.mjs` | 网页与 Agent 的 HTTP 输入、身份及二进制输出 |
| `app/audio-state.mjs` | 播放会话与迟到响应保护，独立于 DOM |
| `app/reader-audio.js`、`app/reader-audio.css` | 书页入口、播放器、声音抽屉和讲稿编辑 |
| 现有 portal、server、MCP 和配置文件 | 接入上述模块，保留已有读取与翻译行为 |

## Task 1 内容准备与模型配置

**Files:** 创建 `server/media-config.mjs`、`server/audio-content.mjs`、`tests/audio-content.test.mjs`；修改 `.env.example`、`.env.hosted.example`。

**Interfaces:** `mediaConfiguration(env)` 返回不含密钥的公开模型配置及单独的服务端凭据；`prepareReading(book,input)` 返回 `{bookId,contentVersion,chapterId,language,variant,clips}`；每个 clip 包含 passageId、start、end、text、textHash。`validateDialogue(book,scope,candidate)` 返回已核验讲稿；`clipCacheKey(identity,clip,voice,model,style)` 返回 SHA-256 标识。

- [ ] 编写失败测试，使用含独立两种译文的合成书；断言选区文本必须等于来源的 UTF-16 子串，篡改文本、错章、过期版本及缺译文均拒绝。重复 passageId 或乱序范围拒绝；对照选区保留真实语言。
- [ ] 运行 `node --test tests/audio-content.test.mjs`，确认缺失模块或导出造成失败。
- [ ] 实现上述接口；正文以当前语言和译法取值，讲稿引用必须为授权范围内的精确子串；文本哈希独立于 book.contentVersion。读取 `OPENROUTER_API_KEY`、`DEEPSEEK_API_KEY`、`READER_SPEECH_MODEL` 和 `READER_IMAGE_MODEL`，模型默认值按 Global Constraints；默认朗读 Sulafat，讲解者 Charon、提问者 Puck，精选声音另含 Kore。凭据只作服务端输入。
- [ ] 重跑测试，断言模型默认值正确、公开配置不含密钥、同段译文改字使缓存键改变；上下文超过 30,000 字符或 80 段、候选超过 24 轮或 6,000 字符均拒绝。
- [ ] 只提交本任务文件：`feat: prepare source-bound audio content`。

代表性断言（合成 book 与选区 fixture 在本任务测试内创建）：

```js
assert.equal(prepareReading(book, selection).clips[0].text, selectedText);
assert.throws(() => prepareReading(book, {...selection, contentVersion:'stale'}), {status:409});
```

## Task 2 真实供应商适配

**Files:** 创建 `server/audio-provider.mjs`、`server/dialogue-generator.mjs`、`tests/audio-provider.test.mjs`。

**Interfaces:** `createSpeechProvider({env,fetcher})` 返回 `{available,model,synthesize({turns,signal})}`，成功结果为 `{bytes,mimeType,generationId}`。`createDialogueGenerator({env,fetcher})` 返回 `generate({bookId,contentVersion,passages,signal})`；候选必须再经 Task 1 验证。未配置时返回 unavailable，不调用网络。

- [ ] 编写可控 fetcher 测试，断言语音只发送指定台词和 voice，演绎指令在 instructions 中；文字请求仅进入 DeepSeek。让 402、429、超时、200 JSON 错误体和过大音频先失败。
- [ ] 运行 `node --test tests/audio-provider.test.mjs`，确认未实现接口导致失败。
- [ ] 实现 OpenRouter `/api/v1/audio/speech`，请求 MP3；单片段最多 4,000 字符、输出最多 4 MB、45 秒超时，无自动重试。按有效 MIME 及 MP3 帧或容器检查接收音频。DeepSeek 请求使用已有 `DEEPSEEK_API_KEY`、`deepseek-chat` 和 JSON 结果，限制输出 token 并传递 AbortSignal。
- [ ] 重跑测试，断言错误保留可处理代码且不暴露 Authorization、输入私文或供应商原始敏感详情。
- [ ] 只提交本任务文件：`feat: add bounded Gemini speech and DeepSeek dialogue adapters`。

```js
await assert.rejects(speech.synthesize({turns, signal}), {code:'insufficient_credits'});
assert.equal(requests.length, 1); // 402 fixture 不触发重试。
```

## Task 3 持久任务与取消

**Files:** 创建 `server/audio-store.mjs`、`server/audio-service.mjs`、`tests/audio-service.test.mjs`。

**Interfaces:** `createAudioStore({dataDir})` 提供 `read(ownerId,bookId)`、`mutate(ownerId,bookId,operation)`、`putClip(key,bytes)`、`getClip(key)`。`createAudioService({store,getBook,speechProvider,dialogueGenerator})` 提供 `capabilities`、`prepare`、`createSession`、`getSession`、`cancelSession`、`getClip`、`getPreferences`、`savePreferences`、`savePosition`、`createDialogue`、`editDialogue`、`getDialogue`、`close`；首个参数均为可信 owner 身份。

- [ ] 编写失败测试，用可手动完成的 provider Promise 证明：并发同键只调用一次；同键异文为 409；取消后完成的 Promise 不发布音频；第二个账户无法读取会话或 clip。
- [ ] 运行 `node --test tests/audio-service.test.mjs`，确认接口缺失造成失败。
- [ ] 实现原子元数据、私有文件和有界队列；每个账户同时一个生成会话，全服务最多两个供应商请求。会话状态为 prepared、generating、ready、failed、cancelled；片段独立记录生成进度和错误。恢复时将未完成任务标为 interrupted，不自动重试；已有片段保留。
- [ ] 重跑测试，补验实际文本变化拒绝旧片段、402 无重试、偏好与播放位置隔离、编辑讲稿版本后仅新文本片段失效、关服务后没有迟到写入。
- [ ] 只提交本任务文件：`feat: persist cancellable audio sessions`。

```js
assert.equal((await audio.getSession(owner,bookId,session.id)).status, 'cancelled');
assert.equal(providerCalls, 1); // 并发同幂等请求只发送一次。
```

## Task 4 网页 HTTP 与安全接入

**Files:** 创建 `server/audio-routes.mjs`、`tests/audio-http.test.mjs`；修改 `server/server.mjs`、`server/portal.mjs`、`api/[...path].js`。

**Interfaces:** `createAudioRoutes({audio,library})` 返回 `handle({req,res,url,user,bookId,action,body,send,agent})`。书房 API 前缀为 `/api/library/books/:bookId/audio/`；旧本机单书入口为 `/api/audio/`，仅复用已有 loopback 与来源限制。动作固定为 capabilities、prepare、sessions、sessions/:id、sessions/:id/cancel、clips/:id、preferences、position、dialogues、dialogues/:id。

- [ ] 编写真实 HTTP 测试：匿名付费请求拒绝；跨账号为 404；X-Reader-Owner 变化为 409；其他 Origin 拒绝；缺配置返回准确能力状态，正文仍可读取。
- [ ] 运行 `node --test tests/audio-http.test.mjs`，确认路由未实现导致失败。
- [ ] 接入现有本机服务器和 portal，依赖可注入以便隔离测试。音频使用 res 的二进制响应，不经过 JSON send；设置私有缓存策略及 Content-Type，网页 CSP 允许同源与 blob 音频，不开放第三方脚本。托管 adapter 返回明确不可用能力，不创建 hosted/ 本地目录或后台生成任务。
- [ ] 重跑测试，补验合法音频字节完整、JSON 错误不冒充 audio、查询与取消只访问所属书籍；运行现有 `tests/portal.test.mjs` 和 `tests/hosted.test.mjs`。
- [ ] 只提交本任务文件：`feat: expose authorized audio endpoints`。

```js
assert.equal((await fetch(privateClipUrl, {headers:otherOwnerHeaders})).status, 404);
assert.deepEqual(Buffer.from(await validClipResponse.arrayBuffer()), clipBytes);
```

## Task 5 可携带的讲稿与音频

**Files:** 创建 `server/audio-backup.mjs`、`tests/audio-backup.test.mjs`；扩展 Task 3 服务及 Task 4 路由的 export、validate、import 动作。

**Interfaces:** `exportAudio({ownerId,bookId,includeAudio})` 返回开放格式 JSON 包；`validateAudioBackup(book,backup)` 在写入前验证全部锚点、版本、哈希和大小；`restoreAudio({ownerId,bookId,backup})` 合并恢复。音频按 clip 分别下载，备份可选 base64 字节，最大恢复包 32 MB，超限提示分批导出。

- [ ] 编写失败测试：在全新目录恢复讲稿、音频字节、偏好和播放位置；损坏任一片段或非法来源使整包验证失败，不能部分写入。
- [ ] 运行 `node --test tests/audio-backup.test.mjs`，确认接口缺失。
- [ ] 实现独立听读包，不改变原有书房备份格式；不导出 ownerId、grants、密钥或供应商凭证。导入归属为当前已认证账户；重复导入不重复 clip，也不覆盖不同版本的用户修改稿。
- [ ] 重跑测试并实际启动第二个 reader server，恢复后通过 HTTP 读取同一音频，断言字节与哈希一致，讲稿引用仍可定位。
- [ ] 只提交本任务文件：`feat: export and restore portable audio records`。

```js
assert.deepEqual(await restoredAudio.getClip(owner,bookId,clipId), clipBytes);
assert.equal(JSON.stringify(backup).includes('OPENROUTER_API_KEY'), false);
```

## Task 6 听读界面与交互

**Files:** 创建 `app/audio-state.mjs`、`app/reader-audio.js`、`app/reader-audio.css`、`tests/audio-state.test.mjs`；修改 `app/index.html`、`app/reader.js` 及静态资源映射。

**Interfaces:** `createPlaybackState()` 提供 `begin(identity)`、`accept(ticket,result)`、`stop(reason)`、`setFollowing(value)`；ticket 绑定账户、书籍、会话和请求版本，旧 ticket 不能提交。UI 使用既有 `window.marginaliaReader.getExcerpt/getState/getAnchor/goToPassage` 与 reader:ready、reader:chapter 事件，不从显示 DOM 猜译文。

- [ ] 编写状态测试，断言切书后旧请求、取消后的旧请求、旧音频 ended 事件均不能推进新播放队列，手动滚动后 following 为 false。
- [ ] 运行 `node --test tests/audio-state.test.mjs`，确认缺失接口。
- [ ] 实现选文朗读、章首入口和双人讲稿编辑。底部播放器未启用时不占位，启用后为正文预留空间；手机为紧凑栏加展开面板。通过 HTMLAudioElement 播放有效音频，设置本地 0.75–1.5 倍速、键盘操作、aria-live 状态、下载及声音偏好；切书或身份变化时停止音频、取消请求并释放 blob URL。
- [ ] 浏览器实测完整选文、准备、播放、暂停、换声音、进度、出处回跳和讲稿编辑；用隔离的合成音频验证 UI，不将其标为真实 Gemini 输出。验证来源未准备好和 402 的错误界面，刷新保留位置但不自动出声。
- [ ] 在 320/390/768/1440px、夜读及低动态偏好下检查选择和复制、工具条、播放器遮盖与焦点顺序。运行 `node --test tests/audio-state.test.mjs tests/share.test.mjs tests/passage-layers.test.mjs tests/toolbar-placement.test.mjs`。
- [ ] 只提交本任务文件：`feat: add an integrated listening experience`。

```js
const stale = playback.begin(identityA); playback.begin(identityB);
assert.equal(playback.accept(stale, completedClip), false);
```

## Task 7 Agent 共用能力

**Files:** 修改 `server/mcp.mjs`、`server/library-service.mjs`、`server/portal.mjs`、`app/home.html`、`app/portal.js`、`app/grant-result.mjs`；创建 `tests/audio-mcp.test.mjs`，扩展授权范围测试。

**Interfaces:** MCP 工具固定为 `reader_prepare_audio`、`reader_generate_audio`、`reader_get_audio`、`reader_cancel_audio`；沿用 `/api/agent/` 和 server-side authorize。prepare 使用 content，generate/cancel 使用 audio:generate，status/资源使用 audio:read，禁止 Agent 自报 ownerId。

- [ ] 编写官方 MCP client 测试，证明 content-only grant 可准备但不能收费生成；audio grant 能创建同一网页可见任务；撤回后 status 和音频均拒绝。
- [ ] 运行 `node --test tests/audio-mcp.test.mjs`，确认工具尚不存在。
- [ ] 扩展现有书房授权 UI 与白名单，清楚区分读取音频和收费生成。MCP 仅返回任务及资源，不主动播放；任意 Agent 回答朗读采用独立 inputKind:ai-response、至多 4,000 字符、显式生成权限，不冒充书籍引用。
- [ ] 重跑测试与 `node --test tests/mcp.test.mjs tests/grant-result.test.mjs`；检查旧的六个工具及只读授权仍可用。
- [ ] 只提交本任务文件：`feat: share scoped audio capabilities with agents`。

```js
assert.equal((await contentOnlyClient.callTool({name:'reader_generate_audio',arguments:request})).isError, true);
assert.equal(providerCalls, 0); // 被拒请求不发送供应商。
```

## Task 8 最终验证与运行交接

**Files:** 更新 `README.md`、`deploy/README.md`、`_briefs/mcp-contract.md`；真实证据保存在 `local/verification/audio-reading/`，不提交凭据或私人音频。

- [ ] 运行 `npm test`、`npm run build:vercel`、`git diff --check`，确认全部通过。失败先查根因，不以删除测试换通过。
- [ ] 按已批准规格逐项检查功能覆盖及中文文案；先读取项目声音约定，再执行 `lieflat-less-ai-tone` 的最小白名单复查，路径、样本文本与事实不改。
- [ ] 完成一次整分支独立审查，重点检查授权、取消、幂等、缓存污染、正文选择及后台任务；修复后仅重跑受影响检查。
- [ ] 具备可用额度时，仅发送合成短文本，分别实测普通话、中英混合及双人音频；记录首片段等待、字节与播放时长、供应商 generation ID 和实际账单。若仍为 402，保留失败证据并明确标出真实供应商播放验收未通过，不反复调用。
- [ ] 记录真正可复现的启动方法、模型环境变量与仍未支持的托管能力。保留本机书籍、笔记与既有配置，交付可运行页面；不部署或推送远程。
- [ ] 提交文档与验证修复：`docs: document verified audio reading workflow`。

## 自检结果

规格的内容来源、交互、取消与恢复、模型分工、导出和 Agent 权限均对应上述任务。本人声音复刻和实际托管执行不纳入首版，入口只在后端真实可用后开放。真实供应商音频与隔离界面验证分别记录。
