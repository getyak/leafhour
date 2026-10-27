本记录为模型辅助的独立代码审阅，不代表真实外部宿主验收。

# 独立人物 MCP 资源审阅

Merge verdict：Approve。本次限定范围内没有发现需要修复的 Critical 或 Important，也没有阻止合并的兼容性问题。

2026-10-28，审阅 `output/people-mcp-resource-report.md`，并对照已批准版本检查本轮 mcp-http、mcp-oauth、人物保留 ID、相关测试和 Vercel rewrite。没有重审旧 F1/F2/F3，没有修改实现、index 或 HEAD，没有付费调用。

## 已核对的边界

资源隔离正确。`server/mcp-oauth.mjs:27` 明确区分 `/api/mcp` 与 `/api/people/mcp`。请求、授权码和令牌均保存原始精确 resource，交换时核对 audience。`server/mcp-http.mjs:105` 将端点绑定的 authenticate 传入工具服务器，工具内部复查仍使用同一资源。跨端点使用令牌会返回 401。

默认只读保持。人物资源元数据只公布 people 范围，阅读资源元数据只公布原阅读范围。共享授权服务器可以服务两者，但拒绝混用范围。授权页的写入、创建和生成选项默认关闭，不提交这些选项只得到 people:read。旧阅读连接仍默认 content。

回调精确匹配。`server/mcp-oauth.mjs:39` 只新增 literal IPv4/IPv6 loopback 的 HTTP 回调，拒绝 DNS localhost、其他主机、非规范地址、凭据和片段。授权入口与代码交换都逐字核对已注册 URI，因此错误端口或路径无法交换授权码。S256 要求保持。

发现路径已接通。`vercel.json` 将人物专属 well-known 地址映射到 `/api/mcp/people-metadata`，通用 API rewrite 也能到达人物资源本身。官方 SDK 测试从无令牌、无注册信息开始，实际经过 challenge、资源和授权服务器发现、动态注册、PKCE、同意与代码交换。随后 SDK 自动携带令牌连接，旧阅读 SDK 仍提供原来的五项只读工具。

保留 ID 的范围合适。`app/person-model.mjs:21` 只保留人物顶层的 mcp、directory、shares，避免服务路由冲突，没有禁止事件、作品或来源使用这些 ID。

## 本次验证

独立使用 Node v22.22.0 运行九项定向回归，9/9 通过、无跳过。覆盖精确 audience、默认只读、旧注解授权兼容、原生回调拒绝、保留 ID，以及官方 SDK 的完整自动发现授权连接。

SDK 测试使用生产形状的 HTTPS 逻辑地址，通过 fetch proxy 映射到本机 HTTP fixture。IPv4 原生回调实际送达临时 loopback 接收器，IPv6 由独立匹配测试覆盖。这些结果证明了当前代码与已安装 SDK 的接线，不等于已验证生产 TLS 或某个真实外部 Agent 宿主。

## Declined to judge

本轮没有重新执行完整 suite、CI 或 Production 验收，也没有操作真实账号。真实浏览器的人机授权过程、生产网络及第三方宿主仍以根代理后续验收为准。本次批准不改变已有评测分数或 98 分目标的未完成状态。
