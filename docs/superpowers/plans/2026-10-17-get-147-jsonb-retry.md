# GET-147 JSONB 重试修复

原设计及T1–T9不变。首个PR合并后，真实生产验收发现同一手动补记原内容重试409。生产JSONB返回的区间对象为endedAt/startedAt，客户端规范化为startedAt/endedAt；时间值完全相同，字符串化比较却不同。客户端回执检查也受影响。文件存储与原托管夹具保留键序，未覆盖此差异。

修复前固定：共享区间比较只核对长度、顺序、每段开始/结束字符串；对象键序不参与语义。manual身份与回执共用，不降低原owner/book/source/status/sequence/anchor检查。真实值/顺序/数量变化和坏项仍拒绝。无需迁移、权限或数据库变更。

新增先失败的领域和回执回归，以及实际createHostedStore/CAS、两个领域服务实例与重排JSONB夹具的丢ACK→刷新续传→同ID仅600秒→重复备份恢复不增行。修改后运行受影响宿主测试、完整构建及独立审查，再由后续PR最新提交全CI和正常合并发布验证原生产合成书的原ID，不换ID掩盖失败。

依据：[PostgreSQL JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)说明JSONB不保留对象键序；[Supabase JSON指南](https://supabase.com/docs/guides/database/json)推荐JSONB。已核对当前changelog，当前修复不新增平台接口。生产原始记录、复现日志、红绿测试和交付收据保留在本聊天对应issue证据目录。
