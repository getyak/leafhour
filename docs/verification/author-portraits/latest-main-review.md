本记录为模型辅助的独立代码审阅，不代表线上验收。

# 最新主分支冲突合并复核

Merge verdict：Approve。限定冲突范围内未发现 Critical、Important 或阻止合并的遗漏。

审阅合并提交 `91f430c30b91fb3a1bc9f525a22708fdc8b4424b`，分别对照父提交 `00e83a4` 与主分支 `8c911af`。只检查本次冲突接线，没有扩大到其他功能，没有修改实现、index 或 HEAD，没有付费调用。

`api/[...path].js` 的路由允许列表同时保留人物 API 与 account observability/config/events。主分支新增的初始化失败观测、enteredPortal 去重与错误返回保持完整。

`server/portal.mjs:215` 的 logout fence、`:229` 的人物实时 session 检查、`:397` 的 authorizePeople 均保留。观测服务创建、requestState、chat_failed outcome、streaming catch 的 queueFault 以及外层 handle wrapper 与主分支一致。导出服务对象同时包含 observability 和人物服务。人物请求上限与观测请求上限分别保留，没有因合并落入通用大请求上限。

人物静态页面、图片和模块映射均保留。`tools/build-reader-web.mjs:454` 的精确延迟入口包含 observability-bridge、person-return-controller 和 reader-companion-loader，各自仍受原调用者和 import kind 限制。没有用宽泛正则替代入口校验。

已比较两个父提交的 release-files 集合，合并结果没有遗漏任一父提交的条目。冲突文件的 diff check 通过。

使用 Node v22.22.0 独立执行九项针对性检查，9/9 通过、无跳过。包括人物实际路由与静态模块、实时授权传递、观测账号隔离和请求上限、初始化及认证前故障、HTTP 200 的失败对话 outcome，以及一次真实阅读器构建。构建测试确认单脚本、延迟完整样式及原有 320 KiB/200 KiB 上限保持。

本次只批准冲突合并的实现结果。完整 suite、CI 和同提交 Production 验收仍由根代理继续执行，不以九项定向检查代替全量验收。
