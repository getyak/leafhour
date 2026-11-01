# GET-352：目录与自动翻页任务报告

范围：iOS 17+，SwiftUI、现有 TextKit/PDFKit 分页。实施基线为 `85bf3a3b9615ebc309a614839dbe252c096b926d`，分支 `codex/get-352-natural-ios-reading`。本报告只覆盖目录、自动翻页状态与控件；分页消费者、全局偏好、ReaderScreen 接线和最终验收由主任务汇总。

## 调研与选择

现有 `BookChapter` 只有稳定 ID、标题、源路径和段落；`Passage.heading` 只有布尔值。导入器没有保存 EPUB nav/NCX 的真实目录深度。因此本次不按标题数字猜父子关系，也不把章节数组位置当作排版页码。

| 方案 | 具体行为 | 取舍 |
| --- | --- | --- |
| A：完整目录与当前章定位（采用） | 一个原生列表保留真实顺序，本地搜索标题，正在读的条目同时用文字、图标和背景标记；固定入口清除搜索并定位当前章。自动翻页有独立设置页和书页底部的暂停入口。 | 所有章节仍然可见，不增加目录导航层级；长目录靠搜索与当前位置定位处理。 |
| B：当前位置附近与全部目录两层 | 第一屏仅列当前章及真实相邻章节，“全部目录”进入完整列表；自动翻页控制合并到这层位置工具。 | 初看更短，但查远处章节多一步，搜索范围和返回路径更复杂，也会把计时控制重新混进目录。 |

采用 A，删除目录中的上一章、下一章和拖动即跳的章节滑杆。目录只负责查找目的地；“定位当前章节”只滚动目录，不写阅读位置。保留真实可用的正文起点。PDF 输入纯数字时精确定位已有页，超范围返回空结果。

Apple 的列表指南强调文字扫读和持续的位置反馈；搜索指南建议说明搜索范围、输入即更新。对应本方案使用标题列表和“搜索章节标题”，PDF 使用“输入页码或页面标题”。这两条是官方原则；移除滑杆和保持一层目录是本项目的设计选择。来源：[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)。

