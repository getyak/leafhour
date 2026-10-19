# GET-194 workspace：实际 Chromium 本机检查

采集源码：`8204f5cf66e4555e20b6d7dacbac59a9fcc3e98a`；固定 compiled build `build-1792448457875-e78b710a-cee4-457a-bb93-f522514e9815`。使用隔离合成账号、36 段两章夹具、真实应用认证与聊天 UI；未调用产品模型、真实书籍或真实账号。

实际操作：桌面 1440×1000 一次点击 AI；拖动与键盘调整宽度；手机 390×844 保留同一输入节点与草稿；14 次 Tab 保持在对话内；390×400 短视口输入框可见；More 中保留范围及陪读控制。四种界面语言与夜间主题逐一点击并截图，原文 DOM SHA-256 均为 `b1a9f067d24adbb874ddf1e0b5dadfc40f7b8828bdf5b2e7c548022490a70662`。手机关闭后焦点回到 AI 按钮；Home 后真实 `Shift+ArrowLeft` 得到 384px。

本机消息区：390×844 时约 577px，原基线约 114px。这里只证明所列 Chromium 操作；短视口不是物理键盘，未宣称真实 IME、辅助技术或 Production 验收。缺失夹具接口产生两条已知控制台错误，不能声称零错误。此前错误使用 select 定位增强后的语言按钮导致一次测试脚本超时，修正定位后四语言检查通过。

结束回执：snapshotUnchanged、sourceUnchanged、compiledUnchanged、portClosed 均 true；rejectedExperienceCalls=0，syntheticChatCalls=[]。截图全部逐张人工查看。采集后的三处独立 review 修复仍需另行复核，完整引用功能、CI、merge、Production 尚未完成。
