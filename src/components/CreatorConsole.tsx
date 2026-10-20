import type { ConsoleTab } from "../shared/types";
import { formatClock } from "../shared/format";
import { simulationStore, useSimulation } from "../store/useSimulation";
import { CONSOLE_TAB_LABELS } from "./labels";
import { cx } from "./ui";
import { OverviewTab } from "./console/OverviewTab";
import { EventsTab } from "./console/EventsTab";
import { RulesTab } from "./console/RulesTab";
import { ResidentsTab } from "./console/ResidentsTab";
import { BuildingsTab } from "./console/BuildingsTab";
import { LogsTab } from "./console/LogsTab";
import { SavesTab } from "./console/SavesTab";
import { ExperimentsTab } from "./console/ExperimentsTab";

const TABS: Array<{ id: ConsoleTab; label: string; icon: string }> = [
  { id: "overview", label: "总览", icon: "◎" },
  { id: "events", label: "事件注入", icon: "⚡" },
  { id: "rules", label: "世界规则", icon: "⚖" },
  { id: "residents", label: "居民编辑", icon: "☻" },
  { id: "buildings", label: "建筑编辑", icon: "▦" },
  { id: "logs", label: "日志", icon: "≣" },
  { id: "saves", label: "存档", icon: "⛁" },
  { id: "experiments", label: "实验", icon: "⑂" },
];

function TabBody({ tab }: { tab: ConsoleTab }) {
  switch (tab) {
    case "events":
      return <EventsTab />;
    case "rules":
      return <RulesTab />;
    case "residents":
      return <ResidentsTab />;
    case "buildings":
      return <BuildingsTab />;
    case "logs":
      return <LogsTab />;
    case "saves":
      return <SavesTab />;
    case "experiments":
      return <ExperimentsTab />;
    case "overview":
    default:
      return <OverviewTab />;
  }
}

export function CreatorConsole() {
  const state = useSimulation();
  const { world, consoleOpen, consoleTab, mode, paused, speed } = state;
  const day = `D${String(world.clock.day).padStart(2, "0")}`;
  const time = formatClock(world.clock.minuteOfDay);

  if (!consoleOpen) {
    return (
      <section className="console is-collapsed" aria-label="造物主控制台（已折叠）">
        <button
          type="button"
          className="console-handle"
          title="展开造物主控制台"
          onClick={() => simulationStore.setConsoleOpen(true)}
        >
          <span className="console-handle-kicker">◤ 造物主控制台</span>
          <span className={cx("mode-pill", `mode-${mode}`)}>{mode === "intervene" ? "干预模式" : "观察模式"}</span>
          <span className="console-handle-tab">
            当前页 · {CONSOLE_TAB_LABELS[consoleTab]}
          </span>
          <span className="console-handle-spacer" />
          <span className="console-handle-status mono">
            {paused ? "已暂停" : `${speed}x`} · {day} {time} · tick {world.clock.tick}
          </span>
          <span className="console-handle-expand">展开 ▴</span>
        </button>
      </section>
    );
  }

  return (
    <section className="console" aria-label="造物主控制台">
      <header className="console-head">
        <button
          type="button"
          className="console-collapse"
          title="折叠控制台（保留底部把手）"
          aria-label="折叠控制台"
          onClick={() => simulationStore.setConsoleOpen(false)}
        >
          ▾
        </button>
        <div className="console-title">
          <span className="console-kicker">造物主控制台</span>
          <span className={cx("mode-pill", `mode-${mode}`)}>{mode === "intervene" ? "干预模式" : "观察模式"}</span>
          <span className="console-clock mono">
            {day} {time} · tick {world.clock.tick} · {paused ? "暂停" : `${speed}x`}
          </span>
        </div>
        <nav className="console-tabs" aria-label="控制台分页">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cx("console-tab", consoleTab === tab.id && "is-active")}
              title={CONSOLE_TAB_LABELS[tab.id]}
              onClick={() => simulationStore.setConsoleTab(tab.id)}
            >
              <span className="console-tab-icon" aria-hidden="true">
                {tab.icon}
              </span>
              <span className="console-tab-label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="console-head-actions">
          {mode === "observe" ? (
            <span className="console-lock-hint" title="切换到干预模式后才能提交造物主命令">
              观察模式 · 编辑锁定
            </span>
          ) : null}
          <button
            type="button"
            className={cx("btn", "btn-tiny", mode === "intervene" ? "btn-ghost" : "btn-primary")}
            onClick={() => simulationStore.setMode(mode === "intervene" ? "observe" : "intervene")}
          >
            {mode === "intervene" ? "退出干预" : "进入干预"}
          </button>
        </div>
      </header>
      <div className={cx("console-body", `console-body-${consoleTab}`)}>
        <TabBody tab={consoleTab} />
      </div>
    </section>
  );
}
