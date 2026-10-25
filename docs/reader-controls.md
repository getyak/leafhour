# 阅读控件：顶部章节选择与听读入口

GET-161，2026-10-18 实现记录。本文件说明本轮改动的界面设计与本机真实检查；实际浏览器的手机、夜读、键盘与音频全流程仍由交付方另行验收，本文不把本机测试写成线上已通过。

## 设计

**章节标题保持安静。** `#chapter-heading` 只保留章号、章名与原题，不再放任何独立工具按钮；正文内容里不残留听读入口。390px 窄屏下标题不被工具遮挡，页面锚点与正常章节恢复逻辑未改动。

**听当前章节移入侧栏。** 原先标题下的大按钮 `#listen-chapter` 移入现有可收起的右侧阅读工具面板 `#reading-tools-panel`，样式为一条克制的 44px 工具行，文案为「听当前章节」。ID 唯一，不复制；点击仍打开原有听读面板（先听导读 / 朗读正文 / 帮我听懂），声音设置、已保存的听读、讲稿、供应商与授权行为均不变。仅打开或切换章节不会生成、播放声音，也不会发起任何听读或模型请求。

**顶部分开书名与当前章节。** 原 `#open-book-info` 同时带书名、`#running-chapter` 与箭头但只开书籍介绍；现在拆成两个入口，共处顶栏中栏 `.running-entries`：

- `#open-book-info`：书名（过长省略号截断），只开原有书籍介绍浮层，元数据入口保留；
- `#open-chapter`：真正的章节选择按钮，带箭头，标签为当前章节（如「第 3 章 · 绕圈赛跑与长故事」），打开现有 `#toc-dialog` 全书目录。

**一个目录模型。** `#toc-dialog` 仍是唯一目录：顶部「目录」、设置里的「全书目录」与新章节选择共用它，不新增第二份章列表。选择章节后关闭选择器并进入所选章节的正文位置，不会重新打开书籍介绍。显式章节显示「第 N 章」，自动分段的书显示「阅读片段 N」，序言等非正文部分只显示标题，不伪装成编号章节；连续阅读与翻页阅读路径一致。

**就绪、ARIA 与焦点。** 书页就绪前章节选择按钮为 `disabled`，就绪后启用并暴露当前章节；按钮使用 `aria-haspopup="dialog"`、`aria-controls="toc-dialog"`、`aria-expanded`，目录中当前章仍以 `aria-current="location"` 标出。Esc 关闭目录后，焦点回到真正打开它的控件；若原控件位于已关闭的对话框内（如设置里的目录入口），焦点回退到顶栏「目录」。

**移动端。** 移除了旧的 `#running-chapter` 窄屏隐藏规则，390px 下章节选择仍可见可点；书名截断、控件保持至少 44px 高，不与全屏、氛围、菜单按钮重叠。沉浸阅读与阅读工具默认仍然安静（`data-reading-tools="closed"`，面板 `inert`）。

## 真实检查（本机，2026-10-18）

在冻结工作树执行聚焦测试，未跑全套：

```
env TMPDIR=/private/tmp/ai-test-linear-get-161.t2Q3sA node --test \
  tests/reader-controls.test.mjs tests/reader-navigation.test.mjs tests/reader-immersion.test.mjs
# tests 19 / pass 19 / fail 0
git diff --check   # 无输出
```

覆盖内容：

- `tests/reader-controls.test.mjs`：顶部书名/章节入口拆分的标记检查；章节标题无独立控件、`#listen-chapter` 单一 ID 且位于阅读工具面板、文案「听当前章节」；章节入口就绪前禁用、就绪后显示当前章（含自动分段与序言）、点击只开目录；选择章节关闭选择器、焦点回到真正的打开控件、不触碰书籍介绍（连续/翻页两种模式分别验证）；Esc 焦点回归与失效打开者回退；侧栏听读行只响应显式点击，打开/切换章节不触发听读处理函数、`fetch` 计数为 0；`app/reader.js` 不含听读/讲解/讲稿端点，`showChapter` 仅被定义并交给点击处理。
- `tests/reader-navigation.test.mjs`：沿用原有目录与书籍介绍测试，新增当前章节命名（显式章节、自动分段、序言、空章节）与书籍介绍、章节选择共用同一命名。
- `tests/reader-immersion.test.mjs`：沿用原有沉浸测试，新增默认安静检查（面板初始收起且 `inert`、标题无按钮、单一听读入口、章节选择初始禁用）。

## 边界与未核验

- 听读面板、声音设置、已有听读记录、朗读与授权行为未改动，也未做真实音频播放验证；「不隐式生成音频」由代码路径与聚焦测试证明，不等于真实浏览器播放验收。
- `app/styles.css` 与 `app/reader-pagination.css` 之外的样式不在本轮范围：`styles.css` 中旧 `.running-title` 窄屏规则由 `app/reader-navigation.css` 的等优先级规则兜底（含 390px 工具展开时的 44px 高度）；`reader-pagination.css` 里 `body[data-paginated=true] .chapter-heading .listen-chapter` 规则因标题内不再有该按钮而自然失效，保留原文件不动，交由文件属主清理。
- 实际浏览器的 390/768/1440px、夜读、键盘、焦点可见性与音频片段流程由交付方独立验收；本轮没有浏览器检查、没有全套测试、没有提交或发布。

## Dynamic dialog integration

The listening dialog is created after the side toolbar mounts. Its open lifetime must hold the toolbar without revealing a previously closed panel. A body-subtree observer covers later-added, opened, closed and removed native dialogs; the existing 5-second idle timer resumes only after the dialog hold is released.

Parent browser acceptance exercises real chapter loading and native Escape at 390, 768 and 1440px in scroll and spread layouts. The initial implementation lost the listen opener after waiting 5.6 seconds in the dynamically created audio dialog; the mounted-toolbar regression first failed, then passed with the observer fix. All six real-browser cases now return to the listening entry after the same delay, with no audio generation requests, playback source, horizontal overflow or page errors. Current-head CI, production delivery and live verification remain required.

## GET-221: preview and explicit tools

A mouse hover previews the reading card without revealing the header or taking focus. Only the reading button and card keep that preview alive; the adjacent AI entry does not. Leaving both allows a 200ms crossing gap, then a 180ms exit transition. At the close transition the card becomes inert, `aria-hidden=true`, and stops receiving pointer input. Reduced motion removes the transition.

Activating the button or interacting with the card promotes it to explicit tools and reveals navigation. The same state machine owns its five-second idle deadline. Pointer use, keyboard navigation, an active form control, card text selection, and a child dialog with a real opener hold that deadline. Mouse-induced navigation focus alone does not. Audio, manual entry, prompts and drafts declare their actual `aria-controls`, including browsers without dialog `beforetoggle` events; unrelated dialogs do not hold the card.

An outside primary click closes after the complete gesture without cancelling its target. Inside drags, scroll cancellation, right clicks and a gesture that already dismissed a child layer do not also dismiss the parent. Escape unwinds the current child before the tools. Chapter/reader changes and fullscreen transitions close through the coordinator; window suspension releases transient mouse holds and keeps explicit work available. Unmount removes owned listeners and cancels the sole deadline.

The verification record separates local behavior, browser measurements, CI, merge and matching Production acceptance. These rules do not generate models, start the reading clock or change chat drafts and request identities.
