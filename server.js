require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

app.disable("x-powered-by");
app.use(express.json({ limit: "24kb" }));
app.use(express.static(path.join(__dirname, "public")));

const ACTIONS = new Set([
  "work", "trade", "share", "ally", "spread_rumor", "ask_help", "hoard"
]);

app.get("/api/status", (_req, res) => {
  res.json({ mode: API_KEY ? "online-ready" : "offline", model: MODEL });
});

app.post("/api/propose", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({ error: "未配置 DeepSeek API 密钥，当前使用离线模拟。" });
  }

  const residents = Array.isArray(req.body?.residents) ? req.body.residents.slice(0, 3) : [];
  const world = req.body?.world;
  if (!residents.length || !world || typeof world !== "object") {
    return res.status(400).json({ error: "请求数据不完整。" });
  }

  const compactResidents = residents.map((r) => ({
    id: String(r.id || "").slice(0, 32),
    name: String(r.name || "").slice(0, 40),
    faction: String(r.faction || "").slice(0, 40),
    job: String(r.job || "").slice(0, 40),
    goal: String(r.goal || "").slice(0, 120),
    personality: String(r.personality || "").slice(0, 100),
    resources: sanitizeNumbers(r.resources),
    memory: Array.isArray(r.memory) ? r.memory.slice(-2).map(x => String(x).slice(0, 180)) : []
  }));

  const compactWorld = {
    day: Math.max(1, Math.min(9999, Number(world.day) || 1)),
    resources: sanitizeNumbers(world.resources),
    metrics: sanitizeNumbers(world.metrics),
    factions: Array.isArray(world.factions) ? world.factions.slice(0, 3).map(f => ({
      id: String(f.id || "").slice(0, 32),
      name: String(f.name || "").slice(0, 50),
      influence: Number(f.influence) || 0
    })) : []
  };

  const system = [
    "你是赛博朋克城市生态模拟器中的行动提案器，不是游戏状态执行器。",
    "根据给定世界和居民信息，为每名居民提出一个行动。只输出严格 JSON，不要 Markdown。",
    "JSON 格式：{\"proposals\":[{\"residentId\":\"...\",\"action\":\"work|trade|share|ally|spread_rumor|ask_help|hoard\",\"target\":\"...\",\"reason\":\"不超过60字\"}]}",
    "行动只是提案，程序会自行校验并决定是否执行。不要输出资源数值或要求执行代码。",
    "只使用输入中的居民 ID 和势力 ID；target 可以是居民 ID、势力 ID 或简短目标描述。"
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ world: compactWorld, residents: compactResidents }) }
        ]
      })
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ error: `模型服务返回错误 (${response.status})`, detail: body.slice(0, 240) });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content || "{}");
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, 3) : [];
    const safe = proposals.map(p => ({
      residentId: String(p.residentId || "").slice(0, 32),
      action: ACTIONS.has(p.action) ? p.action : "work",
      target: String(p.target || "").slice(0, 60),
      reason: String(p.reason || "在城市中寻找生存机会。").slice(0, 100)
    }));
    res.json({ proposals: safe, model: MODEL });
  } catch (err) {
    res.status(502).json({ error: err.name === "AbortError" ? "模型请求超时。" : "无法解析模型响应。", detail: String(err.message || "").slice(0, 180) });
  }
});

function sanitizeNumbers(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [key, val] of Object.entries(value).slice(0, 12)) {
    if (typeof val === "number" && Number.isFinite(val)) out[String(key).slice(0, 32)] = Math.max(-100000, Math.min(100000, val));
  }
  return out;
}

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`NEON//ECOLOGY running at http://localhost:${PORT}`);
  console.log(`DeepSeek: ${API_KEY ? "configured" : "offline mode (no API key)"}`);
});
