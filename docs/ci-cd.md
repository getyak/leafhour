# 自动检查与发布

唯一开发仓库是公开的 [getyak/leafhour](https://github.com/getyak/leafhour)。代码、Agent 规范、设计文档、开发计划和验收记录直接在这里维护，功能分支经过 PR 检查后合并到 `main`。不再通过私有主仓库、公开源码镜像或部署镜像中转。

```text
公开仓库：功能分支 → PR 检查 → main → Vercel 验证、构建与部署
                                  ↓
                         Production 等待同一源提交上线
                                  ↓
                         leafhour.com 匿名验收
```

`CI` 在 PR 与 `main` 执行 `npm run verify:deploy`：隔离环境中的完整测试、构建、媒体完整性与部署内容检查。用户已授权 Agent 在检查通过后直接合并 PR，无需重复确认；不得绕过失败的检查。

Vercel 直接连接公开仓库的 `main`，执行 `npm run verify:hosted`。构建版本读取 Vercel 提供的 `VERCEL_GIT_COMMIT_SHA`，无需依赖平台未提供的 `.git` 目录；本机可回退到当前 Git 提交。生产数据库、邮箱、登录与模型凭据保存在 Vercel 环境变量中，GitHub 不需要镜像写入密钥。测试或构建失败时不会替换线上版本。

`Production` 仅跟随公开主分支上成功的 CI，等待 `/release.json` 返回同一提交，再验证首页、书房、阅读页、静态资源、匿名会话、公版书接口和旧接口关闭状态。自动验收只执行匿名读取，不发送邮件、写入阅读记录或调用模型；它不能代替真实登录、上传和跨设备验收。

源码公开与用户数据存储各有职责：`.env`、实际密钥、用户上传的书籍、个人记录与数据库不进入 Git。`catalog/` 提供来源和许可明确的公版样书。旧开发历史包含商业书籍全文，已在本机保留恢复备份；迁移只引入源码与开发文档，避免将该历史带入公开 PR。

`release-files.json` 仅列出部署快照所需的软件文件，不再决定哪些开发文档可以开源。设计、计划、验收与 `AGENTS.md` 已在公开仓库中，部署时可由 `.vercelignore` 排除。配置示例保留变量名，实际值不写入文件或日志。

本机验证：

```sh
npm ci
npm run verify:deploy
npm run smoke:production
```

回退时在同一公开仓库撤销相关代码提交，经 PR 合入 `main` 后重新部署；紧急情况可在 Vercel 将正式域名回退到已验证版本。数据库迁移需要单独审核与执行，代码回退不代表数据回退。
