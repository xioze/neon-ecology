/**
 * Express 应用构建器。供 supertest 直接测试，也由 server/index.ts 启动。
 *
 * 职责：
 *  - GET /api/status：严格按照 docs/CONTRACTS.md 返回 mode/model/ai 字段，绝不返回 API Key；
 *  - POST /api/ai/decision：zod 校验请求 → 调用 AI 顾问 → 映射服务层错误；
 *  - 安全响应头、80kb 请求体限制、API 404 JSON；
 *  - 其余 GET 请求静态服务 dist/，dist/index.html 不存在时返回中文 503（提示 npm run dev）。
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aiDecisionRequestSchema,
  type AiDecisionRequest,
  type AiProposalErrorResponse,
} from "../src/shared/ai";
import {
  AiService,
  AiServiceError,
  type AiDecisionService,
  type FetchLike,
  type Logger,
} from "./aiService";
import { isAiAvailable, loadConfig, type ServerConfig } from "./config";

const DEFAULT_DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));
const JSON_BODY_LIMIT = "80kb";

export interface CreateAppOptions {
  /** 显式配置（测试必须注入，避免读取真实 .env）。 */
  config?: ServerConfig;
  /** 注入 fake 服务；否则由 config/fetchImpl/now 创建真实 AiService。 */
  aiService?: AiDecisionService;
  /** 注入 fetch（测试用）。 */
  fetchImpl?: FetchLike;
  /** 注入时钟（测试限流用）。 */
  now?: () => number;
  /** 安全日志输出（默认静默，避免测试噪音）。 */
  logger?: Logger;
  /** 静态资源目录，默认项目根目录下的 dist/。 */
  staticDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? (() => {});
  const staticDir = options.staticDir ?? DEFAULT_DIST_DIR;
  const aiService =
    options.aiService ??
    new AiService({
      config,
      fetchImpl: options.fetchImpl,
      now: options.now,
      logger,
    });

  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.get("/status", (_req, res) => {
    res.json(buildStatus(config, aiService));
  });
  api.post("/ai/decision", (req, res, next) => {
    handleDecision(req, res, config, aiService, logger).catch(next);
  });
  api.use((_req, res) => {
    sendError(res, 404, "接口不存在。", "NOT_FOUND");
  });
  app.use("/api", api);

  // 生产静态资源；前端未构建时给中文提示。
  app.use(express.static(staticDir, { index: false, redirect: false, maxAge: 0 }));
  app.use((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, 404, "资源不存在。", "NOT_FOUND");
      return;
    }
    const indexHtml = path.join(staticDir, "index.html");
    if (existsSync(indexHtml)) {
      res.sendFile(indexHtml);
      return;
    }
    res.status(503).type("html").send(NOT_BUILT_HTML);
  });

  // 兜底错误处理：请求体过大 / JSON 解析失败 / 未预期异常，一律返回 JSON。
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (isEntityTooLarge(error)) {
      sendError(res, 413, `请求体过大，上限 ${JSON_BODY_LIMIT}。`, "PAYLOAD_TOO_LARGE");
      return;
    }
    if (isJsonParseError(error)) {
      sendError(res, 400, "请求体不是合法 JSON。", "BAD_REQUEST");
      return;
    }
    logger(`[server] 未处理异常：${sanitizeLog(errorMessage(error), config.deepseekApiKey)}`);
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      sendError(res, 500, "服务端内部错误。", "INTERNAL_ERROR");
      return;
    }
    res.status(500).type("text").send("服务端内部错误。");
  });

  return app;
}

/** GET /api/status 的响应体：字段严格按契约，不含 Key、不含 baseUrl。 */
export function buildStatus(config: ServerConfig, aiService: AiDecisionService) {
  const stats = aiService.getStats();
  const available = isAiAvailable(config);
  return {
    mode: available ? "online-ready" : "offline",
    model: config.deepseekModel,
    ai: {
      enabled: available,
      hourlyLimit: config.aiMaxRequestsPerHour,
      calls: stats.calls,
      failures: stats.failures,
      rejected: stats.rejected,
      lastError: stats.lastError,
      lastLatencyMs: stats.lastLatencyMs,
      minIntervalMs: config.aiMinIntervalMs,
      timeoutMs: config.aiTimeoutMs,
    },
  };
}

