# 把 NEON//ECOLOGY 部署成可转发的固定链接

目标：

- 一个**长期不变的 HTTPS 链接**，例如 `https://neon-ecology.onrender.com`
- 把代码推到 Git 后，托管平台**自动重新构建**
- 同一个链接自动提供最新版本
- DeepSeek Key 只存在于服务端，不进前端、不进 Git

当前项目是「Vite 静态前端 + Express 服务端」：

- 静态文件只有 `dist/`
- `/api/status`、`/api/ai/decision` 需要 Node 进程
- DeepSeek Key 必须放在服务端环境变量里

因此**不要用 GitHub Pages / 纯静态空间来承载完整版本**。纯静态网站无法隐藏 Key，AI 功能只能关闭。

---

## 方案 A（推荐）：GitHub + Render

Render 提供免费 Node Web Service，域名固定为 `*.onrender.com`，连接 GitHub 后可自动部署。适合这个项目，因为现有 Express 服务可以直接运行，不需要改造成 Serverless。

### 1. 把项目推送到 GitHub

当前目录已经是一个 Git 仓库，但**还没有 remote**：

```bash
git remote add origin https://github.com/<你的用户名>/neon-ecology.git
git branch -M main
git push -u origin main
```

先在 GitHub 创建一个空仓库（不要勾选初始化 README / .gitignore）。这一步需要你登录自己的 GitHub 账号。

### 2. 在 Render 创建 Web Service

