import { WEATHER_META } from "../shared/constants";
import { formatClock } from "../shared/format";
import type { AiRuntimeInfo, InteractionMode, SimSpeed } from "../shared/types";
import { simulationStore, useSimulation } from "../store/useSimulation";
import { cx } from "./ui";

const SPEEDS: SimSpeed[] = [1, 2, 4];
const MODES: Array<{ id: InteractionMode; label: string; hint: string }> = [
  { id: "observe", label: "观察", hint: "只读：居民与世界自主演化，不能修改状态。" },
  { id: "intervene", label: "干预", hint: "造物主：所有编辑会直接写入模拟状态。" },
];

type AiBadgeState = "online" | "offline" | "pending" | "error" | "disabled";

function describeAi(ai: AiRuntimeInfo): { state: AiBadgeState; label: string; hint: string } {
  if (!ai.enabled) {
    return { state: "disabled", label: "AI 已停用", hint: "AI 顾问已停用，居民使用本地决策。" };
  }
  if (ai.pending) {
    return { state: "pending", label: "AI 等待", hint: "正在等待 DeepSeek 决策提案…" };
  }
  if (!ai.serviceAvailable) {
    return ai.lastError
      ? { state: "error", label: "AI 错误", hint: ai.lastError }
      : {
          state: "offline",
          label: "AI 离线",
          hint: "未检测到本地 AI 服务；模拟照常运行，居民使用本地决策。",
        };
  }
  if (ai.lastError) {
    return { state: "error", label: "AI 错误", hint: ai.lastError };
  }
  return {
    state: "online",
    label: "AI 在线",
    hint: `DeepSeek 顾问可用${ai.model ? ` · ${ai.model}` : ""}${ai.hourlyLimit ? ` · 每小时上限 ${ai.hourlyLimit}` : ""}`,
  };
}

export function TopBar() {
  const state = useSimulation();
  const { world, paused, speed, mode, ai, consoleOpen } = state;
  const weather = WEATHER_META[world.weather.condition];
  const aiBadge = describeAi(ai);
  const selectedResident =
    state.selected?.kind === "resident"
      ? world.residents.find((resident) => resident.id === state.selected?.id)
      : undefined;

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-sigil" aria-hidden="true">
          ◈
        </span>
        <span className="brand-text">
          <span className="brand-name">
            NEON<span className="brand-slash">//</span>ECOLOGY
          </span>
          <span className="brand-sub">
            霓虹生态箱 · {world.name} · v{world.ruleVersion}
          </span>
        </span>
      </div>

      <div className="topbar-clock" title={`第 ${world.clock.day} 天 · tick ${world.clock.tick} · 30 分钟/刻`}>
        <span className="clock-day">D{String(world.clock.day).padStart(2, "0")}</span>
        <span className="clock-time mono">{formatClock(world.clock.minuteOfDay)}</span>
        <span className="clock-progress" aria-hidden="true">
          <i style={{ width: `${(world.clock.minuteOfDay / 1440) * 100}%` }} />
        </span>
        <span className="clock-tick mono">t{world.clock.tick}</span>
      </div>

      <div
        className="topbar-weather"
        title={`${weather.label} · 强度 ${Math.round(world.weather.intensity * 100)}% · ${weather.description}`}
      >
        <span className="weather-icon" style={{ color: weather.color }} aria-hidden="true">
          {weather.icon}
        </span>
        <span className="weather-label">{weather.label}</span>
        <span className="weather-intensity mono">{Math.round(world.weather.intensity * 100)}%</span>
      </div>

      <div className={cx("ai-badge", `ai-badge-${aiBadge.state}`)} title={aiBadge.hint}>
        <span className="ai-dot" aria-hidden="true" />
        <span className="ai-label">{aiBadge.label}</span>
        <span className="ai-meta mono">{ai.calls}/{ai.failures}</span>
        <span className="ai-actions">
          <button
            type="button"
            className="icon-btn"
            title="刷新 AI 状态"
            aria-label="刷新 AI 状态"
            onClick={() => {
              void simulationStore.refreshAiStatus();
            }}
          >
            ↻
          </button>
          <button
            type="button"
            className={cx("icon-btn", ai.enabled && "is-on")}
            title={ai.enabled ? "停用 AI 顾问" : "启用 AI 顾问"}
            aria-label={ai.enabled ? "停用 AI 顾问" : "启用 AI 顾问"}
            onClick={() => simulationStore.setAiEnabled(!ai.enabled)}
          >
            ⏻
          </button>
          <button
            type="button"
            className="icon-btn"
            title={
              selectedResident
                ? `为 ${selectedResident.name} 请求 AI 决策`
                : "先在场景或居民列表里选择一名居民"
            }
            aria-label="为选中居民请求 AI 决策"
            disabled={!selectedResident || !ai.enabled}
            onClick={() => {
              void simulationStore.requestAiForSelected();
            }}
          >
            ✦
          </button>
        </span>
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-controls">
        <button
          type="button"
          className={cx("btn", "btn-pause", paused ? "btn-warn" : "btn-ghost")}
          title={paused ? "继续模拟（快捷键 Space）" : "暂停模拟（快捷键 Space）"}
          onClick={() => simulationStore.togglePause()}
        >
          {paused ? "▶ 继续" : "❚❚ 暂停"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          title="暂停并推进 30 分钟（一个 tick）"
          onClick={() => simulationStore.stepOnce()}
        >
          单步 ⏭
        </button>

        <div className="seg" role="group" aria-label="模拟速度">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={cx("seg-btn", speed === value && "is-active")}
              title={`${value} 倍速：${value === 1 ? "1200" : value === 2 ? "650" : "330"}ms / tick`}
              onClick={() => simulationStore.setSpeed(value)}
            >
              {value}x
            </button>
          ))}
        </div>

        <div className="seg seg-mode" role="group" aria-label="交互模式">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("seg-btn", mode === item.id && "is-active", `seg-${item.id}`)}
              title={item.hint}
              onClick={() => simulationStore.setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={cx("btn", consoleOpen ? "btn-primary" : "btn-ghost")}
          title={consoleOpen ? "收起造物主控制台" : "展开造物主控制台"}
          onClick={() => simulationStore.setConsoleOpen(!consoleOpen)}
        >
          ▤ 控制台 {consoleOpen ? "▾" : "▴"}
        </button>
      </div>
    </header>
  );
}
