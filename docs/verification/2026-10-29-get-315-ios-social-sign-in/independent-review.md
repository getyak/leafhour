# GET-315 独立安全与正确性审查

结论：在当前工作树的限定范围内，未确认需要修复的 P0/P1/P2 缺陷。可以继续完成作者测试和交付门禁；这不等于真实提供商与线上配置验收通过。

审查范围：deploy/hosted-native-auth.mjs、hosted-auth 接线、server/portal 原生/既有 Web OAuth 路由，Swift NativeOAuth、CloudLibraryClient、NativeProviderAuthentication、LibraryModel、AccountScreen、LibraryScreen、Info.plist、相关测试、release-files 与 Vercel API 打包路由。

重点核对结果：
- 原生发起凭据与服务端 PKCE 分离；一次性 launch、callback、handoff 的状态变更有原子占用及取消标记，handoff 同时绑定 state 和客户端 verifier。
- 外部授权地址限定 Google/Apple 的 HTTPS 主机与具体授权路径；回调固定，公开错误映射不返回提供商诊断或 token。原生只接收严格回调结构，LibraryScreen 不把非文件 URL 当导入。
- 显式绑定绑定原 opaque session、owner ID、主邮箱；完成时重新读取身份、确认 provider 与已验证主邮箱，保留原 access/refresh 凭据。不同 UID 即使邮箱相同也拒绝；不自行合并账号。
- Swift 在异步完成后核对操作、账号、generation、父 token，然后才持久化和采用凭据。绑定路径保留原书房、阅读器与草稿，取消/超时/晚到回调有明确终止路径。
- 原有 Web callback 分支保留；新模块被发布清单及 deploy/** 打包规则覆盖，API 通配路由覆盖新增入口。

证据边界：本次仅静态审查代码及测试内容，没有运行构建、测试、真实 Google/Apple 授权、修改配置或读取真实账号内容。作者汇报的测试结果仍应以其最终提交上的正式证据为准。

线上待验收：当前 Vercel 凭据对账户/团队/项目查询均返回 403，插件团队列表为空；未取得可核对叶时域名及 getyak/leafhour 仓库归属的项目配置，因此没有读取环境变量、登录默认测试账号或调用真实手动绑定入口。Supabase manual linking 是否启用及真实 Google/Apple 同账号回流仍未知，应明确保留为上线验收项。
