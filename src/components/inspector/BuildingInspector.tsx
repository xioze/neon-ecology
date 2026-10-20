import { useState } from "react";
import {
  BUILDING_TYPE_META,
  MAP_DEPTH,
  MAP_WIDTH,
  RESOURCE_LABELS,
} from "../../shared/constants";
import { formatMoney } from "../../shared/format";
import type { Building, InteractionMode, WorldState } from "../../shared/types";
import { simulationStore } from "../../store/useSimulation";
import { useConfirm } from "../ConfirmDialog";
import { buildingTypeLabel } from "../labels";
import {
  ColorField,
  cx,
  DataRow,
  EmptyHint,
  InventoryRows,
  NumberField,
  ObserveNotice,
  PanelSection,
  SelectField,
  Tag,
  TextAreaField,
  TextField,
  validateNumberRange,
} from "../ui";

interface BuildingPanelProps {
  world: WorldState;
  building: Building;
  mode: InteractionMode;
}

export function BuildingInspector({ world, building, mode }: BuildingPanelProps) {
  const editable = mode === "intervene";
  const meta = BUILDING_TYPE_META[building.type];
  const ownerFaction = world.factions.find((faction) => faction.id === building.ownerFactionId);
  const ownerResident = world.residents.find((resident) => resident.id === building.ownerResidentId);

  const present = world.residents.filter(
    (resident) => resident.alive && resident.insideBuildingId === building.id,
  );
  const residentsHome = world.residents.filter(
    (resident) => resident.alive && resident.homeBuildingId === building.id,
  );
  const workers = world.residents.filter(
    (resident) => resident.alive && resident.workBuildingId === building.id,
  );
  const recentVisits = building.recentVisits.slice(0, 12);

  return (
    <div className="building-panel">
      <section className="bld-identity">
        <div className="bld-icon" style={{ color: meta.color, borderColor: meta.color }}>
          {meta.icon}
        </div>
        <div className="bld-identity-main">
          <div className="res-name-row">
            <h3 className="res-name">{building.name}</h3>
            <span className="res-pronoun">
              {buildingTypeLabel(building.type)} · {building.w}×{building.d} · 容量 {building.capacity}
            </span>
          </div>
          <div className="res-tag-row">
            <Tag tone={building.operational ? "good" : "bad"}>{building.operational ? "运行中" : "停运"}</Tag>
            <Tag tone={building.open ? "cyan" : "warn"}>{building.open ? "开放" : "关闭"}</Tag>
            <Tag tone={building.openAir ? "good" : "neutral"}>{building.openAir ? "露天" : "室内"}</Tag>
            {building.rotation !== 0 ? <Tag tone="purple">旋转 {building.rotation}°</Tag> : null}
            <Tag tone={building.condition >= 60 ? "good" : building.condition >= 30 ? "warn" : "bad"}>
              状况 {Math.round(building.condition)}
            </Tag>
          </div>
          <div className="res-meta-row">
            <span>◈ 坐标 ({building.x}, {building.z})</span>
            <span>
              所有者 <b style={{ color: ownerFaction?.color ?? "#9fb4c8" }}>{ownerFaction?.name ?? "无"}</b>
            </span>
            <span>
              排放 <b className="mono">{building.emissions.toFixed(1)}</b>
            </span>
            <span>
              霓虹 <i className="color-swatch" style={{ background: building.neonColor }} /> <span className="mono">{building.neonColor}</span>
            </span>
          </div>
        </div>
      </section>

      <PanelSection title="建筑档案">
        <div className="kv-grid">
          <DataRow label="类型">{buildingTypeLabel(building.type)}</DataRow>
          <DataRow label="坐标" mono>
            ({building.x}, {building.z})
          </DataRow>
          <DataRow label="占地" mono>
            {building.w} × {building.d} 格
          </DataRow>
          <DataRow label="旋转" mono>
            {building.rotation}°
          </DataRow>
          <DataRow label="容量" mono>
            {building.capacity}
          </DataRow>
          <DataRow label="状况" mono>
            {Math.round(building.condition)} / 100
          </DataRow>
          <DataRow label="所有者">{ownerFaction?.name ?? "无所有者"}</DataRow>
          <DataRow label="所有者（个人）">{ownerResident?.name ?? "—"}</DataRow>
          <DataRow label="运行">{building.operational ? "运行中" : "已停止"}</DataRow>
          <DataRow label="开放">{building.open ? "对外开放" : "关闭中"}</DataRow>
          <DataRow label="排放" mono>
            {building.emissions.toFixed(2)}
          </DataRow>
          <DataRow label="上次维护">D{building.lastServicedDay}</DataRow>
          <DataRow label="收入 / 支出" mono>
            {formatMoney(building.income)} / {formatMoney(building.expenses)}
          </DataRow>
          <DataRow label="露天空间">{building.openAir ? "是" : "否"}</DataRow>
        </div>
        <p className="bld-desc">{building.description}</p>
      </PanelSection>

      <PanelSection title="库存" hint="食物 / 医疗 / 能源 / 资金">
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
        {!editable ? <p className="form-hint">观察模式下库存只读。</p> : null}
        <div className="inventory-summary">
          {Object.entries(building.inventory).map(([key, value]) => (
            <span key={key} className="muted">
              {RESOURCE_LABELS[key as keyof typeof RESOURCE_LABELS] ?? key}：<b className="mono">{Math.round(value)}</b>
            </span>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="在场人员" hint={`${present.length} 人在内`}>
        {present.length === 0 ? <EmptyHint>目前没有居民在这栋建筑内。</EmptyHint> : null}
        <div className="chip-grid">
          {present.map((resident) => (
            <button
              key={resident.id}
              type="button"
              className="chip chip-button"
              onClick={() => simulationStore.select({ kind: "resident", id: resident.id })}
              title={resident.currentAction?.reason ?? resident.jobTitle}
            >
              {resident.name}
              <span className="muted"> · {resident.currentAction ? "行动中" : "停留"}</span>
            </button>
          ))}
        </div>
        <div className="bld-population">
          <div>
            <span className="muted">住户 {residentsHome.length}</span>
            <div className="chip-grid">
              {residentsHome.slice(0, 6).map((resident) => (
                <button
                  key={resident.id}
                  type="button"
                  className="chip chip-button"
                  onClick={() => simulationStore.select({ kind: "resident", id: resident.id })}
                >
                  {resident.name}
                </button>
              ))}
              {residentsHome.length > 6 ? <span className="muted">+{residentsHome.length - 6}</span> : null}
            </div>
          </div>
          <div>
            <span className="muted">职员 {workers.length}</span>
            <div className="chip-grid">
              {workers.slice(0, 6).map((resident) => (
                <button
                  key={resident.id}
                  type="button"
                  className="chip chip-button"
                  onClick={() => simulationStore.select({ kind: "resident", id: resident.id })}
                >
                  {resident.name}
                  <span className="muted"> · {resident.jobTitle}</span>
                </button>
              ))}
              {workers.length > 6 ? <span className="muted">+{workers.length - 6}</span> : null}
            </div>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="近期进出" hint={`${building.recentVisits.length} 条记录`}>
        {recentVisits.length === 0 ? <EmptyHint>还没有人进出这栋建筑。</EmptyHint> : null}
        <ul className="visit-list">
          {recentVisits.map((visit, index) => {
            const resident = world.residents.find((candidate) => candidate.id === visit.residentId);
            return (
              <li className="visit-item" key={`${visit.residentId}-${visit.tick}-${visit.kind}-${index}`}>
                <Tag tone={visit.kind === "enter" ? "cyan" : "neutral"}>
                  {visit.kind === "enter" ? "进入" : "离开"}
                </Tag>
                {resident ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => simulationStore.select({ kind: "resident", id: resident.id })}
                  >
                    {resident.name}
                  </button>
                ) : (
                  <span className="mono muted">{visit.residentId}</span>
                )}
                <span className="mono muted">
                  D{visit.day} · t{visit.tick}
                </span>
              </li>
            );
          })}
        </ul>
      </PanelSection>

      {editable ? (
        <BuildingIntervention world={world} building={building} />
      ) : (
        <ObserveNotice>
          观察模式下建筑档案只读。切换到「干预」模式后可以修改参数、库存、所有权、开关，移动/旋转或拆除建筑。
        </ObserveNotice>
      )}
    </div>
  );
}

function BuildingIntervention({ world, building }: { world: WorldState; building: Building }) {
  return (
    <section className="ui-section intervention-section">
      <header className="ui-section-head">
        <h4 className="ui-section-title">造物主干预</h4>
        <span className="ui-section-hint">所有改动直接写入模拟状态</span>
      </header>
      <div className="ui-section-body">
        <BuildingParamsEditor building={building} />
        <OwnershipEditor world={world} building={building} />
        <div className="switch-row">
          <button
            type="button"
            className={cx("btn", building.open ? "btn-primary" : "btn-ghost")}
            onClick={() =>
              simulationStore.runCommand({
                type: "edit_building",
                buildingId: building.id,
                patch: { open: !building.open },
              })
            }
          >
            开放：{building.open ? "开" : "关"} → 切换
          </button>
          <button
            type="button"
            className={cx("btn", building.operational ? "btn-primary" : "btn-danger")}
            onClick={() =>
              simulationStore.runCommand({
                type: "edit_building",
                buildingId: building.id,
                patch: { operational: !building.operational },
              })
            }
          >
            运行：{building.operational ? "运行中" : "已停止"} → 切换
          </button>
          <button
            type="button"
            className="btn btn-warn"
            onClick={() => simulationStore.runCommand({ type: "repair_building", buildingId: building.id })}
          >
            完全修复
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => simulationStore.runCommand({ type: "rotate_building", buildingId: building.id })}
            title="旋转 90°，占地长宽互换"
          >
            旋转 90°
          </button>
        </div>
        <MoveControls building={building} />
        <DemolishButton building={building} />
      </div>
    </section>
  );
}

