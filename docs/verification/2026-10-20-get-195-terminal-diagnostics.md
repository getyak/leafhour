# GET-195 回答终止原因诊断

基线为公开 main `7706009`。该版本正式发布后，真实站内批注请求仍失败，日志已明确为 `publish / Error / runtime-failure`，不能再归因为初始化失败；运行返回也不代表回答通过校验。本次修复让原有回答拒绝条件保留 SDK 的固定终止事实，不改变接受条件或重试模型。

依据当前锁定 SDK 的 TurnEndReasonMap 与 LlmFailure 类型，只保留回答校验类别、已知终止 kind、固定 code 白名单及100–599整数status。原始消息、requestId、响应内容与额外字段既不被复制，也不写日志。提取器仅从末尾检查最多2048项，以最近的非 completed 终止优先，防止后来 completed 掩盖此前失败；工厂再次过滤后输出 `response-validation`。这只是新增提取器的边界，原有 completed 验证器的数组扫描没有改写。

新增回归先失败后修复：真实 QUOTA/402 形状只输出固定事实；未知字段不泄露；此前 AUTH/401 错误不被随后 completed 隐藏。仓库针对性测试35/35通过。独立 sub-agent 另加6例，共41/41通过、0skip，无未解决P0/P1；覆盖敏感getter零执行、伪造诊断二次过滤、最大稀疏数组的2048项边界、正常回答及单次运行。独立审查绑定本补丁三个源码文件的SHA256；报告摘要SHA256为 `b9ff2cbfdc725efa048fb1a5af259e8be722243de99fb1b197e4ed78854dbf4f`。

本机 `npm run verify:deploy` 退出0：2526 tests，2525 pass，0 fail，1个既有Linux可选平台skip；隔离运行时初始化、正式构建、公开内容及发布allowlist检查通过，无模型请求。当前提交Linux CI另行运行，不能将本机skip算作通过。

本次没有修改界面、语言、引用、阅读记录、账号授权、供应商、模型或预算。合成 QUOTA/402 不是线上根因证据。本补丁仍须当前提交CI、正常合并及同提交Production，随后使用一次有界真实请求核对结果；GET-195在站内生成、持久化及页面恢复验收完成前保持进行中。

## 额度恢复后的正式验收

2026-10-20，用户确认额度恢复后，先通过 DeepSeek 官方只读余额接口确认当前配置可用，再对已有失败线程进行一次有界站内重试。Production 仍为 `0d2ebb310d8af3fc4b94885b37fa089ae929f01b`，原 QUOTA/402 回执保留。该次真实生成约10.5秒完成，读回1条单独标识为站内 Agent 的 AI 消息；没有补写用户问题或运行全书翻译。

真实 Chrome 使用默认协议协商直连，确认批注显示、刷新后正文一致、390×844 手机批注卡与追问框可见、关闭与输入中心可命中，无横向溢出和 pageerror。只读浏览器复核封锁额外模型、陪读与阅读进度写入；账号验收上下文和浏览器均已关闭。此结果独立于早前 HTTP/1 诊断。运行内容、身份、密钥及截图私密保留，不作为公开源码数据。

- 最新 PR [#142](https://github.com/getyak/leafhour/pull/142) 已读回 MERGED；同提交 main [CI](https://github.com/getyak/leafhour/actions/runs/39404262957) 与 [Production](https://github.com/getyak/leafhour/actions/runs/39404618359) 均成功，最终线上 `release.json` 读回该提交。
- 正式生成与持久化回执 SHA-256：`91da0d815bc3151b868701ab5661d5b29de3ce58ef8443f7d64afddb552a312c`。
- 最终手机浏览器回执 SHA-256：`b6c513bf840512b26c713b2bd2f8bd507819331c4f76026e3bf4433dae997e81`。
- 此前 Production 正式 MCP SDK 已验证外部 AI 写入与精确重放、来源区分、JSON 导出、撤销按书授权后拒绝访问；后续诊断提交未改变该权限与领域服务。

GET-195 已在全部必要验收后改为 Done，并读回完成状态。该结论不代表 GET-198 或其他尚在开发的功能已发布。
