# GET-160 · 实现与本机验证

基线：`0a2be888d03e38f43dded37a05f44f17c4cbc5e9`。固定设计和 B1–B11 表见 [设计](../superpowers/specs/2026-10-18-get-160-book-introduction.md)，执行步骤见 [计划](../superpowers/plans/2026-10-18-get-160-book-introduction.md)。本记录区分已观察结果与仍需发布后验证的结果。

## 已观察

- 服务端及共享简介模块 22 项语义测试覆盖原书简介优先、有界原文输入、账号/内容版本隔离、幂等、两个独立 Node 进程争抢租约、替换租约的 nonce 隔离、共享并发与账号配额、模型失败/超时/退出登录/取消晚到，以及干净实例备份恢复。
- 真实 HTTP 测试覆盖 cookie/owner、跨来源拒绝、no-store、源版本及连接断开取消。生成适配器测试固定无工具/历史、1 请求、600 tokens、0.10 CNY、60 秒。
- 控制器测试覆盖仅 GET 读取、显式 POST、重复点击、失败重试、关闭后旧回调、换书隔离；阅读器集成测试覆盖赠书关闭保留未寄出草稿、返回书名焦点以及原文版本变化关闭旧操作。
- 初次源码审结后的全量宿主测试为 1221 passed / 0 failed / 1 skipped；同步主线 GET-164 后为 1254 passed / 0 failed / 1 skipped，共 1255 tests。跳过项是仅 Linux x64 适用的固定 Node license 篡改验证，本机为 macOS；Linux CI 仍须验证，未把跳过记为通过。
- 真实本机浏览器使用一次性的隔离合成书籍：生成中关闭被取消；第二次受控失败显示可重试错误；第三次受控成功保存初稿；刷新恢复，调用次数不增加。生成器是确定性测试适配器，这些结果不证明真实模型可用。
- 390 / 768 / 1440px、长书名、夜读、键盘 Escape 实际检查；390px 页面 scrollWidth=390，简介 clientWidth/scrollWidth=356/356，赠书为372/372。关闭赠书和书籍介绍均返回 `open-book-info`。浏览器视口已恢复。
- 预览前后匿名分享链接仍为 0，明确封好后为 1；下载包保留合成原文，不含私人笔记或账号 AI 简介覆盖层。未寄出草稿关闭后重开仍保留。实际点击收回并确认后，界面显示“这封信已收回”，匿名下载返回 404。没有向外部收信人发送任何信息。
- 初次宿主 Web build 成功，公共资产扫描 207 files / 9 media assets；同步主线后的最终构建为 209 files / 9 media assets。初次发布软件白名单 526 files；隔离官方 Harness runtime 成功构建并初始化 928 files / 9.0 MB，0 模型请求。原有尺寸与发布门禁未放宽。

首轮全量测试发现新模块遗漏发布白名单；补齐显式软件文件后通过。外部 node_modules 软链接使 NFT 将真实文件判为超出 root，导致 SDK 与 PDF 打包验证失败；改用当前任务拥有的 APFS 依赖副本后真实打包验证通过，原共享缓存未修改。浏览器发现父阅读器关闭赠书时误清草稿；先补 RED 测试，再去除该清理，保留 composer 自己的生命周期取消，定向与全量测试通过。

独立 reviewer `/root/get160_review` 首轮核验完整 26 文件快照，发现 0 项 P0/P1、1 项 P2：恢复校验接受全书任意段落，而不是实际开头取样。父任务复现后先得到 2 项失败的回归测试，再将存储/恢复校验限定为 `introductionContext` 的真实结果，包含正文类型排除和字符/编码字节裁剪。非法备份在任何写入前拒绝，`preserveExisting` 不会覆盖已有初稿。另补实际阅读器父组件测试：服务端已验证的初稿在开头章节尚未加载时仍能显示。定向 25/25 通过，随后全量得到上述结果；修复后的独立复核仍须记录。

