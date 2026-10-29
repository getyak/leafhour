# 重排时保留正在阅读的位置

GET-308 · Keep iOS reading position stable during reflow。处理字号、行距和正文宽度变化时的位置与选文生命周期，不增加行宽偏好、字体依赖或持久化字段。

## 实测与取舍

在现有 iOS 26.5 Primary iPhone、公版任务数据中，原生探针先滚动 600pt，并在同一帧修改字号。可见原文已到 text-3/scalar28，会话仍是 text-2/scalar353；原实现重排后回到 text-2/scalar353。之后一次字号变化把有效选文 `waistcoat-` 清空。探针控制真实 UITextView 与 ReaderSession 的时序，这不是普通手势下的发生率或真机性能测量。合法的同章显式目标500原本即可到可见481；不能把它说成原有搜索跳转故障。

滚动位置现在立即进入非观察 checkpoint，不逐次发布整份 ReaderState，也不逐次写盘。延迟保存、任何其他保存和退出前的 flush 都吸收最新 checkpoint；已有写入等待期间出现新位置，也要确认新快照后才返回。笔记保留自己的原句锚点，不随阅读 checkpoint 改写。

排版偏好不再生成显式导航身份。重排读取已渲染几何下的最新位置，同章、原文仍相同的有效 UTF-16 选区可以保留；显式跳转清空选区。捕获和恢复都检查已渲染章节、导航身份，异步恢复另检查代次，旧任务不能释放新任务的恢复状态。UIKit 宽度布局回调负责纯宽度变化，避免依赖某次 SwiftUI 状态更新恰好发生。

选择这条边界的依据是 UIKit 分别提供布局生命周期和选区状态：[layoutSubviews](https://developer.apple.com/documentation/uikit/uiview/layoutsubviews%28%29)、[selectedRange](https://developer.apple.com/documentation/uikit/uitextview/selectedrange)。这是本项目据实测作出的实现取舍；没有迁移 TextKit，也不声称支持 iOS 26 的混合双向多范围自然选文。

## 验证与后续

最终 47 项宿主 XCTest、1 个真实原生组合探针通过。原生重排后仍在 text-3，可见行首为scalar0，会话 checkpoint 为28；不是可见scalar完全不变。选文保留，显式目标500可见481，实际横屏750×382时仍可见481且会话checkpoint500。原生探针没有独立读回这些新位置的磁盘状态；真实存储传播由宿主测试覆盖。独立审阅补齐了笔记提交在非观察 checkpoint 更新后重新确认回执的分支。

[原始结果与范围](../../verification/2026-10-29-get-308-reflow/README.md) 区分已执行、排除和未验证项。跨章真实界面抢占、图片与长单段滚动成本、iPad／分屏、PDF主题回程、最大字、VoiceOver及真机仍需要各自验收；没有 FPS、延迟或内存提升结论。宽屏列宽与图片缓存留给有独立证据的小批次。
