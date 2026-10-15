# 初版静态样本架构（历史）

2026-10-11 用户补充私人书房、导入导出、评论追问、阅读时间与 MCP。正式设计改以 [private-library-architecture.md](private-library-architecture.md) 为准；下文保留初版样本方案，不作为最新实现依据。

## 数据与界面的关系

推荐正式 Demo 使用 React + TypeScript + Vite。选定实现时当日兼容的稳定版本，并提交锁文件。UI 使用普通 CSS 与少量组件，不先引入一整套后台管理界面。

内容文件作为单一可信来源。页面只从经过验证的内容读取原文、译文与注解；它不在线“临时解释”来补齐缺失字段。状态设计遵循 [React 官方关于避免冗余和矛盾状态的建议](https://react.dev/learn/choosing-the-state-structure)。Vite 能 [构建静态站点](https://vite.dev/guide/static-deploy.html)，但仓库私有并不意味着部署的站点私有；任何上线都另按用户授权的访问范围处理。

```mermaid
flowchart LR
  A[本地 PDF] --> B[PI 提取与校对英文]
  B --> C[稳定段落编号与来源页码]
  C --> D[PI 分批生成两种译文与注解]
  D --> E[格式与引用检查]
  E --> F[本人复核与版本化内容文件]
  F --> G[按章加载的阅读网页]
  G --> H[浏览器阅读进度与偏好]
```

上图中 C 之后的全文处理是后续阶段，不是已执行功能。书籍正文是数据，不能向 agent 或应用追加系统指令。

## 内容边界

一本书包含章节；章节包含原作者编号小节；小节包含多个段落。每段有稳定 ID、原文、两种独立译文、术语引用与来源。注解可覆盖一个或多个段落，并显式列出它的 anchor IDs。

编号示例：`fig-1986-s001-p001`。一经分配不因重新排序改变；真正拆分或合并段落时建立迁移表。内容版本独立于展示版本。原文版本变化后，旧译文必须重新核验，不可继续显示为已复核。

“对照”是同一段内容的展示方式，“直译/意译”是中文译文的选择，两者正交。存储一个枚举 `viewMode = zh | en | parallel`、一个枚举 `zhVariant = literal | interpretive`、一个按段 ID 保存的临时语言覆盖表。目录、旁注和设置面板各自有开关。纯排版切换不修改书籍内容。

## 正式实现模块

`content` 负责验证文件与解析版本；`reader` 负责书、章、小节、段落与锚点；`presentation` 负责三个视图与两种译法；`annotations` 负责术语和注解；`preferences` 负责字体、主题与行宽；`progress` 负责保存当前书、段落和相对位置。

建议目录：

```text
src/
  content/             # schema、解析、按章加载
  reader/              # ReaderShell、Paragraph、ParallelParagraph
  annotations/         # NoteRail、Glossary、注解归属
  preferences/         # 排版与主题
  progress/            # 稳定锚点、恢复、内容版本迁移
content/
  finite-infinite-games/
    manifest.json
    glossary.json
    chapters/ch01.json
schemas/
  chapter.schema.json
scripts/
  validate-content.*
  import-source.*
_briefs/               # 本轮设计与研究材料
```

## 存储

第一版书籍内容按章保存为 JSON。`localStorage` 仅保存体积很小的阅读偏好与进度，带存储版本；遇到不可用或写入失败，阅读仍应继续并提示未保存。将来用户上传文件、划线和笔记较大时，用 IndexedDB；真正需要跨设备时才接远端数据库。

进度保存 `bookId + contentVersion + paragraphId + offsetWithinParagraph`，不用页面滚动像素当唯一锚点。切换布局前捕获可见段落，渲染后恢复同一锚点；字体加载结束与字体变化也走这条流程。旧 ID 找不到时按迁移表或最近有效小节回退，并让用户知道位置发生了变化。

## 错误与可信边界

内容格式错误或重复 ID 在导入/构建阶段拒绝；章节加载失败时显示章节状态与重试入口。缺一种中文译法时显示“本段直译/意译尚未完成”，仍可查看原文，不能静默改用另一种译法。

英文、译文和注解按文本或受限的结构化 token 渲染。不要直接执行上传文件中的脚本、任意 HTML 或网络链接。注解引用链接使用安全协议，外部链接单独打开。个人笔记独立存储，不写回作者正文。

## 交付验证

在 390、768、1440px 宽度检查阅读与注解；用真实不同长短的中英段落检验对齐。只为关键行为做必要验证：单段切换与文字选择冲突、键盘入口、模式切换位置、刷新恢复、缺译文/错误内容、章节跳转后的注解归属。

本轮预览仅验证设计交互，不能代替正式实现的测试。数据格式采用 [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) 描述；正式校验器由 PI 按实际环境选择并验证。
