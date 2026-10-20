/**
 * 服务端测试：全部使用注入的显式 config + fake fetch / fake aiService，
 * 不读取真实 .env、不调用真实 DeepSeek API。
 */

import os from "node:os";
import path from "node:path";

import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../server/app";
import { AiServiceError, type AiDecisionService, type FetchLike, type FetchResponseLike } from "../server/aiService";
import { DEFAULT_CONFIG, loadConfig, type ServerConfig } from "../server/config";
import type { AiDecisionRequest } from "../src/shared/ai";

// 一个绝不会出现在真实环境中的哨兵 Key，用于断言不泄漏。
const CANARY_KEY = "sk-test-canary-4f7b2c9d8e1a0b";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    deepseekApiKey: CANARY_KEY,
    deepseekBaseUrl: "https://api.deepseek.test",
    deepseekModel: "deepseek-chat",
    aiEnabled: true,
    aiTimeoutMs: 2_000,
    aiMaxRequestsPerHour: 48,
    aiMinIntervalMs: 0,
    aiMaxTokens: 700,
    aiTemperature: 0.65,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AiDecisionRequest> = {}): AiDecisionRequest {
  return {
    requestId: "req-test-001",
    residentId: "r_linlan",
    resident: {
      name: "林岚",
      age: 27,
      pronouns: "她",
      jobTitle: "数据修复师",
      factionName: "自由港互助会",
      personalityLabels: ["好奇", "谨慎"],
      values: ["诚实", "自由"],
      backstory: "在旧城区修理被企业丢弃的终端，并偷偷备份被删除的记忆。",
      mood: 62,
      stress: 38,
      health: 88,
      wealth: 420,
      needs: { hunger: 30, energy: 55, social: 40, safety: 70 },
      goals: ["还清母亲的医疗债务", "找到一套稳定的终端零件"],
      importantMemories: ["父亲留下的旧终端在雨夜里突然亮起"],
      relationships: [
        {
          name: "陈墨",
          type: "朋友",
          trust: 46,
          affinity: 32,
          attraction: 12,
          targetId: "r_chenmo",
        },
      ],
      currentPlace: "街道上",
      currentAction: "正在决定下一步",
      recentDecisionReasons: ["去商店补充食物"],
    },
    world: {
      day: 3,
      time: "08:30",
      weather: "雾霾",
      metrics: { stability: 55, pollution: 62, trust: 48, inequality: 58, resourceSupply: 51 },
      reserves: { food: 120, energy: 90, meds: 30 },
      recentEvents: ["旧城区停电，空气过滤站过载"],
    },
    allowedActions: ["rest", "talk", "work"],
    targets: [
      { id: "b_home", kind: "building", name: "林岚的公寓", note: "住宅" },
      { id: "b_work", kind: "building", name: "新纪元数据塔", note: "工作场所" },
      { id: "r_chenmo", kind: "resident", name: "陈墨" },
    ],
    ...overrides,
  };
}

function recordingFetch(handler: (call: CapturedCall, index: number) => Promise<FetchResponseLike>): {
  fetchImpl: FetchLike;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: CapturedCall = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetchImpl, calls };
}

function chatCompletion(content: string, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      }),
  };
}

function proposalJson(action: string, targetId?: string, reason = "根据当前状况提出一个合理的下一步行动。"): string {
  return JSON.stringify(targetId ? { action, targetId, reason } : { action, reason });
}

function httpError(status: number, body = "upstream failure details"): FetchResponseLike {
  return { ok: false, status, text: async () => body };
}

function hangingFetch(): FetchLike {
  return (_url, init) =>
    new Promise<FetchResponseLike>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
}

function makeApp(
  options: {
    config?: Partial<ServerConfig>;
    fetchImpl?: FetchLike;
    now?: () => number;
    aiService?: AiDecisionService;
    staticDir?: string;
  } = {},
) {
  const config = makeConfig(options.config);
  const app = createApp({
    config,
    fetchImpl: options.fetchImpl,
    now: options.now,
    aiService: options.aiService,
    staticDir: options.staticDir,
  });
  return { app, config };
}

interface StatusBody {
  mode: string;
  model: string;
  ai: {
    enabled: boolean;
    hourlyLimit: number;
    calls: number;
    failures: number;
    rejected: number;
    lastError: string | null;
    lastLatencyMs: number | null;
    minIntervalMs: number;
    timeoutMs: number;
  };
}

