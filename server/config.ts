/**
 * 服务端运行配置。
 *
 * 只在 Node 侧从 process.env 读取；DEEPSEEK_API_KEY 只保存在内存中，
 * 绝不允许出现在响应体、错误信息或日志里。数值均做范围校验：
 * 无法解析时回退默认值，越界时收敛到最近的合法边界并发出警告。
 */

export interface ServerConfig {
  /** Express 监听端口。 */
  port: number;
  /** DeepSeek API Key；空字符串表示离线运行。 */
  deepseekApiKey: string;
  /** DeepSeek API 基地址（不含结尾斜杠）。 */
  deepseekBaseUrl: string;
  /** 请求的模型名。 */
  deepseekModel: string;
  /** 服务端 AI 总开关。 */
  aiEnabled: boolean;
  /** 单次上游请求超时（毫秒）。 */
  aiTimeoutMs: number;
  /** 全局每小时最多 AI 决策请求数。 */
  aiMaxRequestsPerHour: number;
  /** 两次 AI 决策请求之间的最小间隔（毫秒）。 */
  aiMinIntervalMs: number;
  /** 上游生成的 max_tokens。 */
  aiMaxTokens: number;
  /** 上游生成的 temperature。 */
  aiTemperature: number;
}

export const CONFIG_BOUNDS = {
  port: { min: 1, max: 65_535 },
  aiTimeoutMs: { min: 250, max: 120_000 },
  aiMaxRequestsPerHour: { min: 1, max: 10_000 },
  aiMinIntervalMs: { min: 0, max: 600_000 },
  aiMaxTokens: { min: 16, max: 8_192 },
  aiTemperature: { min: 0, max: 2 },
} as const;

/** 与 .env.example 保持一致的默认值。 */
export const DEFAULT_CONFIG: Readonly<ServerConfig> = {
  port: 3000,
  deepseekApiKey: "",
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekModel: "deepseek-chat",
  aiEnabled: true,
  aiTimeoutMs: 15_000,
  aiMaxRequestsPerHour: 48,
  aiMinIntervalMs: 1_800,
  aiMaxTokens: 700,
  aiTemperature: 0.65,
};

/** AI 顾问当前是否真正可用（有 Key 且未被关闭）。 */
export function isAiAvailable(config: ServerConfig): boolean {
  return config.aiEnabled && config.deepseekApiKey.length > 0;
}

type ConfigWarning = (message: string) => void;

/**
 * 读取并校验配置。宽容策略：服务端不会因为某个环境变量写错而拒绝启动，
 * 但会把非法值修正为默认值/边界值，并通过 onWarning 报告（不含密钥）。
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  onWarning: ConfigWarning = () => {},
): ServerConfig {
  const port = readInteger(env, "PORT", DEFAULT_CONFIG.port, CONFIG_BOUNDS.port, onWarning);

  const deepseekApiKey = (env.DEEPSEEK_API_KEY ?? "").trim();
  const deepseekBaseUrl = normalizeBaseUrl(
    readString(env, "DEEPSEEK_BASE_URL", DEFAULT_CONFIG.deepseekBaseUrl, onWarning, 400),
    onWarning,
  );
  const deepseekModel = readString(
    env,
    "DEEPSEEK_MODEL",
    DEFAULT_CONFIG.deepseekModel,
    onWarning,
    80,
  );
  const aiEnabled = readBoolean(env, "AI_ENABLED", DEFAULT_CONFIG.aiEnabled, onWarning);
  const aiTimeoutMs = readInteger(
    env,
    "AI_TIMEOUT_MS",
    DEFAULT_CONFIG.aiTimeoutMs,
    CONFIG_BOUNDS.aiTimeoutMs,
    onWarning,
  );
  const aiMaxRequestsPerHour = readInteger(
    env,
    "AI_MAX_REQUESTS_PER_HOUR",
    DEFAULT_CONFIG.aiMaxRequestsPerHour,
    CONFIG_BOUNDS.aiMaxRequestsPerHour,
    onWarning,
  );
  const aiMinIntervalMs = readInteger(
    env,
    "AI_MIN_INTERVAL_MS",
    DEFAULT_CONFIG.aiMinIntervalMs,
    CONFIG_BOUNDS.aiMinIntervalMs,
    onWarning,
  );
  const aiMaxTokens = readInteger(
    env,
    "AI_MAX_TOKENS",
    DEFAULT_CONFIG.aiMaxTokens,
    CONFIG_BOUNDS.aiMaxTokens,
    onWarning,
  );
  const aiTemperature = readDecimal(
    env,
    "AI_TEMPERATURE",
    DEFAULT_CONFIG.aiTemperature,
    CONFIG_BOUNDS.aiTemperature,
    onWarning,
  );

  return {
    port,
    deepseekApiKey,
    deepseekBaseUrl,
    deepseekModel,
    aiEnabled,
    aiTimeoutMs,
    aiMaxRequestsPerHour,
    aiMinIntervalMs,
    aiMaxTokens,
    aiTemperature,
  };
}

function readRaw(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readString(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
  onWarning: ConfigWarning,
  maxLength = 200,
): string {
  const raw = readRaw(env, name);
  if (raw === undefined) return fallback;
  if (raw.length > maxLength) {
    onWarning(`${name} 过长（>${maxLength} 字符），已使用默认值。`);
    return fallback;
  }
  return raw;
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
  onWarning: ConfigWarning,
): number {
  const raw = readRaw(env, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    onWarning(`${name} 不是有效整数，已使用默认值 ${fallback}。`);
    return fallback;
  }
  const clamped = clamp(parsed, bounds.min, bounds.max);
  if (clamped !== parsed) {
    onWarning(`${name}=${parsed} 超出范围 [${bounds.min}, ${bounds.max}]，已调整为 ${clamped}。`);
  }
  return clamped;
}

function readDecimal(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
  onWarning: ConfigWarning,
): number {
  const raw = readRaw(env, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    onWarning(`${name} 不是有效数字，已使用默认值 ${fallback}。`);
    return fallback;
  }
  const clamped = clamp(parsed, bounds.min, bounds.max);
  if (clamped !== parsed) {
    onWarning(`${name}=${parsed} 超出范围 [${bounds.min}, ${bounds.max}]，已调整为 ${clamped}。`);
  }
  return clamped;
}

function readBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
  onWarning: ConfigWarning,
): boolean {
  const raw = readRaw(env, name);
  if (raw === undefined) return fallback;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  onWarning(`${name}=${raw.slice(0, 20)} 不是有效布尔值，已使用默认值 ${fallback}。`);
  return fallback;
}

function normalizeBaseUrl(raw: string, onWarning: ConfigWarning): string {
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed.length === 0) return DEFAULT_CONFIG.deepseekBaseUrl;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return trimmed;
  } catch {
    onWarning("DEEPSEEK_BASE_URL 不是合法的 http(s) 地址，已使用默认值。");
    return DEFAULT_CONFIG.deepseekBaseUrl;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