登录 [Render Dashboard](https://dashboard.render.com/) → **New +** → **Web Service** → 连接刚创建的 GitHub 仓库。

因为仓库里有 `Dockerfile`，Render 通常会把 Language 自动选成 **Docker**。**保持 Docker 即可**，不需要改成 Node；Docker 字段会自动使用仓库根目录的构建配置，原先的 Build Command / Start Command 字段不会出现。

| 配置项 | 值 |
| --- | --- |
| Name | `neon-ecology`（决定默认域名；被占用时可用 `neon-ecology-xioze`） |
| Language | **Docker**（保留自动检测结果） |
| Branch | `main` |
| Root Directory | 留空 |
| Region | Singapore（如果该区域支持 Free 套餐；否则 Oregon 也可以） |
| Docker Build Context Directory | `.`（仓库根目录） |
| Dockerfile Path | `Dockerfile`（若当前显示的是 `.`，改为 `Dockerfile` 或 `./Dockerfile`） |
| Docker Command | 留空（使用 Dockerfile 内 CMD） |
| Pre-Deploy Command | 留空 |
| Health Check Path | `/api/status` |
| Instance Type | Free（免费实例闲置会休眠，首次访问可能需等待唤醒） |
| Auto-Deploy | On Commit（如果可选，选择 **After CI Checks Pass**） |

> 如果你更想用 Render 的 Node runtime 而不是 Docker：Language 改成 `Node`，Build Command 填 `npm ci --include=dev && npm run build`，Start Command 填 `npm run serve`。两种方式都可以，本仓库已经同时支持。

创建后，Render 会给一个固定 URL，通常形如：

```text
https://neon-ecology.onrender.com
```

这个域名在服务存在期间不会改变。若名称已被占用，Render 会追加随机后缀；可以改名或绑定自己的域名。

### 3. 配置环境变量

在 Render 的 **Environment** 页面添加（**不要上传 `.env` 文件**）：

```dotenv
NODE_VERSION=22
DEEPSEEK_API_KEY=<在这里粘贴你的 Key>
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
AI_ENABLED=true
AI_TIMEOUT_MS=15000
AI_MAX_REQUESTS_PER_HOUR=48
AI_MIN_INTERVAL_MS=1800
AI_MAX_TOKENS=700
AI_TEMPERATURE=0.65
```

不要把真实 Key 写进仓库、前端代码、README 或 `.env.example`。

如果不希望公网访客消耗你的 AI 额度，可以：

- 将 `AI_ENABLED=false`，离线模拟仍然完整可用；
- 或调低 `AI_MAX_REQUESTS_PER_HOUR`（例如 `12`）。

服务端 `/api/status`、错误日志和前端都不会暴露 Key。

### 4. 第一次部署

点击 **Create Web Service**，等待 Build 完成。打开固定 URL 应该看到 3D 城市。

验证：

```text
https://<你的域名>/api/status
```

应该返回：

```json
{"mode":"online-ready","model":"deepseek-chat","ai":{...}}
```

如果返回 `mode: "offline"`，说明服务端没有拿到 `DEEPSEEK_API_KEY`，但离线模拟仍可正常游玩。

### 5. 以后如何让链接使用最新代码

你的日常流程会变成：

```bash
# 修改代码后
git add -A
git commit -m "feat: 更新内容"
git push
```

Render 监听到 `main` 分支的新提交后，会自动：

1. 安装依赖；
2. 运行 `npm run build`；
3. 替换线上的 `dist/`；
4. 让**同一个固定域名**提供新版本（不需要重新分享链接）。

仓库已包含 [.github/workflows/ci.yml](../.github/workflows/ci.yml)：

- 每次 push / PR 自动执行 `npm run typecheck`、`npm test`、`npm run build`；
- 在 Render 中把 Auto-Deploy 设为 **After CI Checks Pass**，可以避免测试失败的代码直接覆盖线上版本。

服务端的 HTML 已设置 `Cache-Control: no-cache`，刷新页面会拿最新入口；Vite 的 JS/CSS 文件名带内容 hash，不需要清缓存。

### 6. 自定义域名（可选但更专业）

Render → 你的 Service → **Settings → Custom Domains**：

1. 添加 `game.example.com`；
2. 在 DNS 服务商添加 CNAME 指向 `neon-ecology.onrender.com`；
3. 等待 DNS 生效，Render 会自动签发 HTTPS 证书。

之后分享的链接就是固定的自有域名，后续发布不改地址。

---

## 方案 B：Docker 部署到 Railway / Zeabur / Fly.io

仓库中已包含 [Dockerfile](../Dockerfile) 和 `.dockerignore`。这些平台大多都支持「GitHub 仓库 → 自动构建 Docker → 固定域名」。

构建与本地验证：

```bash
docker build -t neon-ecology .
docker run --rm -p 3000:3000 --env-file .env neon-ecology
# http://localhost:3000
```

部署到 Railway / Zeabur / Fly.io 时：

- 选择从 GitHub 仓库部署；
- 平台会自动识别 `Dockerfile`；
- 在平台环境变量中配置与方案 A 相同的变量；
- 绑定平台生成的固定域名，之后每次 push 自动更新同一域名。

Docker 运行阶段的依赖只包含生产依赖；`tsx` 已经在 `dependencies` 中，因此服务端可以直接运行 TypeScript。

---

## 方案 C：只分享临时预览（不是固定链接）

如果只是现在想发给朋友看一眼，本机服务开启后可以用隧道：

```bash
# 需要安装 cloudflared
npx cloudflared tunnel --url http://127.0.0.1:3000
```

会生成一个随机的 `*.trycloudflare.com` 链接：

- 关闭本机服务后链接失效；
- 每次启动链接通常不同；
- 不适合长期分享，也不建议在不可信网络暴露带 Key 的本地服务。

它解决的是“临时预览”，不是“固定链接”。要固定链接，请使用方案 A 或 B。

---

## 关于“每次点开都是最新版”的准确含义

只有满足以下条件，固定链接才会自动使用最新代码：

1. 你确实把最新提交 push 到了托管平台监听的分支（如 `main`）；
2. 平台已经完成新的构建和发布；
3. 访客刷新页面（旧标签页不会凭空变成新代码）。

分享链接本身不包含代码；它始终指向同一个部署。更新的是部署，而不是链接。

---

## 重要：分享出去后，存档是“每个人自己的”

当前版本的居民、关系、快照和存档保存在浏览器 `localStorage` 中：

- 你在这个链接里的世界不会自动同步给访客；
- 每个访客第一次打开都会得到自己的世界；
- 平台重新部署不会删除访客浏览器里的存档；
- 如果存档 schema 版本升级，旧存档可能被安全拒绝，建议在游戏内导出 JSON 备份。

如果你想要的是“大家进入同一个持续世界”，需要下一步增加：

- 服务端持久化数据库（PostgreSQL / SQLite + 持久磁盘）；
- 用户或房间概念；
- 服务端权威模拟与同步接口。

这是另一个架构阶段，不是换一个托管平台就能自动实现的。

---

## 安全与成本清单

- 公网发布前务必确认 `.env` **没有**被提交：`git ls-files .env` 应无输出。
- 平台的 Key 用 Secret / Environment Variable 注入。
- 公网访客可以使用你的 AI 额度；服务端已有每小时 48 次、最小间隔 1.8 秒的硬限流，但仍建议按预算调低。
- 如果分享到公开群，考虑 `AI_ENABLED=false`，让城市以纯本地模拟运行。
- 免费 Render 实例约 15 分钟闲置后休眠，下一次打开会慢一些；需要稳定即时响应可升级付费实例。
- 中国大陆直接访问海外 PaaS 可能不稳定；若主要受众在国内，可考虑支持香港/新加坡节点的平台或自有域名，但中国大陆服务器通常需要 ICP 备案。
- 分享链接本身不会绕过平台登录/访问控制；如果需要私密访问，要在平台上加访问控制，或在应用层加简单的邀请码/密码（目前未内置）。

---

## 常见部署问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 页面 503「前端尚未构建」 | Build Command 没跑 `npm run build`，检查 `dist/index.html` 是否产生 |
| 打开报 502 | 服务进程未启动或启动命令错误；检查 Render 日志，Start Command 应为 `npm run serve` |
| `/api/status` 有响应但页面空白 | 静态文件目录问题；默认应服务工作区 `dist/`，不要改 `staticDir` |
| AI 显示离线 | 平台环境变量没有 Key，或 `AI_ENABLED=false`；服务端重启后生效 |
| 修改代码后链接没变化 | 没有 push、自动部署关闭、构建失败或浏览器旧标签页未刷新 |
| 免费实例首次加载很慢 | Render 免费实例休眠唤醒，等待几十秒；或升级实例 |
| 部署后本地存档加载失败 | schema 版本已变化；在本地先导出 JSON，再在游戏中导入 |
| 端口冲突/平台要求 PORT | 平台会注入 `PORT`，服务端会自动读取；不要写死 3000 |

---

## 最短操作清单

```text
1. 创建 GitHub 空仓库
2. git remote add origin ... && git branch -M main && git push -u origin main
3. Render: New Web Service → 连接仓库
   Language 保持 Docker；Context=.；Dockerfile=Dockerfile；Health=/api/status
   （或 Language=Node：Build `npm ci --include=dev && npm run build`，
     Start `npm run serve`）
4. Instance Type 选 Free；Auto-Deploy 保持 On Commit
5. 环境变量填 DEEPSEEK_API_KEY 等（不提交 .env）
6. 打开 Render 生成的固定域名，分享这个链接
7. 以后 git push → 自动部署 → 同一链接使用最新代码
```