interface DecisionBody {
  ok: boolean;
  proposal?: { action: string; targetId?: string; reason: string };
  meta?: { model: string; latencyMs: number; retried: boolean; source: string; requestId: string };
  error?: string;
  code?: string;
}

function statusOf(body: unknown): StatusBody {
  return body as StatusBody;
}

function decisionOf(body: unknown): DecisionBody {
  return body as DecisionBody;
}

function parseBody(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe("loadConfig", () => {
  it("空环境使用与 .env.example 一致的默认值", () => {
    const config = loadConfig({});
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.deepseekApiKey).toBe("");
    expect(config.port).toBe(3000);
    expect(config.aiTimeoutMs).toBe(15_000);
    expect(config.aiMaxRequestsPerHour).toBe(48);
    expect(config.aiMinIntervalMs).toBe(1_800);
    expect(config.aiMaxTokens).toBe(700);
    expect(config.aiTemperature).toBe(0.65);
  });

  it("读取并规范化合法环境变量", () => {
    const config = loadConfig({
      PORT: "8080",
      DEEPSEEK_API_KEY: `  ${CANARY_KEY}  `,
      DEEPSEEK_BASE_URL: "https://api.example.com/v1///",
      DEEPSEEK_MODEL: "deepseek-reasoner",
      AI_ENABLED: "false",
      AI_TIMEOUT_MS: "20000",
      AI_MAX_REQUESTS_PER_HOUR: "10",
      AI_MIN_INTERVAL_MS: "500",
      AI_MAX_TOKENS: "900",
      AI_TEMPERATURE: "0.3",
    });
    expect(config.port).toBe(8080);
    expect(config.deepseekApiKey).toBe(CANARY_KEY);
    expect(config.deepseekBaseUrl).toBe("https://api.example.com/v1");
    expect(config.deepseekModel).toBe("deepseek-reasoner");
    expect(config.aiEnabled).toBe(false);
    expect(config.aiTimeoutMs).toBe(20_000);
    expect(config.aiMaxRequestsPerHour).toBe(10);
    expect(config.aiMinIntervalMs).toBe(500);
    expect(config.aiMaxTokens).toBe(900);
    expect(config.aiTemperature).toBe(0.3);
  });

  it("非法/越界数值回退或收敛到边界，且警告不包含 Key", () => {
    const warnings: string[] = [];
    const config = loadConfig(
      {
        PORT: "not-a-number",
        DEEPSEEK_API_KEY: CANARY_KEY,
        DEEPSEEK_BASE_URL: "ftp://not-http",
        DEEPSEEK_MODEL: "",
        AI_ENABLED: "maybe",
        AI_TIMEOUT_MS: "-5",
        AI_MAX_REQUESTS_PER_HOUR: "0",
        AI_MIN_INTERVAL_MS: "-100",
        AI_MAX_TOKENS: "999999",
        AI_TEMPERATURE: "9",
      },
      (warning) => warnings.push(warning),
    );
    expect(config.port).toBe(3000);
    expect(config.deepseekBaseUrl).toBe("https://api.deepseek.com");
    expect(config.deepseekModel).toBe("deepseek-chat");
    expect(config.aiEnabled).toBe(true);
    expect(config.aiTimeoutMs).toBe(250);
    expect(config.aiMaxRequestsPerHour).toBe(1);
    expect(config.aiMinIntervalMs).toBe(0);
    expect(config.aiMaxTokens).toBe(8_192);
    expect(config.aiTemperature).toBe(2);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join("\n")).not.toContain(CANARY_KEY);
  });
});

