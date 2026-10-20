import { BUILDING_TYPE_META } from "../shared/constants";
import { formatClock } from "../shared/format";
import { simulationStore, useSimulation } from "../store/useSimulation";
import { BuildingInspector } from "./inspector/BuildingInspector";
import { ResidentInspector } from "./inspector/ResidentInspector";
import { cx, EmptyHint } from "./ui";

export function Inspector() {
  const state = useSimulation();
  const { selected, inspectorOpen, world, mode } = state;

  if (!selected || !inspectorOpen) return null;

  const resident =
    selected.kind === "resident"
      ? world.residents.find((candidate) => candidate.id === selected.id)
      : undefined;
  const building =
    selected.kind === "building"
      ? world.buildings.find((candidate) => candidate.id === selected.id)
      : undefined;

  const faction = resident ? world.factions.find((item) => item.id === resident.factionId) : undefined;
  const kicker = resident ? "居民档案" : building ? "建筑档案" : "档案";
  const title = resident?.name ?? building?.name ?? "未知目标";
  const subtitle = resident
    ? `${resident.jobTitle} · ${faction?.name ?? "无归属"} · ${resident.alive ? "存活" : "已故"}`
    : building
      ? `${BUILDING_TYPE_META[building.type].label} · (${building.x}, ${building.z}) · ${building.w}×${building.d}`
      : "目标已不在当前世界中";

  return (
    <aside className="inspector" aria-label={kicker}>
      <header className="inspector-head">
        <div className="inspector-head-main">
          <span className="inspector-kicker">
            {kicker}
            <span className="inspector-time mono">
              D{String(world.clock.day).padStart(2, "0")} {formatClock(world.clock.minuteOfDay)}
            </span>
          </span>
          <h2 className="inspector-title">{title}</h2>
          <span className="inspector-sub">{subtitle}</span>
        </div>
        <div className="inspector-head-actions">
          <span className={cx("mode-pill", `mode-${mode}`)}>{mode === "intervene" ? "干预模式" : "观察模式"}</span>
          <button
            type="button"
            className="icon-btn inspector-close"
            title="关闭档案（Esc）"
            aria-label="关闭档案"
            onClick={() => simulationStore.closeInspector()}
          >
            ×
          </button>
        </div>
      </header>
      <div className="inspector-body">
        {resident ? (
          <ResidentInspector key={resident.id} world={world} resident={resident} mode={mode} />
        ) : building ? (
          <BuildingInspector key={building.id} world={world} building={building} mode={mode} />
        ) : (
          <EmptyHint>选择已经失效，世界状态可能已被快照或存档替换。</EmptyHint>
        )}
      </div>
    </aside>
  );
}
