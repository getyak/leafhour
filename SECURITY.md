# Security

Please report security issues privately to the repository owner instead of opening a public issue.

Never commit book files, personal records, database passwords, Supabase secret or service-role keys, DeepSeek keys, or Vercel tokens. The browser must not receive `SUPABASE_SECRET_KEY`.

The supplied Supabase migration enables RLS and removes direct access from `anon` and `authenticated`. The current hosted adapter is intended for a single-owner deployment protected by Vercel Deployment Protection. Add Supabase Auth and per-user policies before running it as a public multi-user service.

新版公开托管入口只提供许可清楚的公版试读。私人上传与记录要求邮箱身份；匿名不能读取旧单书 API。`reader_documents` 与 `reader-originals` 仅服务端密钥可直接访问，按账户隔离通过共用领域服务执行。部署排除私人归档与本机数据；云端邮箱未配置时不开放注册。
