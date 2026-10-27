本记录为模型辅助的独立代码与画面审阅，不代表真人读者研究。

# 人物页最终定向复核

Merge verdict：Approve。本轮范围内没有剩余的 Critical、Important 或需要阻止合并的 Minor。正常交付仍须由根代理完成当前提交的完整检查、CI 和同提交 Production 验收。

日期为 2026-10-28。审阅当前工作树及 `.superpowers/author-portraits/review-final.patch` 的相关部分，当前 HEAD 为 `23d0719e90948453bba0039316098edd4a5b5fd7`，已确认包含 `744c20b`。本轮只复核 F1/F2/F3 及相关修复，没有重新审阅其他领域，也没有修改功能文件、index 或 HEAD。

## Critical / Important / Minor

本次定向范围内无未关闭的明确问题。

## 原问题的复核结果

F1 已关闭。`server/people-service.mjs:57` 只投影实际公开 claim 或原句使用的连续文字，来源标签改为中性值，查询参数按固定规则筛选，摘要指纹重新计算，私人 locator 不再直接公开。实际重跑旧 payload 后，preview、publish、getShare 和 publicProjection 导出均不含 PRIVATE 标记，私人原始资料仍保留。将副本标记改回旧 v2 后，读取得到 410。

F2 已关闭。`app/person-model.mjs:56` 为改动实体借用的已核证明建立待核候选，保留原 claim。实际重跑“只把 w-born 正文改为伪造获奖事实、不改 claims”的旧 payload 后，改动事件引用 uncertain，原 w-birth 仍 verified，已有精确引文完全保留。作品、关系和年份改动的相关回归也通过。付费生成与 Agent 写入共用这个处理过程。

F3 已关闭。`app/portable-chat.mjs:21` 已取消不一致的 24 条限制，引用与已保存回答采用同一总容量边界。原来的 25 条人物引用 payload 现在能完整往返，没有丢失引用。

## 相关修复

撤权现在先关闭 grant，再等待 `people.fenceWrites()` 对人物存储键完成一次真实修改。最后一次权限检查后仍在等待提交的旧写入会触发 CAS 冲突，重试时重新检查授权。栅栏失败不会返回撤回成功，撤权状态保留并允许重试。普通网页 CRUD 也接入当前 session 检查，退出登录会等待同样的栅栏。

来源和肖像的新 URL 输入拒绝凭据或签名参数，SourceReader 与 prepare 也拦截旧凭据地址。自托管分享使用当前实例 origin，并继续拒绝无关外站地址。上述路径的定向回归通过。

已用 view_image 查看最新 1440、768、390、320 四张真实首屏。较窄画面将“伍尔夫”完整放在第二行，没有原来的孤字。来源片段现在显式设为 und，cite 内书名按内容语言设置 lang。本次没有运行真实读屏。

未收录作者的检索意图与返回书籍保存在账号范围的 session state，公开人物地址不携带私人 bookId。已核对相关 helper 和现有真实浏览器结果，未重新执行完整用户流程。

## 实际验证

本轮独立重跑三条原始纯内存复现，全部关闭。另运行九项针对性 Node 22 测试，9/9 通过。覆盖公开来源裁剪、实体待核证明、25 条引用备份、自托管分享及 URL 凭据边界。撤权回归使用实际 createHostedStore 和模拟 RPC，暂停在最终权限检查后的提交窗口，分别验证 create、update、completeGeneration 不会在撤权确认后迟到保存。还验证栅栏失败不确认且可重试。

所有检查均无真实付费模型调用、无真实账号写入。本轮没有重跑完整 suite，不把这些定向测试结果当成全站通过。

## Declined to judge

完整 suite、CI、发布和线上验收由根代理执行。真实外部 MCP 宿主、VoiceOver、Safari、系统分享送达及读者启发没有新增实测。全部历史事实和各法域许可没有重新核验。

九维总分仍不完整，原首轮结果保持 62/72。本报告不将回归通过率换算成审美或内容质量分数，也不宣称严格超过 98。

<!-- 文案复查：按 docs/writing.md 与 lieflat-less-ai-tone 检测并逐条复核。六条顿号命中均为实际检查范围或数值清单，予以保留；冒号为结果标签或代码位置。只将一处可独立成句的正文分号改为句号，未改观点、事实或结构。检测原始输出保留在审阅会话。 -->
