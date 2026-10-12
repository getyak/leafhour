# Vercel + Supabase 部署

## 1. 创建数据库

在 Supabase 新建项目，然后执行 `supabase/migrations/` 中的迁移。迁移只创建结构和权限，不包含书籍或个人数据。

准备一个不会提交到 Git 的环境文件：

```bash
cp .env.hosted.example .env
```

设置 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`READER_BOOK_ID` 和 `READER_OWNER_ID`。服务端 secret 能绕过 RLS，只能用于服务器与导入脚本。

## 2. 导入私人书籍

把 `book.json`、`experience-pack.json` 和 `experience-metrics.json` 放在 `local/finite-infinite-games/`，然后运行：

```bash
npm run db:import
```

导入脚本只把内容传入你配置的 Supabase 项目；`local/` 和 `content/` 都被 Git 忽略。

## 3. 连接 Vercel

从 Vercel 导入 GitHub 仓库，Framework Preset 选择 `Other`。仓库已经提供：

- Build Command：`npm run build:vercel`
- Output Directory：`dist`
- Functions：`api/[...path].js`

在 Production、Preview、Development 三个环境设置同样四个变量。私有书籍部署建议开启 Vercel Deployment Protection；公开站点则应先增加 Supabase Auth 和按用户 RLS 策略。

GitHub `main` 每次更新后，Vercel 会自动构建和发布。构建产物只有阅读器外壳，书籍从受保护的 API 读取。

## 4. 验证

部署后检查：

```bash
curl -I https://YOUR_DOMAIN/
curl -I https://YOUR_DOMAIN/api/book
```

页面应显示完整章节；Supabase 的 `reader_books` 有一本书，`reader_states` 会在首次访问时创建。公开仓库和 Vercel 构建日志中不应出现 secret 或整书 JSON。
