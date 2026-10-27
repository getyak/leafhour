# GET-272：正式阅读器纯读状态

日期：2026-10-27。基线：`f03d593521b936a335ccc96451b230a23f042e08`。任务：[GET-272](https://linear.app/getyak/issue/GET-272)。

## 本单修改

- Web 顶栏、工具入口和对话入口在纯读状态隐藏；顶部和底部 44px 区域的短点击唤醒同一组工具。静读五秒或滚动后收起，键盘操作、编辑、选区与子弹窗保持原有焦点。
- 透明边缘按钮保留键盘及辅助功能语义，指针穿透正文。边缘只消费完成的短点击，拖动、取消、长按、链接和已有选区继续交给浏览器。正文中部规则由原有实现负责，GET-273 仍单独交付。
- 翻页导航移入原工具面板，分页正文使用安全区内的稳定高度。导航叠加在正文上，唤醒与休眠不会重新排版正文。键盘焦点环使用公共令牌并内缩到可见视口。独立样式经过公开文件白名单与 4 KiB 上限检查，原 JS 320 KiB／主 CSS 200 KiB 上限保留。
- 原生 EPUB/TXT 与 PDF 使用 UIKit 边缘轻点识别，透明辅助功能按钮不拦截正文手势。文字滚动后的坐标使用 `bounds.minY/maxY` 判断。减少正文固定留白，滚动与三秒静读收起工具；选区、Slider、VoiceOver 和键盘控件焦点会阻止自动收起。

## 实际验证

| 项目 | 结果 |
| --- | --- |
| 阅读控制、定位、分页、打包与组件焦点 Node 测试 | 108 项通过，无失败或跳过 |
| 正式 Web 打包产物 + 隔离本机 API | Chrome，390×900 与 1440×900；连续与分页模式 |
| Web 定时与输入 | 十秒静读无工具；上下边唤醒；滚动收起；再静读收起；键盘焦点保持；边缘正文可拖选 |
| Web 位置与错误 | 唤醒前后段落位置相同；最终矩阵无 console/HTTP 错误 |
| 原生构建 | 最终 unsigned `build-for-testing` 通过 |
| 原生 UI | Primary iPhone／iPhone 17 Pro／iOS 26.5，1 项通过，0 失败；37.839 秒 |
| 原生定时与恢复 | 十秒无工具；上下边唤醒；滚动后中部轻点不唤醒；滚动后顶边仍可用；冷启动续读保持纯读 |
| 文案检查 | 指定 Vale 3.24.0、现有 pinned textlint；lint 与 canary 通过，历史告警保留 |
| 独立审阅 | 确认的 1 个 P1 与各轮 P2 已修复并复核关闭，无遗留已确认问题 |

原生验收使用从 `catalog/alice.txt` 截取的公版原文片段，通过正常 `OfflineLibrary` 导入服务预置到独立的 `org.leafhour.get272` 测试 App；这项测试不宣称完整 EPUB/PDF 或云端同步验收。完整文件导入的既有基线见原生 GET-276 记录。

本轮所有原生操作都经过 `dev-ios-session`，复用既有 Primary。其他会话持锁时等待，没有停止其服务或抢占设备，没有创建、清空或全局清理模拟器；结束时保留原来已启动的设备。

## 保留的限制与诊断

- 真实 iPhone、Safari、完整 VoiceOver／硬件键盘交互未在本单实测；TestFlight 属于 GET-276 的独立发布验收。合并、正式部署与实际平台验收分别记录，缺少必要平台验收时 GET-272 保持 In Progress。
- GET-273 与 GET-274 未被本单关闭。原型 PR #209 保留为历史参考，本单修改正式 Web 与已有原生工程。
- 内置浏览器控制曾长时间无响应，改用临时 Playwright 进程。没有触发产品模型生成，也未扩展账号、provider、权限或计费。
- 首次隔离参数未覆盖 Debug 中的固定 bundle ID，安装曾更新 `org.leafhour.local` unsigned 开发包；随后命令在读取独立容器前停止，未执行测试书籍复制、erase 或数据迁移。后续在忽略的本地配置中明确设置并读回 `org.leafhour.get272`，种书与全部 UI 验收均在该独立包中完成。
- 第一次原生 UI 探针把完整公版文本放在单章，XCUI 快照耗时超过工具显示窗口。改用有界公版摘录后通过；失败日志保留，不能把该失败记为通过。

## 凭据与证据

Linear 通过现有 OAuth MCP 的 CLI 连接读取并核对 GetYak、GET 与 Leafhour UUID；没有启动旧调度引擎。工作区、会话和 generation 沿用原登记，派发次数没有重置。真实凭据未写入源码、日志或本文。

原生截图来自最终 `.xcresult` 附件；Web 截图来自正式打包器产物。截图哈希与源文件指纹见 JSON 记录。合并后 Production 的源提交及线上浏览器结果记录在主 PR 与本单 Linear 回读中。

API 依据：[Apple UIScrollView 坐标](https://developer.apple.com/library/archive/technotes/tn2154/_index.html)、[Apple location(in:)](https://developer.apple.com/documentation/uikit/uigesturerecognizer/location(in:))、[HTML inert](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert)。
