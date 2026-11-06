# GET-201：当前设置验收夹具准备

关联 [GET-201](https://linear.app/getyak/issue/GET-201)；原工程 PR 为 [#149](https://github.com/getyak/leafhour/pull/149)。初始批次准备当前组件的合成验收环境，随后执行真实 Chrome 采集并修复两项复现问题。下文按阶段记录，不缩减原验收范围，不恢复 Symphony 或发布流程。

## 来源与用途

准备基线是 `d302393d4ed01a82af6828d7200969be3b8addc9`。本地旧 `dist` 的来源标记为 `e44e83ef79f2470e87027689f1098e22774e9c51`，不用于此次当前版本验收。夹具通过 esbuild 单独编译真实 `mountLibraryShell` 及其依赖；产品 JS、页面 header、CSS 和依赖资产取自指定 Git 提交。没有复制设置 UI、替换产品组件或手写 `release.json`。这是组件构建，不能证明完整托管包或 Production 已通过。

`provenance.json` 保存实际提交、编译输入/输出摘要和 fixture ID，`coverage.json` 初始化所有待验行。夹具自身修改以单独输入摘要记录，因此准备阶段未提交的夹具代码不被冒称为原基线的代码。源文件和合成产物不包含真实账号、书籍或历史截图。

## 准备命令

先执行资源检查和 `dev-storage-guard audit`，用 `new-artifact GET-201-settings-fixture` 获取产物根目录。依赖复用同锁文件的现有安装，不运行安装或完整应用构建。以下命令的输出目录必须是尚不存在的任务产物子目录：

```sh
node tools/settings-acceptance/host.mjs prepare /absolute/task-artifact/component-build FULL_CURRENT_HEAD
node --test --test-concurrency=1 tests/get201-settings-fixture.test.mjs
```

工具要求预期提交等于当前 HEAD；产品输入读取该 Git 对象，输出到新目录，绝不覆盖仓库 `dist`。准备失败保留错误，不把部分输出当作可运行产物。主线变化后必须重新建立对应来源的产物，不能改 marker 复用旧内容。

## 服务方案：独审后再启动

准备阶段未启动服务或浏览器。协调方批准执行窗口后，运行：

```sh
node tools/settings-acceptance/host.mjs serve /absolute/task-artifact/component-build
```

宿主仅绑定 `127.0.0.1` 的内核分配端口，先核对所有产物摘要，再把静态文件读入内存。记录该进程 PID、启动时间、工作区、fixture ID 和精确 URL；只由本任务关闭。未知现有监听服务不停止、不改配置、不默认复用。网页不加载真实登录态，使用隔离浏览器上下文/站点数据空间，不能进入真实账号。

HTTP 只允许准确 Host、同源 Origin 的 GET/HEAD 和构建清单中的静态路径。唯一允许的 Cookie 是产品真实语言展示 hint 的准确名称和合法编码；未知 Cookie、混合或重复 Cookie、Authorization 全部拒绝。`ui` 参数精确允许真实语言选项，刷新优先使用 `ui`，再使用夹具的初始 `locale`。API、变更请求、路径穿越、站外 Origin 和未知查询参数全部拒绝。CSP 禁止网络连接、worker、frame、object、表单导航，脚本和字体只允许本地资产；sandbox 不开放弹窗和顶层导航。

浏览器在导入任何产品模块前安装不可回退原生网络的 fence，然后动态加载并注入真实偏好 codec。fetch 只走内存 API；XHR、WebSocket、EventSource、worker、beacon、新窗口与链接导航拒绝。链接目的地在夹具层改为本页禁用锚点，避免中键和浏览器菜单绕过 click；这项隔离不能用来证明产品链接导航正常。下载仅允许本次运行已登记的 blob URL，且文件名为两种合成 JSON 导出名称。只允许 `synthetic-a`、`synthetic-b`、guest，所有书名、邮箱与计划均为固定合成值。请求经过身份和代次核对，A→B→A 期间的延迟响应拒绝。

准确 API 白名单见 `tools/settings-acceptance/model.mjs`。目前支持设置页水合、阅读/界面偏好 CAS、合成资料名修改及合成计划暂停/恢复。界面偏好使用真实快照校验；计划暂停/恢复按产品实际 `baseRevision` 请求体核对；退出同时撤销语言桥所属身份。偏好记忆只读；遥测配置固定关闭，事件发送拒绝；MCP 只提供空目录。生成、认证、真实账号、授权创建、领取/送达、外部工具调用及未列明 API 都没有实现，不存在生产网络后备。

## 执行清单与限制

1. 先由 reviewer 核查来源绑定、内存白名单、旧代次拒绝、静态宿主及网络 fence，处理确认的 P0/P1，再排浏览器时段。
2. 实际 Safari、Chrome、Firefox 分别建立六页 × EN/简中/日语 × 明暗 × 1440/390 的 72 行矩阵。Appearance/Data/每日陪读的 36 行是其中子集，不能另算完整矩阵。逐次记录实际应用版本、真实 viewport、来源、文件摘要及结果。Playwright WebKit 不记作 Safari；其他引擎不记作 Firefox。
3. 控件逐状态、dropzone 四种附加状态、尺寸/溢出/CJK、token、键盘与焦点、错误/保存反馈、访客/空/有数据场景分别记账。不适用状态必须说明原因。仅展示首屏或通过单元夹具不能关闭这些行。
4. 目前没有备份/恢复与导出流程的内存 API、有效档案及填充个人记录夹具；没有偏好记忆写入或 MCP 工具调用场景。这些操作会明确拒绝，必须按实际需要增加独立审阅过的合成适配及断言，再执行对应验收；不能将拒绝当作产品错误或状态通过。文件选择只使用已核实的合成文件，不从真实书房导出测试素材。
5. macOS/Linear 设置参考与实际并排图另补。原 `/workspace/ambi/ambi-design-benchmark.md` 不在本机，既有 14/16 是改编自评，不能改称原量表认证。第三方与真实账号参考保留私密目录，只发布无私人信息且有明确来源的材料。

Safari、Chrome 已安装；当前标准应用路径及 Spotlight 未找到 Firefox。暂不安装 Firefox、不启用 Safari Remote Automation、不新增插件或权限。Safari 390px 需要真实视口读回；窗口最小宽度受限时安排实际 Safari 响应式模式，不拿 WebKit 抵替。

两位非技术读者各做五秒解释仍是真人项，保留 `need human`；软件测试不代填。Production 平台恢复后，仍需单独核对当时部署提交并进行线上验收。本批没有上线、真实登录、真实账号写入、模型调用或截图矩阵通过声明。

## 本批准备结果（2026-11-07）

独立 reviewer `get201_fixture_review` 首轮确认 2 个 P1、5 个 P2，均属于夹具而非产品缺陷：语言 Cookie 导致资源拒绝、原生链接导航旁路，以及界面语言快照、URL 参数、计划 CAS 字段、退出身份同步和 fence 的安装顺序。修正后 reviewer 只读复核关闭这些项，未发现新的阻止准备阶段的 P0/P1。它不代表浏览器行为或完整安全验收已通过。

最终轻量检查 34/34 通过、0 skip：7 项夹具边界反例，加现有 settings-controls 和 library-profile-shell 的 27 项宿主测试。未运行完整应用测试、浏览器、设备或服务。首次组件准备因公开 CSS 引用的 WebP 未在夹具扩展名白名单中而失败，未当作通过；补充准确公开资产类型后重新准备，最终修正后又生成独立最终产物，旧中间产物不用于执行。

最终组件构建为基线 `d302393d4ed01a82af6828d7200969be3b8addc9`，196 项有摘要的输入、162 项有摘要的输出。已逐项读回输出完整性及当前夹具代码输入摘要；纯宿主 handler 检查根页面及合法语言刷新为 200，未知 API 为 404，私有 Cookie 为 403。这些是直接函数检查，没有监听端口或实际 HTTP/浏览器请求。

- provenance SHA-256：`601c8d8937ae70e1209d8dd93517c3f2f72423b4f763690471f3a4981dcf5229`
- coverage SHA-256：`e4dddbc07ecf9a9a412e6faf5486c7a7ed15b42d2638f88ebb65b66a8ec447af`
- 216 行计划截图全部 pending，各浏览器 72 行，首批各 36 行属于子集；两位真人、全部控件状态、参考与线上验收仍 pending。

产物留在登记的任务目录，供协调方安排独占浏览器时段；未恢复旧归档、未占用未知服务、未写 Linear 或启动自动流水线。准备代码通过审查后仍须按仓库交付门禁进入关联 PR；本记录不是 PR 已合并或任务已完成的回执。

## 2026-11-07：真实 Chrome 采集与两项修复

实际执行使用已安装的 Google Chrome `156.0.8078.80`，显式指定该浏览器的 executable，headed、单页串行、隔离临时 profile。夹具提交为 `5650441159d23aa9e40edd679c0be0a3f6cb3ca1`，产品输入仍为 `d302393d4ed01a82af6828d7200969be3b8addc9`。不是 Playwright Chromium 或 WebKit 替代验收。

合成状态的六面板 × 三语言 × 两主题 × 两宽度，72/72 行已采集；原图、facts、截图 SHA 及逐行 source 保留在 `chrome-acceptance/chrome-matrix.json`。页面错误、站外请求和 HTTP 失败均为零。1440×900 的弹窗为 880×640，390×844 为 366×640。这里的 captured 不等于 accepted：初始可见性 probe 未排除 closed details 后代的保留布局盒，不能据其推断这些控件可见或通过。另有 24 条控件状态记录，其中 `reading-save-states` 等待超时；旧 runner 误等 status 出现 Saving，而产品忙态由 form 的 `aria-busy` 表达、status 会清空。失败记录保留，不能改写成通过。

HTTP 边界实测 12/12 通过。Chrome profile 均在关闭上下文后移除，无 profile 内容进入证据。原 loopback HTTP 服务已正常关闭，PID 与端口均读回消失。未操作其他服务或用户浏览器数据。

### 复现、源码绑定与最小修复

1. 数据页的两个导出选项直接创建原生 checkbox，`library-data.css` 明确设为 20×20；原图为 `screenshots/data-paper-en-390.png`。核对了 home 的全部 31 个 CSS link 及顺序，相关 JS/CSS 的 Git、manifest、CSS 输出摘要一致，排除夹具漏样式。改为复用已有 `switchRow`，保留原 checkbox 作为值与键盘行为的拥有者。国际化只更新独立 label span，移除旧 20px 和 label 布局覆盖。切换导出选项仍只改本地值，实际导出继续由显式按钮发起。
2. 日语 390×844 直接打开外观时，选中项右缘 385 超出弹窗右缘 378，原图为 `screenshots/appearance-paper-ja-390.png`。`selected-tab-reproduction.json` 记录打开后仅诊断性 recenter 即恢复完整边界（右缘 221）。根因为 select 在 closed modal 尚无布局时尝试滚动。修复为 showModal 后定位，并在当次字体 ready 和语言文案更新时对当前选中项重新定位；关闭时不执行滚动。

两项新增行为回归先各自失败，再修复产品源码。修复后，settings-controls、library-profile-shell 和 fixture 边界共 36/36 PASS，library-data-ui 另 16/16 PASS。相邻 library-reading-preferences、account-settings-http 在导入时因复用的本机依赖缺少 commonmark 而失败，未视为通过，未安装或改写共享依赖。独立 source review 未发现新增 P0/P1 或可确认 P2；该 review 没有运行新浏览器或构建。

修复后真实浏览器复验目前等待协调方的串行资源窗口。旧 d302 的 72 图只证明旧来源的采集；不能作为修复后版本完整矩阵。后续应以新的冻结源码产物，只复验受影响的语言、宽度、选中项定位、开关样式、键盘与禁用状态，并逐行记录来源。源码回归不能代替实际几何和视觉验收。

Safari、Firefox、真实账号、完整导出/恢复、MCP 实调用、两名真实读者及 Production 仍未验收。GET-201 保持进行中，人工体验结论继续保留 need human；不能据此关闭原 issue。