PR 创建期间主线合入 GET-164（`dd03e456b490fd000cd591afd29f91b7ca592f53`），普通合并时仅服务构造参数及返回对象冲突；同时保留 introduction 和 giftQuote 两条服务。真实 HTTP 追加共存验证，赠书准备引文不会重做简介或公开链接。既有引文准备允许 POST，测试仍严格禁止打开/关闭或旧版本 seal 发布赠书，定向 64/64 通过。实际浏览器检查主线引文、关闭后草稿、390px 无横溢出与返回书名焦点；长书名在小封面内原先纵向越界，已使用封面内裁剪与四行标题修复，实际 DOM 矩形确认标题完全位于封面内。该 CSS 小修另由最终构建与公共资产检查覆盖，未更改主线赠书实现。

## 未完成门禁

独立 Codex review、最终提交/PR 当前 head CI、平台部署、真实已配置模型生成，以及默认 `test@cubxxw.com` 的生产合成书籍/分享撤回验收，仍须分别记录。截图、构建或本机适配器不能替代这些结果。只有全部通过才合并、验收生产并将 GET-160 标为完成。

本机永久证据位于当前任务的 GET-160 issue 记录目录；不将凭据、真实书籍、个人笔记或生产认证会话写入 Git。本记录将在交付时补充实际 PR/部署提交与验收结果。

## 2026-10-18 maintainer review follow-up

The maintainer subsequently requested a deep review, fixes and merge of the repository's open PRs. The earlier pending-review paragraph is a historical checkpoint. This review preserves the separate live-model and default-account acceptance gates; merging code does not mark GET-160 complete.

Review reproduced and fixed these defects before merge:

- EPUB spine sections and PDF outlines use `source-section`; the opening sampler now accepts that source type while retaining front-matter and appendix exclusions. Real EPUB import, generation with an isolated adapter, and clean-instance restore cover the regression.
- Source correction inherited a version-bound introduction from the original book and failed validation. New revisions discard that overlay while preserving the old book, introduction and notes.
- Restore validated introductions against incoming metadata rather than the final retained book. Both restore modes now project and validate the final state before writing, and store that same projection. Regressions cover public books, existing private books, older backups without introductions, and preservation of all prior records on rejection.
- Integration exceeded the existing 320 KiB main-script budget. Gift composition and cover code now load only after explicit sharing; the public arrival registry retains its own allowlisted module URL. The main script is 316,395 bytes; with the 16,343-byte initial registry, initial JavaScript totals 332,738 bytes. CSS is 159,863 bytes. The budget was not increased.
- Hiding the successful generation button could leave focus on the document body. Escape now returns to the book title, and the reader respects that handled event so it does not also close the immersion toolbar.

Each defect was reproduced before its fix. Independent re-review covered restoration, event ordering, lazy loading, close/version fences, the release allowlist and the explicit sealing boundary. Browser checks use disposable local data and a deterministic model adapter; they do not prove live provider availability or production-account sharing.

The final integrated local `npm run verify:deploy` passed: 1,313 tests passed, zero failed and one Linux-only test was skipped on macOS. The isolated runtime initialized without model requests; the hosted build, 212 public assets, nine registered media assets, 539-file release allowlist and source-provenance checks passed. Current-head Linux CI and deployment remain separately observable gates.


## 2026-10-18 cancellation commit race

A second independent Codex review of4007ce0 found no P0/P1 and reproduced one P2: cancellation after the durable CAS was dispatched but before it committed still returned success and persisted the introduction. A regression with the actual HostedStore and a gated synthetic fetcher first failed with “Missing expected rejection”. The store now associates a successful publication with its generation nonce. Cancellation/timeout after completion is checked again, and a compensating mutation discards only that generation's late publication; restore clears the old publication nonce so later cancellation cannot erase a restored draft. Provider execution may already have incurred charges.

Independent re-review closed the P2 and tested conflicts with a concurrent restore and a new-version generation: both retain the newer value after CAS retry. Focused introduction/HTTP/controller tests pass36/36. The subsequent complete verify:deploy passed1,315 tests, zero failures and one Linux-only skip on macOS; isolated runtime, hosted build,212 public assets,9 registered media assets and539-file release allowlist also pass. Production-provider behavior under a real storage outage is not established by the synthetic CAS tests.

The project-only password keychain item is absent (exit44); no fallback credential source was read. Live default-account model/gift/restore acceptance remains open until that required credential is restored. Current-head CI/deployment and merged release are separate delivery gates.
