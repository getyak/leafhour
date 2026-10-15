# 自动检查与发布

开发入口是私人归档仓库 `getyak/marginalia-reader-private-archive`。功能分支提交 PR，检查通过后合入 `main`，GitHub Actions 自动同步源码并更新 [循页](https://reader.cubxxw.com)。

```text
功能分支 → PR 检查 → main
                      ↓ 测试、构建、发布边界检查
                 白名单软件快照
                  ↙           ↘
         公开源码仓库         私有部署镜像
                                 ↓ Vercel 再验证、构建
                            reader.cubxxw.com
                                 ↓ 版本与匿名访问检查
```

`CI` 在 PR 与 `main` 执行测试、构建和发布边界检查。`Publish` 仅在私人归档的 `main` 执行，也可从 Actions 手动重跑；相同源码重跑也会重新触发 Vercel，便于恢复偶发构建故障。发布串行执行；每次同步镜像前检查 `main`，已有更新提交时，旧任务跳过后续同步。构建失败保留上一版线上部署；上线后的匿名检查若失败，任务报错，需要检查并按下述方式回退。

`release-files.json` 是逐文件白名单。新增软件文件需加入此文件；缺文件、符号链接、疑似密钥、私人目录、验证资料或 PDF/EPUB 都会阻止发布。公开样书只包含已审核的三本公版书。镜像创建自己的提交，不复制私人仓库历史；README 的内部项目入口也不会发布。数据库与个人阅读记录保留在各自存储中。

同步目标固定为 `getyak/marginalia-reader` 和 `cubxxw/marginalia-reader-deploy`。两个仓库各有一个专用写入 deploy key，私钥仅存于私人归档的 Actions secrets：`PUBLIC_MIRROR_DEPLOY_KEY`、`DEPLOY_MIRROR_DEPLOY_KEY`。密钥只授予对应仓库，不使用个人访问令牌。撤销对应仓库 deploy key 即可停用。

Vercel 沿用部署镜像的原生 Git 集成，无需把生产数据库、登录服务或 Vercel 凭据交给 Actions。GitHub 用 `npm run verify:deploy` 检查完整发布包；Vercel 会预先排除配置模板等文件，因此构建命令为 `npm run verify:hosted`，执行隔离测试、构建与公开产物检查。测试或产物检查失败时不会替换正式域名。自动验收仅执行匿名读取，不发送邮件、写入阅读记录或调用模型。

`/release.json` 保存实际发布的源提交。发布结束前，任务等待正式域名返回该提交，再检查首页、书房、阅读页、主要资源、匿名会话、公版书接口与旧接口关闭状态。通过后才视为发布成功；超时或异常会让任务失败。它不能代替真实登录、上传与跨设备阅读验收。

本机验证：

```sh
npm ci
npm run verify:deploy
npm run smoke:production
```

回退代码时在开发仓库撤销相关提交，合入 `main` 后走同一条发布流程；紧急情况可在 Vercel 将正式域名回退到上一部署。数据库迁移继续单独审核与执行，不能用代码回退推断数据可回退。直接修改镜像可能被下一次同步覆盖，应先回到开发仓库修正。

当前账户的私人仓库不支持强制分支保护；发布流程自身执行完整验证，Vercel 构建也有同一检查。若未来开启分支保护，可要求 PR 的 `test` 检查通过并禁止直接写 `main`。
