# iOS 阅读设置与导入实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development for an isolated server implementation and final review; the controller integrates native changes. Track verified results in the task ledger.

**Goal:** iOS 正确导入大型 TXT、可关闭缩进、缓存书架优先启动，并按书保存原文／译入语言。

**Architecture:** 复用 OfflineLibrary、ReaderSession、现有章节读取与翻译计费入口。排版偏好与本书语言状态分开。分语言保存双译，保留旧中文格式兼容。

**Tech Stack:** SwiftUI/UIKit、LeafhourCore、Node.js 22、现有 JSON 领域存储。

**Spec:** docs/superpowers/specs/2026-11-02-ios-reading-preferences-design.md

## Global Constraints

- 不提交真实书籍、运行数据或凭据。持久联调数据只归测试账号。
- 不启动全书翻译。设置语言不生成内容，段落与本章原有确认范围不变。
- 保留旧中文译文、原文版本、私人记录、锚点和账号隔离。
- 当前任务的常规 PR 与正常合并已有用户授权。集中一次推送，等待适用 CI。

## Review Focus

- 非 UTF-8 大型文本与看似标题的正文，目录可复现且不丢文。
- TXT 自带段首空格与大字模式，关闭缩进真正生效且选文锚点正确。
- 冷启动离线、认证慢与账号变化，缓存不串账号，不自动打开书籍。
- 切换译入语言时迟到的网络结果和未完成请求，不能混入当前语言。
- 请求语言与计费报价／重试身份绑定。旧中文调用保持原行为。

### Task 1: 分语言翻译领域与传输

**Files:** server/library-service.mjs、server/translation.mjs、server/translation-batch.mjs、server/portal.mjs、相关 billing scope 模块。新增 tests/translation-languages.test.mjs。

**Interfaces:**
- translate(user,id,passageId,options) 新增可选 sourceLanguage（zh/en/ja/ko/fr/de/es）和 targetLanguage（同集合），缺省保留既有译入中文行为。
- readingChapter(user,id,chapterId,contentVersion,options={}) 接收 targetLanguage。章节 HTTP 查询接受 targetLanguage，默认仍是旧中文投影。
- 每段译文元数据携带 sourceLanguage/targetLanguage。不同语言双译分别保存，默认中文仍按旧格式输出。完整导出／恢复不能丢失新语言。
- 请求 body 的语言字段必须纳入现有报价和幂等指纹，不能用同一计费请求悄悄更换语言。

- [x] 先新增失败测试：中文→英文、英文→日文、两种语言独立保存、中文旧调用、同语言提前拒绝、非法语言、跨账号与旧版本、语言切换计费身份。
- [x] 实现上述接口与目标语言提示词，保持现有上下文范围、合并保护和取消检查。
- [x] 跑受影响服务与 HTTP／计费测试，并记录命令结果。只提交本任务文件。

### Task 2: iOS 排版与按书语言

**Files:** LeafhourCore Models/ReadingLayers/ReaderSession/OfflineLibrary/CloudBookSync，原生 ReaderPanels/ReaderReadingContent/ReaderCloudTools/ReadingAppearanceControls/TextReadingView。

**Interfaces:** 本书 ReaderState 保存语言设置，ReaderPreferences 保存首行缩进。网络与磁盘缓存以目标语言隔离。原语言自动识别使用当前原书的有限文本样本。

- [x] 新增偏好兼容、跨书独立语言、不同目标缓存及切换结果隔离测试，先验证失败。
- [x] 提供“不缩进／两字”以及原文／译入语言选择。原书自动识别及手动设置并存。
- [x] 语言写入明确翻译请求与恢复计划，拒绝迟到结果串语言。保留原文选择映射。
- [x] 运行 Swift 核心测试与原生构建，检查模拟器真实画面。

### Task 3: 书架启动缓存与真实导入核对

**Files:** LeafhourApp.swift、LibraryScreen.swift、OfflineLibrary.swift。必要的导入容量模块与测试。

- [x] 移除启动自动恢复阅读。先加载当前账号本机书架再联网恢复／同步，合并重复同步触发。
- [x] 缓存书目解码并按文件变化失效。打开书仍执行完整性验证，下拉可强制刷新。
- [x] 用提供的 TXT 在临时隔离目录本机导入，核对完整目录、首尾与原件哈希。只保留统计证据。
- [x] 核对原件同步服务容量。TXT／Markdown 统一为64MiB，使该原件能同步到翻译服务。EPUB20MiB、PDF256MiB、展开内容容量保持原约束。

### Task 4: 集成审阅与交付

- [x] 检查完整改动与上述 Review Focus，修复重要发现并回归。
- [x] 完成受影响测试、Web 构建、原生模拟器构建及交互验收，记录实际边界。
- [ ] 单批推送、创建 PR、等待 CI 后正常合并。跟踪已有 Production 发布，分别报告合并／发布／TestFlight 状态。
