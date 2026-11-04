# R1–R2 书架实现与验证

日期：2026-11-05。基线：`30e1b4b4`。范围为 [书架独立设计](shelf-design.md) 对应的 Task 1；不包含后续打开优化、翻译或其他阅读需求。

## 已实现

- 默认 `recent` 改为“最近活动”，使用真实加入时间与真实阅读时间的较晚值。置顶仍优先，用户显式选择书名、作者或加入顺序时保持原规则。
- 云端副本的下载时间不作为加入时间。未读状态及“继续读”仍使用真实阅读信息，未改 `lastReadAt` 口径。已知活动时间相同时以稳定 ID 排序，缺日期的旧书保留服务顺序。
- 账号恢复以 UID 判断是否切换。相同 UID 的邮箱资料变化保留本机库实例和缓存书架，过期账号恢复结果不得重新进入当前书房。
- 相同的云端快照及本机书架数据不再次写入观察属性。缓存载入捕获网络代际，迟到的旧缓存不能覆盖更新的回执。
- 刷新复用进行中的任务；强制请求在需要时等待一次合并的后续检查。启动和下拉删除重复的本机载入。没有下载副本需同步时，省去无用途的第二次书架请求。
- 同步说明改为独立观察的小视图，同时用于列表与网格。沿用原领域 ID 和独立导入进度模型，未添加全架动画或刷新 UUID。
- 书目缺版本或有重复 ID 时拒绝整份快照，保留此前书架。仅为现有 `ImportJob` 与 `CloudSyncMetadata` 增加 `Equatable`，用于抑制不变数据发布。

持久缓存仍在成功网络回执后写入。这样，一次缓存落盘失败后，相同回执也能再次尝试保存，不因内存已更新而永久保留旧磁盘缓存。全量展示投影缓存、额外滚动协调器及封面内存缓存本次未引入，需要实际性能证据后再判断。

## 先失败、再通过

| 检查 | 修改前新期望 | 修改后结果 |
| --- | --- | --- |
| 真实 `LibraryPresentation.swift` 与 `LibraryPresentationTests.swift` | 22 项中 4 项失败：新加入与旧阅读的竞争、下载未知日期、相同日期的稳定顺序 | 22 项通过，0 失败 |
| Core `AccountShelfTests` | 8 项中 2 项失败：缺版本书目及重复身份未被拒绝 | 包含在完整 Core 通过结果中 |
| 完整 `LeafhourCore` | 本轮在修复后运行 | 355 项，2 项跳过，0 失败 |
| 修改的 App 与 App 测试文件 | 执行 Swift 语法解析 | 通过，不等于 iOS 类型检查或构建通过 |
| 当前改动格式 | `git diff --check` | 通过 |

Core 两项跳过为 `ImportTests.testUserSelectedTextFixture` 和 `TextStructureImportTests.testSelectedLocalNovelDirectoryAudit`：环境未提供用户选定的样本与目录。没有读取真实私人文件补齐样本，也没有把跳过写成通过。

使用的主要命令：

```sh
swift test --package-path .superpowers/shelf-contract-tests --scratch-path /tmp/leafhour-reading-experience-20261105/core --jobs 2
swift test --package-path apps/ios/LeafhourCore --scratch-path /tmp/leafhour-reading-experience-20261105/core --jobs 2
xcrun swiftc -frontend -parse apps/ios/Leafhour/LeafhourApp.swift apps/ios/Leafhour/LibraryScreen.swift apps/ios/Leafhour/LibraryPresentation.swift apps/ios/LeafhourAppTests/LibraryActivityTests.swift apps/ios/LeafhourAppTests/LibraryPresentationTests.swift
git diff --check
```

第一个命令使用工作区忽略目录中的临时 SwiftPM 包，直接链接真实的 `LibraryPresentation.swift` 和原 App 测试文件，依赖仓库内的 LeafhourCore。它只验证不依赖 UIKit 的真实展示规则，不能代替 App 宿主测试。正常项目中同一套测试仍由 `LeafhourAppTests` 运行。

原始红绿日志保留在本工作区 `.superpowers/shelf-contract-tests/{red,green,core-red,core-green}.log`。本机 `dev-ios-session` 与 `dev-storage-guard` 不可用，本轮未声称使用这些工具。未运行 `xcodebuild`，由主任务统一检查。

## 已新增、待 App 宿主执行

- `testRestoredEmailMetadataKeepsTheSameAccountLibraryAndCachedShelf`：同 UID 邮箱补齐保留实际库实例和书目。
- `testUnchangedShelfRefreshDoesNotRepublishCloudBooks`：观察书架与书目属性，同快照强制刷新不触发发布。
- `testForcedRefreshWaitsForTheInFlightShelfAndItsQueuedRecheck`：网络请求被延迟时，强制刷新等待共享工作及合并复查。

这些测试已写入，尚未执行，不记为通过。真实像素闪动、滚动位置、多选连续性及 VoiceOver 焦点还需录屏或设备测试。未测量 R1–R2 的首屏、投影耗时、卡顿或内存，Core 中已有的打开基准输出不能充当书架性能证据。

## 当前证据评分

| 需求 | 功能 /30 | 交互 /25 | 性能 /25 | 边界与可访问性 /20 | 已验证分 | 待验证分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R1 | 0 | 0 | 0 | 6 | **6/100** | 94 |
| R2 | 25 | 0 | 0 | 8 | **33/100** | 67 |

R1 的 6 分来自实际运行的完整/旧缓存、owner 拒绝及畸形书目拒绝规则。UID 保留、无重复观察发布和刷新等待需 App 宿主验证，暂不计功能分。

R2 的 25 分来自真实展示规则测试：默认最近活动、新加入与续读时间竞争、显式其他比较器和置顶。边界 8 分来自已知/缺失加入日期、下载日期隔离、稳定并列和隔离缓存。真实“继续读”与状态联动、导入操作的完整时间口径仍待 App 复核，边界余分及所有可访问性分保留。

这两项均未达到 95 的验收目标。评分只反映本轮取得的证据，后续可按独立设计中的表逐项补分，不能直接将未验证上限记为得分。

## 自审与未完成

自审了账号代际、共享任务等待、缓存失败可重试及读取时间与加入时间的分离。未改打开、上传或 reader 流程；未触碰其他任务的服务端改动。主任务仍需完成 App 类型检查与测试、界面和真机验收，再决定后续性能处理。

中文报告已按 `lieflat-less-ai-tone` 检测并做最小修改。技术路径、测试名、数字与限定保留。技术表格和配置清单中的必要并列保留。检测与复测记录位于工作区 `.superpowers/shelf-contract-tests/`。
