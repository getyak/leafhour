# GET-209 补充工具的执行守卫与离线验证

2026-10-27。本次仅修复工具和证据表述，没有调用 OCR、真实模型、上传、登录、供应商查询或
新增计费。原 [历史回执](2026-10-27-get209-live-ab.md) 中的 8 页/4 次/¥0 是先前操作员报告；
其 `fixtures/get209-live-ab-2026-10-27/` 内原始 intent、report、PNG 保持不变。

## 一次实验的持久状态

1. `--generate` 只接受工具内三个合成 CC0 样本，不接受私人书籍。新目录的 v2 intent 冻结逐页
   参考、PDF 字节摘要、最多 12 页预算、模型/SDK/选项/批次，以及工具、编排、依赖锁文件摘要。
   这是哈希绑定的本地意图，不是数字签名，也不替代本轮运行的人工授权或费用凭据。
2. `--run` 在读取 token、构造 provider 或发出 probe 前检查既有 `report.json`/`attempt.json`，
   核对全部 intent，随后通过 `wx`、文件及父目录 `fsync` 独占创建 `attempt.json`。
   同目录并发只有一个调用能取得 claim。即使 claim 仅写了一部分或进程崩溃，也不会自动清除。
3. 每次 submit 前，按 sample×mode 独占、同步保存 `submission-*.json`，包含原 batchId、
   原件/实际批次摘要、页数和 `outcome: unknown`。已确认提交另存 `acknowledged-*.json`；
   不覆盖原 reservation，不释放已用预算，不允许同一路径换 requestId 重发。总预留不超过 12 页。
4. 响应丢失、落盘失败或崩溃保留 claim 与已有 reservation。未知提交阻止后续新提交；工具不自动
   重放整个实验，也不把 0 acknowledged 写成 0 attempts/0 side effects。报告保留 reserved/
   acknowledged/unknown 分项，不完整运行的 `recognizedPages` 为 `null`。账单与费用始终独立，
   新报告的 `billingVerified: false`、`actualCost: null` 不能由 token probe 推导成 ¥0。
5. 每条路径完成时即保存 `route-*.json`，保留完整 synthetic `extractedPages`，并提供 raw 文本/
   几何投影及原 blob 摘要。投影有意不包含 provider 传输元数据或签名下载 URL，不冒充完整 raw
   payload。最终报告也包含这些文本，可从冻结参考离线重算 CER；旧实验丢失的全文不能补造。

出现未知状态时，保留整个目录和原 intent，先检查 reservation 的原 requestId；任何供应商对账或
恢复查询都需另外授权。不要删 marker、复制旧 intent 到另一目录来重试，或重新生成 intent 冒充
原预算尚未使用。需要另一场真实实验时，重新核定授权与费用上限并创建新的目录。

旧 v1 intent 明确拒绝。新版文字层样本使用字宽换行与可见边界校验：两栏分别位于 x=40/322、
宽 238pt；每行和脚注递减基线，正文与脚注保留间隔。扫描文字同样按实测宽度换行。layoutVersion 2
会生成新的 PDF 字节，不能把新排版或其离线通过归入旧哈希、旧 CER 或旧 provider 运行。

## 验证与证据范围

```sh
node --test tests/pdf-live-guard.test.mjs tests/pdf-live-evaluation.test.mjs \
  tests/pdf-ingestion-eval.test.mjs tests/book-ingestion.test.mjs \
  tests/pdf-native.test.mjs tests/paddleocr.test.mjs
```

新的测试使用真实文件 claim/reservation、真实 PDF 页数和真实 ingestion 编排，只有外部 provider/
token 为明确的合成实现；相关测试把网络设为禁止。覆盖已有报告、并发、部分 claim、intent/预算/
代码漂移、12 页上限、响应丢失、不可重放、完整 hypothesis、安全 raw 投影、CER 顺序反例，以及
旧双栏参考和三行脚注的几何边界。

本机 Node v22.23.2 执行上述六个测试文件：**52 pass、0 fail、0 skip**，其中新测试 17 项。
修复前的精确旧函数离线红例为 3/3 失败：已有报告仍 submit 4 次、并发 submit 8 次、未知响应缺少
attempted 页数。外部正式审计目录保留 `get209-repair-red.test.cjs`、`get209-repair-red.log` 和
`get209-repair-offline-green.log`。没有运行完整测试套件、全构建或真实 A/B。

CER 是全文序列编辑距离/参考字符数，包含顺序变化；逆序对只在整块精确命中子集上另计。单块
未命中不能直接当作整段丢失；`expectedBelongsTo` 是人工参考，`semanticOwnershipVerified: false`
明确表示没有验证脚注语义归属。

本机离线验证不等于补充 PR CI、真实 A/B、生产发布或真实书籍验收。产品网页保持 `auto` 默认。