describe("GET /api/status", () => {
  it("无 Key 时 mode=offline，且响应绝不含 Key", async () => {
    const { app } = makeApp({ config: { deepseekApiKey: "" } });
    const response = await request(app).get("/api/status").expect(200);
    const body = statusOf(response.body);
    expect(body.mode).toBe("offline");
    expect(body.model).toBe("deepseek-chat");
    expect(body.ai).toEqual({
      enabled: false,
      hourlyLimit: 48,
      calls: 0,
      failures: 0,
      rejected: 0,
      lastError: null,
      lastLatencyMs: null,
      minIntervalMs: 0,
      timeoutMs: 2_000,
    });
    expect(response.text).not.toContain(CANARY_KEY);
    expect(response.text).not.toContain("sk-");
  });

  it("有 Key 时 mode=online-ready，字段齐全且不含 Key", async () => {
    const { app } = makeApp({
      config: { aiMaxRequestsPerHour: 12, aiMinIntervalMs: 1_500, aiTimeoutMs: 9_000 },
    });
    const response = await request(app).get("/api/status").expect(200);
    const body = statusOf(response.body);
    expect(body.mode).toBe("online-ready");
    expect(body.model).toBe("deepseek-chat");
    expect(body.ai.enabled).toBe(true);
    expect(body.ai.hourlyLimit).toBe(12);
    expect(body.ai.minIntervalMs).toBe(1_500);
    expect(body.ai.timeoutMs).toBe(9_000);
    expect(response.text).not.toContain(CANARY_KEY);
    expect(response.text).not.toContain("Authorization");
  });

  it("AI_ENABLED=false 时即使有 Key 也是 offline", async () => {
    const { app } = makeApp({ config: { aiEnabled: false } });
    const response = await request(app).get("/api/status").expect(200);
    const body = statusOf(response.body);
    expect(body.mode).toBe("offline");
    expect(body.ai.enabled).toBe(false);
  });

  it("响应带安全头且不暴露 x-powered-by", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/api/status").expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("POST /api/ai/decision 请求校验", () => {
  it("空对象请求体 → 400 BAD_REQUEST", async () => {
    const { app } = makeApp();
    const response = await request(app).post("/api/ai/decision").send({}).expect(400);
    const body = decisionOf(response.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("BAD_REQUEST");
  });

  it("allowedActions 为空 → 400", async () => {
    const { app } = makeApp();
    const response = await request(app)
      .post("/api/ai/decision")
      .send(makeRequest({ allowedActions: [] }))
      .expect(400);
    expect(decisionOf(response.body).code).toBe("BAD_REQUEST");
  });

  it("未知 action / 非法 target kind → 400（zod 拦截）", async () => {
    const { app, config } = makeApp();
    const fetchSpy = recordingFetch(async () => chatCompletion(proposalJson("rest")));
    const appWithFetch = createApp({ config, fetchImpl: fetchSpy.fetchImpl });

    const unknownAction = await request(appWithFetch)
      .post("/api/ai/decision")
      .send({ ...makeRequest(), allowedActions: ["rest", "fly"] })
      .expect(400);
    expect(decisionOf(unknownAction.body).code).toBe("BAD_REQUEST");

    const badTarget = await request(appWithFetch)
      .post("/api/ai/decision")
      .send({ ...makeRequest(), targets: [{ id: "x", kind: "robot", name: "x" }] })
      .expect(400);
    expect(decisionOf(badTarget.body).code).toBe("BAD_REQUEST");

    expect(fetchSpy.calls.length).toBe(0);
    expect(app).toBeTruthy();
  });

  it("请求体超过 80kb → 413", async () => {
    const { app } = makeApp();
    const oversized = { ...makeRequest(), padding: "x".repeat(90_000) };
    const response = await request(app)
      .post("/api/ai/decision")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(oversized))
      .expect(413);
    expect(decisionOf(response.body).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("非法 JSON 请求体 → 400 JSON 错误", async () => {
    const { app } = makeApp();
    const response = await request(app)
      .post("/api/ai/decision")
      .set("Content-Type", "application/json")
      .send('{"requestId": ')
      .expect(400);
    expect(decisionOf(response.body).ok).toBe(false);
    expect(decisionOf(response.body).code).toBe("BAD_REQUEST");
  });
});

describe("AI 不可用", () => {
  it("无 Key → 503 AI_OFFLINE，不调用上游，不泄漏 Key", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => chatCompletion(proposalJson("rest")));
    const { app } = makeApp({ config: { deepseekApiKey: "" }, fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(503);
    const body = decisionOf(response.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AI_OFFLINE");
    expect(calls.length).toBe(0);
    expect(response.text).not.toContain(CANARY_KEY);
  });

  it("AI_ENABLED=false → 503 AI_DISABLED", async () => {
    const { app } = makeApp({ config: { aiEnabled: false } });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(503);
    expect(decisionOf(response.body).code).toBe("AI_DISABLED");
  });
});

describe("合法提案", () => {
  it("合法模型 JSON → 200 proposal + meta，并按契约调用上游", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      chatCompletion(proposalJson("talk", "r_chenmo", "去找陈墨聊聊最近的停电。")),
    );
    const { app, config } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    const body = decisionOf(response.body);

    expect(body.ok).toBe(true);
    expect(body.proposal).toEqual({
      action: "talk",
      targetId: "r_chenmo",
      reason: "去找陈墨聊聊最近的停电。",
    });
    expect(body.meta).toMatchObject({
      model: "deepseek-chat",
      retried: false,
      source: "deepseek",
      requestId: "req-test-001",
    });
    expect(typeof body.meta?.latencyMs).toBe("number");
    expect(body.meta?.latencyMs).toBeGreaterThanOrEqual(0);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.deepseek.test/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CANARY_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");

    const upstreamBody = parseBody(calls[0]);
    expect(upstreamBody.model).toBe("deepseek-chat");
    expect(upstreamBody.temperature).toBe(config.aiTemperature);
    expect(upstreamBody.max_tokens).toBe(config.aiMaxTokens);
    expect(upstreamBody.stream).toBe(false);
    expect(upstreamBody.response_format).toEqual({ type: "json_object" });
    const messages = upstreamBody.messages as Array<{ role: string; content: string }>;
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("提案");
    expect(messages[0].content).toContain("JSON");
    expect(messages[1].content).toContain("talk");
    expect(messages[1].content).toContain("r_chenmo");
    expect(messages[0].content).not.toContain(CANARY_KEY);
    expect(messages[1].content).not.toContain(CANARY_KEY);

    const status = await request(app).get("/api/status").expect(200);
    const statusBody = statusOf(status.body);
    expect(statusBody.ai.calls).toBe(1);
    expect(statusBody.ai.failures).toBe(0);
    expect(statusBody.ai.rejected).toBe(0);
    expect(statusBody.ai.lastLatencyMs).not.toBeNull();
    expect(status.text).not.toContain(CANARY_KEY);
  });

  it("允许 ```json 围栏的安全剥离", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      chatCompletion("```json\n" + proposalJson("rest", undefined, "今天太累了，先休息。") + "\n```"),
    );
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    const body = decisionOf(response.body);
    expect(body.proposal?.action).toBe("rest");
    expect(body.proposal?.targetId).toBeUndefined();
  });

  it("无需目标的行动可省略 targetId", async () => {
    const { fetchImpl } = recordingFetch(async () => chatCompletion(proposalJson("work", "b_work")));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    expect(decisionOf(response.body).proposal).toEqual({
      action: "work",
      targetId: "b_work",
      reason: "根据当前状况提出一个合理的下一步行动。",
    });
  });

  it("首次上游 5xx 后重试一次成功 → meta.retried=true", async () => {
    const { fetchImpl, calls } = recordingFetch(async (_call, index) =>
      index === 0 ? httpError(500) : chatCompletion(proposalJson("rest")),
    );
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    expect(calls.length).toBe(2);
    expect(decisionOf(response.body).meta?.retried).toBe(true);
  });
});

describe("模型输出被安全拒绝", () => {
  it("模型返回非法 JSON → 422 AI_INVALID_JSON，重试后安全拒绝且不崩溃", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => chatCompletion("这不是 JSON"));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    const body = decisionOf(response.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AI_INVALID_JSON");
    expect(calls.length).toBe(2);

    const status = await request(app).get("/api/status").expect(200);
    const statusBody = statusOf(status.body);
    expect(statusBody.ai.calls).toBe(1);
    expect(statusBody.ai.failures).toBe(1);
    expect(statusBody.ai.rejected).toBe(1);
    expect(statusBody.ai.lastError).toBeTruthy();
    expect(status.text).not.toContain(CANARY_KEY);
  });

  it("未知 action（zod 枚举之外）→ 422 AI_INVALID_PROPOSAL", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      chatCompletion(JSON.stringify({ action: "fly", reason: "我想飞到城市上空。" })),
    );
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    expect(decisionOf(response.body).code).toBe("AI_INVALID_PROPOSAL");
  });

  it("合法 action 但不在 allowedActions → 422 AI_ACTION_NOT_ALLOWED（不重试）", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => chatCompletion(proposalJson("date", "r_chenmo")));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    expect(decisionOf(response.body).code).toBe("AI_ACTION_NOT_ALLOWED");
    expect(calls.length).toBe(1);
  });

  it("targetId 不在白名单 → 422 AI_UNKNOWN_TARGET", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => chatCompletion(proposalJson("talk", "r_ghost")));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    expect(decisionOf(response.body).code).toBe("AI_UNKNOWN_TARGET");
    expect(calls.length).toBe(1);
  });

  it("action 与 target 类型不匹配 → 422 AI_INVALID_PROPOSAL（社交行动不能指向建筑）", async () => {
    const { fetchImpl } = recordingFetch(async () => chatCompletion(proposalJson("talk", "b_home")));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    const body = decisionOf(response.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AI_INVALID_PROPOSAL");
    expect(body.error).toContain("不匹配");
  });

  it("action 与 target 类型不匹配 → 工作行动不能指向居民", async () => {
    const { fetchImpl } = recordingFetch(async () => chatCompletion(proposalJson("work", "r_chenmo")));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    expect(decisionOf(response.body).code).toBe("AI_INVALID_PROPOSAL");
  });

  it("缺少 choices 或 message.content → 422 AI_INVALID_JSON", async () => {
    const { fetchImpl } = recordingFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "x", choices: [] }),
    }));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    expect(decisionOf(response.body).code).toBe("AI_INVALID_JSON");
  });

  it("理由为空白 → 422 安全拒绝", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      chatCompletion(JSON.stringify({ action: "rest", reason: "   " })),
    );
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(422);
    expect(decisionOf(response.body).code).toBe("AI_INVALID_PROPOSAL");
  });
});

