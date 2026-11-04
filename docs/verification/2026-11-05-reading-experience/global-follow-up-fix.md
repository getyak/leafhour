# 全局会话追问路由修复

全局松鼠会话只恢复书房身份，没有书内 chatContext。追问现在按已恢复的真实会话身份发送；书房会话使用 `/api/library/chat`、`library-chat-v1` 和 `conversation`，书内会话继续使用原书位置。没有有效身份时显示错误，保留草稿。

新增 `FollowUpRoutingTests` 两项回归，覆盖 GlobalChat 的实际 restore／load 路径、父回复引用、双击单次提交、文字与语音草稿保留，以及身份缺失错误。父任务正在统一验证，本轮按要求未运行 Node 或 Swift；仅完成差异检查，不声称新测试已通过。ReaderCloudTools 中父任务尚未提交的准备导览、搜索恢复和点数说明改动按授权一并保留。
