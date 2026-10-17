# 安全

[English](SECURITY.md) | **简体中文** | [繁體中文](SECURITY.zh-Hant.md) | [日本語](SECURITY.ja.md)

请私下向仓库所有者报告安全问题，不要公开开 Issue。

不要提交书籍文件、个人记录、数据库密码、Supabase 密钥或 service-role 密钥、DeepSeek Key 或 Vercel Token。浏览器端不能收到 `SUPABASE_SECRET_KEY`。

随附的 Supabase 迁移开启 RLS，并移除 `anon` 与 `authenticated` 的直接访问权限。当前托管适配器面向由 Vercel Deployment Protection 保护的单所有者部署。作为公开多用户服务运行前，请先接入 Supabase Auth 与按用户策略。

新版公开托管入口只提供许可清楚的公版试读。私人上传与记录要求邮箱身份；匿名不能读取旧单书 API。`reader_documents` 与 `reader-originals` 仅服务端密钥可直接访问，按账户隔离通过共用领域服务执行。部署排除私人归档与本机数据；云端邮箱未配置时不开放注册。