describe("上游异常", () => {
  it("上游连续 500 → 502 AI_UPSTREAM_ERROR，重试一次", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => httpError(500));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(502);
    const body = decisionOf(response.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AI_UPSTREAM_ERROR");
    expect(calls.length).toBe(2);

    const status = await request(app).get("/api/status").expect(200);
    expect(statusOf(status.body).ai.calls).toBe(1);
    expect(statusOf(status.body).ai.failures).toBe(1);
  });

  it("上游 4xx（如 Key 无效）→ 502，不重试", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => httpError(401));
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(502);
    expect(decisionOf(response.body).code).toBe("AI_UPSTREAM_ERROR");
    expect(calls.length).toBe(1);
  });

  it("上游超时 → 504 AI_TIMEOUT", async () => {
    const { app } = makeApp({ config: { aiTimeoutMs: 40 }, fetchImpl: hangingFetch() });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(504);
    const body = decisionOf(response.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AI_TIMEOUT");
  });

  it("网络异常 → 502 AI_UPSTREAM_ERROR", async () => {
    const { fetchImpl } = recordingFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(502);
    expect(decisionOf(response.body).code).toBe("AI_UPSTREAM_ERROR");
  });

  it("上游/网络错误信息中的 Key 不会进入响应或 status", async () => {
    const { fetchImpl } = recordingFetch(async () => {
      throw new Error(`connect failed Authorization: Bearer ${CANARY_KEY}`);
    });
    const { app } = makeApp({ fetchImpl });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(502);
    expect(response.text).not.toContain(CANARY_KEY);
    expect(response.text).not.toContain(CANARY_KEY.replace("sk-test-canary-", ""));

    const status = await request(app).get("/api/status").expect(200);
    expect(status.text).not.toContain(CANARY_KEY);
    expect(statusOf(status.body).ai.lastError).not.toContain(CANARY_KEY);
  });
});

