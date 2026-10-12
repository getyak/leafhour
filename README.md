# 旁读 · Marginalia Reader

旁读是一间可自托管的深度阅读书房。正文保持安静；需要时，读者可以核对原文与两种译文、查看论证骨架、留下评论、做章节选择，并把选中的句子生成聚焦分享图。

软件代码采用 AGPL-3.0 开源。书籍原文、译文、个人笔记、阅读记录和服务端密钥不属于源码仓库，也不随开源发布。

## 现在能做什么

- 中文、英文、对照三种阅读方式，直译和意译独立保存
- 段落原文、注解、想法和问题按稳定 ID 对齐
- X-ray 论证透视、站队翻页、回声批改和克制的章节互动
- 选中句子后生成可配置的单语或双语分享图
- 字体、字号、行高、段距、字距、首行缩进和纸面主题
- 评论、问题、阅读位置及体验数据导入导出
- 本机 JSON 存储，或 Vercel + Supabase 私有托管

## 本机运行

Node.js 22 及以上：

```bash
npm install
npm test
npm start
```

默认访问 `http://127.0.0.1:8330/`。本机书籍放在被 Git 忽略的 `local/` 目录；仓库不提供受版权约束的整书样本。

## 私有托管

公开代码与私人数据分开：

```text
GitHub public repo ──自动部署──> Vercel
                                  │ server-side secret
                                  ▼
                         Supabase private tables
                         ├─ book + translations
                         └─ notes + reading state
```

建表迁移在 `supabase/migrations/`。Supabase 的两张表均启用 RLS，`anon` 和 `authenticated` 没有直接表权限；Vercel Function 使用服务端 secret 访问。完整部署步骤见 [deploy/README.md](deploy/README.md)。

浏览器端不需要服务端 key。`.env.hosted.example` 只列变量名，真实值应放入 Vercel Environment Variables 或本机被忽略的 `.env`。

## 内容边界

阅读器、数据格式、迁移、导入导出与 Agent 适配可以开源。书籍内容是否可公开取决于书籍授权；软件许可证不会自动授予原书的传播权。个人记录默认只属于部署者自己的实例。

项目主页：[GitHub](https://github.com/getyak/marginalia-reader) · [Notion](https://app.notion.com/p/3f6a444a6c0081558966e38cc6880a86) · [Linear](https://linear.app/getyak/project/marginalia-旁读-d51582413114)

## 许可证

[GNU Affero General Public License v3.0](LICENSE)。如果你通过网络提供修改后的版本，需要向该服务的用户提供对应源码。
