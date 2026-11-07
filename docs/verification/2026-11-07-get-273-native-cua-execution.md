# GET-273 单次原生长按执行包

状态：源码已实现；最终 freeze 和独审结果以最终 handoff 为准，实际执行仍等统筹窗口。当前仅 source/offdevice；没有 lease、boot、原生输入或新 build。原七场景仍未验收。产品样本固定 `d302393d4ed01a82af6828d7200969be3b8addc9`，不代表新的 main 已验收。

## 固定范围与真实证据

实际入口 `tools/get273-native-cua.mjs` 只启动已有合成 fixture，核对真实 `dev-ios-session is-owner` 与固定 Primary `02B4F0C1-A92F-469D-9DCC-5ED13F119507`，保存同步追加日志和上下文图片哈希。`tools/get273-native-cua-route.js` 是直接粘贴到 `cua_repl` 的实际字面源码，载入不调用 SDK，重复安装直接拒绝；不要重置 REPL、重贴代码或换 handle 来重试输入。

路线不加载 mirror/native addon，不创建浏览器转发，不改产品、Host/Origin/cap/fetch-site 门禁。它只有本场列出的原生控件点击、固定 blank/fixture 地址、Return、一次 `App.click(point,{durationMs:700})`、只读 AX/截图及丢弃自有 App 引用。没有 drag、DOM 选区写入、事件 dispatch、通用 exec、任意 URL、剪贴板、账号或模型调用。

每次输入必须使用控制器刚同步落盘的 ticket。CUA 的实际 await 成功返回后，才把**该次完整工具结果**交给控制器。手写 ACK、宿主 fake SDK 和单独的 receipt 文件都不是 runtime；必须保存本任务/root 的真实 CUA 工具轨迹、真实截图及 fixture passive trace。`selectionchange.isTrusted` 也不能单独证明原生输入。

CUA SDK 没有物理 mouse-up/release 证明；所有记录保持 `osReleaseVerified:false`。正常成功路径可检验，但 error/timeout/未确认输入立即 hold，不能用 SIGINT、wrapper 取消、Home、shutdown、新驱动或另一次点击猜测释放。输出丢失、工具整体抛错或超时，即使曾看到部分 `method-returned` 输出，也不能据其伪造 ACK；本场保留会话。v3 的零输入例外回收不适用。

## 预计实际窗口：8–10 分钟

1. 统筹先确认 B/GET-328 真正归还；本轮不预占 lease。刷新 pause/resources/audit，明确产品 M 和执行 freeze。仅用既有 Primary；其他设备若非 Shutdown，拒绝本场，不关闭他人的设备。无新 build、安装或签名。
2. 通过下面真实 wrapper 启动冻结包，`--timeout 0` 避免外层定时强杀。控制器有 10 分钟 deadline，届时只 hold，不清场或交租约。入口若 Shutdown，仅在自有会话正常 boot/bootstatus；入口 Booted 则保留原生命周期。所有输入前及正常返回后，都核对真实 owner、固定设备 Booted、其他设备 Shutdown 和冻结源码。资源仅作新操作准入，安全恢复不因磁盘下降被阻断。
3. 粘贴冻结 `get273-native-cua-route.js` 一次，向控制器发 `admit bind`，在 `cua_repl` 仅 `await get273NativeRoute.method(ticket)`。不要把输入和可能失败的观察写在一个工具调用。将真实结果传 `method-ok`，得到同 ID 的 observation ticket，再独立 `await get273NativeRoute.observe(ticket)`，将完整成功结果传 `observed`。
4. 观察输出仅为固定标签和真实 App 截图，不导出完整未知 Safari AX。核对同一个 Primary 窗口与桌面焦点，再为最新 observed ID 提交 `view`。这是基于真实图像/工具轨迹的操作人确认，API 不提供独立的 OS 焦点证明。新观察立即废弃旧确认；窗口位置/缩放变化重新取图。遇到陌生页面只用 chrome 控件离开，不读或保存其内容，不枚举 tabs/history。`getApp` 自动首图本身可能显示当前窗口，开场必须使用统筹移交的自有 blank/已知 Home 状态。
5. 只通过已观察的 Safari/Home/菜单控件打开一个自有私密 tab，采用同一 tab 的 `about:blank` 为 entry/restore 基线。不额外创建 reader tab，不依赖未验证的 Back/关页。私密归属由实际菜单轨迹与图像共同证明，白图自身不够。每个动作使用下表固定 action；没有控件就停止，不猜 AX index。先在自有地址栏作无害焦点/坐标校准。`setup-address`/`setup-submit` 可将此自有页设为 blank。
6. 以真实 Simulator Save Screen 控件保存 entry PNG，只移动本阶段刚产生、精确自有的那一张到 `screenshots/entry-blank.png`。不要覆盖旧截图或遍历用户图片。固定 proof 核对本机 UID、fresh mtime、PNG、非 symlink 和哈希；内容仍要实际观看。向控制器提交最新 `owned-private-blank` view（privateContext true），再 `entry`。
7. 原生地址栏进入控制器 ticket 内唯一的 `/read?book=touch-fixture&ui=en`。收到 parser-blocking `observer-ready` 及同一 document 的 `reader-ready`、无 fixture violation 后，实际图像确认原文 `fixture-p0` 的 `grows` 可见。必要时只用一次已观察的原文模式控件；不能在正文试点校准。提交新 `owned-reader` view，targetVisible true，再 `ready`。坐标只来自当前 CUA 窗口图，不能用 1206×2622 Save Screen 设备 PNG 像素。
8. `admit hold` 只给此 `grows` 的窗口坐标。实际执行一次 700ms 原生 click，完整 await 成功后再 `method-ok`。这先持久化 input returned，再重新查真 owner/设备；随后独立观察实际 handles/系统 Copy（不点击 Copy）和 passive trace。无选区是本路径未证实/未通过，不能补发长按。首个原始 UTF-16 `grows` 应为 [7,12)，后续 app 扩句 [0,20) 分账；若 OS 初始就选全句，不能据此给 app 扩句通过。
9. 只有输入已正常返回、没有未知或在飞操作时，提交 `restore`，再用同一 live App 的新观察/确认和原生地址栏回同一自有 `about:blank`。Save Screen 真实 fresh `restored-blank.png`，查看后提交 `restored`。自有既定空白 tab 留作已约定基线，不称其已关闭。任何额外新建 tab 必须精确清理，否则不提交恢复通过。
10. `admit close` 后在真实 CUA `method(ticket)` 丢弃局部 App 引用，将返回的 `closed` 结果交控制器固定 `closed` 命令。它不调用不存在的 App.close，不声称全局 CUA SDK 已关闭。随后 `closeout` 保存 fixture trace，关闭本任务 server，仅恢复自己 boot 的 Shutdown，检查实际状态，写 stopped 后退出0。最后独立读回 wrapper exit、锁/metadata 缺失、自有端口拒绝、设备原入口状态以及 CUA completion summary。源 receipt 不能替代这些读回。

