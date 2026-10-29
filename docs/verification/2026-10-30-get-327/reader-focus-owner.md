# 编译阅读页的共享焦点状态

本记录对应 `8523699` 之后的 GET-327 工作树改动。后续提交、同提交 CI 和正式发布结果由主交付记录分别确认。

## 复现与修复

`8523699` 的实际 reader 构建为 328,563 字节，超过固定 320 KiB 上限 883 字节。同时，核心入口内联 `reading-toolbar.mjs`，延后加载的原始 `reading-hub.mjs` 又静态导入原始 toolbar，导致两份 `focusHandoffs` 状态。通过浏览器 URL 解析执行真实编译入口及原始 hub 的回归，修复前得到两个 RAF 和两个清理 deadline；hub 无法取代核心 header 的交接任务。

`reading-tool-focus.mjs` 现在是唯一状态 owner。核心 toolbar、immersion 和原始 hub 均通过同一 `/reading-tool-focus.mjs` URL 使用它。构建仅批准这三个调用方的精确静态导入，模块不允许任何出边；如果文件别名导致模块被内联，metafile 检查会拒绝该构建。原始 toolbar 的兼容重导出继续指向同一 owner。

每次交接必须明确传入 `blocked` 查询，缺失时立即报错。immersion 和 hub 都传入完整的 `overlayOpen(document)`，包括聊天 dialog 和已打开的 owned popover；不会用排除非模态聊天的较弱查询代替。所有可见性、焦点、新输入、关闭、隐藏、卸载及有界清理规则保留。hub 的弹层查询依赖仍在可选模块加载时取得，首屏共享 owner 本身没有依赖。

编译 HTML 为 canonical helper 加入唯一 `modulepreload`，与入口并行取回。源服务的 portal 和 reader 两条静态路由都逐字返回此文件。发布清单与现有离线图遍历覆盖相同 URL，最终 225 项离线资源中，helper 和可选 popover 依赖各有一个带字节数及 SHA-256 的记录。

## 产物测量

| 项目 | 最终产物 |
| --- | ---: |
| 编译 reader JS | 327,097 B |
| 固定预算余量 | 583 B |
| 相对 `8523699` 的核心入口减少 | 1,466 B |
| 无依赖 helper | 3,443 B |
| 首屏脚本总量净增加 | 1,977 B、一个 URL |
| 完整 reader 与 hub 路径的脚本图净减少 | 10,562 B |

完整路径以新 helper 替换原来的 raw toolbar，请求总数保持不变。首屏增加的 helper 已预加载；这些是字节和依赖图测量，不是冷启动耗时提升的实测结论。

最终 JS 文件为 `reader-49a121b8685b6749.js`，helper SHA-256 为 `3a8c7c29c7f0d8e6bf679c78f943eda3515f08bcec8d0494d789237c0ff99829`。

## 验证范围

共享状态、源码路由、发布/离线及固定预算回归先得到 5 项失败；去除首屏传递依赖、必传 guard 与预加载得到 3 项失败；文件别名负例也先确认未被拒绝，再补构建防线。最终定向检查：

```sh
node --test tests/reader-tool-focus-boundary.test.mjs tests/reader-tool-focus.test.mjs tests/chat-upload-boundary.test.mjs tests/release.test.mjs
```

结果为 **25 项通过，0 失败、0 跳过**。另有构建、UI 模块图、离线构建、hub、工具条和 immersion 的 **99 项适用回归通过**。完整宿主门禁仍由主 Agent 单独运行，不能由这些定向结果替代。

独立 Agent 使用真实编译 `read.html`、上述 hashed bundle、原始可选 hub 和公开资源，运行 macOS Chrome 原生 CDP 输入验收。helper 的 canonical URL 只请求一次；单次 pill Enter 的焦点调用严格只有 `open-toc`，没有 header 竞争。实际书籍信息面板、延后 share/gift、单次 Escape 还焦、四个真实 italic glyph 及字体响应字节、顶部唤醒和无 hub 时的 header 回退均通过，错误列表为空。浏览器和本任务临时服务已关闭。

这些是隔离本机编译产物证据，不代表 Linux、Windows、Android 或生产验收。本轮没有调用真实模型或写入真实账号记录。本机原始记录位于本任务隔离产物的 `shared-tool-focus/`，包括 `final-green.tap`、`dependency-free-contracts.tap`、`build-receipt.json` 与 `reader-packaged-native-cdp.json`。
