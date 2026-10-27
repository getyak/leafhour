# 数据库与默认测试书房

更新日期：2026-10-15。本文描述当前代码与真实数据库检查结果。早期设计中的 SQLite 尚未用于当前托管服务；现在是 Node 领域服务、Supabase PostgreSQL、私人对象存储和本机 JSON 文件。

## 默认归属

后续持久测试数据统一使用 `test@cubxxw.com`。邮箱是操作入口，实际隔离依据是 Supabase Auth 的用户 ID，不能把邮箱或固定的 `owner` 当成新书房的用户 ID。

密码只保存在 macOS 登录钥匙串：service 为 `com.cubxxw.agents.default-data-workspace`，account 为 `test@cubxxw.com`。运维程序在运行时读取，不能将值插入命令、源码、日志或备份。服务端数据库凭据沿用受保护配置，不能交给浏览器。

这个约定适用于需要留下的书籍、资源和联调验收数据。单元测试仍在临时目录运行，避免污染真实书房。32 本默认书继续匿名共享；它们的个人译文、笔记和阅读进度归各自账号。其他真实账号已有记录保持原归属。

托管版网页默认使用邮箱与密码登录，同时保留邮箱验证码、Google 和 Apple。新建书房和找回密码先验证邮箱，再设置密码。仅配置 SMTP 的本机实例继续使用验证码与本机书房。运维生成验证码验证接口，不能记成邮箱实际收信。

## 三张业务表

| 表 | 字段与主键 | 当前作用 |
| --- | --- | --- |
| `reader_books` | `book_id` 主键；`content_version`；`payload`、`experience_pack`、`experience_metrics` 为 JSON；`updated_at` | 旧单书存档，不是当前账号书架 |
| `reader_states` | `owner_id + book_id` 联合主键；`book_id` 外键关联旧书表并级联删除；`records`、`experiences` 为 JSON；`updated_at` | 旧单书笔记、位置和体验记录；旧 `owner` 不是 Auth 账号 |
| `reader_documents` | `key` 主键；`version` 为正整数；`value` 为 JSON；`updated_at` | 当前多账号书房、登录会话、授权、限流和上传任务 |

真实数据库中三表均启用行级安全，匿名角色和普通认证角色没有直接表权限。应用服务端使用受保护凭据读写，再由领域服务检查用户身份。浏览器持有普通用户令牌，也不能直接读取这些业务表。数据库当前仅有上述三个主键索引，没有按书、用户或 JSON 内容建立额外索引。

当前系统把章节、段落、译文、术语与注解存为书籍 JSON；评论、问题、阅读时段、目标和位置存为每书记录 JSON。它们在业务上分开，在 PostgreSQL 中没有各自独立的表。数据库外键不会替它们检查段落引用，导入、记录写入和恢复由 `server/library-service.mjs` 与 `app/library-backup.mjs` 校验。

## 账号目录怎样映射到数据

当前网页和 MCP 共用 `server/library-service.mjs`，线上数据根目录为 `hosted/library`。`H(...)` 表示 SHA-256 哈希：

```text
hosted/library/users/H(Auth用户ID)/
  index.json                       私人书架摘要
  books/H(bookId).json              原文、章节、双译和编辑注解
  records/H(bookId).json            用户笔记、问题、阅读时段和位置
  translations/H(bookId).json       当前账号的译文覆盖层
  resources/                       本次保留的旧测试资源与迁移清单
```

这些路径是 `reader_documents.key`，不是云端磁盘目录。`resources/` 是迁移归档约定，网页目前没有独立资源浏览器；不能把归档保存说成新增了可操作的功能页面。

`hosted/library/grants.json` 单独存放 Agent 授权，包含用户、书籍、范围、到期时间、撤销状态与令牌哈希。`auth/sessions/...` 保存服务端会话与供应商令牌，`auth/oauth/...` 保存一次性登录事务。它们不能混进书房导出，也不能把其他账号的会话复制给默认测试账号。

上传任务使用 `uploads/H(userId)/...`，上传限流使用 `limits/uploads/H(userId)`。翻译限流使用共享文档 `limits/translation`，其中请求按账号哈希区分；共享限流不是共享私人内容。

`reader_document_cas` 用预期版本比较后写入：旧版本不匹配则重读重试，最多十二次，避免不同服务进程覆盖同一份文档。它保护单文档的并发修改；整本恢复仍是原件、书、索引、译文、记录依次写入，没有跨全部文档的数据库事务。操作中断后需要回读核对并重跑，不能仅凭一个成功响应断言完整迁移。

## 原文件与版本

`reader-originals` 存储桶为私有，限制 20 MB。原件对象名是 `originals/H(账号原件逻辑路径)`，其中逻辑路径包含账号目录与文件内容哈希。文件名哈希本身不构成授权；原件下载先由书房服务检查账号和书籍，再签发一分钟有效的下载地址。

当前原件下载要求 `book.contentVersion` 与 `book.source.sha256` 一致。旧《有限与无限的游戏》使用 `full-book-draft-1`；本次迁移将活动版本绑定到已核对的 PDF 哈希，并在 `provenance.legacyContentVersion` 保留旧版本号。段落 ID、英文、直译、意译、术语、注解和审阅状态不变；译文及个人记录的版本引用随之对应到同一底本。

`tools/import-supabase-book.mjs` 只更新旧 `reader_books`。它不会将书加入登录账号的书架，不能作为新的账号上传流程。

## 迁移与后续验收

先读取当前默认账号，清点目标书架、原文版本、记录和原件。保留本机文件与旧云端数据的哈希快照。通过 `createLibraryService` 验证备份，再用 `createHostedStore` 保存原件，通过 `restoreLibrary` 合并书籍与记录。重复执行应保持原有 ID，不能制造第二份书或重复笔记；遇到不同原文版本应停止并保留冲突现场。

历史测试数据的来源副本保留，目标账号下的 `resources/test-fixtures/` 保存原始文档及来源标识。旧体验脚本、指标和体验记录保存在迁入书籍的 `legacyReadingResources` 中，并随普通书房 JSON 备份导出。托管版探索和回声接口仍未接入，归档没有启动模型生成。

验收要从正式网站的登录会话读取书架和正文，核对章节、段落、两种译文、术语与注解数量及内容；下载原件比对哈希；确认匿名与其他账号均无法读取。再导出到干净本机实例，检查内容与记录可恢复。普通书房 JSON 不带二进制原件；完整恢复原件需另行复制并核对原文件。发布记录应分别说明账号数据完成、代码合并、网站发布和实际验收。

当前容量边界保持原样：单书 JSON 与单书记录各限 350 万字节；正式 JSON 响应限 400 万字节。大书房使用已有分段导出，单段最多 1 MiB 原始数据。后续若引入分表，应先补迁移和回滚验证；本次没有为了归拢测试数据重建数据库。

对应实现：`supabase/migrations/`、`deploy/hosted-store.mjs`、`deploy/hosted-auth.mjs`、`server/library-service.mjs` 与 `api/[...path].js`。
