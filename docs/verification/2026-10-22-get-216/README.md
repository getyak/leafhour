# GET-216：环境音连续循环与恢复播放

2026-10-22，`codex/get-216-work`，同步基线 `23f9dd746bc293b086f79ec6805c5f872340b270`，提交前再同步 `d7dad860ef6716b520a50cd0a106ade888e7a153`。此目录记录本地候选验收；PR 最新提交的 CI、合并和生产验收另以关联 PR / Linear 的读回结果为准。

## 实现

- 原始五份 MP3 有首尾 0.6 秒淡化。解码后裁掉两端各 0.75 秒，再用 2 秒等功率重叠构造循环缓冲。真实解码得到 32.04 秒原始录音、28.54 秒循环；由 AudioBufferSourceNode 的音频渲染线程循环，不依赖 JS 定时器衔接。原始素材与许可不改动。
- 沿用账号/书籍隔离的偏好键，保存严格布尔 `playing` 意图。重入尝试恢复；显式暂停与无主题关闭意图，离开页面停止设备输出并保留意图。旧设置缺少该字段时保持关闭。
- 自动播放被限制时显示等待真实操作的提示，可信 pointerdown/keydown 恢复。播放/暂停/切主题按钮自己处理，避免首次 pointerdown 恢复后同次 click 又反向取消。
- bfcache 恢复先共享并等待当前身份核验；异账号、离线、页面离开、显式暂停和已手动播放的新主题均不会被晚到的核验恢复覆盖。
- 音频引擎通过精确 importer/import-kind 的静态外部模块导入，保持固定 reader 320 KiB 门禁；它仍是静态依赖，并非按需 import()。新循环回归已加入 release-files 隔离发布清单。

## 验证与边界

- 独立 sub-agent 完成最终源码、账号边界、构建合并复核。确认的首次点击 P1、缓存页账号恢复 P2、晚到确认重启手动主题 P2 均已关闭，无未解决 P0/P1。
- `identity-red.log.gz` 记录先复现的失败；`identity-fixed.log` 为最终 24/24 音频、控制器、账号 API 定向测试通过。`bundle-resume.log` 为同步主分支后的 reader 体积/外部模块检查通过。
- `merged-targeted.log`：最后一次 main 同步后 38/38 定向测试通过（含新主分支相关注解边界）。`build-final.log` 为该合并后的托管构建通过。
- `build-resume.log`、`runtime-resume.log`：同步后的托管构建与隔离 runtime 构建通过。公开产物检查 409 文件/11 注册素材，发布清单 878 软件文件及源码溯源检查通过。
- `verify-deploy-fixed.log.gz` 是暂停前旧基线的全量宿主验证：2889 项、2888 通过、0 失败、1 跳过。它不能代替新主分支合并后 PR 当前 head 的完整 CI。旧失败日志保留，未将它们写成成功。
- `copy-final.log` 与对应 lint report 是同步后的固定 Vale 3.24.0、textlint 15.8.0 文案检查；保留既有债务及警告，不改 baseline。
- `browser-local/` 来自真实 Chromium 153.0.8010.12（实际版本见 browser.json.gz），未使用自动播放放行参数，也未静音输出。对真实输出节点旁路接入 AnalyserNode 和 MediaRecorder，原有扬声器连接保留。音乐音量通过可信键盘归零，以独立观察环境音。四主题依次切换，每种实时采集 60.28–62.81 秒，覆盖两次循环。每个预定边界前后 300ms 的采样窗口均无静音（RMS > 0.0001）；录音、逐时 RMS 和实际 start/loop 调度参数均保存。
- 五份真实素材在浏览器 OfflineAudioContext 渲染三轮，接缝 RMS 非零，接缝相邻采样跳变不超过素材中的既有最大跳变。`*-seam.f32` 为第一接缝前后各一秒的 48 kHz 单声道 Float32 PCM，`waveforms.json` 保存数值。
- 同一次真实浏览器验收中，sea 开启意图重入后是 `blocked`；真实点击恢复后检测到非零输出。显式暂停、无主题再重入均保持关闭，页面无 uncaught error。账号核验竞态以确定性控制器/API 测试覆盖；不把合成 pageshow 事件称为真实 bfcache 验收。
- 这些记录证明浏览器数字音频图的连续输出，不宣称已完成人工试听或物理扬声器录音。未启动 iOS 模拟器，未调用模型、未全书翻译，未访问其他真实账号。生产音频验收阻止非登录 POST，避免写入阅读记录或触发模型。

## 复现

使用已安装 Playwright 与 Chromium，指定 `GET216_BASE`、`GET216_OUT`、`GET216_PLAYWRIGHT_MODULE`、`GET216_CHROMIUM` 运行 browser-check.mjs。输出应放 dev-storage-guard 登记的临时目录。`GET216_AUTH=keychain` 仅用于已授权的生产默认账号；凭据和 Cookie 只存在内存，报告仅保存 owner 的 SHA-256。禁止提交账户运行数据或凭据。

原暂停与恢复经过、资源清理及可恢复源码快照保存在本机运维记录。原工作区保留；旧失败记录 `browser-failure.json` 是首次隐藏入口问题，后续 harness 变量错误和成功报告分开保存。
