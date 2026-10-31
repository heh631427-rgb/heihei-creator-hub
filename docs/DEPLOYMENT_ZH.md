# Vercel 部署操作说明

本包目标架构：Next.js 16.3.4 + React 19.2.6 + Vercel Node.js 24 + 远程 libSQL/Turso。原站的 Cloudflare D1 接口已通过兼容适配层替换，核心业务计算模块保留。数据库和托管账户应归你管理。

## 1. 准备账户和数据库

- GitHub：https://github.com/ —— 保存自己的私有代码仓库。
- Vercel：https://vercel.com/ —— 公司经营工作台按商用 Pro 方案部署；当前价格页面为 $20/月起，税费与超额资源用量另计。以开通页面为准。
- Turso：https://turso.tech/ —— 创建新的 **libSQL 兼容**数据库，获得 `libsql://...` URL 和认证令牌。也可通过 Vercel Marketplace 查看 Turso 集成：https://vercel.com/marketplace/tursocloud 。

本包使用 `@libsql/client`，要使用 libSQL 兼容端点。不要将其他数据库引擎或 Postgres URL 直接填入。尽量选择靠近欧洲 Frankfurt 的数据库区域；Vercel 函数区域已设为 `fra1`。数据库费用、备份保留期限和用量以所选方案为准。

## 2. 配置本地环境

在电脑安装 Node.js 24 LTS。解压本包，进入 app/ 目录。

把 `../private-data/vercel-environment.env` 复制为当前目录的 `.env.local`，用文本编辑器填写：

| 名称 | 填写内容 | 是否公开 |
| --- | --- | --- |
| TURSO_DATABASE_URL | 自己的 libSQL 数据库 URL | 仅服务端 |
| TURSO_AUTH_TOKEN | 自己数据库的认证令牌 | 仅服务端机密 |
| WORKBENCH_SESSION_SECRET | 使用随包预生成的值 | 仅服务端机密 |

不要在这些名称前添加 NEXT_PUBLIC_。不要将 `.env.local` 或 private-data 提交 GitHub；app/.gitignore 已排除环境文件。

Windows PowerShell 示例（先 cd 到 app 目录）：

```powershell
Copy-Item ../private-data/vercel-environment.env .env.local
notepad .env.local
npm ci
npm run migrate -- ../private-data
```

macOS/Linux 示例：

```sh
cp ../private-data/vercel-environment.env .env.local
# 用自己的编辑器填写 .env.local 中的数据库 URL 和令牌
npm ci
npm run migrate -- ../private-data
```

`migrate` 会：检查目标数据是否冲突 → 创建数据库结构 → 导入 3 个账号 → 导入当前完整业务状态 → 逐字段读回比对。相同备份重复执行会核对并跳过已完成导入；如果目标数据与本包不同，会拒绝覆盖。遇到错误按终端提示解决后重试，不要删除数据库中的记录来强行通过。

如需分步执行：

```sh
npm run db:setup
npm run accounts:restore -- ../private-data/auth-accounts.json
npm run backup:import -- ../private-data/workbench-backup.json
```

分步账号/业务导入只接受空的对应目标，不覆盖已有内容。`admin:setup` 是没有账号备份时用于新安装的交互命令，本次迁移无需运行。

## 3. 上传源码并部署

将 **app 文件夹里的内容**提交到自己的 GitHub 私有仓库，包括 package.json、package-lock.json、vercel.json、app/、components/、lib/、public/、drizzle/、scripts/。迁移交付包最外层的 docs 和 private-data 不进入该仓库。

Vercel → Add New → Project → Import Git Repository：

| 选项 | 设置 |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | 如果仓库根目录就是 app 内的文件，选择 `.`；若仓库保留 app 子目录，则选择 `app` |
| Node.js Version | 24.x |
| Install Command | npm ci |
| Build Command | npm run build |
| Output Directory | 保持 Next.js 默认值，不填写 dist |

在项目 Settings → Environment Variables 的 **Production** 中加入上面的三项环境变量，值与完成初始化的 .env.local 一致。先配置变量再部署；变量修改后需要重新部署才生效。

Preview 环境应连接独立的测试数据库，并使用不同会话密钥，避免预览页面改到正式业务数据。网站本身使用自己的账号登录，不需要访客持有 ChatGPT 账号。

可选 CLI 部署（已在 Vercel 完成账户和环境变量配置时）：

```sh
npx vercel link
npx vercel --prod
```

不把账户密码、数据库令牌放到命令参数中。CLI 的账户登录由你在自己的电脑完成。

## 4. 验收后绑定域名

先使用 Vercel 分配的访问地址测试。登录 `heh631427@gmail.com`，密码使用迁移前已有密码。管理员可管理账号、导入与保存；普通账号继续只读，保留原有可见范围。

Project → Settings → Domains 中添加 `creators.spsil.es`（示例），再到 spsil.es 的域名服务商填写 Vercel 实际显示的 DNS 记录。保留 spsil.es 官网其他记录，仅调整该子域名。DNS 生效和 HTTPS 正常后，再把新地址发给员工。

## 5. 上线验收清单

- 未登录访问数据 API 返回 401；主页显示登录入口。
- 管理员能查看账户管理、导入、规则和佣金功能；普通账号无法调用管理员写入接口。
- 核对 1,944 收样 / 4,490 订单 / 3,895 视频 / 429 达人 / 13,620 佣金明细 / 19 Target 记录。
- 打开原有视频报表、历史基线、月度推广、达人意愿和规则设置，检查数据内容。
- 改一条可恢复备注并保存，刷新或换浏览器登录后仍可见；测试撤销能恢复该修改。
- 浏览器内导出 JSON 备份，并确认可在独立测试库重新导入。
- 核对页面布局、Excel 导入和导出。当前环境未完成浏览器交互验收，正式切换前完成本项。

## 技术参考（2026-10-31 核实）

- GitHub 部署：https://vercel.com/docs/git/vercel-for-github
- 环境变量：https://vercel.com/docs/environment-variables
- 域名：https://vercel.com/docs/domains/set-up-custom-domain
- 函数体积上限：https://vercel.com/docs/functions/limitations
- Turso TypeScript 与事务：https://docs.turso.tech/sdk/ts/reference
- Vercel 套餐：https://vercel.com/pricing