function BuildingParamsEditor({ building }: { building: Building }) {
  const [draft, setDraft] = useState({
    name: building.name,
    capacity: String(building.capacity),
    condition: String(Math.round(building.condition)),
    emissions: building.emissions.toFixed(2),
    neonColor: building.neonColor,
    description: building.description,
  });
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const name = draft.name.trim();
    if (name.length === 0) {
      setError("建筑名称不能为空。");
      return;
    }
    const capacityCheck = validateNumberRange(draft.capacity, "容量", 1, 200, true);
    if (capacityCheck.error) {
      setError(capacityCheck.error);
      return;
    }
    const conditionCheck = validateNumberRange(draft.condition, "状况", 0, 100);
    if (conditionCheck.error) {
      setError(conditionCheck.error);
      return;
    }
    const emissionsCheck = validateNumberRange(draft.emissions, "排放", 0, 20);
    if (emissionsCheck.error) {
      setError(emissionsCheck.error);
      return;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.neonColor)) {
      setError("霓虹颜色必须是 #RRGGBB 格式。");
      return;
    }
    setError(null);
    simulationStore.runCommand({
      type: "edit_building",
      buildingId: building.id,
      patch: {
        name,
        capacity: capacityCheck.value ?? building.capacity,
        condition: conditionCheck.value ?? building.condition,
        emissions: emissionsCheck.value ?? building.emissions,
        neonColor: draft.neonColor,
        description: draft.description.slice(0, 240),
      },
    });
  }

  return (
    <div className="editor-block">
      <h5 className="editor-title">参数</h5>
      <div className="form-grid">
        <TextField label="名称" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={30} />
        <NumberField
          label="容量"
          value={draft.capacity}
          min={1}
          max={200}
          step={1}
          onChange={(capacity) => setDraft({ ...draft, capacity })}
        />
        <NumberField
          label="状况"
          value={draft.condition}
          min={0}
          max={100}
          step={1}
          onChange={(condition) => setDraft({ ...draft, condition })}
        />
        <NumberField
          label="排放"
          value={draft.emissions}
          min={0}
          max={20}
          step={0.1}
          onChange={(emissions) => setDraft({ ...draft, emissions })}
        />
        <ColorField
          label="霓虹颜色"
          value={draft.neonColor}
          onChange={(neonColor) => setDraft({ ...draft, neonColor })}
        />
        <TextAreaField
          label="描述"
          value={draft.description}
          onChange={(description) => setDraft({ ...draft, description })}
          rows={2}
          maxLength={240}
        />
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={submit}>
          应用建筑参数
        </button>
      </div>
    </div>
  );
}

