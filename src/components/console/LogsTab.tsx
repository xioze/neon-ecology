import { useMemo, useState } from "react";
import { formatClock } from "../../shared/format";
import type { GameEvent } from "../../shared/types";
import { useSimulation } from "../../store/useSimulation";
import { simulationStore } from "../../store/useSimulation";
import {
  EVENT_SOURCE_LABELS,
  EVENT_TYPE_LABELS,
  LOG_FILTERS,
  eventTypeTone,
  type LogFilterId,
} from "../labels";
import { cx, EmptyHint, ImportanceDots, Tag } from "../ui";

const LOG_LIMIT = 180;

function matchesFilter(event: GameEvent, filter: LogFilterId): boolean {
  switch (filter) {
    case "social":
      return event.type === "social";
    case "economy":
      return event.type === "economy";
    case "faction":
      return event.type === "faction";
    case "ai":
      return event.type === "ai";
    case "danger":
      return event.type === "danger" || event.type === "warn";
    case "player":
      return event.type === "player";
    case "system":
      return event.type === "system" || event.type === "info" || event.type === "lifecycle";
    case "all":
    default:
      return true;
  }
}

export function LogsTab() {
  const { world } = useSimulation();
  const [filter, setFilter] = useState<LogFilterId>("all");
  const [query, setQuery] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return world.events.filter((event) => {
      if (!matchesFilter(event, filter)) return false;
      if (importantOnly && event.importance < 4) return false;
      if (!keyword) return true;
      const actor = event.actorId
        ? world.residents.find((resident) => resident.id === event.actorId)?.name ?? ""
        : "";
      return [event.title, event.description, event.tag, actor, EVENT_TYPE_LABELS[event.type]]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [world.events, world.residents, filter, query, importantOnly]);

  const groups = useMemo(() => {
    const map = new Map<number, GameEvent[]>();
    for (const event of filtered.slice(0, LOG_LIMIT)) {
      const list = map.get(event.day);
      if (list) list.push(event);
      else map.set(event.day, [event]);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  const activeFilter = LOG_FILTERS.find((item) => item.id === filter);

  return (
    <div className="logs-tab">
      <header className="tab-toolbar log-toolbar">
        <div className="log-filters">
          {LOG_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("filter-chip", filter === item.id && "is-active")}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="log-search">
          <input
            type="search"
            value={query}
            placeholder="搜索标题 / 描述 / 标签 / 人物…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="log-important-toggle" title="只显示重要度 ≥ 4 的事件">
            <input
              type="checkbox"
              checked={importantOnly}
              onChange={(event) => setImportantOnly(event.target.checked)}
            />
            仅重要
          </label>
          <span className="muted mono">
            {filtered.length} / {world.events.length} 条 · 显示 {Math.min(filtered.length, LOG_LIMIT)}
          </span>
        </div>
      </header>

      <div className="log-scroll">
        {groups.length === 0 ? (
          <EmptyHint>没有匹配的事件。调整筛选条件或关键字试试。</EmptyHint>
        ) : null}
        {groups.map(([day, events]) => (
          <section className="log-day" key={day}>
            <header className="log-day-head">
              <span className="log-day-title">第 {day} 天</span>
              <span className="muted mono">{events.length} 条</span>
            </header>
            <ul className="log-list">
              {events.map((event) => {
                const actor = event.actorId
                  ? world.residents.find((resident) => resident.id === event.actorId)
                  : undefined;
                return (
                  <li className={cx("log-item", `log-tone-${eventTypeTone(event.type)}`)} key={event.id}>
                    <span className="log-time mono">{formatClock(event.minuteOfDay)}</span>
                    <Tag tone={eventTypeTone(event.type)}>{EVENT_TYPE_LABELS[event.type]}</Tag>
                    <div className="log-main">
                      <div className="log-title-line">
                        <span className="log-title">{event.title}</span>
                        <span className="log-meta mono">
                          {event.tag} · {EVENT_SOURCE_LABELS[event.source] ?? event.source}
                          {actor ? ` · ${actor.name}` : ""}
                        </span>
                        <ImportanceDots value={event.importance} />
                      </div>
                      <p className="log-desc">{event.description}</p>
                    </div>
                    {actor ? (
                      <button
                        type="button"
                        className="link-btn log-actor"
                        title={`查看 ${actor.name}`}
                        onClick={() => simulationStore.select({ kind: "resident", id: actor.id })}
                      >
                        {actor.name}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {filtered.length > LOG_LIMIT ? (
          <p className="log-truncated muted">
            已截断：仅显示最近 {LOG_LIMIT} 条（当前筛选「{activeFilter?.label ?? "全部"}」）。
          </p>
        ) : null}
      </div>
    </div>
  );
}