async function handleDecision(
  req: Request,
  res: Response,
  config: ServerConfig,
  aiService: AiDecisionService,
  logger: Logger,
): Promise<void> {
  const parsed = aiDecisionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue && issue.path.length > 0 ? issue.path.join(".") : "body";
    sendError(res, 400, `请求参数不合法（${location}）：${issue?.message ?? "无法解析"}`, "BAD_REQUEST");
    return;
  }
  const request = parsed.data as AiDecisionRequest;

  try {
    const result = await aiService.decide(request);
    res.status(200).json({
      ok: true,
      proposal: result.proposal,
      meta: result.meta,
    });
  } catch (error) {
    if (error instanceof AiServiceError) {
      const message = sanitizeLog(error.message, config.deepseekApiKey);
      sendError(res, error.httpStatus, message, error.code);
      return;
    }
    logger(`[server] AI 决策处理异常：${sanitizeLog(errorMessage(error), config.deepseekApiKey)}`);
    sendError(res, 502, "AI 服务处理请求时发生内部错误，本次使用本地决策。", "AI_UPSTREAM_ERROR");
  }
}

type ErrorCode =
  | AiProposalErrorResponse["code"]
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

function sendError(res: Response, status: number, error: string, code: ErrorCode): void {
  res.status(status).json({ ok: false, error, code });
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

function isEntityTooLarge(error: unknown): boolean {
  const candidate = error as { type?: unknown; status?: unknown } | null;
  return candidate?.type === "entity.too.large" || candidate?.status === 413;
}

function isJsonParseError(error: unknown): boolean {
  const candidate = error as { type?: unknown; status?: unknown } | null;
  return candidate?.type === "entity.parse.failed" || (error instanceof SyntaxError && candidate?.status === 400);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

/** 日志脱敏：移除 Bearer 与 sk- 形式的密钥片段。 */
function sanitizeLog(message: string, apiKey: string): string {
  let safe = message;
  if (apiKey.length >= 8) safe = safe.split(apiKey).join("[REDACTED]");
  safe = safe.replace(/sk-[A-Za-z0-9_-]{6,}/g, "[REDACTED]");
  safe = safe.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  return safe.slice(0, 800);
}

const NOT_BUILT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NEON//ECOLOGY · 前端尚未构建</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(circle at 30% 20%, #0d1b2a 0%, #05070d 60%, #02030a 100%);
    color: #d9f7ff;
    font-family: "Segoe UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  }
  main {
    max-width: 680px; width: 100%; padding: 40px 36px;
    border: 1px solid rgba(90, 242, 208, 0.35); border-radius: 18px;
    background: rgba(5, 12, 20, 0.82);
    box-shadow: 0 0 42px rgba(90, 242, 208, 0.12), inset 0 0 28px rgba(90, 242, 208, 0.05);
  }
  h1 {
    margin: 0 0 6px; font-size: 24px; letter-spacing: 2px; color: #5af2d0;
    text-shadow: 0 0 18px rgba(90, 242, 208, 0.55);
  }
  .kicker { margin: 0 0 24px; font-size: 12px; letter-spacing: 4px; color: #ff4fa3; text-transform: uppercase; }
  p { line-height: 1.8; color: #a9c7d6; font-size: 14px; margin: 10px 0; }
  code {
    display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 13px;
    background: rgba(90, 242, 208, 0.12); color: #8ffbe4; border: 1px solid rgba(90, 242, 208, 0.25);
  }
  .hint { margin-top: 26px; padding-top: 18px; border-top: 1px solid rgba(164, 138, 255, 0.25); color: #a48aff; font-size: 13px; }
</style>
</head>
<body>
<main>
  <p class="kicker">NEON // ECOLOGY</p>
  <h1>前端尚未构建</h1>
  <p>服务端已经启动，但当前目录下没有 <code>dist/index.html</code>，因此暂时无法渲染城市界面。</p>
  <p>开发模式：运行 <code>npm run dev</code>，同时启动 tsx 服务端与 Vite 前端（<code>http://127.0.0.1:5173</code>）。</p>
  <p>生产预览：先运行 <code>npm run build</code>，再运行 <code>npm start</code> / <code>npm run serve</code>。</p>
  <p class="hint">API 仍可使用：GET /api/status · POST /api/ai/decision</p>
</main>
</body>
</html>`;
