# 安全

[English](SECURITY.md) | [简体中文](SECURITY.zh-CN.md) | **繁體中文** | [日本語](SECURITY.ja.md)

請私下向倉庫所有者報告安全問題，不要公開開 Issue。

不要提交書籍檔案、個人資料庫記錄、資料庫密碼、Supabase 密鑰或 service-role 密鑰、DeepSeek Key 或 Vercel Token。瀏覽器端不能收到 `SUPABASE_SECRET_KEY`。

隨附的 Supabase 遷移開啟 RLS，並移除 `anon` 與 `authenticated` 的直接存取權限。目前託管轉接器面向由 Vercel Deployment Protection 保護的單一所有者部署。作為公開多使用者服務運行前，請先接入 Supabase Auth 與按使用者策略。

新版公開託管入口只提供許可清楚的公版試讀。私人上傳與記錄要求郵箱身分；匿名不能讀取舊單書 API。`reader_documents` 與 `reader-originals` 僅伺服器端密鑰可直接存取，按帳戶隔離透過共用領域服務執行。部署排除私人封存與本機資料；雲端郵箱未設定時不開放註冊。
