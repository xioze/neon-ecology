import { Html } from "@react-three/drei";
import { ACTION_META, BUILDING_TYPE_META } from "../../shared/constants";
import type { ActionPhase, Building, Resident, Selection, WorldState } from "../../shared/types";
import { tileToWorld } from "../../sim/city";
import {
  PALETTE,
  ZONE_LABELS,
  getBuildingWorld,
  tilePointToWorld,
  typeLabel,
} from "./sceneLayout";

interface SceneLabelsProps {
  world: WorldState;
  selected: Selection;
  hovered: Selection;
}

const PHASE_LABELS: Record<ActionPhase, string> = {
  deciding: "决策中",
  moving: "移动中",
  acting: "行动中",
  blocked: "受阻",
};

export function SceneLabels({ world, selected, hovered }: SceneLabelsProps) {
  const selectedKey = selected ? `${selected.kind}:${selected.id}` : null;
  const hoveredKey = hovered ? `${hovered.kind}:${hovered.id}` : null;
  const showHovered = hovered !== null && hoveredKey !== selectedKey;

  return (
    <>
      {ZONE_LABELS.map((zone) => {
        const position = tilePointToWorld(zone.x, zone.z);
        return (
          <Html
            key={zone.id}
            position={[position.x, 1.25, position.z]}
            center
            zIndexRange={[8, 0]}
            wrapperClass="scene-html-anchor scene-html-anchor--zone"
            style={{ pointerEvents: "none" }}
          >
            <div className="scene-zone">
              <span className="scene-zone__dot" style={{ background: zone.color }} />
              <span className="scene-zone__title" style={{ color: zone.color }}>
                {zone.title}
              </span>
              <span className="scene-zone__sub">{zone.subtitle}</span>
            </div>
          </Html>
        );
      })}
      {selected && <SelectionLabel selection={selected} world={world} variant="selected" />}
      {showHovered && hovered && (
        <SelectionLabel selection={hovered} world={world} variant="hover" />
      )}
    </>
  );
}

function SelectionLabel({
  selection,
  world,
  variant,
}: {
  selection: Selection;
  world: WorldState;
  variant: "selected" | "hover";
}) {
  if (!selection) return null;
  if (selection.kind === "resident") {
    const resident = world.residents.find((item) => item.id === selection.id);
    if (!resident || !resident.alive) return null;
    return <ResidentLabel resident={resident} variant={variant} />;
  }
  const building = world.buildings.find((item) => item.id === selection.id);
  if (!building) return null;
  return <BuildingLabel building={building} variant={variant} />;
}

function ResidentLabel({ resident, variant }: { resident: Resident; variant: "selected" | "hover" }) {
  const position = tileToWorld(resident.position.x, resident.position.z);
  const action = resident.currentAction;
  const acting = action
    ? `${ACTION_META[action.action].label} · ${PHASE_LABELS[action.phase]}`
    : resident.insideBuildingId
      ? "室内活动"
      : "自由活动";
  const indoor = resident.insideBuildingId ? " · 室内" : "";
  return (
    <Html
      position={[position.x, 2.85, position.z]}
      center
      zIndexRange={[12, 0]}
      wrapperClass={`scene-html-anchor scene-html-anchor--${variant}`}
      style={{ pointerEvents: "none" }}
    >
      <div
        className={`scene-label scene-label--${variant}`}
        style={{ borderLeftColor: PALETTE.cyan }}
      >
        <div className="scene-label__title">
          {resident.name}
          <span className="scene-label__tag">{resident.pronouns}</span>
        </div>
        <div className="scene-label__sub">
          {resident.jobTitle} · {Math.floor(resident.age)}岁{indoor}
        </div>
        <div className="scene-label__meta">{acting}</div>
      </div>
    </Html>
  );
}

function BuildingLabel({
  building,
  variant,
}: {
  building: Building;
  variant: "selected" | "hover";
}) {
  const world = getBuildingWorld(building);
  const meta = BUILDING_TYPE_META[building.type];
  const state = building.openAir
    ? "开放空间"
    : !building.operational
      ? "停运"
      : building.open
        ? "营业中"
        : "闭门";
  const positionY = building.openAir ? 3.1 : world.height + 1.4;
  return (
    <Html
      position={[world.cx, positionY, world.cz]}
      center
      zIndexRange={[12, 0]}
      wrapperClass={`scene-html-anchor scene-html-anchor--${variant}`}
      style={{ pointerEvents: "none" }}
    >
      <div
        className={`scene-label scene-label--${variant}`}
        style={{ borderLeftColor: building.neonColor }}
      >
        <div className="scene-label__title">
          {building.name}
          <span className="scene-label__tag">{meta.short}</span>
        </div>
        <div className="scene-label__sub">
          {typeLabel(building.type)} · {state}
        </div>
        <div className="scene-label__meta">
          容量 {Math.round(building.capacity)} · 状况 {Math.round(building.condition)}%
        </div>
      </div>
    </Html>
  );
}
