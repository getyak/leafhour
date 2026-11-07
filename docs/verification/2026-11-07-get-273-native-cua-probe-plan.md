# GET-273 原生 CUA 单场候选方案

状态：本文件保留路线评估。最小单场控制器现已实现，具体动作、错误分账与执行步骤见 [单次长按执行包](2026-11-07-get-273-native-cua-execution.md)。当前仍只有 source/offdevice，没有 boot、lease、原生输入或新 mirror；B/GET-328 的窗口不被占用。真实执行仍需最终独审冻结和统筹排期。

## 已知事实与判断

真实 Booted 探测已证明 `getApp("com.apple.iphonesimulator")` 能取得 Primary 窗口与 Home；v3 的普通原生菜单点按已创建自有 private blank，并通过 Simulator Save Screen 保存真实 PNG。这证明观察和普通 UI 操作可用，**没有证明 Safari 正文长按、原生 handles 或拖动已工作**。

当前 CUA 文档明确提供 `App.click([x,y], {durationMs:700})` 和 `App.drag(from,to)`。它们具备候选操作面，但文档没有独立 mouse-up/cancel API、错误路径 release 承诺，也没有 drag 内部 move 事件／逐 move 租约核对接口。不能把它称为与原 mirror 底层门禁完全等价的替换。

统筹的独立 synthetic transport replay 已实际观察 Chrome 导航 HTTP403，拒绝计数为 fetch-site1、remote-address/host/origin0，fake frame/touch0；进程与端口已清理。结果来自 `/Users/cubxxw/ops/runs/linear-audit-20261106/round14-synthetic-transport-probe/RESULT.json`。它确认了这条工具导航路径命中当前 Fetch Metadata 门禁，不能算 Safari 产品失败。所有 mirror Host/Origin/cap/fetch-site 门禁保持不变。

结论：**按统筹本轮明确决定，可准备一次 700ms 长按的正常成功路径验证；尚不称七场景可完成**。文档没有异常 release 保证，这是结论限制：保留 wrapper 只隔离会话，不证明 CUA 服务已释放全局按压；宿主 fake 测试也补不出该证明。它不被解释为软件永久需人工阻塞。若正常调用成功，可联合真实范围和画面验证；若 error／timeout 或结果不确定，立即 hold，不重试输入、不自动交接。首场不做 drag。实际执行仍须新控制器冻结、审阅和统筹窗口，当前没有执行许可。

## 建议首场：一次 700ms 长按，约 6–8 分钟

1. Fresh resources/audit/无 pause。由真实 `dev-ios-session --profile primary --timeout 0` 独占已有 Primary，记录入口 Booted/Shutdown；只正常启动自己原为 Shutdown 的设备。固定窗口标题／设备状态不匹配时，不输入。
2. 只接受统筹明确移交的自有私密空白 tab，实际 CUA 再确认。避免浏览其他页／tab／历史。首场建议把该自有 tab 的 `about:blank` 约定为 entry/restore 基线，真实 Save Screen PNG 与建立私密上下文的 UI 记录共同证明归属；不把白图本身当成 private 证明。不新建额外 reader tab，也不依赖尚未验证的关闭当前 tab／Back 行为。若必须恢复 Safari Start Page 而不能采用此基线，先单独核对其恢复路径，不带着未知清理路径进入长按。
3. 复用原有合成 fixture、固定书／passage、parser-blocking 被动观察和构建来源。通过原生 Safari 地址栏进入本任务 loopback reader，不经过 Chrome mirror。收到真实 reader-ready 后才开始；安全警告、权限提示或无法访问时不绕过、不扩权。
4. 每次输入前硬核对同一个 Primary 窗口与桌面焦点；设备 lease 不等于桌面 UI 独占。只有实际暴露 Raise 时才可用该动作，并须重新观察焦点；若现有 API 不能确认，不输入、不猜测前台。优先限定该窗口截图；AX 只取需要的固定标签，不导出完整树。只用同次 **CUA 窗口截图**定位；不把 1206×2622 的 Save Screen device PNG 像素直接当作 CUA 窗口坐标。先以自有地址栏的普通点按／焦点变化核对坐标约定，不能靠在正文试点来校准。每次窗口位置／缩放变化都要重新取图。
5. 确认原文层的 `grows` 实际可见、reader-ready 与 passage/layer 对齐，不能据源码假定坐标或视图。控制器核对 real owner，并先同步写入唯一阶段／操作 ID 和 input-in-flight；CUA 独立调用一次 `await app.click(point,{durationMs:700})`，在正常返回后单独记完成，再请求 AX／截图。不要把 click 与可能超时的观察绑在一个工具调用，混淆动作是否完成。目标是已知 `fixture-p0` 原文中的 `grows`；文本／路径保持原样，不调用 selectText、Selection、Range setter、dispatchEvent 或 reader 回调。
6. 联合核对：真实原生 handles／系统 Copy 菜单可见（不点击 Copy）；被动 trace 中首个非空原始范围与后来 app-selection 分账。`grows` 的预期 UTF-16 范围是 [7,12)，第一句是 [0,20)，但以实际观测为准，不能补造范围。如果 OS 首次就给全句，只能记原生选择被观察，不能据此声称 app 扩句通过；若首个原始范围丢失，也记该项未验证。
7. 首场没有 drag、笔记保存、对话生成或七场景扩展。只在 CUA 输入已正常返回且没有不确定操作时，用正常原生 UI 回到同一自有 `about:blank`，保存 fresh 真实恢复 PNG。停止本任务 fixture、保存固定 schema 观察、确认控制器退出，再恢复自己启动的 Shutdown 并读回 wrapper／锁。保留收到的既有空白 tab；任何本场额外新增 tab 都必须精确关闭，不能把留存说成已关。

