import { useEffect, useState } from "react";
import { BUILDING_TYPE_META } from "../../shared/constants";
import { formatMoney } from "../../shared/format";
import type { Resident } from "../../shared/types";
import { simulationStore, useSimulation } from "../../store/useSimulation";
import { useConfirm } from "../ConfirmDialog";
import { PRONOUN_OPTIONS } from "../labels";
import {
  EmptyHint,
  NumberField,
  ObserveNotice,
  SelectField,
  Tag,
  TextAreaField,
  TextField,
  cx,
  validateNumberRange,
} from "../ui";

export function ResidentsTab() {
  const state = useSimulation();
  const { world, mode, selected } = state;
  const editable = mode === "intervene";
  const alive = world.residents.filter((resident) => resident.alive);
  const residentials = world.buildings.filter((building) => building.type === "residential");
  const selectedResidentId = selected?.kind === "resident" ? selected.id : "";
  const [quickId, setQuickId] = useState(selectedResidentId || alive[0]?.id || "");
  const quickResident = world.residents.find((resident) => resident.id === quickId);

  useEffect(() => {
    if (selectedResidentId) setQuickId(selectedResidentId);
  }, [selectedResidentId]);

  return (
    <div className="residents-tab">
      {!editable ? (
        <ObserveNotice>居民创建与编辑需要干预模式。你的改动会立即写入模拟状态并生成一条造物主事件。</ObserveNotice>
      ) : null}
      <div className="residents-columns">
        <section className="residents-create">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>创建居民</h5>
              <Tag tone="cyan">新意识</Tag>
              <span className="muted">共 {alive.length} 名存活居民</span>
            </div>
          </header>
          <CreateResidentForm
            editable={editable}
            factions={world.factions.map((faction) => ({ value: faction.id, label: faction.name }))}
            homes={residentials.map((building) => ({ value: building.id, label: building.name }))}
            works={world.buildings.map((building) => ({
              value: building.id,
              label: `${building.name} · ${BUILDING_TYPE_META[building.type].label}`,
            }))}
          />
        </section>

        <section className="residents-quick">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>选中居民快捷编辑</h5>
              {quickResident ? <Tag tone="purple">{quickResident.name}</Tag> : null}
            </div>
            <div className="tab-toolbar-actions">
              <select value={quickId} onChange={(event) => setQuickId(event.target.value)} aria-label="选择居民">
                {world.residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.name}
                    {resident.alive ? "" : "（已故）"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-tiny"
                disabled={!quickResident}
                onClick={() => {
                  if (quickResident) simulationStore.select({ kind: "resident", id: quickResident.id });
                }}
              >
                打开完整档案
              </button>
            </div>
          </header>
          {quickResident ? (
            <QuickResidentEditor
              key={quickResident.id}
              resident={quickResident}
              editable={editable}
              factionName={
                world.factions.find((faction) => faction.id === quickResident.factionId)?.name ?? "无归属"
              }
            />
          ) : (
            <EmptyHint>选择一名居民进行快捷编辑。</EmptyHint>
          )}
        </section>
      </div>
    </div>
  );
}

interface Option {
  value: string;
  label: string;
}

function CreateResidentForm({
  editable,
  factions,
  homes,
  works,
}: {
  editable: boolean;
  factions: Option[];
  homes: Option[];
  works: Option[];
}) {
  const [form, setForm] = useState({
    name: "",
    age: "26",
    pronouns: "TA",
    jobTitle: "自由职业者",
    factionId: factions[0]?.value ?? "",
    homeBuildingId: homes[0]?.value ?? "",
    workBuildingId: works[0]?.value ?? "",
    labels: "新来者, 谨慎, 观察中",
    longTermGoal: "在第七码头站稳脚跟",
    workSkill: "适应",
    wealth: "30",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function submit() {
    const name = form.name.trim();
    if (name.length === 0) {
      setError("居民姓名不能为空。");
      return;
    }
    if (name.length > 20) {
      setError("姓名最多 20 个字符。");
      return;
    }
    const ageCheck = validateNumberRange(form.age, "年龄", 16, 90, true);
    if (ageCheck.error) {
      setError(ageCheck.error);
      return;
    }
    const wealthCheck = form.wealth.trim() === "" ? { value: undefined, error: null } : validateNumberRange(form.wealth, "初始财富", 0, 10_000);
    if (wealthCheck.error) {
      setError(wealthCheck.error);
      return;
    }
    if (!form.factionId || !form.homeBuildingId || !form.workBuildingId) {
      setError("必须选择势力、住宅与工作地点。");
      return;
    }
    const result = simulationStore.createResident({
      name,
      age: ageCheck.value ?? 26,
      pronouns: form.pronouns as Resident["pronouns"],
      jobTitle: form.jobTitle.trim() || "自由职业者",
      factionId: form.factionId,
      homeBuildingId: form.homeBuildingId,
      workBuildingId: form.workBuildingId,
      workSkill: form.workSkill.trim() || undefined,
      wealth: wealthCheck.value ?? undefined,
      personalityLabels: form.labels
        .split(/[,，、\s]+/)
        .map((label) => label.trim())
        .filter(Boolean)
        .slice(0, 6),
      longTermGoal: form.longTermGoal.trim() || undefined,
    });
    if (result.ok) {
      setError(null);
      setSuccess(`居民「${name}」已接入世界。`);
      setForm((previous) => ({ ...previous, name: "", age: "26" }));
    } else {
      setError(result.message);
    }
  }

  return (
    <div className="create-form">
      <div className="form-grid">
        <TextField
          label="姓名 *"
          value={form.name}
          onChange={(name) => {
            setForm({ ...form, name });
            setSuccess(null);
          }}
          maxLength={20}
          placeholder="例如：林夜"
          disabled={!editable}
        />
        <NumberField
          label="年龄 *"
          value={form.age}
          min={16}
          max={90}
          step={1}
          onChange={(age) => setForm({ ...form, age })}
          disabled={!editable}
          hint="16–90"
        />
        <SelectField
          label="代词"
          value={form.pronouns}
          onChange={(pronouns) => setForm({ ...form, pronouns })}
          options={PRONOUN_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          disabled={!editable}
        />
        <TextField
          label="职业"
          value={form.jobTitle}
          onChange={(jobTitle) => setForm({ ...form, jobTitle })}
          maxLength={30}
          disabled={!editable}
        />
        <SelectField
          label="势力"
          value={form.factionId}
          onChange={(factionId) => setForm({ ...form, factionId })}
          options={factions}
          disabled={!editable}
        />
        <SelectField
          label="住宅"
          value={form.homeBuildingId}
          onChange={(homeBuildingId) => setForm({ ...form, homeBuildingId })}
          options={homes}
          disabled={!editable}
        />
        <SelectField
          label="工作地点"
          value={form.workBuildingId}
          onChange={(workBuildingId) => setForm({ ...form, workBuildingId })}
          options={works}
          disabled={!editable}
        />
        <TextField
          label="技能"
          value={form.workSkill}
          onChange={(workSkill) => setForm({ ...form, workSkill })}
          maxLength={20}
          disabled={!editable}
        />
        <NumberField
          label="初始财富"
          value={form.wealth}
          min={0}
          max={10_000}
          step={1}
          onChange={(wealth) => setForm({ ...form, wealth })}
          disabled={!editable}
        />
        <TextField
          label="性格标签"
          value={form.labels}
          onChange={(labels) => setForm({ ...form, labels })}
          maxLength={80}
          hint="用逗号分隔，最多 6 个"
          disabled={!editable}
        />
      </div>
      <TextAreaField
        label="长期目标"
        value={form.longTermGoal}
        onChange={(longTermGoal) => setForm({ ...form, longTermGoal })}
        rows={2}
        maxLength={60}
        disabled={!editable}
      />
      {error ? <p className="form-error">{error}</p> : null}
      {success ? <p className="form-success">{success}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={!editable} onClick={submit}>
          创造居民
        </button>
        <span className="muted">新居民会在住宅门前出现，并自动加入所选势力。</span>
      </div>
    </div>
  );
}

function QuickResidentEditor({
  resident,
  editable,
  factionName,
}: {
  resident: Resident;
  editable: boolean;
  factionName: string;
}) {
  const confirm = useConfirm();
  const [form, setForm] = useState({
    name: resident.name,
    age: String(Math.round(resident.age)),
    jobTitle: resident.jobTitle,
    wealth: String(Math.round(resident.wealth)),
  });
  const [error, setError] = useState<string | null>(null);

  function save() {
    const name = form.name.trim();
    if (name.length === 0) {
      setError("姓名不能为空。");
      return;
    }
    const ageCheck = validateNumberRange(form.age, "年龄", 0, 120, true);
    if (ageCheck.error) {
      setError(ageCheck.error);
      return;
    }
    const wealthCheck = validateNumberRange(form.wealth, "财富", 0, 1_000_000);
    if (wealthCheck.error) {
      setError(wealthCheck.error);
      return;
    }
    setError(null);
    simulationStore.editResident(resident.id, {
      name,
      age: ageCheck.value ?? resident.age,
      jobTitle: form.jobTitle.trim(),
      wealth: wealthCheck.value ?? resident.wealth,
    });
  }

  async function remove() {
    const ok = await confirm({
      title: `删除居民「${resident.name}」？`,
      message: "不可撤销：该居民的所有关系、记忆与到访记录都会被清理。",
      tone: "danger",
      confirmText: "确认删除",
    });
    if (!ok) return;
    simulationStore.runCommand({ type: "delete_resident", residentId: resident.id });
  }

  return (
    <div className="quick-form">
      <div className="quick-summary">
        <Tag tone={resident.alive ? "good" : "bad"}>{resident.alive ? "存活" : "已故"}</Tag>
        <Tag tone="cyan">{factionName}</Tag>
        <span className="muted">
          {resident.insideBuildingId
            ? "位于建筑内"
            : `街区 (${Math.round(resident.position.x)}, ${Math.round(resident.position.z)})`}
        </span>
        <span className="muted">
          财富 {formatMoney(resident.wealth)} · 健康 {Math.round(resident.health)} · 压力 {Math.round(resident.stress)}
        </span>
        {resident.paused ? <Tag tone="warn">行动暂停</Tag> : null}
        {resident.aiHint ? <Tag tone="magenta">AI 建议</Tag> : null}
      </div>
      <div className="form-grid">
        <TextField
          label="姓名"
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
          maxLength={20}
          disabled={!editable}
        />
        <NumberField
          label="年龄"
          value={form.age}
          min={0}
          max={120}
          step={1}
          onChange={(age) => setForm({ ...form, age })}
          disabled={!editable}
        />
        <TextField
          label="职业"
          value={form.jobTitle}
          onChange={(jobTitle) => setForm({ ...form, jobTitle })}
          maxLength={30}
          disabled={!editable}
        />
        <NumberField
          label="财富"
          value={form.wealth}
          min={0}
          max={1_000_000}
          step={1}
          onChange={(wealth) => setForm({ ...form, wealth })}
          disabled={!editable}
        />
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={!editable} onClick={save}>
          保存快捷编辑
        </button>
        <button
          type="button"
          className={cx("btn", resident.paused ? "btn-primary" : "btn-ghost")}
          disabled={!editable}
          onClick={() =>
            simulationStore.runCommand({ type: "pause_resident", residentId: resident.id, paused: !resident.paused })
          }
        >
          {resident.paused ? "恢复行动" : "暂停行动"}
        </button>
        <button type="button" className="btn btn-danger" disabled={!editable} onClick={() => void remove()}>
          删除居民
        </button>
      </div>
    </div>
  );
}
