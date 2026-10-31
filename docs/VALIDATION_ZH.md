# 验证报告

## 已完成

- Next.js 生产构建通过，TypeScript 检查通过，全部 10 个服务端 API 路由被识别。
- 50 项迁移相关测试全部通过：认证、账号管理、会话撤销、权限、SQL 事务、24 MB 分片读写、跨账号/降级权限隔离、分片缺失、重复提交和旧版本冲突。
- 3 个账号恢复到本地 libSQL 数据库成功，原密码校验值和角色保留。
- 约 23 MB 当前业务备份恢复成功；按所有原字段读取比对一致。
- 验证原站第 22 版与迁移版的 9 个核心计算模块逐字节一致：creator-engine、creator-commissions、monthly-promotion、video-views、video-periods、video-staging、state-visibility、creator-willingness、import-presets。
- 原站和原源代码仓库未修改、未重新部署。

## 原版本已有一项测试差异

原有 291 项测试中 290 项通过；1 项在**原版源代码中也可重现失败**，文件 `tests/video-views.test.mjs` 第 29 行。该测试预期 6 月产品 P1/P2 的 historicalViewsReference 为 1250 / 1000，当前代码实际返回 null / null。汇总值的其他断言通过。这不是迁移引入的差异。

本次保留原计算逻辑和原测试，不擅自改变历史播放量的统计规则。全量运行 `npm test` 仍会显示这项既有失败；新加的 4 项 Vercel 迁移测试全部通过。迁移专项验收命令为 `npm run test:migration`，结果为 50/50。

## 尚未验证

- 尚未连接你的远程 Turso 数据库、Vercel 账户或自有域名，因此未声称已正式上线、远程数据库实测通过或具备永久可用承诺。
- 浏览器交互 QA 未完成：当前预览服务向 Next.js 传入了不支持的 `--host` / `--strictPort` 参数，预览未启动。未为绕过预览环境而改动应用启动行为。需要部署后按 DEPLOYMENT_ZH.md 的清单完成页面、登录、Excel 和大数据交互验收。
- 初始化脚本的恢复路径已在本地 libSQL 库执行；真实云端连接、配额和网络时延需要在你的账户验收。

## 迁移改动

- 从 Vinext / Cloudflare Worker 构建改为标准 Next.js / Node.js。
- 添加 libSQL 数据库适配层，保留原 SQL、原子批处理、乐观并发及撤销机制。
- 用约 512 KiB 的原始数据块分片传输，每批 3 块，编码后的单个 HTTP 请求/响应小于 3 MiB；避免原站 23 MB 数据超过 Vercel 普通函数 4.5 MB 限制。
- 临时传输绑定账号和当时角色，30 分钟过期；读取完成会清理，过期记录在后续传输时清理。
- 小型兼容 state API 上限设为 3 MiB；正式界面使用分片 API。撤销接口只返回结果元数据，随后界面分片重读。
- 生产登录限流改用 Vercel 注入的 IP 头；原 scrypt 密码校验和 HttpOnly / Secure 会话保持。
- 添加迁移、数据库初始化、账户恢复、备份导入导出、环境变量示例与 Vercel 配置。
