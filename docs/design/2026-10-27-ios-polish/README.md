# Leafhour iOS：交互打磨版

延续半屏陪读方向，保留[第一版](../2026-10-26-ios-half-sheet/README.md)作为比较。本轮用户授权持续优化至 2026-10-27 12:00 Asia/Singapore，进展与下一步在 [WORKLOG.md](WORKLOG.md)。

这版先处理操作的连续性。面板从当前屏幕位置接受重新抓取，用释放速度决定落点；停手后不保留过时的甩动速度，取消不提交关闭。遮罩随面板高度变化，拖拽区达到 44 px。按钮在按下时给出短促反馈，减少动态保留静态分档与按钮。

选文工具跟随真实选区，在导航、底部工具和半屏边界内定位。继续滚动时跟随原句，原句离开视野时收起；确认问题或取消后清除临时段落高亮。选择与复制仍由浏览器处理，不因选择本身更换已发送问题的引用。

原文、直译、意译、讲解和自己的笔记保持独立；阅读位置、讨论位置和临时出处各自保存。内容仍为固定公版样章和标注的示例讲解，不接模型、不写真实书房数据。

## 查看

- `prototype/index.html` 是联机预览入口，浏览器模块由本机静态服务提供。
- `Leafhour-iOS-prototype.html` 是构建后可直接打开的单文件，包含本地模块，无外部脚本依赖。
- `exports/` 为实际浏览器截图和可编辑 SVG；流程与关系沿用第一版，功能方向未变。
- Figma 同步结果单独记录；没有截图与反应读回时，不将网页更新写成 Figma 已更新。

本轮 [Figma 新版流程](https://www.figma.com/proto/zjkapX58kUJZZh0la8F4Nw/Leafhour?node-id=1-1869&starting-point-node-id=1%3A1869&page-id=1%3A2) 已写入同一文件下方，初版保留。13 个画面、165 个控件反应读回；通过 Computer Use 实际点通阅读→半屏→展开→出处→返回讨论→继续读。原生图层中的整段选择用段落背景表达，网页中用文字行背景表达；这不等同系统文本选择验收。

## 重现与验证

先运行 `node --test motion.test.mjs selection-position.test.mjs`，再用已有 Playwright 运行时设置 `LEAFHOUR_PLAYWRIGHT_MODULE`，执行 `node verify-polish.mjs` 与 `node build.mjs`。前者验证新增手势和选文行为；后者运行原有 11 条阅读/草稿/出处回程检查，导出 13 个状态，再检查单文件。

打包使用仓库已有的 [esbuild API](https://esbuild.github.io/api/#bundle)，把运动和定位模块合入单文件。没有新增项目依赖。报告中的浏览器、源文件哈希和错误记录是实际结果；不能当作 SwiftUI、真实 iPhone、Safari、触觉、系统键盘或 VoiceOver 已验收。

独立审阅的关闭中抓取、往返拖动、真实触摸滚动和快速上甩边界问题，均先复现失败，再通过对应回归。新增 10 项计算检查、14 项浏览器检查与原有 11 项阅读回归分别记录，不将检查数量当作审美评价。计算检查通过 `tests/ios-design-interaction.test.mjs` 纳入仓库常规检查；全量应用检查以远端结果为准。
