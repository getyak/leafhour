# GET-273 Safari parent runner

状态：父入口合同。历史 v3 已在授权窗口真实运行到 private blank／mirror ready，随后 viewer403、child-exit-unconfirmed；原 blocked 与 PNG 保留，并已按主控具体授权完成 cancelled 异常回收，七场景未执行。当前 v4 只做 source/off-device 准备，不重新获得 lease 或启动 native／设备／浏览器。下一真实窗口由主控另行安排。

## 固定范围

`tools/get273-safari-parent.mjs` 是实际将运行的父入口，`tools/get273-safari-parent-control.mjs` 管理生命周期。它只持有本任务合成 fixture、一个已审镜像子进程，以及真 lease 中已有 Primary `02B4F0C1-A92F-469D-9DCC-5ED13F119507`。没有任意命令、URL、bundle、设备、DOM／JS、文件浏览、日志、存储或通用 RPC 接口。

父入口不获取或伪造 lease。它只在 `dev-ios-session run` 内继承真实 session／lock 环境，以 `is-owner` 核对固定设备。子进程保留继承的所有必需 ownership 字段原值，排除其他凭据；只新增关闭 Device Hub keyboard bridge 的既有非权限开关。任何 cap／lease 值不写回执、日志、冻结或聊天。

实际执行包用离线 `tools/prepare-get273-safari-parent.mjs` 生成：钉住已交接镜像 freeze `465d1013…64dcd16`、其 8 个输入、产品 M `d302393` 的真实 Web 构建、实际父入口及完整相对 source import 闭包。只复制公开构建 manifest 中允许的静态资产，不复制书籍、账号、运行数据库、`.env` 或其他服务数据。运行必须传入独审通过的完整 `--freeze-sha`，并核对 Node 版本和现有 `dev-ios-session` 脚本 hash；不重新构建或安装组件。

## 入口状态与设备恢复

只读核对了本机现有 `dev-ios-session` 源码：wrapper 会记录 `borrowed`，自身不执行 boot；结束时会保留原先已运行的设备，或恢复本次从 Shutdown 开始的设备。父入口同时核对 inherited borrowed 与固定设备的真实状态，不一致或中间状态直接拒绝。

- 原为 Booted：不 boot、不 shutdown，只在结束时读回仍为 Booted。
- 原为 Shutdown：在真 live lease 内只 boot 此固定已有 Primary，等待 bootstatus 并读回；一旦 boot 调用不确定，保持 blocked，不试图用 shutdown 覆盖不确定操作。只有子进程确认退出、所有清理回执有效、fixture 已关闭后，才 shutdown 本任务启动的 Primary 并读回 Shutdown。
- 每次设备命令前重新核对真实 owner；不会创建、擦除、重启或处理其他设备／服务。Device pool 查询只在内存中提取固定 UUID 的状态，其他设备结果不输出或保存。

## 自有 Safari 上下文与固定协议

父进程不自动打开 Safari、URL、tab 或 profile，不枚举／读取／保存其他页面。启动 fixture 后停在 `awaiting-context`，此时镜像尚未创建，不能捕获未知屏幕。从公布可准备上下文的这一刻起，父进程保守承担恢复义务：即使后续镜像尚未 ready 或初始化失败，也不能按“未公布镜像”跳过上下文恢复；没有确认恢复就保持隔离。尚未启动镜像时，可用同一 finish 入口提交 fresh 恢复 attestation。

主控交接并由 CUA 直接确认的空白、可弃 QA 上下文是前提。只在其中使用本任务自己的私密 tab，不读历史、不创建会跨账号同步的 profile。固定截图位于本任务包的 `screenshots/entry-blank.png` 与 `screenshots/restored-blank.png`；只能来自已批准的自有上下文捕获，不能用任意页、旧图或合成图填充。父进程只验证固定路径、文件类型／新鲜度／hash，不验证图片语义；它保存的是明确的 operator attestation，不冒充 OS 验证。实际 CUA 画面与工具记录须另外保留审阅。

stdin 每次只接受一行、一个固定操作；必须等上一次返回后再发下一行。没有动态参数：

```json
{"op":"status"}
{"op":"open-owned-context"}
{"op":"finish-owned-context"}
{"op":"abort"}
```

