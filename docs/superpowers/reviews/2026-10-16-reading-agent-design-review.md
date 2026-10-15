# 阅读 Agent 设计独立审阅

2026-10-16。结论：产品方向通过；以下 1—4 项在实现前补入契约，5—6 项作为实施验收门槛。无需追加用户批准。未修改产品代码。

已检查设计、计划、AGENTS.md、项目七份前置 brief、现有聊天领域服务和 UI、回声生成器与插件，以及本机官方 SDK/provider 源码。这里只判断可实施性，不宣称已完成真实运行验收。

## 1. 阻塞：搜索预算回调必须同步，而且搜索有额外模型请求

依据：Spec「服务端执行与来源」第 56 行；Plan Task 1 的 `recordRequest`；`node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js` 的 `search()`。

Provider 使用独立 native fetch，不经过 `ctx.llm`；搜索本身额外发一次模型请求。`options.recordRequest?.(...)` 未被 await，随后马上 fetch。若实现者把异步 bridge 预算函数直接传给它，拒绝预算也阻止不了请求。默认搜索输出 4096 tokens、max_uses=5，与设计中的 3072 输出上限不同；映射结果不保留响应 usage，不能假设有真实结算数据。

修订：search provider 在父进程执行，recordRequest 同步调用同一内存账本的 reserve 并同步抛错；子进程主模型在 `llm/stream` 中 await 固定 bridge reserve 路由。显式设置搜索 maxTokens 和 maxUses（建议初始 1024/1），将该完整 body 的保守 input 与输出上限预留计费。记录 reservation-not-invoice，不以未知 usage 退款。官方服务器搜索工具是否另收调用费须通过供应商费用依据确定；若没有可确认价格，不声称 0.10 是完整真实账单上限。至少测试同步拒绝时 fetch 调用数为零、主模型与搜索并发争用同一余额。

## 2. 阻塞：0.10 元与自由跨章读取的实际容量不匹配

依据：Spec 第 27、38、56 行；`harness/pricing.json` 的输入 2 元/M、输出 8 元/M；`harness/reader-plugin.mjs` 现有按 JSON 字节估算的保守预留。

按继承的算法，24 KiB 历史加一页 24 KiB 工具返回，下一请求仅输入预留约 0.0983 元，加 3072 输出预留 0.0246 元，单次已经超过整轮 0.10。即使较短历史，连续读取两个章节再回答也容易失败；8 次请求只是名义许可。不得沿用旧 24KiB 全请求拒绝规则，否则新工具的一页加 schema 即超限。

修订：明确区分历史、单工具结果、累计请求容量，累计请求建议单独设 64 KiB 可配置上限。默认工具页用较小目标量（例如 6–8 KiB），24 KiB 仅硬上限；历史优先裁掉旧完整轮次，保留本次问题和已经读取的必要证据。建议单轮预留上限提高至可配置 0.50 元（仍保留全站限流），按剩余预算降低输出 maxTokens，并在耗尽前为最终回答留额度。该数值是工程建议，不是已验证账单。用真实请求尺寸验收“读两章并比较”“搜索再读章节再引用”“外部搜索再回答”，至少三次主模型循环可完成；达不到就调整默认页大小或预算，不能牺牲核心体验仅让测试问候通过。

## 3. 阻塞：超长段续读缺少可调用的完整 schema

依据：Spec 表格第 38 行只有段落 offset/limit，第 46 行另要求字符 offset；第 35 行 context 没有续读字段；第 50 行引用要求缓存可见文本。

一个段落原文短而译文很长时，现有参数不能表达继续哪一层、哪一个字符，容易反复读第一页或跳过剩余正文。仅缓存完整段落哈希也不足以证明引用真的已向模型展示。