function OwnershipEditor({ world, building }: { world: WorldState; building: Building }) {
  const [owner, setOwner] = useState(building.ownerFactionId ?? "");
  return (
    <div className="editor-block">
      <h5 className="editor-title">所有权</h5>
      <div className="form-grid form-grid-3">
        <SelectField
          label="所有者势力"
          value={owner}
          onChange={setOwner}
          options={[
            { value: "", label: "无所有者" },
            ...world.factions.map((faction) => ({ value: faction.id, label: faction.name })),
          ]}
        />
        <div className="form-inline-actions">
          <button
            type="button"
            className="btn btn-primary"
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
      </div>
    </div>
  );
}

function MoveControls({ building }: { building: Building }) {
  const [x, setX] = useState(String(building.x));
  const [z, setZ] = useState(String(building.z));
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const xCheck = validateNumberRange(x, "X 坐标", 0, MAP_WIDTH - building.w, true);
    const zCheck = validateNumberRange(z, "Z 坐标", 0, MAP_DEPTH - building.d, true);
    if (xCheck.error || zCheck.error) {
      setError(xCheck.error ?? zCheck.error);
      return;
    }
    setError(null);
    const result = simulationStore.runCommand({
      type: "move_building",
      buildingId: building.id,
      x: xCheck.value ?? building.x,
      z: zCheck.value ?? building.z,
    });
    if (!result.ok) setError(result.message);
  }

  return (
    <div className="editor-block">
      <h5 className="editor-title">移动</h5>
      <div className="form-grid form-grid-3">
        <NumberField label="X 坐标" value={x} min={0} max={MAP_WIDTH - building.w} step={1} onChange={setX} hint={`0–${MAP_WIDTH - building.w}`} />
        <NumberField label="Z 坐标" value={z} min={0} max={MAP_DEPTH - building.d} step={1} onChange={setZ} hint={`0–${MAP_DEPTH - building.d}`} />
        <div className="form-inline-actions">
          <button type="button" className="btn btn-primary" onClick={submit}>
            移动建筑
          </button>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <p className="form-hint">不能覆盖道路或与其他建筑占地冲突；室内居民会被疏散到门口。</p>
    </div>
  );
}

function DemolishButton({ building }: { building: Building }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const ok = await confirm({
      title: `拆除「${building.name}」？`,
      message:
        "不可撤销：建筑会从世界中移除。室内居民会被疏散，失去住所或工作地点的居民会被安置到其他建筑。",
      details: (
        <ul className="confirm-list">
          <li>类型：{buildingTypeLabel(building.type)}</li>
          <li>占地：{building.w}×{building.d}，坐标 ({building.x}, {building.z})</li>
          <li>库存与到访记录会被一并删除</li>
        </ul>
      ),
      tone: "danger",
      confirmText: "确认拆除",
    });
    if (!ok) return;
    setBusy(true);
    const result = simulationStore.runCommand({ type: "demolish_building", buildingId: building.id });
    setBusy(false);
    if (result.ok) simulationStore.closeInspector();
  }

  return (
    <div className="danger-bar">
      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void handleClick()}>
        {busy ? "拆除中…" : "拆除建筑"}
      </button>
    </div>
  );
}