建议时间预算：0–2 分钟准入/boot，2–5 分钟自有私密 blank 与 fixture，5–6 分钟唯一 hold 与只读证据，6–9 分钟正常恢复和实际清理；第10分钟仍未结束则按 hold 保留，不发第二次输入。

## 固定动作与命令

| section | action | 唯一允许的原生操作 |
| --- | --- | --- |
| setup | bind | `cua.getApp('com.apple.iphonesimulator')` |
| setup | safari-open / safari-more / new-private-tab / private-not-now / entry-focus-address / entry-save-screen | 已观察控件，120ms click，各最多一次 |
| setup | setup-address / setup-submit | 已观察地址 index 设 `about:blank`；Return，各最多一次 |
| reader | reader-focus-address / reader-show-original | 已观察地址栏/原文控件，120ms click，各最多一次 |
| reader | reader-address / reader-submit | 设 ticket 的固定合成 fixture URL；Return，各最多一次 |
| reader | hold | 当前 `grows` 窗口坐标，700ms，只一次；此后只读/恢复 |
| restore | restore-focus-address / restored-save-screen | 已观察控件，120ms click，各最多一次 |
| restore | restore-address / restore-submit | 设 `about:blank`；Return，各最多一次 |
| restore | close | 无 SDK 输入，丢弃本地 App 引用 |

CLI 输入严格 JSONL，每次一行、一次一操作，等待真实结果再继续。没有 `exec`/通用命令或测试租约入口。`status` 只读；`view` 必须带最新 observed ID、primaryWindow/desktopFocus/privateContext/targetVisible 布尔和固定 view 名（primary-home/owned-private-blank/owned-reader/owned-address）。`entry`、`ready`、`restore`、`restored`、`closeout`、`observe` 均是固定命令。`method-ok`/`observed`/`closed` 携带实际 CUA 完整返回值；不要手工补字段。

```json
{"op":"admit","action":"hold","payload":{"point":[133,290]}}
{"op":"view","value":{"id":"<actual observed id>","primaryWindow":true,"desktopFocus":true,"view":"owned-reader","privateContext":true,"targetVisible":true}}
```

上面的坐标只是 JSON 格式示例，**不能用于实际输入**。实际点必须从本场最新图像重新确定。

准备命令（本地、无 UI，复制已有 M 构建，不新 build）：

```sh
node tools/prepare-get273-native-cua.mjs --artifact <own-new-pack> --fixture-inputs /private/tmp/ai-test-GET-273-SafariParentPrepare.AmFEyR/execution-v3
```

实际命令只在统筹交还并排期后，从最终 handoff 取得真实 PACK/FREEZE 值：

```sh
/Users/cubxxw/.local/bin/dev-ios-session run --profile primary --udid 02B4F0C1-A92F-469D-9DCC-5ED13F119507 --reason GET-273-native-single-hold --timeout 0 -- node <PACK>/tools/get273-native-cua.mjs --artifact <PACK> --freeze-sha <FREEZE>
```

## 错误分账与宿主验证

输入 error/timeout、并发/旧回执、真实 owner/设备失配、journal I/O 失败、缺恢复、信号或 deadline 都 hold；不关闭 fixture、不 shutdown、不普通退出交租约。外层 wrapper 对信号的10秒升级仍存在，控制器不能阻止外部强杀，所以不要向 wrapper 发取消信号。

**输入已成功、AX/截图失败**：把实际观察错误绑定其 id 记 `observation-error`，inputState 仍 returned，不伪装 HID 在飞。可在同一 live route/App 上请求一个新的 `observe` ticket，只读补证，不再输入。尚有未 settled 的 SDK read 时 route 拒绝追加 SDK 调用；待真实调用结束后才补只读。如果工具整体结果未知，不把部分输出当成功；输入未知始终 hold。即使没有选区，只要输入与恢复流程确已正常完成，也可记录“本场未证实选择、清理完成”，不能记产品验收成功。

宿主测试覆盖真实 route 字面入口、实际 parser→dispatch→controller 闭环（包括真实 closed 回执）、单次输入与异步返回、只读失败/重试、重复安装、旧 focus/view、stale/replay/concurrent、晚返回、Booted/Shutdown、资源下降、输入错误、deadline、缺恢复与 I/O 失败。测试替代的只有 SDK、真 owner/设备/fixture等外部边界；不把这些 fake 成果称为实际长按。完整产品 CI 不在本轮重跑，旧 PR334 证据另存。
