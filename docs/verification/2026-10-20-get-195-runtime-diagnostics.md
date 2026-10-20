# GET-195 运行时失败诊断

基线：公开 main `8b317c8`。站内批注真实生成失败，Vercel 原有日志只给出 `setup / OTHER / runtime-failure`，无法据此确定是初始化、模型运行还是清理失败。文件存在标记不证明运行成功，本机供应商余额也不证明线上凭据归属。

修复保留初始化、运行与回答校验的固定阶段；原始错误与关闭运行时、记录费用预留回执、删除临时目录的错误一起保留，任何清理失败仍阻止发布。冻结的 SDK 错误不被修改。诊断遍历 cause 与 AggregateError.errors，最多32个原因节点、每个聚合最多32项、累计32768字符用于本机匹配；循环去重，字段 getter 不被执行。输出只有固定系统代码、信号、SDK错误类型白名单、标准JSON-RPC错误代码与是否达到遍历限制。原始消息、堆栈、stderr、data、正文、用户输入和凭据均不写日志。无法确定阶段时明确记为 unclassified，不再默认声称 setup。

先运行新增回归得到5项失败，再实施修复；独立review另发现包装层仍执行message getter，补充永久反例先失败后修复。最终 `node --test tests/reader-chat-generator.test.mjs tests/chat-runtime.test.mjs` 实际32/32通过，0 skip；覆盖聚合 SDK 原因、私密 sentinel、循环/深层/宽聚合、已撤销Proxy、拒绝执行错误 getter、冻结初始化/运行错误与关闭失败并存，以及成功回答遇到关闭/回执失败仍拒绝发布。独立review的另7个反例也通过，确认无未解决P0/P1，getter问题已关闭。测试使用合成 harness，只建立本机 loopback bridge，没有真实运行时或模型调用。

本机最终源码 `npm run verify:deploy` 完整通过：2523 tests，2522 pass，0 fail，1个既有Linux可选运行时平台skip；打包运行时初始化、正式构建、公开内容检查与发布allowlist全部通过，0模型调用。Linux/AWS运行时验证由当前提交CI另外执行，不能将本机skip写成通过。

实现没有更改界面、语言、来源引用、阅读进度、授权、供应商、模型、生成预算或计费模式。当前提交CI、独立review、合并和同提交Production结果另行记录；本文件的本机验证不是站内生成成功证据，GET-195仍须实际生成、持久化与页面恢复验收。
