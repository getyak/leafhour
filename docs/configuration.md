# 配置 Leafhour

本机只维护根目录的 `.env`，使用 `npm start` 启动。只阅读公版书和使用本机书房时，可以不创建这个文件。

## 启用 AI

需要 AI 时，将 `.env.example` 复制为 `.env`，只填写需要的功能：

```dotenv
# 翻译、阅读对话、讲解稿
DEEPSEEK_API_KEY=

# 语音生成
OPENROUTER_API_KEY=
```

这两项分别填写对应服务商的 Key。模型有默认值，无需另建 `.env.audio`。修改后重启服务。

启动提示区分“未配置”“已配置，待验证”和“当前部署尚未支持”。填写 Key 不表示余额、模型权限或实际生成已验证；启动过程不会发送模型请求、试听语音或检查付费额度，也不会打印密钥。

## 托管部署

Vercel 等托管平台使用 `.env.hosted.example` 作为变量清单，在平台中保存 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISHABLE_KEY` 和 `READER_PUBLIC_ORIGIN`。需要 AI 文字功能时再加 `DEEPSEEK_API_KEY`。

当前托管版没有持久语音任务后端，填写语音 Key 也不会开启语音。SMTP、Google 和 Apple 登录的供应商设置继续在 Supabase Auth 管理，见 [部署说明](../deploy/README.md)。

## 高级选项

模型默认值统一维护在 `server/model-config.mjs`。按功能分开选择模型，避免混淆不同接口与费用策略。已有模型和费用边界保持不变。

| 可选变量 | 用途 |
|---|---|
| `READER_TRANSLATION_MODEL` | 按段生成直译、意译 |
| `READER_AUDIO_SCRIPT_MODEL` | 生成双人讲解稿 |
| `READER_SPEECH_MODEL` | 把文字合成为声音 |
| `READER_PORT` | 本机端口，默认 8330 |
| `READER_HOST` | 本机监听地址，默认 127.0.0.1 |
| `READER_PUBLIC_ORIGIN` | 实例的正式来源地址 |
| `READER_BOOK_PATH` | 明确选择已有的本机阅读包 |

阅读 Agent 与原文回声使用已设费用策略的 Harness 模型。讲解稿模型不会改变阅读 Agent 的模型。图片生成尚无产品入口，因此图片模型不出现在默认模板中；旧变量仍兼容读取。

本机需要邮箱登录时，可在同一个 `.env` 中额外填写：

```dotenv
READER_SMTP_HOST=
READER_SMTP_PORT=587
READER_SMTP_SECURE=false
READER_SMTP_FROM=
READER_SMTP_USER=
READER_SMTP_PASSWORD=
```

## 旧配置兼容

`npm run start:configured` 继续可用，行为与 `npm start` 相同。

启动时兼容读取已有 `.env.audio`；同名变量的优先级为：系统环境变量、`.env`、`.env.audio`。例如系统已设置的 Key 不会被文件覆盖；`.env` 中明确留空的同名 Key 会覆盖旧文件的值。支持 Node.js 的环境文件语法，包括引号、多行值和注释。

`READER_DIALOGUE_MODEL` 是旧的讲解稿模型名。只设置旧名时继续生效；新旧名称同时设置时，非空的 `READER_AUDIO_SCRIPT_MODEL` 优先。`READER_IMAGE_MODEL` 仍兼容，但不代表已提供图片生成功能。

准备合并旧文件时，先备份两份文件，保留实际需要的值；模型覆盖可以省略，让默认值生效。`.env`、`.env.audio` 和真实密钥都不能进入 Git、公开构建或阅读备份。

环境文件解析使用 Node.js 的 [util.parseEnv](https://nodejs.org/docs/latest-v22.x/api/util.html#utilparseenvcontent)。优先级由本项目的 `server/local-env.mjs` 明确控制。
