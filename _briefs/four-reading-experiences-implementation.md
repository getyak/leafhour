# 四条阅读体验 · 实现契约

用户在 2026-10-12 明确要求实现 US-1 至 US-4；本文件固定各模块接口。沿用现有 Node + HTML/JS 阅读服务，正式模型使用官方 DSH，私有内容保持 local/。不创建自动通知、不发布整书。

## 页面与接口

- GET /api/experiences 返回 {bookId,contentVersion,xrays:{[passageId]:Xray},cards:[Card],states:{[chapterId]:{shown,skipped,choice}},echoes:[]}。首屏预载，透视点击不调用模型。
- Xray: {passageId,sourceHash,basis,roles:[{kind,label,summary,sourceRef:{passageId,quote},quotes:{en,literal,interpretive}}]}。所有 quote 均为对应原文或译文的精确子串。结构线索与人工/AI解读标明归属，不把表层解析当完整论证。
- Card: {id,chapterId,triggerPassageId,prompt,choices:[{id,label}],responses:{[choiceId]:{tone,title,text,sourceRefs:[{passageId,quote}]}},echoPassageIds:[id]}。每章至多一个自动邀请；选择翻到作者回应，跳过不改变阅读位置。探索、回声手动入口按需显示。
- POST /api/experience-state: {chapterId,cardId,action:'shown'|'skip'|'choose',choiceId?}。shown 不能重复制造自动邀请；显式选项与个人记录持久化。
- POST /api/echo: {idempotencyKey,passageId,text} → {runId,status,pollUrl}；GET /api/echo/{runId} → {runId,status,result,error?}；POST /api/echo/{runId}/cancel。
- POST /api/explain 复用回声的异步轮询与取消；记录为 `kind:explain`，解释只允许 consistent/uncertain 和空 segments，不混入读者复述。默认书页隐藏入口，显式 `?study=chat` 的更多菜单显示“解释（对照）”。
- Echo result: {verdict:'consistent'|'needs_revision'|'uncertain',summary,segments:[{start,end,reason,sourceRef:{passageId,quote}}],sourceRefs:[{passageId,quote}],validated:true}。start/end 是提交原话的 JS UTF-16 位置。先提交再看反馈；无效引用整个结果不展示，uncertain 不标红；真正的语义错误仍需人工抽查。
- POST /api/experience-events: {events:[{id,sessionId,type,chapterId,passageId?,cardId?,runId?,exposureId?,elapsedMs?,occurredAt?,variant?}]}。仅保存白名单事件与有界数字；正文/原话不在事件中。GET /api/experience-metrics 提供来源覆盖、响应延迟、各率的分子分母、目标和样本状态。
- GET /api/experiences/export 与 POST /api/experiences/import 提供个人选择、回声原话、状态和观测的独立开放格式包；无密钥。既有评论/进度格式保持兼容。

## 指标口径

用户目标原样保留。E1.3/E3.3 用前台可见段落和实际用户滚动作行为代理，不能据此宣称脑内已经阅读。聊天对照是显式实验条件而非虚构数据。立即退出定义为邀请曝光后10秒内离开章节；切换浏览器标签不等于退出。复制是冷启动传播代理，与真实分享/截图分别报告；浏览器不能监测系统截图。

各行为率按独立曝光/提交去重，跳过与退出不从分母删掉。样本不足时不标已达到目标；隔离 QA 数据不得进入真实指标。每章自动强交互≤1、安静段≥70%为程序性约束。

## 模块职责

app/experiences.js 与 experiences.css 负责透视、站队、回声、克制呈现及浏览器观测。reader.js 提供 window.marginaliaReader: getBook(), getChapterId(), getSelectedId(), goToPassage(id), getAnchor(), restoreAnchor(anchor)，并派发 reader:ready 与 reader:chapter 事件。

server/experience-service.mjs 提供 createExperienceService({book,storePath,packPath,generator})，handle({req,res,url,body,send})，close()。generator({kind:'echo'|'explain',book,passageId,text,signal,runId})返回未信任候选，服务核验后才持久化。源/所有权/取消/幂等由服务控制，模型不得自授权限。

harness/generator.mjs 提供 createHarnessGenerator(options)，使用同版本官方 SDK、sdk-minimal+受限插件。独立Run私有快照通过读取工具提供，候选由发布工具提交，Host读取并重新核验；取消关闭进程，迟到结果不可提交。快照文件桥接替代此前HTTP桥接，减少额外服务与凭证面，不暴露任意路径。

内容编译器根据原文显式连接词提供全书结构线索，丰富透视与站队使用有出处的候选资产。内容的表层校验与语义审阅分开；无明确论证的段落允许只列作者表述而不补造前提。

## 验收

必须跑接口真实持久化/导入恢复、来源坏引用拒绝、取消迟到、重复提交与指标去重。真实浏览器验证≤800ms的缓存透视、无遮盖、选择翻面、证据回跳、复制、提交后回声、单章邀请、进度保留与320/390/768/1440px。官方Harness至少完成一例真实回声并有事件回执；比例目标等待真实试读。

## 当前执行

已实现段落内透视、站队翻面、先写后看的真实 DSH 回声、本机选择/原话持久化和导入导出、邀请偏好、取消和事件观测。579段缓存中1411个展示片段均有精确原文定位；每章一张可选卡，潜在自动邀请位置之外占98.8%，邀请默认关闭。透视覆盖包含明确标示的文本结构线索，重点段落有编辑骨架；不能当成全书语义审阅。

官方 SDK/CLI 使用已发布的同版本0.2.1-alpha.2，按文档源基线核对接口；未修改官方内核。独立运行快照替代HTTP桥接。回声按一次上下文读取、候选、复核提交运行，未知工具拒绝；每次最多4个模型请求/8次工具调用，单次1024输出token，60秒，预留上限0.10元。非思考模式用于短反馈，复核与来源检查仍保留；预算值是保守预留，不是实际账单。费率参照失效时不继续生成。

最新受控浏览器样本的七章缓存透视耗时10–17ms，四种宽度通过；这是受控自动化样本，不是生产95百分位或人群试读。真实SDK事件回执、HTTP持久化和浏览器批改链路已通过；短反馈调整中发现重复上下文、重叠标记，均增加先失败后通过的检查。错误候选不展示，原话保留。

完成率80%、原文回看40%、传播5%、回声重读60%、继续阅读70%和厌恶退出<15%均保留为待试读目标。跳过/退出保留在对应分母；E1.3计时从关闭透视开始，聊天对照从关闭可用回答开始，显式 `?study=chat` 提供解释入口；尚无随机分组试读样本；E2.3以可见结果页为分母，复制是独立代理。截图不可自动观测，滚动/可见只是行为代理，不证明理解。

独立review发现的旧轮询覆盖新提交、关页漏记退出及邀请默认问题已修复。观察页为 /evals，QA隔离数据不进入真实指标。回执和截图在被Git忽略的 local/service/qa-experiences/，模型运行记录在 local/harness/。外部MCP、通用书籍导入、完整地图和跨书个性化尚未实现。

31项接口与契约检查通过。解释对照已完成真实官方DSH生成与精确引用核验，168字解释、3处依据、零批改标记；它与回声分别记录，仍不代表比较效果已验证。隔离本机浏览器另验证真实解释呈现、精确英文出处回跳和可用回答关闭事件；其QA观测不进入真实指标。
