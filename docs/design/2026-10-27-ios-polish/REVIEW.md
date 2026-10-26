# 第一轮审阅与修复

独立审阅先给出“暂不合并”：三项需要修复、一项短暂越界显示问题。我们把越界也列入本轮修复，因为把手与标题会进入系统状态栏区域。审阅未修改工作区。

| 真实输入情况 | 修复与证据 |
| --- | --- |
| 面板仍在关闭途中，重新抓取把手 | 关闭期间只禁用内容控件，把手继续接收输入；抓取会恢复原面板和草稿。`a-closing-sheet-can-be-grabbed-and-cancelled-with-its-draft` 先失败后通过。 |
| 拖离原位再拖回来松手 | 使用整次手势最大位移区分轻点和拖动。`dragging-away-and-back-is-not-treated-as-a-tap` 先失败后通过。 |
| 用真实触摸滚动正文，原句仍可见 | 将轻点取消与滚动分开；不再在按下时立即清空选文。`real-touch-scrolling-keeps-tools-for-a-still-visible-selection` 先失败后通过。 |
| 快速向上甩动 | 拖动使用小范围阻尼，释放时约束全屏和关闭边界。`a-fast-upward-flick-keeps-the-handle-below-the-status-area` 先失败后通过。 |

修复后 10 项计算、14 项新增浏览器交互、11 项原有阅读回归通过，单文件另验，源文件哈希保存在 verification.json。计算检查已加入仓库的常规检查入口。没有以第二次口头审阅代替失败复现与回归结果。

Figma 的 13 个新版画面保留初版，165 个控件跳转逐一读回，主流程通过 Computer Use 实际点击。Figma 是固定状态；连续拖拽、文本输入、滚动和恢复属于网页原型证据。

保留的边界：正式 iPhone、Safari、系统键盘、VoiceOver 与触觉尚未验收。页面外的演示工作台仍可通过 Tab 进入，不把它当作正式产品的模态焦点循环。Figma 整段高亮采用段落背景，网页采用文字行背景；这不是系统文本选择的验收。
