# GET-195 — 外部批注工具与整体验证

本记录对应提交前实现验收，不代表已合并或已发布。正式发布证据另附于关联 PR。

## 范围

官方 MCP SDK stdio 新增 `reader_get_annotations` 和 `reader_add_annotation`，共用 HTTPS JSON 领域服务。仅显式新授权 `annotations` / `annotation:write` 可读写指定书籍；旧授权不扩权。不是远程 OAuth MCP，也不声称已在 ChatGPT 安装。

写入必须携带真实版本、段落、层和精确偏移的 typed quote；服务端固定 external-agent 归属，拒绝伪造 owner、用户消息、时间和运行权限。生成入口与外部写入共用容量、取消、来源变更和授权撤销边界；外部写入不调用站内模型。返回窄回执，读取只含 AI 消息，用户追问、私人笔记和运行权限不进入工具结果。

完整资料和使用限制见 [Reading annotations](../reading-annotations.md)。批量处理仍受 100 线程、20 消息、1 MiB、分页和显式授权限制，不承诺无限全书生成。

## 独立审查修复

- 授权撤销和来源变更确认前，通过同一文档 CAS 强制写栅栏；空文档也阻止先前挂起的写入在确认后落地。当前授权在每次存储重试重新检查。
- 高亮 alias 先解析为 canonical identity，再核对历史回执；来源或高亮后续变化不会破坏同 payload 的历史回执，新写入仍严格校验当前来源。
- 读取参数在放入对象前核对白名单，拒绝 `__proto__` 等未知参数。
- 实际 HostedStore 模拟 JSONB 重排对象字段：精确重试与后续追问成功，变更内容仍 409，没有额外模型调用。比较不再依赖 JSON 字段顺序；有效零偏移先规范化，避免 `-0` 持久化为 `0` 后误冲突。数组顺序仍有意义。

独立 MCP 原定向 34/34 通过，组合反例覆盖来源/高亮删除后的历史回执、待完成生成的容量保留与恢复。父任务整合定向 105/105 通过；最终 signed-zero HostedStore 文件 9/9 通过。最终本机全量 2517 tests：2516 PASS / 0 FAIL / 1 SKIP（macOS 不具备 Linux optional runtime 的既有平台条件），并非跳过失败测试；当前 head 的 Linux CI 仍为合并门禁。独立 JSONB / signed-zero 最终补审 12/12 PASS，M3/P1、M4/P2 均 CLOSED。这些本机结果不代替 CI。

## 实现来源与限制

Pi 实现批次 `20261020-134623-aed26061` 使用冻结的 MiMo Pro 合同。69 回合后，runner 因 setup 创建的 `node_modules` 链接超出 scope 标为 failed；未重置合同或换付费提供方。父任务保存 checkpoint，核实唯一越界路径为该依赖链接，再显式整合源码与未跟踪测试，并独立审查、重新验证。因此没有将 worker 的 failed 状态或其局部测试冒充交付通过。

合成 HTTP/SDK/CAS 测试没有读其他真实账号，也没有调用付费模型。授权过期以授权时刻核对，未宣称跨所有文档的全局事务；已被外部读取的副本不能撤回。跨资源恢复可能在已应用部分后失败，明确保留失败证据。
