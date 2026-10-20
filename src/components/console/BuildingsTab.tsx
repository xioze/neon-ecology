import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { BUILDING_TYPE_META, MAP_DEPTH, MAP_WIDTH } from "../../shared/constants";
import type { Building, BuildingType, WorldState } from "../../shared/types";
import { simulationStore, useSimulation } from "../../store/useSimulation";
import { useConfirm } from "../ConfirmDialog";
import {
  cx,
  EmptyHint,
  InventoryRows,
  NumberField,
  ObserveNotice,
  SelectField,
  Tag,
  validateNumberRange,
} from "../ui";

const PLACEMENT_DIMENSIONS: Record<BuildingType, [number, number]> = {
  residential: [4, 3],
  shop: [3, 3],
  workplace: [4, 4],
  public: [4, 3],
  medical: [3, 3],
  utility: [3, 3],
};

export function BuildingsTab() {
  const state = useSimulation();
  const { world, mode, placement, selected } = state;
  const editable = mode === "intervene";
  const selectedBuildingId = selected?.kind === "building" ? selected.id : "";
  const [focusId, setFocusId] = useState(selectedBuildingId || world.buildings[0]?.id || "");
  const building = world.buildings.find((candidate) => candidate.id === focusId);

  useEffect(() => {
    if (selectedBuildingId) setFocusId(selectedBuildingId);
  }, [selectedBuildingId]);

  return (
    <div className="buildings-tab">
      {!editable ? (
        <ObserveNotice>建筑放置与编辑需要干预模式。进入干预模式后可在 3D 场景中直接放置建筑。</ObserveNotice>
      ) : null}
      <div className="buildings-columns">
        <section className="buildings-place">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>放置模式</h5>
              <Tag tone={placement.type ? "magenta" : "neutral"}>
                {placement.type ? `放置中 · ${BUILDING_TYPE_META[placement.type].label}` : "未激活"}
              </Tag>
            </div>
            {placement.type ? (
              <button
                type="button"
                className="btn btn-ghost btn-tiny"
                onClick={() => simulationStore.setPlacementType(null)}
              >
                取消放置
              </button>
            ) : null}
          </header>
          <p className="tab-hint">
            选择类型后进入放置模式，在 3D 场景的地面上点击即可放置。放置模式中场景会显示落点预览。
          </p>
          <div className="placement-grid">
            {(Object.keys(BUILDING_TYPE_META) as BuildingType[]).map((type) => {
              const meta = BUILDING_TYPE_META[type];
              const [w, d] = PLACEMENT_DIMENSIONS[type];
              const active = placement.type === type;
              return (
                <button
                  key={type}
                  type="button"
                  className={cx("placement-btn", active && "is-active")}
                  style={{ "--placement-color": meta.color } as CSSProperties}
                  disabled={!editable}
                  title={`${meta.label} · ${w}×${d} 格`}
                  onClick={() => simulationStore.setPlacementType(active ? null : type)}
                >
                  <span className="placement-icon" aria-hidden="true">
                    {meta.icon}
                  </span>
                  <span className="placement-label">{meta.label}</span>
                  <span className="placement-size mono">
                    {w}×{d}
                  </span>
                </button>
              );
            })}
          </div>
          {placement.type ? (
            <div className="placement-hint">
              <Tag tone="magenta">放置模式</Tag>
              <span>在 3D 场景地面点击，放置「{BUILDING_TYPE_META[placement.type].label}」。</span>
            </div>
          ) : null}
          <p className="form-hint">建筑不能覆盖道路或与其他建筑占地冲突；放置失败会以 Toast 返回具体原因。</p>
        </section>

        <section className="buildings-quick">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>选中建筑工具</h5>
            </div>
            <div className="tab-toolbar-actions">
              <select
                value={focusId}
                onChange={(event) => setFocusId(event.target.value)}
                aria-label="选择建筑"
              >
                {world.buildings.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {BUILDING_TYPE_META[item.type].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-tiny"
                disabled={!building}
                onClick={() => {
                  if (building) simulationStore.select({ kind: "building", id: building.id });
                }}
              >
                聚焦档案
              </button>
            </div>
          </header>
          {building ? (
            <BuildingQuickTools key={building.id} building={building} world={world} editable={editable} />
          ) : (
            <EmptyHint>世界里没有可编辑的建筑。</EmptyHint>
          )}
        </section>
      </div>
    </div>
  );
}

function BuildingQuickTools({
  building,
  world,
  editable,
}: {
  building: Building;
  world: WorldState;
  editable: boolean;
}) {
  const confirm = useConfirm();
  const [owner, setOwner] = useState(building.ownerFactionId ?? "");
  const [x, setX] = useState(String(building.x));
  const [z, setZ] = useState(String(building.z));
  const [moveError, setMoveError] = useState<string | null>(null);
  const ownerFaction = world.factions.find((faction) => faction.id === building.ownerFactionId);

  function move() {
    const xCheck = validateNumberRange(x, "X 坐标", 0, MAP_WIDTH - building.w, true);
    const zCheck = validateNumberRange(z, "Z 坐标", 0, MAP_DEPTH - building.d, true);
    if (xCheck.error || zCheck.error) {
      setMoveError(xCheck.error ?? zCheck.error);
      return;
    }
    setMoveError(null);
    const result = simulationStore.runCommand({
      type: "move_building",
      buildingId: building.id,
      x: xCheck.value ?? building.x,
      z: zCheck.value ?? building.z,
    });
    if (!result.ok) setMoveError(result.message);
  }

  async function demolish() {
    const ok = await confirm({
      title: `拆除「${building.name}」？`,
      message: "不可撤销：建筑与其库存、到访记录会一并删除；住户与职员会被安置到其他建筑。",
      tone: "danger",
      confirmText: "确认拆除",
    });
    if (!ok) return;
    simulationStore.runCommand({ type: "demolish_building", buildingId: building.id });
  }

  return (
    <div className="quick-form">
      <div className="quick-summary">
        <Tag tone="cyan">{BUILDING_TYPE_META[building.type].label}</Tag>
        <Tag tone={building.operational ? "good" : "bad"}>{building.operational ? "运行中" : "停运"}</Tag>
        <Tag tone={building.open ? "cyan" : "warn"}>{building.open ? "开放" : "关闭"}</Tag>
        <span className="muted mono">
          ({building.x}, {building.z}) · {building.w}×{building.d} · 状况 {Math.round(building.condition)}
        </span>
        <span className="muted">所有者 {ownerFaction?.name ?? "无"}</span>
      </div>

      <div className="quick-actions">
        <button
          type="button"
          className={cx("btn", building.open ? "btn-primary" : "btn-ghost")}
          disabled={!editable}
          onClick={() =>
            simulationStore.runCommand({
              type: "edit_building",
              buildingId: building.id,
              patch: { open: !building.open },
            })
          }
        >
          开放开关
        </button>
        <button
          type="button"
          className={cx("btn", building.operational ? "btn-ghost" : "btn-warn")}
          disabled={!editable}
          onClick={() =>
            simulationStore.runCommand({
              type: "edit_building",
              buildingId: building.id,
              patch: { operational: !building.operational },
            })
          }
        >
          运行开关
        </button>
        <button
          type="button"
          className="btn btn-warn"
          disabled={!editable}
          onClick={() => simulationStore.runCommand({ type: "repair_building", buildingId: building.id })}
        >
          修复
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!editable}
          onClick={() => simulationStore.runCommand({ type: "rotate_building", buildingId: building.id })}
        >
          旋转 90°
        </button>
        <button type="button" className="btn btn-danger" disabled={!editable} onClick={() => void demolish()}>
          拆除
        </button>
      </div>

      <div className="quick-columns">
        <div>
          <h6 className="editor-title">库存增减</h6>
          <InventoryRows
            inventory={building.inventory}
            disabled={!editable}
            onAdjust={(key, delta) =>
              simulationStore.runCommand({
                type: "adjust_building_inventory",
                buildingId: building.id,
                key,
                delta,
              })
            }
          />
        </div>
        <div>
          <h6 className="editor-title">所有者</h6>
          <div className="stack-form">
            <SelectField
              label="势力"
              value={owner}
              onChange={setOwner}
              disabled={!editable}
              options={[
                { value: "", label: "无所有者" },
                ...world.factions.map((faction) => ({ value: faction.id, label: faction.name })),
              ]}
            />
            <button
              type="button"
              className="btn btn-primary btn-tiny"
              disabled={!editable}
              onClick={() =>
                simulationStore.runCommand({
                  type: "edit_building",
                  buildingId: building.id,
                  patch: { ownerFactionId: owner === "" ? null : owner },
                })
              }
            >
              转移所有权
            </button>
          </div>
          <h6 className="editor-title">移动</h6>
          <div className="stack-form">
            <div className="form-grid form-grid-2">
              <NumberField
                label="X"
                value={x}
                min={0}
                max={MAP_WIDTH - building.w}
                step={1}
                onChange={setX}
                disabled={!editable}
              />
              <NumberField
                label="Z"
                value={z}
                min={0}
                max={MAP_DEPTH - building.d}
                step={1}
                onChange={setZ}
                disabled={!editable}
              />
            </div>
            <button type="button" className="btn btn-primary btn-tiny" disabled={!editable} onClick={move}>
              移动建筑
            </button>
            {moveError ? <p className="form-error">{moveError}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