目录沿用一个原生 sheet，不叠加第二个 sheet；当前章定位通过 iOS 17 的程序化搜索关闭键盘后滚动。来源：[Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、[searchable(text:isPresented:placement:prompt:)](https://developer.apple.com/documentation/swiftui/view/searchable(text:ispresented:placement:prompt:)-5hhxx)。

## 自动翻页契约

- 间隔 5–120 秒，步长 5 秒，默认 30 秒；非有限值回到 30 秒。仅间隔进入通用偏好 `autoPageInterval`，运行状态不编码、不恢复。
- 明确区分未开始、运行、暂停、已到本书结尾。开始和继续均等待一个完整间隔；一次只请求下一屏，收到原生页面稳定回执后才开始下个间隔。延迟唤醒不会补翻多页。
- 后台或非活动、触控、选字、工具或提示面板、听书、VoiceOver、手动导航和排版变化暂停；解除条件不恢复，必须手动继续。VoiceOver 期间不允许启动是本项目的焦点保护选择，不声称这是 Apple 的强制要求。
- 开始自动翻页需要使用真实分页；从滚动模式启动时，主接线显式改为左右翻页并在设置页关闭后启动。自动翻页不模拟真实用户触摸，不刷新阅读活跃时间。
- 每个请求有 UUID 和预期导航代次。旧回执、暂停后的回执不能推进新状态。原生页尚未准备好或被阻止时暂停；5 秒仍未应答也暂停，不循环重试。
- 状态胶囊正常字号高 44pt，标签为“自动 · 30秒”或暂停/结束。暂停、继续及选项都有 44pt 点击区；详细原因放在辅助功能值与设置页。选项通过按钮先同步暂停再打开系统操作框；取消不恢复。
- Reduce Motion 下可继续显式启动的定时翻页，原生页转换应关闭位移动画；状态胶囊不显示跳动的秒数。字号进入辅助功能范围时，当前章标记改为上下排列，完整标题继续换行。

Apple 的 `ScenePhase` 要求 inactive 暂停工作，background 尽快清理；`Task.sleep` 支持取消并且不阻塞线程。本实现使用单个可取消等待，前台单调时间计算截止点，不申请后台任务。来源：[ScenePhase.background](https://developer.apple.com/documentation/swiftui/scenephase/background)、[Task.sleep](https://developer.apple.com/documentation/swift/task/sleep(for:tolerance:clock:))。

辅助功能的文字大小、颜色之外的状态提示、可替代手势与可选动画以官方指南为依据；原生分页仍须真实验证 VoiceOver 和 Reduce Motion。来源：[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[Motion](https://developer.apple.com/design/human-interface-guidelines/motion)、[accessibilityVoiceOverEnabled](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityvoiceoverenabled)。

## 文件与接口

优化点一：目录减负。

- 新建 `apps/ios/Leafhour/ReaderContentsPanel.swift`。
- `apps/ios/Leafhour/ReaderPanels.swift` 仅移除原来的 `ReaderContentsPanel`；该文件其他接线由主任务维护。
- 新建 `apps/ios/LeafhourCore/Sources/LeafhourCore/ReaderContentsIndex.swift` 与对应 `ReaderContentsIndexTests.swift`。索引投影只筛选原始章节并保留原导航索引。

优化点二：自动翻页。

- 新建 `apps/ios/LeafhourCore/Sources/LeafhourCore/ReaderAutoPageState.swift` 与对应 `ReaderAutoPageStateTests.swift`，管理截止点、暂停和幂等回执。
- 新建 `apps/ios/Leafhour/ReaderPageCommand.swift`、`ReaderAutoPageController.swift`、`ReaderAutoPagePanel.swift`。
- 新建 `apps/ios/LeafhourAppTests/ReaderAutoPageControllerTests.swift`。
- `ReaderPageRequest(id:expectedNavigationID:direction:origin:)`，回执为 `.settled(navigationID:)`、`.end`、`.notReady` 或 `.blocked`。Text/PDF 消费者按 ID 幂等消费并验证导航代次。
- `ReaderAutoPageController` 提供 `update(_:navigationID:)`、`setInterval(_:)`、`start()`、`pause(_:)`、`stop()`、`receive(_:outcome:)`；只读输出 `state`、`pageRequest`、`isActive` 和 `showsStatus`。
- `ReaderAutoPageConditions` 收入前台、分页模式、选字、触控、面板、听书、VoiceOver 和提示框状态。Root 同步写入这些信号；几何或字体变化直接 `pause(.layout)`。
- `ReaderAutoPagePanel(controller:interval:navigationMode:onStart:)` 及 `ReaderAutoPageStatusControl(controller:onContinue:onSettings:)` 是接线入口。

## 验证状态与计划

本 agent 先编写测试，再编写实现。按主任务资源协调要求，没有启动构建、Simulator、原生测试或 `swiftc`；没有观察到 RED/GREEN，因此不能声称测试已经通过。`git diff --check` 已执行，无空白错误。未安装依赖，未触碰真实账号、密钥，未提交或推送。

| 层级 | 核验内容 | 本 agent 状态 |
| --- | --- | --- |
| Core | 首屏完整间隔；延迟不连翻；所有暂停原因；暂停/停止/结束后旧回执无效；间隔调整；非有限值与范围；过滤后的索引仍指原章；PDF 精确页码和越界 | 8 个测试已写，待主任务运行 |
| App controller | 自动原点与跨章导航代次；所有阻塞条件；解除后不自动继续；手动导航；notReady；选字后旧回执；结尾与重建控制器 | 5 个测试已写，待主任务运行 |
| 原生分页 | 自动命令复用真实一屏；跨章 restore 完成再确认；PDF 正确保存；自动原点不记录真实交互；旧请求及 invalidate 只应答一次 | 分页 agent 实现，待主任务验证 |
| UI | 目录查询、空结果、当前章定位不改变原锚点；PDF 真实末页；普通/AX 字号、窄屏、横屏；无正文遮挡；菜单取消后仍暂停 | 待主任务验证 |
| 生命周期 | 背景、锁屏、中断后无补翻；返回不恢复；冷启动停止但间隔保留；听书、选字、链接、复制、面板、键盘焦点、VoiceOver 动态开启时暂停 | 待主任务验证 |
| 系统偏好 | Reduce Motion 不出现自动位移过渡；Dynamic Type 重排后暂停，继续从同一源锚点计时；44pt 状态胶囊与 AX 扩高 | 待主任务验证 |

原有 `test23ExistingSyntheticPDFReachesLastPageAndColdRestores` 依赖目录“页码”滑杆与“下一页”按钮，须改为选择真实 PDF 页条目并核对当前页标记。不要把删除控件后的旧测试失败解释为产品分页失败。

视觉比对应使用不同的段落见证内容，并同时读取源锚点和页码；重复的合成句可能使真实翻页的截图看起来相同。现有原生验收的历史失败不在本报告中转为通过，Simulator、CI、TestFlight 和实体设备验收仍分别记录。

## 自评与已改进项

实现没有增加目录层级、云端读取或模型调用。目录筛选和定位不会修改会话锚点；自动翻页状态与书籍持久状态分开，场景清理不可能从持久数据自动启动。已在自评中把状态控件收敛为一行胶囊、保留结尾反馈、为辅助功能字号切换目录行布局，并让选项打开动作先暂停。尚需真实原生验证接口接线、页尾/跨章、触摸与后台的竞争顺序以及最终布局。
