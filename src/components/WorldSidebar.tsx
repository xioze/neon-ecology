import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ACTION_META, BUILDING_TYPE_META } from "../shared/constants";
import { formatClock, formatMoney, formatPercent, moodLabel, residentLocation } from "../shared/format";
import type { Faction, WorldMetrics } from "../shared/types";
import { simulationStore, useSimulation } from "../store/useSimulation";
import { FACTION_KIND_LABELS, FACTION_STRATEGY_LABELS, EVENT_TYPE_LABELS } from "./labels";
import { cx, MetricBar, toneForInverse, toneForScore, type Tone } from "./ui";

interface MetricDef {
  key: keyof WorldMetrics;
  label: string;
  higherIsBetter: boolean;
  hint: string;
}

const METRIC_DEFS: MetricDef[] = [
  { key: "stability", label: "城市稳定度", higherIsBetter: true, hint: "情绪、信任、资源与治安的综合结果。" },
  { key: "pollution", label: "污染", higherIsBetter: false, hint: "企业排放与天气共同决定的污染指数。" },
  { key: "trust", label: "公众信任", higherIsBetter: true, hint: "居民对城市机构与彼此的信任水平。" },
  { key: "inequality", label: "贫富差距", higherIsBetter: false, hint: "基于居民财富的基尼系数。" },
  { key: "resourceSupply", label: "资源供应", higherIsBetter: true, hint: "食物、能源、医疗物资与运营建筑的覆盖率。" },
  { key: "averageMood", label: "平均情绪", higherIsBetter: true, hint: "所有存活居民的情绪平均值。" },
];

function metricTone(def: MetricDef, value: number): Tone {
  return def.higherIsBetter
    ? toneForScore(value, 62, 40)
    : toneForInverse(value, 38, 62);
}

function trendClass(delta: number, higherIsBetter: boolean): string {
  if (Math.abs(delta) < 0.5) return "trend-flat";
  const good = delta > 0 === higherIsBetter;
  return good ? "trend-good" : "trend-bad";
}

function trendGlyph(delta: number): string {
  if (delta > 0.5) return "▲";
  if (delta < -0.5) return "▼";
  return "·";
}

function factionKindTone(faction: Faction): Tone {
  if (faction.kind === "corporation") return "blue";
  if (faction.kind === "community") return "cyan";
  return "purple";
}

