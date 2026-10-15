# 个人记录与阅读包契约

## 原则

书籍、译文和个人记录各自版本化。用户评论保存真实原话与修改时间，AI 回答另有作者信息和引用。公开分享与私人备份不是同一种操作。原文版本变化不能覆盖个人数据。

正式服务以 Book、Chapter、Passage、UserComment、QuestionThread、ReadingSession、AgentGrant 为独立对象。UserComment 带 owner、创建修改时间和稳定锚点；QuestionThread 保存用户消息与 AI 消息各自的来源。ReadingSession 保存口径，AgentGrant 保存书籍范围、数据类型、到期/撤回状态。授权和密钥不进入内容导出。

## 当前交互小样

当前小样使用 `marginalia-personal-records/v1` 的 JSON 包，只处理现有样本的个人记录，不是完整书房备份。文件包含 `kind`、`schemaVersion`、`bookId`、`contentVersion`、`comments`、`questions` 和 `readingSessions`。

评论与问题包含稳定 ID、书籍和段落 ID、内容版本、文本、创建时间与 `origin: user`。问题带 `status: open`。AI 回答是固定旁注示例，不冒充已经解决的问题，不混入用户评论。

时段包含开始结束时间、秒数和 `source: design_preview_focus_timer`，只代表小样中用户启动的专注计时。实例恢复后不能把这些数据误升格为正式应用验证过的活跃阅读或掌握记录。

导入只接受对应书籍与内容版本的记录包，校验段落 ID、文本、时间与数据类型；失败不写入一半的数据。重复 ID 幂等合并，正常导入不覆盖已存在的用户记录。

## 正式迁移验收

PI 实现时新增完整书房 ZIP 与清楚的 manifest 版本；如变更字段，升级 schema 并提供转换，不将原小样包静默当成生产包。备份须在干净实例恢复书籍、译文、个人记录、引用与进度，检查源文件是否按用户选择纳入。
