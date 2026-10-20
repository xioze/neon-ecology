/**
 * 生产入口：加载 .env → 构建 app → 监听 PORT。
 *
 * 本文件只在被直接执行（tsx server/index.ts）时启动监听；被测试 import 时
 * 只重新导出 createApp，不产生端口副作用。
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createApp } from "./app";
import { isAiAvailable, loadConfig } from "./config";

export { createApp } from "./app";
export type { CreateAppOptions } from "./app";
export { loadConfig, DEFAULT_CONFIG } from "./config";
export type { ServerConfig } from "./config";

function startServer(): void {
  const config = loadConfig(process.env, (message) => {
    console.warn(`[config] ${message}`);
  });
  const app = createApp({ config, logger: (message) => console.log(message) });

  const server = app.listen(config.port, () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : config.port;
    console.log(`NEON//ECOLOGY 服务端已启动：http://127.0.0.1:${port}`);
    console.log(
      isAiAvailable(config)
        ? `AI 顾问：在线（模型 ${config.deepseekModel}，每小时上限 ${config.aiMaxRequestsPerHour} 次）`
        : "AI 顾问：离线（未配置 DEEPSEEK_API_KEY 或 AI_ENABLED=false），游戏使用本地决策。",
    );
  });

  server.on("error", (error) => {
    console.error(`服务端启动失败：${error.message}`);
    process.exitCode = 1;
  });

  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`收到 ${signal}，正在关闭服务端……`);
    server.close(() => process.exit(0));
    // 兜底：2 秒内没有关闭完成就强制退出，避免挂住 dev 进程。
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryPath = path.resolve(entry).toLowerCase();
  const modulePath = fileURLToPath(import.meta.url).toLowerCase();
  return entryPath === modulePath;
}

if (isDirectExecution()) {
  startServer();
}
