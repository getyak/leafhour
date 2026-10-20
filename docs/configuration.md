# 配置 Leafhour

只记住一个模板 [`.env.example`](../.env.example)，本机只维护一个 `.env`，启动只用 `npm start`。只阅读公版书和使用本机书房时，无需配置。

## 本机启用 AI

已有 `.env` 时直接编辑，避免覆盖原有值。首次配置时，在项目根目录复制模板：

```bash
cp .env.example .env
```

打开 `.env`，只填写需要的 Key，然后 `npm start`。修改后重启服务。

| 想使用的功能 | 填写哪一项 |
|---|---|
| 翻译、阅读对话、双人讲解稿 | `DEEPSEEK_API_KEY`，填写 DeepSeek 的 Key |
| Gemini 语音 | `GEMINI_API_KEY`，填写 Google AI Studio 的 Key |

语音直连 Google 官方 Gemini API，Key 从 [Google AI Studio](https://aistudio.google.com/api-keys) 获取；旧 OpenRouter Key 不能改名复用，也不会作为回退。默认模型为 `gemini-3.8-flash-tts`。

模型已默认选好，不需要另建语音配置文件。模板后面的托管与高级选项均已注释，可以跳过。

启动提示区分“未配置”“已配置，待验证”和“当前部署尚未支持”。填写 Key 不代表余额、模型权限或实际生成已验证；启动不会发送模型请求，也不会打印密钥。

## 托管部署

使用同一模板的“托管部署”一节，在 Vercel 等部署平台逐项填写下面四个变量的真实值。不要把注释符号或占位值当成配置，也不要上传本机 `.env`。

| 必填变量 | 从哪里取得 |
|---|---|
| `SUPABASE_URL` | Supabase 项目的 HTTPS 地址 |
| `SUPABASE_SECRET_KEY` | 同一项目的服务端 Secret Key |
| `SUPABASE_PUBLISHABLE_KEY` | 同一项目的 Publishable Key，供服务端调用登录接口 |
| `READER_PUBLIC_ORIGIN` | 实际网站的 HTTPS 来源，例如 `https://reader.example.com`，不带路径或末尾斜杠 |

需要 AI 文字功能时，再填写 `DEEPSEEK_API_KEY`。完成邮箱真实收信与登录验收后，才设置 `READER_EMAIL_ENABLED=true`。SMTP、Google 和 Apple 的供应商设置在 Supabase Auth 管理；完整步骤见 [部署说明](../deploy/README.md)。修改平台变量后重新部署。

本机服务使用本机书房，填写 Supabase 变量不会自动切换到云端存储。托管函数使用平台环境变量，不读取本机 `.env`。当前托管版尚无持久语音任务后端，填写 `GEMINI_API_KEY` 也不会启用语音。

## 按需展开

<details>
<summary>调整模型、端口和其他高级选项</summary>

所有 DeepSeek 文字功能默认使用 `deepseek-flash`；阅读 Agent、回声、翻译与讲稿生成均关闭思考模式。通常无需填写模型覆盖值。默认模型由 [server/model-config.mjs](../server/model-config.mjs) 统一维护，模板不重复固定模型版本。

| 可选变量 | 用途 |
|---|---|
| `READER_TRANSLATION_MODEL` | 按段生成直译、意译 |
| `READER_AUDIO_SCRIPT_MODEL` | 生成双人讲解稿 |
| `READER_SPEECH_MODEL` | 把文字合成为声音 |
| `READER_PORT` | 本机端口，默认 8330 |
| `READER_HOST` | 本机监听地址，默认 127.0.0.1；只接受 127.0.0.1 或 localhost |
| `READER_DATA_DIR` | 本机私人实例目录；未配置时保留原有 `local/service/`，详见 [实例说明](local-instance.md) |
| `READER_BOOK_PATH` | 明确选择已有的本机阅读包 |
| `READER_ADDITIONAL_WEB_ORIGINS` | 仅托管：额外允许的精确 HTTPS 来源，以逗号分隔 |

语音覆盖值使用 Google 官方模型 ID；已有 `google/` 路由前缀会移除，仍只请求 Google 官方接口。

模型按功能分开配置，仍需符合现有接口与费用策略。阅读 Agent 与原文回声使用已有费用策略的 Harness 模型；讲解稿的覆盖值不会改变阅读 Agent。图片生成尚无产品入口，因此模板不展示图片模型。

</details>

<details>
<summary>本机启用邮箱登录</summary>

在同一个 `.env` 中填写自己的 SMTP 配置，再重启服务：

```dotenv
READER_SMTP_HOST=
READER_SMTP_PORT=587
READER_SMTP_SECURE=false
READER_SMTP_FROM=
READER_SMTP_USER=
READER_SMTP_PASSWORD=
```

使用 465 端口时设置 `READER_SMTP_SECURE=true`。这些变量供本机服务使用；托管邮箱在 Supabase Auth 中配置。

</details>

<details>
<summary>连接外部 Agent 与旧单书导入工具</summary>

MCP 客户端的服务地址与按书授权令牌在宿主 Agent 中单独配置，见 [接入示例](../README.md#连接-mcp)。它连接已经启动的书房，不会自动读取服务端 `.env`，也不需要拿到模型 Key。

`npm run db:import` 是保留的旧单书归档工具，使用 `.env` 中的 Supabase 配置和旧表，不能代替当前书房的导入与账号迁移。新书籍通过书房上传或现有领域服务导入，数据边界见 [数据工作空间](data-workspace.md)。

</details>

<details>
<summary>已有 .env.audio、旧模型名或旧启动命令</summary>

`.env.hosted.example` 已合并到唯一模板；它始终是示例，不是运行时文件。部署平台中已有的变量继续生效。

`npm run start:configured` 继续兼容，行为与 `npm start` 相同。启动仍兼容已有 `.env.audio`，同名变量的优先级为：系统环境变量 → `.env` → `.env.audio`。`.env` 中明确留空的同名 Key 会禁用旧文件中的该 Key。准备合并旧文件时，先备份，再保留实际需要的值。

`READER_DIALOGUE_MODEL` 是旧的讲解稿模型名；只设置旧名时继续生效，新旧同时设置时，非空的 `READER_AUDIO_SCRIPT_MODEL` 优先。`READER_IMAGE_MODEL` 仍兼容，但不代表已有图片生成功能。

环境文件支持引号、多行值和注释，解析采用 Node.js 的 [util.parseEnv](https://nodejs.org/docs/latest-v22.x/api/util.html#utilparseenvcontent)，优先级由 [server/local-env.mjs](../server/local-env.mjs) 控制。

</details>

真实密钥只保存在被 Git 忽略的 `.env` 或部署平台的受保护变量中，不进入源码、公开构建或阅读备份。

## PDF 扫描识别

PDF 使用同一个上传入口，自动逐页检查文字层。文字可读的页面直接整理；扫描页暂停并显示一次“允许识别并继续”。配置 `PADDLEOCR_ACCESS_TOKEN` 后可使用官方 `PaddleOCR-VL-1.6`，只发送本书需要识别的页面，不发送笔记或对话。服务方留存和删除期限尚未核实，确认处可展开说明。同一账号再次选择同一原文件，会复用已有书籍或整理进度，保留段落 ID、译文与记录。

PDF 支持 256 MiB、1200 页，文字层最多800万UTF-16单位；TXT/Markdown 仍为20 MiB。原文件按2 MiB分块上传并校验SHA-256；处理批次最多30页/20 MiB，自动缩小页组。单页超过识别服务20 MiB上限时保留原件并暂停。完整书籍及双译合计最多32 MiB，阅读时通过1 MiB校验分段传输。接近容量上限会在翻译调用前拦截；同书翻译使用持久预约避免并发挤占。原件、供应商结果与坐标保存在私人存储中，页码覆盖完整后才正式加入书架，结果标为未校对。

上传完成后可以离开页面，已授权任务由服务器继续处理；书房显示进度、只读节选与恢复入口。未允许识别、失败或提交结果不确定的任务暂停，不会自动重复付费提交。取消禁止新提交与入库；正在核对一次可能已成功的入库时保留提交围栏。新实例通过持久队列恢复，托管运维配置见[部署说明](../deploy/README.md#pdf-后台处理)。
识别器会把中文强调点和圈号注释的已知 LaTeX 包装还原为可读字符，同时保留原始供应商结果及转换规则；真正的公式保持原样。请求超时后可核对预先保存的请求标识，找回已经提交的任务，不会直接重新发送整批页面。

## 随书听读

章节导听、双人讲解和整书导览沿用同一组文字与语音 Key。托管实例将 `GEMINI_API_KEY` 填入部署平台的加密环境变量并重新部署；既有 Supabase 配置同时用于私人任务与音频存储。生成范围、额度和恢复边界见 [随书听读](guided-listening.md)。
