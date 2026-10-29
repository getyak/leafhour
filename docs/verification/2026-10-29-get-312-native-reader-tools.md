# GET-312 原生阅读工具接入记录

## 界面和真实动作

阅读页首次显示书名、回书房、排版和底部工具栏；闲置六秒或开始滚动后收起，底边轻把手和原有边缘点按可再次唤醒。启用 VoiceOver 时不自动收起；动效服从系统“减少动态效果”。所有工具触区至少 44pt。

| 原生入口 | 行为和数据来源 |
| --- | --- |
| 目录、进度 | 原生章节列表、章节滑杆和前后章节，不请求模型 |
| 听书 | AVSpeechSynthesizer 从当前段连续朗读当前章，声音和语速可选，支持暂停/继续和前后段；不上传正文，不使用阅读点；切后台暂停，不自动改变阅读位置 |
| 翻译 | 读取当前段独立保存的 literal、interpretive 和状态；没有译文时保留原文。可对照或单独查看直译/意译；本机 cloud-content.json 提供已有译文的离线副本 |
| 笔记 | 沿用已验证的笔记提交、草稿保留和原句回程 |
| 更多 | 原文搜索、文字与纸面、已有导读、阅读陪读、原件/本机正文副本分享、笔记和草稿导出；额外能力通过明确标注“网页版”的隔离会话入口打开 |
| 选字菜单 | 沿用系统选择/复制，新增“查看译文”“问陪读”，按 source anchor 查找当前原段 |

Markdown 听书使用 cmark-gfm 解析后的可见文字，保留文本内容，不朗读强调、围栏或链接地址标记。TXT 不做 Markdown 解释。

## 显式生成与账号边界

仅打开面板发起 GET，不能生成译文或回答。按下生成按钮后，先读取当前会话，收费实例再获取报价，核对 owner、模式、价格、书、段落、原文版本、请求 ID 和有效期；用原生确认框展示本次点数与来源片段。确认后提交，失败重试沿用相同请求 ID、quote ID 和 idempotency key。没有确认时不提交生成请求。

请求使用 CloudLibraryClient 并绑定书的 ownerID。选文字引用将 Unicode scalar anchor 换算为服务端要求的 UTF-16 offsets，核对实际原文后才附带 quote。私人笔记和草稿不加入提问请求。生成结果不自动将 AI 文字保存成用户原话。

网页版入口使用短期 nonPersistent WKWebsiteDataStore；在本机凭据和真实会话 owner 均与当前书一致后才注入 host-only、Secure、HttpOnly、SameSite cookie。初始地址绑定当前书和段；嵌入导航及响应仅允许精确 HTTPS origin。跨域自动跳转、子框架和非 HTTP(S) scheme 被拒绝，用户主动点击的 HTTP(S) 外链交给系统打开。退出销毁隔离 store；不会写入共享 Safari 会话。

生成的译文先由服务端保存，再调用 OfflineLibrary.cacheCloudPassage 更新设备副本；本机缓存更新失败明确保留“已保存云端，本机副本未更新”的状态。

## 实现阶段的验证记录

- 已执行：新增 Swift 文件的 `swiftc -frontend -parse`；`git diff --check`。
- 隔离单元测试已编写：既有内容只读、双译状态、确认/取消、错误报价拒绝、相同 ID 重试、Unicode 引用与私人笔记边界、Markdown 朗读文字。
- 本记录写入时尚未由本 sub agent 执行 app 构建、XCTest、模拟器、真机或 TestFlight。由主任务统一运行并另记结果。

## 平台参考

- [Apple：暂停和继续系统语音](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/pausespeaking(at:))
- [Apple：朗读文字、声音与速度](https://developer.apple.com/documentation/avfaudio/avspeechutterance)
- [Apple：选择反馈](https://developer.apple.com/documentation/swiftui/sensoryfeedback/selection)

这里的系统朗读与网页云端生成配音是独立能力，不将其记作云端配音、双人讲稿、氛围或摘录图片均已完成原生对齐。

主任务已完成实际构建、18项原生模型/策略测试、模拟器完整流程与生产账号同步联调；最终证据及范围见 [GET-312完整验证记录](2026-10-29-get-312-connected-reader/README.md)。