`open-owned-context` 明确表示已确认自有私密空白上下文并保存 fresh entry 截图。父进程重新核对 owner，才创建单一镜像子进程；只有 PID／UDID／loopback origin／scope 与当前 child 匹配时，才给出自有镜像和 fixture origin。仅通过 CUA 打开这次 ready URL，在已确认的自有 Safari tab 中进入固定 fixture 阅读路径。

`finish-owned-context` 明确表示：原交接空白上下文已恢复，本任务 Safari tab 与外部镜像 tab 已按约关闭，fresh restored 截图已保存；此后不再输入。父进程先取得这份 operator attestation，立即请求 child 正常结束并等待退出／回执；不会提供单独的“已恢复后继续操作”入口。系统 Copy 仍只看菜单，不访问共享剪贴板。

七场景沿用 [MobileSafari 计划](2026-11-07-get-273-mobile-safari-plan.md)。实际首次原生选区必须由 OS 长按产生，不能用 DOM Selection、事件合成或程序扩句替代。父回执始终标记 `nativeAcceptance: unrun`、`osReleaseVerified: false`；实际验收由原生画面、输入与被动范围证据共同判断。

## blocked 与退出合同

父进程仅向自己创建、尚未确认退出的精确 ChildProcess 发送一次 SIGTERM，最多等待 12 秒；没有强杀、PID 扫描或 global kill。pending／blocked／缺少有效 stopped 回执、非零／signal 退出、初始化中止、关闭失败、owner 丢失、未恢复上下文、证据写入失败，都会保持父进程存活并拒绝交接。缺失不能写成 false／已清理。

正常清理顺序：自有上下文 attestation → child TERM → OS child exit + 全部无在途／无 active 的 stopped 回执 → 固定合成观察保存 → fixture close → 恢复本任务设备状态并读回 → 父 stopped 回执 → 自然退出。不得在 child 仍活着时关闭 fixture、shutdown 或返回 wrapper。只有在上下文 setup 尚未准入、没有 child 或已有可信清理证明的初始化失败，才可安全回收本任务资源并记录失败退出；setup 准入后仍须恢复 attestation，失败而缺失时保持 blocked，不因镜像还没 ready 而放行。

父、子进程在 blocked 生命周期都保留持久 SIGTERM／SIGINT 处理；重复停止不会恢复默认终止，也不会加入强杀。stdin 断开／未知命令／过长或并发命令会安全停止或进入 blocked。40 分钟 deadline 只请求清理，不能因时间到了而释放不确定状态。

**现有外层 wrapper 的真实限制**：其 owner 收到 SIGTERM／SIGINT 后，会在约 10 秒升级 SIGKILL。新父 runner 不修改这个共享工具，也无法对外部 SIGKILL／崩溃给出安全保证。正常结束必须用父 stdin 的固定入口；blocked 时保留整个 wrapper／父／子隔离，通知主控，不能停止 wrapper、关闭其宿主会话或按旧 B controller 的 15 秒强杀后放锁。外层 wrapper 完成后的状态／lease 读回仍是独立收尾证据。

## 本轮验证与交付

离设备验证包含 fake owner／HID／device／receipt 故障，以及一个实际宿主 Node child 忽略 TERM 的 bounded pending 验证；没有模拟器或 native 调用。父 runner 当前 24 项检查通过，已有镜像与 fixture 的 32 项检查保持独立记录；本批合并轻量检查为 56 项。本阶段不重复完整产品 CI／build，不推草案 PR；父包与实际 Safari 结果集中一个 GET-273 验证补 PR。

准备注册目录 `/private/tmp/ai-test-GET-273-SafariParentPrepare.AmFEyR`。每版执行包单独保留，独审具体 freeze hash 后才可在主控授权窗口运行。任何截图的可用传输方式、当前设备／上下文状态都必须在该窗口现场确认，不能从此源码准备推断已完成。

V4 共享 helper 的 actual main 和宿主反例调用同一个 `createAdapterRuntime`；normal0/startfail1 仅在关闭与同步 stopped 证明后触发。`mirror-transport-rejections.json` 只含四类有界整数计数，无 URL/query/header 值/cap；父 OS-exit＋receipt 门禁不变，source freeze 不是新执行许可。详见 [v4 source contract](2026-11-07-get-273-shared-mirror-v4.md)。