修订：在 `reader_read_chapter` 明确加入 passageId/charOffset/layer 或一个等效不透明 cursor，返回 nextCursor、实际可见范围、各层状态、truncated；context 超长时返回首片及同一个续读指针。以 UTF-8 字节截断但保持有效字符，游标单位需固定。仅登记真正返回的各层可见片段，引用必须为其中一个片段或连续已读片段的精确子串。测试长中文/emoji、空译文、单独超长意译、重复翻页和尾部精确引用。

## 4. 阻塞：引用真实性的承诺须明确到 UI 与自由回答的边界

依据：Spec 第 19、25、42、50 行。

可选 reader_cite 能保证登记来源正确，但 finalResponse 是自由文本，模型仍能直接输出未登记的书内链接或引文。不能宣称整段自由回答已经过来源真实性核验。跨书历史还会保存旧引用，当前轮未读不能直接当成新证据。

修订：保持 cite 可选，不恢复强制引用流程。只将登记且复核通过的 sourceRefs 呈现为可核验来源；Markdown 内书内定位链接须匹配本轮已验证来源（不匹配时保留文字，或仅作为未验证导航链接明确区分）。外部网址只标为普通外链，不冒充检索证据。历史回答及其引用明确是历史上下文，需重新读取后才登记本轮引用。测试模型在 finalResponse 自写错误 bookId/passageId 不会得到“已核验来源”待遇。verify 只重新检查访问过/引用过的书，避免全书房扫描和无关书改动让问候失败。

## 5. 实施门槛：SDK 原生 finalResponse 可用，但不能误当已成功完整回答

依据：Spec 第 25、52 行；`node_modules/@deepseek-ai/dsh-sdk-client/README.md` 第 50、86 行。

官方 README 明示 finalResponse 是活动区间中最后一条已提交 root assistant 文本，不保证因果对应单一输入；模型失败也可能只呈现在 events 中。新建每轮独立 session/run 且禁 steering 能解决交错，不需自建发布器。SDK run 接收 text/content blocks，并不直接接收角色 message 数组。

修订：每轮使用独立 sessionId，不加入额外输入/调度；拒绝空 finalResponse，检查事件中的错误或预算中断，不能把工具前的“我先看看”当最终完成。历史以结构化带 role 的资料序列编码进输入，或明确使用官方支持的历史注入接口，勿把 messages 数组传入 run 假装兼容。添加问候无工具、多工具 finalResponse、只有中间 assistant 文本随后错误、运行间隔离测试。系统提示保持目前的简短自然版本。

## 6. 实施门槛：真实进度需要处理首次 GET 比 POST 落盘早的竞态

依据：Spec 第 17、62 行；`app/library-chat.mjs` 的 send/schedulePoll/load；`server/reader-chat.mjs` 的 claim、finish、watchRun。

立刻轮询是正确方向，但第一份 GET 可能尚无新 turn；当前已有 load/send/cancel 状态票据，必须确保没有 turn 不等于失败或解除 pending。活动更新必须检查租约过期，不能仅核对 running 字符串。原 UI 第 12 次停止自动轮询，总时长可能少于 90 秒租约，真实进度会提前静止。

修订：pending POST 期间保留本地 turn，GET 缺行不终结；只允许同 owner/book/turn/run 的单调状态推进。保留租约内轮询，停止/完成后忽略迟到 POST 与 activity。重开浮层重新读取 shared state。activity 记成功完成的不同 bookId+chapterId，失败读取不计入“查阅了 2 章”。测试首次 GET 先于 claim、取消后迟到 POST、另一实例取消、浮层关闭重开和 60–90 秒任务。

## 范围判断

八个只读工具与独立 chat generator 足够，没有必要新增通用 Agent 框架、任务队列或二次候选/复核发布流程。HTTP bridge 是现有官方子进程与父进程领域服务之间的必要边界，建议固定两类路由（工具调用、模型预算），不再引入会话协议层。自然聊天、无强制引用、无固定字数方向符合用户要求；修订集中在可执行契约、真实来源和运行预算，不应写回人格限制。

控制者处置：六项建议全部采纳并写入设计契约。独立审阅阶段结束，开始按计划实施。