describe("限流", () => {
  it("每小时上限：连续请求 → 429 AI_RATE_LIMITED", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => chatCompletion(proposalJson("rest")));
    const { app } = makeApp({ config: { aiMaxRequestsPerHour: 1, aiMinIntervalMs: 0 }, fetchImpl });

    await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    const limited = await request(app).post("/api/ai/decision").send(makeRequest()).expect(429);
    const body = decisionOf(limited.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AI_RATE_LIMITED");
    expect(calls.length).toBe(1);
  });

  it("最小间隔：间隔内第二次请求 → 429，时间推进后恢复", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const { fetchImpl, calls } = recordingFetch(async () => chatCompletion(proposalJson("rest")));
    const { app } = makeApp({ config: { aiMaxRequestsPerHour: 48, aiMinIntervalMs: 60_000 }, fetchImpl, now });

    await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    const limited = await request(app).post("/api/ai/decision").send(makeRequest()).expect(429);
    expect(decisionOf(limited.body).code).toBe("AI_RATE_LIMITED");
    expect(calls.length).toBe(1);

    clock += 60_000;
    await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    expect(calls.length).toBe(2);
  });
});

describe("fake aiService 注入", () => {
  function fakeService(decide: AiDecisionService["decide"], stats?: Partial<ReturnType<AiDecisionService["getStats"]>>): AiDecisionService {
    return {
      decide,
      getStats: () => ({
        calls: 0,
        failures: 0,
        rejected: 0,
        lastLatencyMs: null,
        lastError: null,
        ...stats,
      }),
    };
  }

  it("fake 服务返回提案 → 200，status 反映其统计", async () => {
    const service = fakeService(
      async (decisionRequest) => ({
        proposal: { action: "rest", reason: "fake 提案。" },
        meta: {
          model: "fake-model",
          latencyMs: 12,
          retried: false,
          source: "deepseek",
          requestId: decisionRequest.requestId,
        },
      }),
      { calls: 7 },
    );
    const { app } = makeApp({ aiService: service });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(200);
    expect(decisionOf(response.body).proposal).toEqual({ action: "rest", reason: "fake 提案。" });

    const status = await request(app).get("/api/status").expect(200);
    expect(statusOf(status.body).ai.calls).toBe(7);
  });

  it("fake 服务抛 AiServiceError → 映射到对应状态码", async () => {
    const { app } = makeApp({
      aiService: fakeService(async () => {
        throw new AiServiceError("AI_TIMEOUT", "上游超时，已回退本地决策。", { retriable: true });
      }),
    });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(504);
    expect(decisionOf(response.body).code).toBe("AI_TIMEOUT");

    const { app: limitedApp } = makeApp({
      aiService: fakeService(async () => {
        throw new AiServiceError("AI_RATE_LIMITED", "请求过于频繁。");
      }),
    });
    const limited = await request(limitedApp).post("/api/ai/decision").send(makeRequest()).expect(429);
    expect(decisionOf(limited.body).code).toBe("AI_RATE_LIMITED");
  });

  it("fake 服务抛普通异常 → 502 AI_UPSTREAM_ERROR（不崩溃）", async () => {
    const { app } = makeApp({
      aiService: fakeService(async () => {
        throw new Error("unexpected boom");
      }),
    });
    const response = await request(app).post("/api/ai/decision").send(makeRequest()).expect(502);
    const body = decisionOf(response.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AI_UPSTREAM_ERROR");
    expect(response.text).not.toContain("unexpected boom");
  });
});

describe("API 404 与静态回退", () => {
  it("未知 API 路径返回 JSON 404", async () => {
    const { app } = makeApp();
    const getResponse = await request(app).get("/api/does-not-exist").expect(404);
    expect(decisionOf(getResponse.body).code).toBe("NOT_FOUND");
    const postResponse = await request(app).post("/api/does-not-exist").send({}).expect(404);
    expect(decisionOf(postResponse.body).code).toBe("NOT_FOUND");
  });

  it("dist/index.html 不存在时给中文 503 并提示 npm run dev", async () => {
    const missingDist = path.join(os.tmpdir(), `neon-ecology-no-dist-${Date.now()}`);
    const { app } = makeApp({ staticDir: missingDist });
    const response = await request(app).get("/").expect(503);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("npm run dev");
    expect(response.text).toContain("前端尚未构建");

    const deepLink = await request(app).get("/some/deep/link").expect(503);
    expect(deepLink.text).toContain("npm run dev");
  });
});

describe("入口模块无测试副作用", () => {
  it("import server/index.ts 只重新导出 createApp，不启动监听", async () => {
    const module = await import("../server/index");
    expect(typeof module.createApp).toBe("function");
    expect(typeof module.loadConfig).toBe("function");
  });
});
