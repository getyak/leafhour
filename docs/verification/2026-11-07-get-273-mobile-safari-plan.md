# GET-273：真实 Simulator MobileSafari 最小验收计划

状态：**历史 v3 已完成真实 bootstrap/private blank，但 reader 七场景未执行；当前 v4 仅 source/off-device 准备**。viewer403 与 child-exit-unconfirmed 原证据保留，已按主控具体批准 cancelled 异常回收，不算 clean/UI pass。下一真实窗口须另行协调；新 source freeze 不等于执行许可。本计划仍属于 GET-273 原 scope。

## 已完成与目标

PR [#334](https://github.com/getyak/leafhour/pull/334) 已合并为 `d302393d4ed01a82af6828d7200969be3b8addc9`。修复后 PR CI 与合并提交 CI 全绿，完整宿主测试均 4,840 通过、0 失败、0 跳过；修复后 32 项本地组件检查和 17 项合成 Chromium 检查通过。Production 同提交被 Vercel 拒绝；线上探针为 `402 DEPLOYMENT_DISABLED`，不重试发布。

本批要补的是：**OS 输入使 MobileSafari 自己生成第一次原生选区**，随后默认扩句、原生手柄扩缩／跨段、滚动与三动作／草稿。程序设置 Selection、dispatchEvent 或直接调用 reader 回调都不能充当首次原生长按证明。Simulator 结果不代替 Production 健康、实体触屏或 VoiceOver。

## 工具可行性：已核对与未核对

1. 当前没有 XcodeBuildMCP 工具，`idb` 也未安装；不因此新装插件或扩权。
2. 已读取 CUA 文档：原生 App 的 `click([x,y], {durationMs})` 会保持鼠标按下，另有 `drag(from,to)`。可在租约后选定 Simulator 的 Primary 窗口，用新截图定位，按住约 650–800ms，再用原生拖动操作手柄。**这是可行路径推断，尚未证明该运行时最终产生了 iOS trusted touch／原生选区。**届时必须从实际画面和受限事件证据验证；失败就如实记录。CUA 文档没有显式 end/cancel 或异常释放承诺，因此这条路径还必须满足下述输入释放门禁，不能仅凭 durationMs 文档直接放行。
3. 只读检查了 npm 已缓存、SHA-512 匹配的 `serve-sim@0.1.49` 包：`src/client/types.ts:25` 有独立 `begin/move/end` 触摸；`Sources/SimNative/HIDInjector.swift:209–213` 向 Simulator HID 发送这些阶段。因此底层可组合 hold 和 drag，包自带 native `.node`，不依赖缺失的 idb／XcodeBuildMCP。**没有启动 helper，也没有验证镜像前端能保留按住时长／pointer capture。**画面正常不能证明输入可用。
4. 完整 serve-sim 有 exec、应用安装、权限、相机／位置、WebKit 调试等能力；即使默认不开 `--allow-exec`，也不能把整个控制面作为本次受限适配器。若用镜像，只复用主控审阅后的最小 frame＋固定 touch 通道，限固定 Primary / 自有 QA 屏幕；没有 terminal、logs、exec、其他 app 数据、通用 JS 或存储接口。否则保留直接 CUA Simulator 候选；输入释放保障未证明时等待已审通道，不以 DOM 强选替代。
5. 缓存源明确写明 `repair-input` 会重启 backboardd 并关闭 app，本轮不使用。Skill 的启动清理范例不能覆盖用户保护：不无条件 `--kill <UDID>`，更不能杀别人的 active mirror；只停止已证明由 GET-273 创建的精确 helper PID/instance。

主控已收到 Tormie B 的真实点按／Share 和 cleanup 回执；旧 mirror/fixture 已退出，wrapper 已释放 Primary 并可能恢复为 Shutdown。现仅授权复用窄合同并补齐长按／拖动的离设备故障测试与独审；B 后续 build/mixed-share 仍由主控先行安排。Leafhour 尚未得到设备/UI 槽，不能把旧设备释放当成启动许可。新增实现与父 runner 门禁见 [受限镜像合同](2026-11-07-get-273-mirror-contract.md)。

缓存包完整性：`sha512-Q2SC29YDY30+qrfNA7Auv4etGqe++FYT3bionmpnKi3kd1xgisI/ohSyrrLqD9N5UsBMXjITcVecxMCQAV5sgg==`。本轮只查看包内文本，没有执行、安装或构建它。

## 串行通道与隔离／恢复

- 复用已有 Primary iPhone `02B4F0C1-A92F-469D-9DCC-5ED13F119507`。当前等主控明确移交；不抢 lease、不加入他人的 inherited session、不新建／擦除／重启设备，不关他人 app／镜像。
- 启动前 fresh `.agent-pause`、`dev-storage-guard resources`、`audit`、`new-artifact GET-273-MobileSafari`。按既有 `dev-ios-session run --profile primary --reason ... --timeout 0 -- <owned fixture runner>` 持有锁；`--timeout` 是等锁超时，不是测试期限。占用则立即返回协调，不排队抢锁。fixture runner 设独立有界生命周期，清理在释放锁之前完成。
- **输入释放门禁**：每次 hold／drag 必须是有界、成对的输入原语，异常／超时／取消均在 finally 或独立 watchdog 中对同一固定设备发送 end/cancel。不能留下 begin 后让调用者负责补 up。CUA 若无法证明异常也可靠释放，则不得用于这批 hold/drag，改用主控已独审、具备该保障的受限原语。失去租约后禁止新 begin/move，但仍须完成自己已开始手势的释放；所有在途手势确认结束、证据状态安全后才释放 lease。若抬起无法确认，保持隔离并交主控处理，不能直接放行下一 owner。
- **可选输入桥门禁**：优先 runner 私有 IPC。若确需 HTTP，除 loopback 绑定，还须严格 Host／Origin、每轮短期 capability、固定 UDID 与逐命令 live lease 校验，拒绝跨源请求、其他本机页面、未知帧或任意方法。capability 不入 URL、日志／聊天／公开证据，不接触现有账号凭据，不形成持久权限。没有通用 terminal/log/exec/任意 JS/其他 app 数据接口。
- 由 runner 子进程以其继承的 session 环境检查 `dev-ios-session is-owner`，只输出本任务租约是否有效。每批手势前确认；失去租约立即停输入。不要把 session 环境或锁文件内容暴露成接口。
- 移交约定一个空白、可弃的 QA Safari 上下文，不查看其他页／历史／账号。只在其中新开本任务私密 tab，保留移交的空白页用于恢复。**不创建持久 Safari Profile**：Apple 说明 profile 可跨同 Apple Account 同步，不能为了隔离引入这种副作用。不导出 profile/cookie/storage，不清整个 Safari、localhost 站点或其他 tab 的数据。
- 已有受限通道先按主控交付的源码／审阅与 lifecycle 回执复用：若只是复用代码缓存，等旧 owner 自行清理后只启动一个本任务实例；若是移交中的共享实例，不擅自停止。每轮仍绑定固定 UDID 和本任务当前租约。
- 结束只关闭本任务 tab，回到移交的空白 QA 页；停止本任务精确 fixture／独占 helper，解除自己的 lease。保留原 profile、其他 tab、设备开机及原有设置。若交接上下文不够隔离，先回主控协调，不能靠读其他页面清点来解决。

## 最小 fixture：已完成离设备实现，无需 iOS 增量构建

现有 `tools/verify-reader-touch-selection.mjs` 的 mock 依赖 Playwright route，不能直接给真实 Safari 使用。复用其已知合成书 `touch-fixture / fixture-v1`、稳定 passage ID、双译及合法 reading-cache hash，做一个**独占 loopback HTTP adapter**：

- 本批只补 Leafhour 的合成数据／被动观察 fixture，不建通用输入桥。输入采用 CUA 候选或主控移交的已审受限通道。正式 reader 复用依赖与资产缓存。已只读核对：当前源码 HEAD 是目标 `d302393`，缓存 HTML 已含修复的 dialog autofocus，JS/CSS 为 326,917 / 204,791 bytes；但 `dist/release.json` 仍标记修复前的 `20d0349`，不能据此宣称是已固化的 M 构建。本轮已获主控授权完成这次必要 Web 重建，`dist/release.json.sourceCommit` 已真实变为 `d302393`，不是手改标记；构建与公开产物检查通过。无需 Xcode/native app build；本地 fixture 与被动观察代码已补齐、预检并独审；受限输入合同的补丁另行冻结复核。不并行重活，不手工篡改 release 标记冒充重建。
- 只绑定 `127.0.0.1` 独占端口；不代理公网、不转发 Cookie/Authorization、不发 Set-Cookie。所有 API 返回固定合成身份／书籍／记录，记录与进度仅内存；没有创建账号或读真实书房。按精确 method＋path 白名单实现；未知请求拒绝并计为 fixture 失败，不返回通用成功 JSON。模型、ASR、翻译、购买、上传与外部网络路径硬拒绝；reading-guide 只允许固定合成书的 action=view，ensure／retry 等生成动作拒绝。
- 被动观察脚本必须先于 reader 初始化注册，才能采到 120ms 规范化前的原始范围；未采到首次原始范围就记未验证，不能只展示后来的程序扩句。脚本只处理固定 fixture passage 节点：`pointer/touch` 的 isTrusted、类型、时间，第一次非空 Selection 的已知合成文本／UTF-16 范围，之后的规范化和手柄范围。验证 payload 必须匹配 fixture 内容。没有设置选区、触发事件或调用业务动作的能力。
- 证据只在固定 schema 的合成证据视图／文件中呈现；不提供 console/log dump、任意 eval、DOM 浏览、网络凭据、cookies、localStorage、IndexedDB 或剪贴板读取。观察视图不盖在 Safari 正文上，不改变三按钮布局。
- `selectionchange.isTrusted` 单独不足以证明原生输入：程序变更 Selection 也可能产生 trusted selectionchange。须联合证明 CUA/受限 HID 的真实按下－等待－抬起、Safari 首次原生范围，以及之后应用扩句；后一个程序扩句事件单独标注。
- 不开启 Web Inspector、证书信任、远程权限或 TLS 绕过。loopback 若遇安全警告／无法访问，记录为具体通道阻塞，停止该路径。

## 最小实际矩阵

| 顺序 | OS 操作 | 通过证据 |
|---|---|---|
| 1 | 点按正文，随后短拖滚动 | 没有选区菜单；页面确实滚动 |
| 2 | 在已知词上 OS 按住 650–800ms | Safari 原生初始选区／手柄和系统 Copy 菜单可见；受限 trace 区分原生初始范围与随后应用扩句 |
| 3 | 拖动系统手柄缩小，再扩到下一 passage | 真实手柄移动，精确范围变化且不被重新吸回；跨段稳定 ID 保留 |
| 4 | 保留旧原生范围后滚动；移到另一句重新长按 | 不误弹旧菜单；新长按重新扩句 |
| 5 | 查看三动作及看原文，关闭返回 | 只有解释／原文／笔记，贴近选区；译文显示标注整段原文，不猜对齐；正文与位置保持 |
| 6 | 写合成笔记草稿，关开，再刷新本任务页 | 自有合成草稿恢复，不写真实记录 |
| 7 | 解释选文，在既有合成未发送问题下再进入 | quote 正确、问题不丢；没有模型／ASR／翻译生成请求 |

系统 Copy 只核对菜单可用，不操作共享剪贴板。手柄／原生初始范围若无法产生，不用强选补结果。每一步有截图／受限 trace；通过、失败、工具不支持与未执行分别记录。默认不录全屏视频，避免捕获非自有屏幕。

## 时间、资源与交付

- 一次 Web provenance 重建（预计 <1 分钟）＋ adapter／观察白名单及独立审阅：约 15–20 分钟；不占设备租约，不包含新输入桥开发。本轮已执行来源重建、fixture 预检与准备代码审阅，未执行设备输入。
- 租约内最小矩阵：约 20–30 分钟，另留 5 分钟恢复；建议主控给一条 35–40 分钟串行窗口。若首次真实输入不通，最多两次有依据的位置／时长调整，记录原因后停止该路径。
- 复用现有已启动设备与缓存，不启动 Chrome、第二台 Simulator、serve-sim 全功能服务或 native build。预计新增一个轻量 Node fixture，证据约 20–100MiB；实际以 fresh guard/采样为准，磁盘严格低于 10GiB 才按既有规则暂停新增重活。资源告警先核查，不通杀进程。
- 规划时资源读回：`.agent-pause` 不存在，可用 13.68GiB、swap 14.82GiB、308 个 Node/npm 进程；因此只安排单一轻量 runner，执行前仍须重新采样。这是规划读回，不是设备执行放行。
- 当前 worktree、dist 与合成夹具保留给这批验收，暂不归档／清除。计划、adapter 和实际结果待协调后集中交付一个验证增量，避免仅为草案反复触发 CI。已有 PR #334 的源码与 CI 证据已保存。

参考：[Apple Safari profiles](https://support.apple.com/en-gb/guide/iphone/iphd27a9ff22/27/ios/27)；本机 `ios-simulator-browser/SKILL.md`；已校验的 serve-sim 0.1.49 缓存源码。没有使用实际 Simulator 画面或其他任务页面来准备本计划。

独立计划审阅：已完成只读复核，四项建议（输入可靠释放、桥接通道鉴权与逐命令租约、精确 API 白名单、先于 reader 的被动观察）已写入为执行门禁。它们仍需在待复用的受限通道与本批 fixture 实现审阅／预检中逐条证明；这份计划不是设备启动许可。复核结论为可进入串行协调准备，未发现剩余计划级阻塞。

## 不占设备的准备记录

- 最新远端 source freeze：`d302393d4ed01a82af6828d7200969be3b8addc9`，tree `257af198f8368c5098540706522e0c15b3bb949d`。产品源码无改动。
- `tools/get273-safari-fixture.mjs`：不使用真实领域服务／认证后端，仅不可变构建资产与精确合成 API；拒绝未知 method/path/query/body、生成、真实身份、跨源／异常 Host。没有输入／lease／通用服务接口。观察字段逐项匹配合成文本，原文 variant 也不能夹带任意值。
- `tools/get273-safari-observer.js`：外部 classic parser-blocking 脚本，位于所有 first-paint／reader 代码之前；仅被动读取已知合成范围和信任／时序标记。没有选区设置、事件合成、业务回调、存储／凭据读取。服务端始终标记 `nativeAcceptance: unrun`。
- `tools/prepare-get273-safari-fixture.mjs`：仅一次性 off-device 预检，没有 live-serve 模式。绑定同次 `.ui-entry/read.html`，记录 release／manifest／template／served HTML／observer／资产及工具源码 hash，核对 135 条静态与 literal-lazy 模块路由。HTTP server 在 finally 中关闭。
- 已知静态 retry 只按现有 reader 的六条 `?retry=1` 边精确开放；其他 query 仍拒绝。生产 service worker 有意返回 410，不运行、不计未知路径；不因此声称验收了离线 worker。
- 轻量 HTTP／VM／CLI 检查当前 9 通过；VM 事件全部是合成时序预检，不是 native 证据。初次测试发现字段计数、原文 variant、正常 worker 和静态 retry 处理不足，均保留失败并修复后通过，没有把重跑当修复。
- 准备产物：注册目录 `/private/tmp/ai-test-GET-273-MobileSafari-prepare.cr0E61`；正式证据归档后保留缓存供租约阶段复用。未开 Chrome／Safari／Simulator 输入，没有获得 lease，没有启动或停止 helper。
- 本阶段按主控要求只做轻量准备，不运行全套 4,840 项或推送 CI。准备代码与后续真实结果集中一个 GET-273 验证补 PR，不把计划／预检当实际 MobileSafari 验收。

- 主控新增的镜像补丁准备：逐 move／出帧 live owner、确认 end 后才清状态、零积压 move、超时／断连／finally 与启动／关闭失败保留 blocked。独审另发现并已修复 localhost 跨端口 cookie frame 暴露、重复 stop 信号，以及异步 begin 压缩 hold／丢末端 move；32 项合并轻量检查通过。这里只复制了已钉住的 native 二进制作为冻结输入，没有加载执行。父 runner 不能沿用旧 15 秒强杀后放锁路径。

- Safari 父 runner 离设备准备见 [父 runner 合同](2026-11-07-get-273-safari-parent.md)：入口与 source／静态资产闭包单独冻结，setup 准入就承担上下文恢复义务，子进程 OS 退出与完整 stopped 回执同时成立后才可恢复自有 boot。现有 wrapper owner-signal 升级 SIGKILL 的边界保留，正常结束必须用父 stdin，blocked 不停止 wrapper。实际窗口仍未启动。
