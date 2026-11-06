# GET-201：就地自动保存反馈验证

关联 GET-201；本批基于 PR335 的合并提交 `4cfdd7fc355eae5c73a5f0d654b0c2da89203892`，不向已合并 PR335 追加。原自动保存已经实现，常态 Save 隐藏，失败才显式重试。本批仅改呈现、反馈关联和受保护的成功淡出。

原自然路径（真实 Tab 到字号、方向键修改、Tab 离开）在1440/390 ×503/409四组中均无法在当前视口看到错误；继续 Tab 可恢复且草稿保留。原失败证据保留，手动滚动后的可见截图不算默认反馈通过。

## 当前源码检查

反馈模块复用原 status/retry/recover 节点，成功1500ms后开始160ms淡出，错误持续。owner、消息ticket、dispose防止旧回调清除新消息；locale只重译。保存中显示真实 saving，只读恢复显示单独的 reloading；原请求载荷、CAS、dirty draft、owner fence、防抖和串行队列不变。字段在choice增强前关联同一个状态节点。

已有测试把 `status.parentElement` 当form；加反馈容器后此假设失效。测试现沿父链定位真实form，保留原提交/恢复/owner/请求数和分组断言。迟到owner测试从旧空状态预期改为确认B的Saving消息不能被A迟到结果清除，并非删除保护。只读恢复时的禁用重试不再被标成正在保存；该行为回归先失败。

初始 reading suite 在复用安装中因缺少锁定的 commonmark0.31.2导入失败，保留该记录。后续在注册产物中复制真实源码，按未修改lock用正常npm ci准备隔离依赖，优先离线缓存、禁用生命周期脚本并过滤凭据环境，不使用loader、不改import或共享node_modules。普通Node解析下，完整reading suite与相关呈现/choice/settings/shell/fixture合计106项通过，0失败、0跳过。最初正常运行的旧预期失败与修复后结果分别保留。源文件和隔离副本SHA核对一致。

源码第一轮独审发现并确认了旧测试form定位P2，已修复且复审关闭；其余源码未发现新增P0/P1。实际sticky位置、小屏、焦点是否被遮挡、四条自然RED转绿和成功淡出的浏览器验收仍待新冻结提交执行。

新增的唯一文案key是四语言 `prefs.reloading`，用于只读GET，不把读取称为保存；原catalogue值保持。复制清单通过正常导出更新，不改lint规则、欠债或豁免。新runtime helper进入公开软件allowlist。

## 待完成

以新的完整提交生成冻结组件，核输入/输出摘要，再用已安装Chrome headless单页和loopback内存API执行原自然四条路径。必须无需额外手动滚动看到错误和恢复动作，并保留草稿、只读409恢复；同时检查真实增强控件描述、busy/saved/1500ms淡出、持久错误、owner/迟到/关闭重开、locale和反馈不遮挡焦点。独审后再集中push补充PR，最新head适用CI须通过。

不新增真实账号、模型调用、原始书籍、完整导出恢复、授权或生产操作。PR335合并后的主线CI通过不等于上线：其Production来源核对失败、Vercel为Account is blocked；iOS流程Apple/Archive两job实际跳过，无新IPA。不能用本批结果补齐Safari/Firefox、真人与原GET-201全部验收。
