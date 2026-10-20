import { useState } from "react";
import { EVENT_INJECTIONS } from "../../shared/constants";
import { simulationStore, useSimulation } from "../../store/useSimulation";
import { formatClock } from "../../shared/format";
import { cx, ObserveNotice, Tag } from "../ui";
import { EVENT_TYPE_LABELS, eventTypeTone } from "../labels";

const EVENT_TONE_LABELS: Record<string, string> = {
  info: "信息",
  warn: "警告",
  danger: "危险",
};

export function EventsTab() {
  const { mode, world } = useSimulation();
  const editable = mode === "intervene";
  const latestEvent = world.events[0];

  return (
    <div className="events-tab">
      {!editable ? (
        <ObserveNotice>事件注入会直接改变世界状态。请先在顶栏或控制台切换到「干预」模式。</ObserveNotice>
      ) : (
        <p className="tab-hint">
          注入的事件会立即作用于公共资源、居民需求、关系与指标，并写入一条造物主事件日志。共 {EVENT_INJECTIONS.length} 种事件。
        </p>
      )}
      <div className="events-grid">
        {EVENT_INJECTIONS.map((event) => (
          <article key={event.id} className={cx("event-card", `event-tone-${event.tone}`)}>
            <header className="event-card-head">
              <h5>{event.label}</h5>
              <Tag tone={event.tone === "danger" ? "bad" : event.tone === "warn" ? "warn" : "cyan"}>
                {EVENT_TONE_LABELS[event.tone] ?? event.tone}
              </Tag>
            </header>
            <p className="event-card-desc">{event.description}</p>
            <div className="event-card-foot">
              <span className="mono muted">{event.id}</span>
              <button
                type="button"
                className="btn btn-tiny btn-primary"
                disabled={!editable}
                title={editable ? `注入「${event.label}」` : "观察模式下不可注入事件"}
                onClick={() => simulationStore.injectEvent(event.id)}
              >
                注入事件
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="events-footer">
        {latestEvent ? (
          <>
            <Tag tone={eventTypeTone(latestEvent.type)}>{EVENT_TYPE_LABELS[latestEvent.type]}</Tag>
            <span className="muted mono">
              D{latestEvent.day} {formatClock(latestEvent.minuteOfDay)}
            </span>
            <span className="events-footer-title">{latestEvent.title}</span>
            <span className="muted events-footer-desc">{latestEvent.description}</span>
          </>
        ) : (
          <span className="muted">还没有事件。</span>
        )}
      </div>
    </div>
  );
}
