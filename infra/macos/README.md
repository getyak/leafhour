# Mac mini 发布与恢复

这套工具准备 Leafhour 的独立运行目录、用户会话试运行和系统服务。默认只显示拟执行内容，改变状态须加 `--apply`。本次源码与临时目录测试不等于目标机安装、真实模型验收、正式域名切换或断电恢复验收。

正式目录为 `/Library/Application Support/Leafhour`。用户试运行放在当前用户的 `~/Services/Leafhour`，使用 `gui/<uid>` LaunchAgent，退出登录后不能保证运行。正式模式使用三个低权限账号与系统 LaunchDaemon。Mac mini 当前没有可用的免交互提升权限，必须由操作者在主机上的受信任终端完成提升。系统密码不经过聊天、命令参数、配置文件或日志。

## 文件和边界

| 位置 | 内容 |
| --- | --- |
| `runtime/<runtime-id>/` | 独立、固定 SHA-256 的 macOS arm64 Node 与 Caddy |
| `releases/<build-id>/` | 主线提交的完整只读产物，含三个模块与公开源代码 |
| `ops/` | 这组运维工具。升级前审阅差异，不从运行中的脏工作区覆盖 |
| `config/instance.json` | 模式、运行时版本等非秘密元数据 |
| `config/{api,agent,web}/env.json` | 按角色隔离的 JSON 环境配置，Web 仅允许 `TZ` |
| `config/ipc/agent-token` | 仅 API、Agent 与操作者可读的执行器身份 |
| `state/` | 互斥锁、候选槽、发布阶段和私有操作记录 |
| `run/ipc/` | 每个 API 槽独立的受限 Unix Socket |
| `run/web/caddy-admin.sock` | Caddy 管理 Socket，只有 Web 账号和提升后的操作者可用 |
| `data/api/<slot>/`、`data/{api,agent,web}/{home,tmp}/` | 可恢复缓存与独立运行目录。不作为数据库或书籍备份 |
| `logs/<role>/` | 仅运维字段的日志，单文件 8MiB，保留四份轮转 |

API、Agent 使用 `node apps/api/server.mjs` 和 `node apps/agent/server.mjs`。Web 使用 `apps/web/Caddyfile` 构建为经过校验的原生配置。Web 固定监听回环 `18330`。首槽可用 API `18331`、Agent 健康口 `18332`，候选槽使用 `18341/18342`。只有 Web 入口可转发到 Tailscale。API 与 Agent 健康口、执行 Socket、Caddy 管理口都不向外开放。

系统服务分别以 `_leafhour_web`、`_leafhour_api`、`_leafhour_agent` 运行。API/Agent 加入 `_leafhour_ipc`，Socket 父目录设组继承，Socket 模式为 `0660`，令牌为 `0640`。用户模式使用同一登录身份，只用于隔离数据的试运行，不能据此宣称已验证账号级进程隔离。

## 1. 准备发布包

在受控的 macOS arm64 构建环境中，先更新公开仓库 `origin/main` 并核对目标提交已通过对应检查。构建器拒绝脏工作区，只从该主线提交的 `git archive` 读取已跟踪文件。不会复制未跟踪凭据、用户书籍或其他工作区内容。构建时清空继承环境，用单独 HOME 和 npm 缓存运行锁文件安装、模块构建和生产依赖裁剪。不要在兼任生产的机器上构建不可信 PR。