“没有选区”与“工具动作结果未知”分开：动作正常返回但没有原生选区，是候选路径未证实／未通过，不是产品成功。工具 error/timeout、真实 owner 变化或不能确认已结束的输入，则进入 uncertain/hold；不追加第二次长按、普通 click、Home、shutdown 或取消 wrapper 来假定释放。此前 v3 的零 mirror-HID 例外回收不适用于一次已经尝试的原生长按。

## 控制器最小差异（原方案；实现见执行包）

- 不复用 v3 的 fake mirror child／stopped receipt 来通过门禁。新的 CUA-only runner 只拥有合成 fixture 和真实设备 lease；不加载 native addon，不创建 mirror/cap/浏览器代理，不提供输入、任意 JS 或通用命令接口。
- 保留固定设备、原入口状态、自有上下文 setup 起恢复义务、真实 entry/restore PNG、固定观察 schema 和失败保留。资源检查用于准入新工作；清理阶段仍核对真实 owner，不把磁盘告警伪装成 owner 丢失或阻止已经安全可做的自有恢复。
- 对所有输入，包括 setup、地址栏、正文长按和恢复操作，先同步保存唯一阶段／操作 ID，再记 `input-in-flight → returned`；只接受同一 ID 的对应返回，拒绝过期、重复和并发确认。错误／超时转 `uncertain`，观察调用单独记录。控制器不执行输入，只核对 real owner 并保存有限阶段回执。CUA 服务不在该 lease 子进程内，无法宣称底层逐 move 硬校验；独占整个 primitive 的 lease 和桌面焦点是操作条件，drag 尚需另行验证。
- 正常返回不能直接成为 UI pass。结果至少分成 `tool returned`、`native initial range observed`、`app expansion observed`、`context restored` 和 `cleanup read back`。原生输入／lease／恢复不确定时保留 wrapper；超时不能自动清理／交接。外层 wrapper 的信号升级限制仍明确保留，不能正常取消一个可能有未抬起输入的会话。
- 新源实现后，先做纯宿主故障验证：Booted/Shutdown、上下文 setup 后初始化失败、正常返回但无 range、输入错误／timeout、观察失败、窗口 deadline、恢复缺失、重复信号、资源下降和 receipt 失败。确认所有 uncertain 分支不退出；再独审冻结实际入口。此文档不是运行许可。

## 原七场景的覆盖判断

| 场景 | 文档支持的候选操作 | 仍需实际证据 |
| --- | --- | --- |
| quiet tap／scroll | click／scroll | 正文 tap 不弹菜单、真实滚动方式 |
| 首次长按＋扩句 | coordinate click + durationMs | 本单首场，原生范围与 app 变化分开 |
| handles 缩小／扩展／跨段 | drag | handle 可被命中、轨迹时长与范围保留；没有逐 move 接口 |
| 滚动／重新选择 | scroll＋第二次 hold | 旧范围不误弹、新窗口重新扩句 |
| 三动作／原文 | 普通 click | 真实三个动作及返回位置 |
| 草稿／reload | typeText＋可见 Reload 控件 | 不假设 Mac 快捷键已转发到 iOS；实际恢复与隔离 |
| Explain quote／未发问题 | 普通 click／typeText | quote 与草稿保留，未触发禁止的生成请求 |

上述是能力映射，不是验收结果。没有物理触屏、VoiceOver、Production 或 TestFlight 通过声明。实际产品样本版本仍须在开场冻结中明确，不能借新 helper hash 声称更新后的 main 已验收。

独立方案审阅指出异常释放证明缺失、每次输入 ID 绑定、窗口与桌面焦点核对。后两项已写入差异方案。统筹随后明确重判第一项：它限制异常时的结论并要求 hold，不否定正常成功路径的单场验证，也不构成永久 human block。此重判不伪造 release 保证、不授权拖动或当前执行。本文件的差异方案已落实为新的单场源码；共享 helper 源终审与新的实际控制器冻结／窗口是不同门禁。
