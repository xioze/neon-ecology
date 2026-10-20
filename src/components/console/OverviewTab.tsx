import { buildAiDecisionRequest } from "../../sim/aiContext";
import { formatClock, formatMoney, formatPercent, moodLabel } from "../../shared/format";
import { WEATHER_META } from "../../shared/constants";
import type { AiRuntimeInfo } from "../../shared/types";
import { simulationStore, useSimulation } from "../../store/useSimulation";
import { EVENT_TYPE_LABELS, eventTypeTone } from "../labels";
import { cx, DataRow, EmptyHint, MetricBar, Tag, toneForInverse, toneForScore } from "../ui";

function aiStateLabel(ai: AiRuntimeInfo): { text: string; tone: "good" | "bad" | "warn" | "neutral" | "magenta" } {
  if (!ai.enabled) return { text: "已停用", tone: "neutral" };
  if (ai.pending) return { text: "请求中", tone: "warn" };
  if (!ai.serviceAvailable) return { text: ai.lastError ? "错误" : "离线", tone: ai.lastError ? "bad" : "neutral" };
  if (ai.lastError) return { text: "错误", tone: "bad" };
  return { text: "在线", tone: "good" };
}

export function OverviewTab() {
  const state = useSimulation();
  const { world, paused, speed, ai, lastTickReport, lastAiMessage, snapshots, saveStatus, mode, selected } = state;
  const weather = WEATHER_META[world.weather.condition];
  const latestEvent = world.events[0];
  const aiState = aiStateLabel(ai);
  const selectedResident =
    selected?.kind === "resident"
      ? world.residents.find((resident) => resident.id === selected.id)
      : undefined;
  const requestPreview = selectedResident ? buildAiDecisionRequest(world, selectedResident.id) : null;

  return (
    <div className="overview-grid">
      <section className="ov-card ov-card-time">
        <header className="ov-card-head">
          <h5>时间控制</h5>
          <span className="muted mono">
            {paused ? "已暂停" : `${speed} 倍速`} · 30 分钟 / tick
          </span>
        </header>
        <div className="ov-time-display">
          <strong className="mono">D{String(world.clock.day).padStart(2, "0")}</strong>
          <span className="mono">{formatClock(world.clock.minuteOfDay)}</span>
          <span className="muted mono">tick {world.clock.tick}</span>
        </div>
        <div className="ov-btn-row">
          <button type="button" className={cx("btn", paused ? "btn-warn" : "btn-ghost")} onClick={() => simulationStore.togglePause()}>
            {paused ? "▶ 继续" : "❚❚ 暂停"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => simulationStore.stepOnce()}>
            ⏭ 单步
          </button>
          {[1, 2, 4].map((value) => (
            <button
              key={value}
              type="button"
              className={cx("seg-btn", "btn-tiny", speed === value && "is-active")}
              onClick={() => simulationStore.setSpeed(value as 1 | 2 | 4)}
            >
              {value}x
            </button>
          ))}
        </div>
        <div className="ov-kv">
          <span>上次 tick</span>
          <span className="mono">
            {lastTickReport
              ? `新行动 ${lastTickReport.actionsStarted} · 完成 ${lastTickReport.actionsCompleted} · 事件 ${lastTickReport.eventsCreated}`
              : "等待第一帧"}
          </span>
        </div>
        <div className="ov-kv">
          <span>模式</span>
          <span className={cx("mode-pill", `mode-${mode}`)}>{mode === "intervene" ? "干预模式" : "观察模式"}</span>
        </div>
      </section>

      <section className="ov-card">
        <header className="ov-card-head">
          <h5>世界指标</h5>
          <span className="muted mono">{formatPercent(world.metrics.population > 0 ? world.metrics.averageMood : 0)} 情绪</span>
        </header>
        <div className="ov-metric-grid">
          <MetricBar label="稳定度" value={world.metrics.stability} compact tone={toneForScore(world.metrics.stability)} />
          <MetricBar label="污染" value={world.metrics.pollution} compact tone={toneForInverse(world.metrics.pollution)} />
          <MetricBar label="信任" value={world.metrics.trust} compact tone={toneForScore(world.metrics.trust)} />
          <MetricBar label="贫富差距" value={world.metrics.inequality} compact tone={toneForInverse(world.metrics.inequality)} />
          <MetricBar label="资源供应" value={world.metrics.resourceSupply} compact tone={toneForScore(world.metrics.resourceSupply)} />
          <MetricBar label="平均情绪" value={world.metrics.averageMood} compact tone={toneForScore(world.metrics.averageMood)} />
        </div>
        <div className="ov-kv">
          <span>平均财富 / 人口</span>
          <span className="mono">
            {formatMoney(world.metrics.averageWealth)} · {world.metrics.population} 人
          </span>
        </div>
        <div className="ov-kv">
          <span>平均情绪评价</span>
          <span>{moodLabel(world.metrics.averageMood)}</span>
        </div>
        <div className="ov-kv">
          <span>天气</span>
          <span>
            <i style={{ color: weather.color }}>{weather.icon}</i> {weather.label} · 强度{" "}
            {Math.round(world.weather.intensity * 100)}% · 至 t{world.weather.untilTick}
          </span>
        </div>
      </section>

      <section className="ov-card">
        <header className="ov-card-head">
          <h5>公共资源</h5>
          <span className="muted mono">种子 {world.seed}</span>
        </header>
        <div className="reserve-grid ov-reserve-grid">
          <div className="reserve-cell">
            <span className="reserve-label">信用点</span>
            <span className="reserve-value mono">{formatMoney(world.reserves.credits)}</span>
          </div>
          <div className="reserve-cell">
            <span className="reserve-label">食物</span>
            <span className="reserve-value mono">{Math.round(world.reserves.food)}</span>
          </div>
          <div className="reserve-cell">
            <span className="reserve-label">能源</span>
            <span className="reserve-value mono">{Math.round(world.reserves.energy)}</span>
          </div>
          <div className="reserve-cell">
            <span className="reserve-label">医疗</span>
            <span className="reserve-value mono">{Math.round(world.reserves.meds)}</span>
          </div>
        </div>
        <div className="ov-kv">
          <span>世界</span>
          <span>
            {world.name} · 规则 v{world.ruleVersion} · {world.rules.factionsActive ? "势力模拟开启" : "势力模拟关闭"}
          </span>
        </div>
        <div className="ov-kv">
          <span>存档状态</span>
          <span className="ov-save-status">{saveStatus}</span>
        </div>
        <div className="ov-kv">
          <span>快照</span>
          <span className="mono">{snapshots.length} / 10</span>
        </div>
      </section>

      <section className="ov-card ov-card-ai">
        <header className="ov-card-head">
          <h5>AI 顾问</h5>
          <Tag tone={aiState.tone}>{aiState.text}</Tag>
        </header>
        <div className="ov-kv">
          <span>模型</span>
          <span className="mono">{ai.model ?? "未连接"}</span>
        </div>
        <div className="ov-kv">
          <span>调用 / 失败 / 拒绝</span>
          <span className="mono">
            {ai.calls} / {ai.failures} / {ai.rejected}
          </span>
        </div>
        <div className="ov-kv">
          <span>延迟 / 限额 / 待处理</span>
          <span className="mono">
            {ai.lastLatencyMs !== null ? `${ai.lastLatencyMs}ms` : "—"} / {ai.hourlyLimit ?? "—"} /{" "}
            {ai.pending ? "是" : "否"}
          </span>
        </div>
        {ai.lastError ? <p className="ov-error">{ai.lastError}</p> : null}
        <p className="ov-ai-message">
          最近消息：{lastAiMessage ?? "暂无 AI 决策消息。"}
        </p>
        <div className="ov-btn-row">
          <button
            type="button"
            className="btn btn-ghost btn-tiny"
            onClick={() => {
              void simulationStore.refreshAiStatus();
            }}
          >
            ↻ 刷新状态
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-tiny"
            onClick={() => simulationStore.setAiEnabled(!ai.enabled)}
          >
            {ai.enabled ? "停用 AI" : "启用 AI"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-tiny"
            disabled={!selectedResident || !ai.enabled || ai.pending}
            title={
              selectedResident
                ? `为 ${selectedResident.name} 请求 DeepSeek 决策`
                : "先选择一名居民"
            }
            onClick={() => {
              void simulationStore.requestAiForSelected();
            }}
          >
            ✦ 为选中居民请求
          </button>
        </div>
        {requestPreview ? (
          <p className="muted ov-ai-preview">
            当前上下文：可提议 {requestPreview.allowedActions.length} 种行动 · {requestPreview.targets.length} 个目标 ·{" "}
            {requestPreview.resident.currentPlace}
          </p>
        ) : (
          <p className="muted">未选择居民。选择后可预览 AI 上下文的行动白名单与目标数量。</p>
        )}
      </section>

      <section className="ov-card ov-card-event">
        <header className="ov-card-head">
          <h5>当前事件</h5>
          <button type="button" className="link-btn" onClick={() => simulationStore.setConsoleTab("logs")}>
            打开日志 →
          </button>
        </header>
        {latestEvent ? (
          <div className="ov-event">
            <div className="ov-event-head">
              <Tag tone={eventTypeTone(latestEvent.type)}>{EVENT_TYPE_LABELS[latestEvent.type]}</Tag>
              <span className="mono muted">
                D{latestEvent.day} {formatClock(latestEvent.minuteOfDay)} · {latestEvent.tag}
              </span>
              <span className="muted">重要度 {latestEvent.importance}</span>
            </div>
            <strong className="ov-event-title">{latestEvent.title}</strong>
            <p className="ov-event-desc">{latestEvent.description}</p>
          </div>
        ) : (
          <EmptyHint>世界刚刚生成，还没有事件。</EmptyHint>
        )}
        <div className="ov-event-counts">
          <span>事件总数 {world.events.length}</span>
          <span>历史点 {world.history.length}</span>
          <span>建筑 {world.buildings.length}</span>
          <span>居民 {world.residents.filter((resident) => resident.alive).length}</span>
        </div>
      </section>

      <section className="ov-card">
        <header className="ov-card-head">
          <h5>世界标识</h5>
          <span className="muted mono">schema v{world.schemaVersion}</span>
        </header>
        <DataRow label="世界 ID" mono>
          {world.worldId}
        </DataRow>
        <DataRow label="创建时间" mono>
          {new Date(world.createdAtIso).toLocaleString("zh-CN")}
        </DataRow>
        <DataRow label="初始居民" mono>
          {world.initialResidentIds.length} 人
        </DataRow>
        <DataRow label="RNG 状态" mono>
          {world.rngState}
        </DataRow>
        <DataRow label="AI 事件 tick" mono>
          {world.lastAiEventTick}
        </DataRow>
      </section>
    </div>
  );
}