从 [Node 官方发行目录](https://nodejs.org/dist/) 取得固定的 Node 22 `darwin-arm64` 包，按该版本的官方校验文件核实 SHA-256。Caddy 使用固定发行版的原生 arm64 二进制，按 [官方发布](https://github.com/caddyserver/caddy/releases) 校验。两个摘要必须先通过独立可信渠道核对，再作为参数传入。工具不会将“刚下载的文件摘要”冒充来源校验。生产进程不会引用另一个产品自带的 Node、配置或依赖。

下面大写值由操作者填入已核对的非秘密值，路径均使用绝对路径：

```sh
node infra/macos/leafhourctl.mjs build \
  --repo /absolute/clean/leafhour \
  --source-commit MAIN_COMMIT \
  --out /absolute/artifacts/NEW_BUILD \
  --node-archive /absolute/downloads/node-v22.X.Y-darwin-arm64.tar.gz \
  --node-version 22.X.Y --node-sha256 VERIFIED_NODE_SHA256 \
  --caddy /absolute/downloads/caddy --caddy-sha256 VERIFIED_CADDY_SHA256 \
  --apply
```

模块构建合同为 `npm run build:modules -- --out <fresh-source-root>`。产物保留根目录的运行源码、兼容导入与生产 `node_modules`，前端产物只在 `web/public` 与 `web/templates`。原模块清单保存为 `module-manifest.json`。最终 `manifest.json` 记录源码提交、构建编号、协议版本、运行时摘要和每个文件/链接的校验信息，不记录环境配置。构建工具返回清单 SHA-256。它也要与产物分开传递并核对。

生产依赖的原生绑定必须在目标平台完成无密钥加载检查。本工具的摘要检查不能替代 SDK、原生绑定和真实启动的兼容性验证。修改 Caddy 二进制需要单独维护窗口，配置重载只负责路由切换。

## 2. 初始化目录与角色配置

先查看拟执行内容，再按选定模式应用。

```sh
node infra/macos/leafhourctl.mjs init \
  --root "$HOME/Services/Leafhour" --mode user-trial --runtime-id VERIFIED_RUNTIME_ID
```

用户试运行在同一命令追加 `--apply`。正式模式先审阅 [system-install.sh](system-install.sh)，由操作者在主机终端执行：

```sh
sudo /bin/sh infra/macos/system-install.sh --prepare
sudo /absolute/verified-node/bin/node infra/macos/leafhourctl.mjs init \
  --root '/Library/Application Support/Leafhour' \
  --mode system-service --runtime-id VERIFIED_RUNTIME_ID --apply
```

系统准备器只创建 Leafhour 的账号、组和目录，不启动服务，不改网络、防火墙、电源、磁盘加密或其他应用。它拒绝意外账号与编号冲突。初始化生成内部身份文件，不输出其内容。重复初始化会拒绝覆盖。

用受信任的本地编辑器填写各角色 `env.json`。用户模式要求文件 `0600`。系统模式要求 `root:<role-group>`、`0640`，角色目录 `0750`。编辑器若把文件变为所有人可读，服务会拒绝加载。不要用带秘密值的命令行、shell 历史或 PR 内容配置环境。

API 至少需要实际的 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISHABLE_KEY` 和正确的 `READER_PUBLIC_ORIGIN`。登录能力按原契约配置。生产派发另需 API 可读的 `LEAFHOUR_DISPATCH_LEDGER_URL`、`LEAFHOUR_DISPATCH_LEDGER_TOKEN_FILE`、`LEAFHOUR_DISPATCH_LEDGER_KEY_FILE`。后者保存 64 位十六进制加密密钥，文件权限与 API 配置一致。必须验证异地追加确认与恢复凭据。`LEAFHOUR_ALLOW_LOCAL_LEDGER=1` 和本地账本只用于隔离试运行，不能通过生产备份与对账门禁。

模型、OCR、语音供应商凭据只放 Agent 配置。API 配置含模型凭据会被拒绝。Agent 不得持有数据库管理凭据。按真实可用适配器设置 `LEAFHOUR_AGENT_CAPABILITIES`。工具自动设置版本、监听地址、模板目录、每槽缓存、内部 Socket 和身份文件路径，不需要复制到秘密配置。

## 3. 发布、候选验证与切换

将完整产物经受信任通道放到目标机暂存目录，先核对源码和独立取得的清单摘要：

```sh
node infra/macos/leafhourctl.mjs verify --artifact /absolute/staged/BUILD \
  --expected-commit MAIN_COMMIT --manifest-sha256 TRUSTED_MANIFEST_SHA256
node infra/macos/leafhourctl.mjs publish --root /absolute/Leafhour \
  --artifact /absolute/staged/BUILD --expected-commit MAIN_COMMIT \
  --manifest-sha256 TRUSTED_MANIFEST_SHA256
```

确认后给 `publish` 加 `--apply`。系统模式下，以下变更命令也须在提升后的终端运行。发布器先完整复制到 `.partial`，再次检查文件摘要，再改为只读并改名为不可变版本。已有独立运行时必须与本次包完全匹配。失败的 `.partial` 留待操作者核对，不能当成可用版本。只有本工具生成的暂存目录可以按明确的保留策略处理，不清理其他产品或旧迁移目录。

```sh
node /absolute/Leafhour/ops/leafhourctl.mjs prepare --root /absolute/Leafhour \
  --release-id BUILD_ID --slot-id slot-a --api-port 18331 --agent-port 18332
```

确认端口与源码后加 `--apply`。下一版用不同槽和 `18341/18342`，不能与现有监听者抢端口。候选 Agent 暂停领取，API 与对应模板先完成健康与版本检查。领域数据继续使用同一 Supabase CAS 存储，缓存按槽隔离。候选暂停必须仅作用于候选 API 实例。没有通过该隔离契约的运行时不能进入切换。

```sh
node /absolute/Leafhour/ops/leafhourctl.mjs activate --root /absolute/Leafhour --slot-id slot-a
```

实际切换追加 `--apply`。控制器先核对候选文件及 API/Agent 的源码版本，再暂停旧 Agent，等待真实 `inflight=0` 并退出旧 Agent。它校验新的 Caddy 配置，经受限管理 Socket 重载匹配的静态根与 API 上游，核对 Web 返回的版本后恢复新 Agent，最后排空并退出旧 API。没有旧版本的首次启动也会记录同样的准备与启用阶段。常规启用最多每小时一次。回滚不受该等待限制。

发布过程将 `prepared/switching/draining/active/rollback` 和当前步骤落盘。互斥锁存在时不启动另一轮发布。进程中断后先执行 `status`，核对实际 Caddy 配置、各服务版本、任务与派发回执。不要因文件指针存在就认为切流完成，也不要直接删除锁后重复执行。确认原操作者进程已退出、实际状态与待恢复步骤后，才人工移除本次 `state/deploy.lock` 并选择恢复或回滚。

```sh
node /absolute/Leafhour/ops/leafhourctl.mjs status --root /absolute/Leafhour
node /absolute/Leafhour/ops/leafhourctl.mjs rollback --root /absolute/Leafhour
```

回滚先显示目标，追加 `--apply` 才执行。它启动上一兼容 API，暂停并排空当前 Agent，恢复上一份经过校验的代理配置与 Agent。数据、已交付结果和数据库迁移不会倒退。切流失败时控制器先暂停候选。任何排空、版本或回滚检查失败都保留故障阶段，供操作者继续核对。首次安装没有前版可以恢复，须保留现有正式网站，暂停候选并调查失败。

API/Agent 停止依赖真实运行时的 SIGTERM 行为：停止新受理/领取，取消当前执行，保留派发过但结果不明的回执。运维层不推测供应商是否执行，也不自动重放未知任务。默认排空等待 75 秒，launchd 停止宽限 90 秒。超时会阻止正常切换，不能绕过排空把任务写成完成。

## 4. 只添加 Leafhour 的 Tailscale 入口

2026-11-05 的只读检查发现十二个既有 Serve 端口和一个 Funnel 入口。操作前必须重新读取当前配置。工具将完整配置写入私有备份，只在空闲的 HTTPS `19443` 添加回环 Web 代理，并比较所有其他 JSON 字段，包含未知字段和 Funnel。它不调用 `reset`、`set-config` 或 `funnel`。

```sh
node /absolute/Leafhour/ops/leafhourctl.mjs tailscale-add \
  --hostname smile-m4-minimac-mini.tail25e61f.ts.net \
  --receipt /absolute/Leafhour/state/tailscale-19443.json
```

核对当前配置和 Web 健康后加 `--apply`，实际仅使用 `tailscale serve --bg --yes --https=19443 http://127.0.0.1:18330`。检查 tailnet 内 HTTPS 可达、未授权身份仍被应用拒绝，以及原十二个入口与 Funnel 均保持可用。这个入口属于私网验收，不代表 `leafhour.com` 已迁移。

撤回时用 `tailscale-remove --receipt <同一私有文件>`，确认后加 `--apply`。它只关闭自己记录的 `19443`。自有入口被其他人修改时拒绝操作。它保留之后对其他入口所作的修改，绝不整份覆盖旧备份。添加命令响应不明时，先根据 `prepared` 备份和实时配置核对，不盲目重试或重置。端口关闭与添加参数依据 [Tailscale Serve 官方说明](https://tailscale.com/docs/reference/tailscale-cli/serve)。

## 5. 运维与上线门禁

`resources --root <path>` 返回可用磁盘和 Leafhour 各进程树 RSS，包含 Agent 子进程。初始阈值为 Agent 总 RSS 3GiB、磁盘 15GiB 暂停重任务，磁盘 8GiB 以下须停止新上传。这些是待负载测试校准的起始值。工具会在不足 15GiB 时拒绝新包/候选启动，已有实例需监测系统根据报告调用 `pause --apply`。本工具尚未提供停止上传的接口。8GiB 门禁仍需应用侧受理控制与报警验收，不能把状态提示当成已执行限流。

日志只保留状态、事件码、耗时和版本字段，丢弃原始输出中的问题、书名、正文、Cookie 和凭据字段。需要诊断原始输出时应另开隔离环境，不能在真实书房临时打开全量日志。日志轮转只处理本目录的普通文件，拒绝符号链接。上线前测试进程重启、Agent 独立重启、派发中断、取消、未知结果对账、磁盘与内存报警，记录每一项的实际结果。

正式切换前，还要完成 Supabase 数据库与 Storage 对象的异地加密备份、在干净实例恢复、现有 iOS/MCP/同源登录兼容、测试账号的有界真实模型调用，以及新旧执行链唯一归属核对。当前 Vercel 链、Cloudflare DNS 与隧道保持原状。本工具不验证域名控制权，也不自动切生产域名。替代链验收后由主操作者一次性切换，不能让两条链同时派发同一生产任务。

当前前端仍主要使用稳定的模块 URL。工具保留旧发布包，但旧页面跨版本加载资源仍需实际验收。它不会清理离线缓存或草稿，也不会强制刷新页面。

保留 FileVault、网络保护与其他应用。系统 LaunchDaemon 也不能越过 FileVault 冷启动解锁。必须真实演练断电后解锁、网络恢复和远程接管。没有这些证据前，不能把用户会话运行或一次健康检查写成无人值守生产已通过。

## 本地验证

```sh
node --test infra/macos/tests/*.test.mjs
node --check infra/macos/leafhourctl.mjs
node --check infra/macos/bundle.mjs
sh -n infra/macos/system-install.sh
```

测试使用临时目录、隔离 Socket 和假的 Tailscale 命令，覆盖无关入口保留、占用/并发修改拒绝、清单篡改、配置权限、角色分离、排空与失败恢复、日志轮转、初始化不覆盖。本机结果不覆盖目标机 launchd、独立原生运行时、真实供应商、公开域名或物理设备验收。Caddy 校验与重载语义见 [官方命令文档](https://caddyserver.com/docs/command-line)。
