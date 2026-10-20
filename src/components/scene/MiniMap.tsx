import { memo } from "react";
import {
  BUILDING_TYPE_META,
  MAP_DEPTH,
  MAP_WIDTH,
  ROAD_COLUMNS,
  ROAD_ROWS,
} from "../../shared/constants";
import type { Selection, WorldState } from "../../shared/types";
import { PALETTE, typeColor } from "./sceneLayout";

interface MiniMapProps {
  world: WorldState;
  selected: Selection;
  hovered: Selection;
}

const MiniMapRoads = memo(function MiniMapRoads() {
  return (
    <div className="scene-minimap__roads" aria-hidden="true">
      {ROAD_COLUMNS.map(([a, b]) => (
        <span
          key={`col-${a}`}
          className="scene-minimap__road scene-minimap__road--col"
          style={{
            left: `${(a / MAP_WIDTH) * 100}%`,
            width: `${((b - a + 1) / MAP_WIDTH) * 100}%`,
          }}
        />
      ))}
      {ROAD_ROWS.map(([a, b]) => (
        <span
          key={`row-${a}`}
          className="scene-minimap__road scene-minimap__road--row"
          style={{
            top: `${(a / MAP_DEPTH) * 100}%`,
            height: `${((b - a + 1) / MAP_DEPTH) * 100}%`,
          }}
        />
      ))}
    </div>
  );
});

export function MiniMap({ world, selected, hovered }: MiniMapProps) {
  const aliveResidents = world.residents.filter((resident) => resident.alive);
  return (
    <section className="scene-minimap" aria-label="城市小地图">
      <div className="scene-minimap__head">
        <span className="scene-minimap__title">城市小地图</span>
        <span className="scene-minimap__scale">32 × 28</span>
      </div>
      <div className="scene-minimap__frame">
        <MiniMapRoads />
        {world.buildings.map((building) => {
          const isSelected = selected?.kind === "building" && selected.id === building.id;
          const isHovered = hovered?.kind === "building" && hovered.id === building.id;
          return (
            <span
              key={building.id}
              title={`${building.name} · ${BUILDING_TYPE_META[building.type].label}`}
              className={[
                "scene-minimap__building",
                `scene-minimap__building--${building.type}`,
                building.openAir ? "scene-minimap__building--open" : "",
                isSelected ? "scene-minimap__building--selected" : "",
                isHovered && !isSelected ? "scene-minimap__building--hovered" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                left: `${(building.x / MAP_WIDTH) * 100}%`,
                top: `${(building.z / MAP_DEPTH) * 100}%`,
                width: `${(building.w / MAP_WIDTH) * 100}%`,
                height: `${(building.d / MAP_DEPTH) * 100}%`,
                borderColor: typeColor(building.type),
                background: `${typeColor(building.type)}55`,
              }}
            />
          );
        })}
        {aliveResidents.map((resident) => {
          const isSelected = selected?.kind === "resident" && selected.id === resident.id;
          const isHovered = hovered?.kind === "resident" && hovered.id === resident.id;
          return (
            <span
              key={resident.id}
              title={`${resident.name} · ${resident.jobTitle}`}
              className={[
                "scene-minimap__resident",
                resident.insideBuildingId ? "scene-minimap__resident--indoor" : "",
                isSelected ? "scene-minimap__resident--selected" : "",
                isHovered && !isSelected ? "scene-minimap__resident--hovered" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                left: `${((resident.position.x + 0.5) / MAP_WIDTH) * 100}%`,
                top: `${((resident.position.z + 0.5) / MAP_DEPTH) * 100}%`,
                background: isSelected
                  ? PALETTE.cyan
                  : isHovered
                    ? PALETTE.magenta
                    : resident.appearance.accentColor,
              }}
            />
          );
        })}
        <span className="scene-minimap__compass">N</span>
      </div>
      <p className="scene-minimap__hint">拖拽旋转 · 滚轮缩放 · 右键平移 · 点击地面放置</p>
    </section>
  );
}
