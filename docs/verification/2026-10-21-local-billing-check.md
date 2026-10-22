# 2026-10-21 本地收费链路验证

用户要求本地启动并验证免费额度、充值和订阅的完整通路。本次使用 Node.js 22.22.0。结论：隔离应用路由的串联验证和收费回归通过，构建通过；本地 HTTP 服务未启动，真实 Creem 测试支付、真实账号登录和数据库迁移尚未验收。

## 本次实际结果

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| `npm start`，端口 8330 | 失败：`listen EPERM: operation not permitted 127.0.0.1:8330` | 使用临时实例目录和公版书回退；无法进行浏览器验收。 |
| 收费回归，22 个测试文件 | 220 通过，0 失败，0 跳过 | 包含实际 Portal 路由、领域服务、账本参考实现、适配器、前端状态和构建边界；外部供应商为测试替身。 |
| 登录及会话相关，6 个测试文件 | 71 通过，1 失败 | 失败项为 HTTP Cookie 竞态测试，同样在监听本地端口时遇到 `EPERM`。真实 Supabase 登录未执行。 |
| PostgreSQL 适配器及迁移，2 个测试文件 | 9 通过，1 失败，1 跳过 | 两个实际 SQL 执行用例均未执行成功：`initdb` 的 `shmget` 分配失败，报 `No space left on device`。内核状态查询也被拒绝，尚不能确定宿主机共享内存的真实限额或占用；这不是磁盘空间不足的证明。 |
| `npm run build:vercel` | 通过，退出码 0 | 只生成本机构建，没有部署。 |
| Creem 测试 API 连通性 | 失败 | 当前执行环境连接既有代理 `127.0.0.1:7897` 返回 `connect EPERM`，请求未到达 Creem；尚不能判断代理是否正常运行或 API Key 是否有效。 |
| 本地 `.env` | 测试 Key 已存在，`CREEM_MODE=test`，权限 `0600`，被 Git 忽略 | 仅确认配置存在及测试 Key 格式，未验证供应商鉴权。 |

## 可重复执行的串联验证

新增 `tests/billing-walkthrough.test.mjs`，通过实际 Portal 和 Hosted Auth 实现串联整个应用流程。该用例使用临时文件目录、合成账号及书籍、模拟 Supabase HTTP 边界、模拟 Creem HTTP 边界、模拟翻译器；不用真实 `.env`、真实密码、真实账单或模型接口，也不监听端口。结束后清理临时书籍和账本。

```sh
node --test tests/billing-walkthrough.test.mjs
```

验证的 15 个节点：

1. 密码登录、服务端会话及匿名访问拦截。
2. 第一次显式翻译请求领取一次 10 点试用；账户 GET 不发放点数。
3. 10 次新翻译耗尽试用，累计仅调用模拟翻译器 10 次。
4. 下一次生成返回 402，翻译器调用数不变。
5. 余额为零时读取已有译文仍免费。
6. 定价、条款、退款页面可匿名读取。
7. 创建充值结账链接时不发点。
8. 签名支付通知发放 100 点，重复通知不重复入账。
9. 充值后可再次翻译，扣除 1 点，余额为 99 点。
10. 月订阅首次支付的结账通知及付费通知共享同一次发点，余额为 199 点。
11. 次月成功付费再到账 100 点，重复通知不重复发点，余额为 299 点。
12. 客户门户按当前账号的订阅解析；取消订阅通知保留已有点数。
13. 管理统计显示合成交易 3 笔，其中月付 2 笔、一次充值 1 笔；合成税前销售 US$15、消费 11 点、模拟模型调用 11 次。
14. 重新打开本地账本参考实现后仍保留 299 点；这不等同于 PostgreSQL 持久化验收。
15. 注销后匿名请求返回 401，带旧账号标识的请求返回 409。

以上金额和调用次数均为隔离测试断言，不是商户销售、真实用户消费或真实供应商用量。

## 拒绝原因的追加诊断

用户随后要求检查为何被拒绝。独立于应用重新执行最小 Node 网络探针，得到：

- 当前进程明确设置 `CODEX_SANDBOX_NETWORK_DISABLED=1`；本会话的执行权限为网络受限的托管沙箱。
- 不导入 Leafhour、不读取 `.env` 的 `net.createServer().listen(8330, '127.0.0.1')` 同样返回 `listen EPERM`。应用尚未处理任何登录或支付请求；错误也不是端口占用通常对应的 `EADDRINUSE`。
- 对既有代理 `127.0.0.1:7897` 的最小 TCP 连接返回 `connect EPERM`。这证明当前进程的连接操作被拒绝，不能据此断言宿主机代理没有启动。此前将此概括为“代理故障”过于确定，现予更正。
- `sysctl kern.sysv.*` 和 `ipcs -m` 的查询也返回 `Operation not permitted`。PostgreSQL 日志只能确认 56 字节的 SysV 共享内存分配失败，无法在当前权限下进一步核实限额和占用。`df -h /tmp` 显示所在卷仍有约 55 GiB 可用空间。

主因是当前 Agent 执行环境的网络权限。未观察到 Creem 返回的鉴权、商户审核或支付拒绝响应，也没有修改系统网络、代理或内核配置。

## 真实通路尚缺的条件

本地配置检查 `node tools/configure-billing.mjs --check` 返回未准备好：两个商品 ID、Webhook 签名密钥和网站来源尚未配置，收费开关仍为关闭。真实云端账号及持久化联调所需的 Supabase 地址和服务端配置也不在当前本地环境中；这不能推断线上部署是否已有配置。

真实验收仍需：在允许本地监听及访问既有代理的执行环境中重试、补齐测试商品与回调配置、验证隔离 SQL 迁移，再通过实际账号完成 Creem 测试付款及供应商签名回调。只有本地模拟通过，不能宣称测试支付或正式收费已经跑通。

本次没有变更真实账号、迁移线上数据库、发送收费模型请求、创建真实客户订阅或启用正式计费。现有本地密钥不写入此记录或 Git。


## 2026-10-22 recovery continuation

The earlier environment/delivery limitations above are historical. The local source was integrated on current public main, independently reviewed and corrected. Native SQL and concurrency checks now execute, fixed build budgets are retained, and actual local browser checks cover the public home/menu and disabled billing. Hosted schema, payment fulfillment and billing activation remain separate gates. See [current recovery evidence](2026-10-22-local-git-recovery.md).