export function WorldSidebar() {
  const state = useSimulation();
  const { world } = state;
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");

  const alive = useMemo(() => world.residents.filter((resident) => resident.alive), [world.residents]);
  const filteredResidents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return alive;
    return alive.filter((resident) => {
      const faction = world.factions.find((item) => item.id === resident.factionId);
      return [resident.name, resident.jobTitle, faction?.name ?? ""]
        .some((value) => value.toLowerCase().includes(keyword));
    });
  }, [alive, query, world.factions]);

  const recentEvents = world.events.slice(0, 5);
  const history = world.history;
  const previous = history.length > 1 ? history[Math.max(0, history.length - 7)] : null;

  const stabilityTone = metricTone(METRIC_DEFS[0]!, world.metrics.stability);

  if (collapsed) {
    return (
      <aside className="sidebar is-collapsed">
        <button
          type="button"
          className="sidebar-rail"
          onClick={() => setCollapsed(false)}
          title="展开城市态势侧栏"
          aria-label="展开城市态势侧栏"
        >
          <span className="rail-sigil">◧</span>
          <span className="rail-title">城市态势</span>
          <span className={cx("rail-stability", `tone-${stabilityTone}`)}>
            {Math.round(world.metrics.stability)}
          </span>
          <span className="rail-expand">»</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="sidebar-title-row">
          <h2 className="sidebar-title">城市态势</h2>
          <span className="sidebar-day mono">D{String(world.clock.day).padStart(2, "0")} · {formatClock(world.clock.minuteOfDay)}</span>
          <button
            type="button"
            className="icon-btn"
            title="折叠侧栏，把视野还给城市"
            aria-label="折叠城市态势侧栏"
            onClick={() => setCollapsed(true)}
          >
            «
          </button>
        </div>
        <p className="sidebar-sub">
          seed <span className="mono">{world.seed}</span> · 人口 <b>{world.metrics.population}</b> · 建筑{" "}
          <b>{world.buildings.length}</b>
        </p>
      </header>

      <div className="sidebar-scroll">
        <section className="sidebar-block">
          <header className="sidebar-block-head">
            <h3>城市指标</h3>
            <span className="sidebar-block-hint">较 3 小时前</span>
          </header>
          <div className="metric-list">
            {METRIC_DEFS.map((def) => {
              const value = world.metrics[def.key];
              const delta = previous ? value - previous.metrics[def.key] : 0;
              return (
                <div className="metric-line" key={def.key} title={def.hint}>
                  <MetricBar
                    label={def.label}
                    value={value}
                    display={formatPercent(value)}
                    tone={metricTone(def, value)}
                    compact
                  />
                  <span className={cx("metric-trend mono", trendClass(delta, def.higherIsBetter))}>
                    {trendGlyph(delta)} {delta === 0 ? "" : Math.abs(delta).toFixed(0)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="sidebar-block">
          <header className="sidebar-block-head">
            <h3>公共资源</h3>
            <span className="sidebar-block-hint">全城储备</span>
          </header>
          <div className="reserve-grid">
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
        </section>

        <section className="sidebar-block">
          <header className="sidebar-block-head">
            <h3>势力</h3>
            <span className="sidebar-block-hint">{world.rules.factionsActive ? "模拟中" : "已暂停"}</span>
          </header>
          <div className="faction-list">
            {world.factions.map((faction) => (
              <div className="faction-row" key={faction.id} style={{ "--faction": faction.color } as CSSProperties}>
                <span className="faction-symbol" style={{ color: faction.color }}>
                  {faction.symbol}
                </span>
                <div className="faction-main">
                  <div className="faction-title">
                    <span className="faction-name">{faction.name}</span>
                    <span className="faction-kind">{FACTION_KIND_LABELS[faction.kind] ?? faction.kind}</span>
                    <span className={cx("tag", `tag-${factionKindTone(faction)}`)}>
                      {FACTION_STRATEGY_LABELS[faction.strategy] ?? faction.strategy}
                    </span>
                  </div>
                  <div className="faction-meta">
                    <span>影响力 {Math.round(faction.influence)}</span>
                    <span className="mono">资金 {formatMoney(faction.funds)}</span>
                    <span>{faction.memberIds.length} 人</span>
                  </div>
                  <div className="faction-influence">
                    <i style={{ width: `${Math.max(2, Math.round(faction.influence))}%`, background: faction.color }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sidebar-block sidebar-block-grow">
          <header className="sidebar-block-head">
            <h3>居民</h3>
            <span className="sidebar-block-hint">{filteredResidents.length}/{alive.length} 人</span>
          </header>
          <input
            className="sidebar-search"
            type="search"
            value={query}
            placeholder="筛选姓名 / 职业 / 势力…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="resident-list">
            {filteredResidents.map((resident) => {
              const faction = world.factions.find((item) => item.id === resident.factionId);
              const selected = state.selected?.kind === "resident" && state.selected.id === resident.id;
              const action = resident.currentAction;
              return (
                <button
                  key={resident.id}
                  type="button"
                  className={cx("resident-row", selected && "is-selected")}
                  title={`${resident.name} · ${resident.jobTitle} · ${residentLocation(world, resident)}`}
                  onClick={() => simulationStore.select({ kind: "resident", id: resident.id })}
                >
                  <span
                    className="resident-dot"
                    style={{
                      background: faction?.color ?? "#5af2d0",
                      boxShadow: `0 0 8px ${faction?.color ?? "#5af2d0"}`,
                    }}
                  />
                  <span className="resident-main">
                    <span className="resident-name-line">
                      <span className="resident-name">{resident.name}</span>
                      <span className="resident-job">{resident.jobTitle}</span>
                      {resident.paused ? <span className="mini-mark mini-paused" title="个人行动已暂停">⏸</span> : null}
                      {resident.aiHint ? <span className="mini-mark mini-ai" title="有 AI 建议待评估">✦</span> : null}
                    </span>
                    <span className="resident-sub-line">
                      <span className={cx("resident-action", action && `phase-${action.phase}`)}>
                        {action
                          ? `${ACTION_META[action.action].label} · ${
                              action.phase === "moving" ? "移动中" : action.phase === "acting" ? "执行中" : action.phase === "blocked" ? "受阻" : "决策中"
                            }`
                          : "待机"}
                      </span>
                      <span className="resident-location">
                        {resident.insideBuildingId
                          ? residentLocation(world, resident)
                          : `街区 ${Math.round(resident.position.x)},${Math.round(resident.position.z)}`}
                      </span>
                    </span>
                  </span>
                  <span className="resident-mood" title={`情绪：${moodLabel(resident.mood)}（${Math.round(resident.mood)}）`}>
                    {Math.round(resident.mood)}
                  </span>
                </button>
              );
            })}
            {filteredResidents.length === 0 ? <p className="empty-hint">没有匹配的居民。</p> : null}
          </div>
        </section>

        <section className="sidebar-block">
          <header className="sidebar-block-head">
            <h3>最近事件</h3>
            <button
              type="button"
              className="link-btn"
              onClick={() => simulationStore.setConsoleTab("logs")}
              title="在造物主控制台打开完整日志"
            >
              全部日志 →
            </button>
          </header>
          <div className="event-mini-list">
            {recentEvents.length === 0 ? <p className="empty-hint">世界刚刚开始，还没有事件。</p> : null}
            {recentEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                className={cx("event-mini", `event-type-${event.type}`)}
                title={event.description}
                onClick={() => simulationStore.setConsoleTab("logs")}
              >
                <span className="event-mini-time mono">
                  D{event.day} {formatClock(event.minuteOfDay)}
                </span>
                <span className="event-mini-text">
                  <span className={cx("tag", `tag-type-${event.type}`)}>{EVENT_TYPE_LABELS[event.type]}</span>
                  {event.title}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="sidebar-foot">
          <span>{BUILDING_TYPE_META.residential.icon} 点击居民查看完整档案</span>
          <span>拖拽/滚轮操作 3D 场景</span>
        </div>
      </div>
    </aside>
  );
}
