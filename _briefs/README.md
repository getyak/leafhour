# 设计交接目录

设计与证据后，用户已启动全书候选生成；七章双译初稿与完整阅读包已在本机保存。随后按用户要求建立专注阅读服务，本机持久记录与按需浮层已实现；完整平台仍待后续，全文逐段复核尚未完成。最新界面与服务见 `focus-reader.md`，全文执行范围见 `full-book-execution.md`。

`project-operations.md` 保存 GitHub、Notion 和 Linear 的项目入口与协作约定；`project-operations.json` 提供对应 ID 和地址。执行状态以 Linear 为准。

`product-brief.md` 是用户最新方向；`reader-demo.md` 是视觉设计；`private-library-architecture.md` 是最新模块与存储方案，`architecture.md` 只保留初版历史。`data-ownership.md` 约束私有化、导出与分享，`mcp-contract.md` 描述 Agent 接入。`content-contract.md` 保留翻译规则，`pi-handoff.md` 区分后续执行阶段。

`preview.html` 是可以点按的设计小样。评论与问题可在小样中输入，回答是固定示例；正式数据库、完整书籍解析、在线翻译、MCP 和推送均未实现。文件选择不能当成完成 PDF/EPUB 导入。

`examples/chapter-sample.json` 与对应 schema 给出四段原文、候选译文及注解的最小格式。schema 属于设计示例；生产流程新增译者、模型与复核元数据时，须明确更新 schema 与版本，不可直接写入不被允许的字段。

`personal-data-contract.md` 区分当前小样记录包与未来的完整书房备份。`room-ui.html` 和 `room-interactions.js` 是本轮交互草图的组成部分，正式实现应按领域服务与数据契约重建。

`research/findings.md` 解释设计依据，`research/posts.md` 列出 49 条核读记录及读取范围。搜索卡片、作者推广与独立体验分别判断。

用户提出新条件后，更新这些文档与验收，再下发对应实现。这里的候选译文与设计判断都不代表本人已复核。
