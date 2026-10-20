import { useState } from "react";
import {
  ACTION_META,
  BUILDING_TYPE_META,
  MAP_DEPTH,
  MAP_WIDTH,
  RELATIONSHIP_LABELS,
} from "../../shared/constants";
import {
  formatClock,
  formatMoney,
  healthLabel,
  moodLabel,
  needLabel,
  needSeverity,
  residentLocation,
  stressLabel,
} from "../../shared/format";
import type {
  InteractionMode,
  Memory,
  Needs,
  Relationship,
  Resident,
  WorldState,
} from "../../shared/types";
import { simulationStore } from "../../store/useSimulation";
import { useConfirm } from "../ConfirmDialog";
import {
  ACTION_PHASE_LABELS,
  ACTION_SOURCE_LABELS,
  GENDER_LABELS,
  GOAL_KIND_LABELS,
  GOAL_STATUS_LABELS,
  LIFE_EVENT_KIND_LABELS,
  MEMORY_KIND_LABELS,
  MEMORY_SOURCE_LABELS,
  ageGroupLabel,
  buildingName,
  residentName,
} from "../labels";
import {
  cx,
  DataRow,
  EmptyHint,
  ImportanceDots,
  MetricBar,
  NumberField,
  ObserveNotice,
  PanelSection,
  SelectField,
  Tag,
  TextAreaField,
  TextField,
  validateNumberRange,
} from "../ui";

const NEED_KEYS: Array<keyof Needs> = ["hunger", "energy", "social", "safety"];

const PHASE_TONE: Record<string, "neutral" | "warn" | "good" | "bad"> = {
  deciding: "neutral",
  moving: "warn",
  acting: "good",
  blocked: "bad",
};

const TRAITS: Array<{ key: keyof Resident["personality"]["traits"]; label: string }> = [
  { key: "openness", label: "开放" },
  { key: "conscientiousness", label: "尽责" },
  { key: "extraversion", label: "外向" },
  { key: "agreeableness", label: "宜人" },
  { key: "neuroticism", label: "神经质" },
];

function needTone(key: keyof Needs, value: number) {
  return needSeverity(key, value);
}

function factionTone(kind?: string) {
  if (kind === "corporation") return "blue" as const;
  if (kind === "community") return "cyan" as const;
  if (kind === "underground") return "purple" as const;
  return "neutral" as const;
}

interface ResidentPanelProps {
  world: WorldState;
  resident: Resident;
  mode: InteractionMode;
}

export function ResidentInspector({ world, resident, mode }: ResidentPanelProps) {
  const editable = mode === "intervene";
  const faction = world.factions.find((item) => item.id === resident.factionId);
  const activeGoals = [...resident.goals]
    .filter((goal) => goal.status === "active")
    .sort((a, b) => b.priority - a.priority);

  return (
    <div className="resident-panel">
      <section className="res-identity">
        <div
          className="res-avatar"
          style={{
            background: `linear-gradient(155deg, ${resident.appearance.bodyColor}, ${resident.appearance.accentColor})`,
            borderColor: resident.appearance.accentColor,
          }}
          aria-hidden="true"
        >
          <span className="res-avatar-initial">{resident.name.slice(0, 1)}</span>
        </div>
        <div className="res-identity-main">
          <div className="res-name-row">
            <h3 className="res-name">{resident.name}</h3>
            <span className="res-pronoun">
              {GENDER_LABELS[resident.pronouns]} · {Math.round(resident.age)} 岁 · {ageGroupLabel(resident.age)}
            </span>
          </div>
          <div className="res-tag-row">
            <Tag tone={factionTone(faction?.kind)}>{faction?.name ?? "无归属"}</Tag>
            <Tag>{resident.jobTitle}</Tag>
            <Tag tone={resident.alive ? "good" : "bad"}>{resident.alive ? "存活" : "已故"}</Tag>
            {resident.paused ? <Tag tone="warn">行动暂停</Tag> : null}
            {resident.aiHint ? <Tag tone="magenta">AI 建议待评估</Tag> : null}
          </div>
          <div className="res-meta-row">
            <span>◈ {residentLocation(world, resident)}</span>
            <span>
              财富 <b className="mono">{formatMoney(resident.wealth)}</b>
            </span>
            <span>
              声望 <b className="mono">{Math.round(resident.reputation)}</b>
            </span>
            <span>
              情绪 <b className="mono">{moodLabel(resident.mood)}</b>
            </span>
          </div>
        </div>
      </section>

      <ActionSection world={world} resident={resident} />
      <VitalsSection world={world} resident={resident} activeGoalTitle={activeGoals[0]?.title} />

      {editable ? (
        <section className="ui-section intervention-section">
          <header className="ui-section-head">
            <h4 className="ui-section-title">造物主干预</h4>
            <span className="ui-section-hint">所有改动直接写入模拟状态</span>
          </header>
          <div className="ui-section-body">
            <ProfileEditor world={world} resident={resident} />
            <StatsEditor resident={resident} />
            <TeleportControls resident={resident} />
            <div className="danger-bar">
              <button
                type="button"
                className={cx("btn", resident.paused ? "btn-primary" : "btn-ghost")}
                onClick={() =>
                  simulationStore.runCommand({
                    type: "pause_resident",
                    residentId: resident.id,
                    paused: !resident.paused,
                  })
                }
              >
                {resident.paused ? "▶ 恢复个人行动" : "❚❚ 暂停个人行动"}
              </button>
              <DeleteResidentButton resident={resident} />
            </div>
          </div>
        </section>
      ) : (
        <ObserveNotice>
          观察模式下居民档案只读。切换到「干预」模式后可以编辑属性、需求、记忆、目标、关系，以及传送或删除居民。
        </ObserveNotice>
      )}

      <PersonalitySection resident={resident} />
      <GoalBoard resident={resident} editable={editable} />
      <MemoryBoard world={world} resident={resident} editable={editable} />
      <RelationshipBoard world={world} resident={resident} editable={editable} />
      <TimelineSection world={world} resident={resident} />
      <LifeEventsSection resident={resident} />
      <SecretsSection world={world} resident={resident} />
    </div>
  );
}

function ActionSection({ world, resident }: { world: WorldState; resident: Resident }) {
  const action = resident.currentAction;
  const targetBuilding = action?.targetBuildingId
    ? world.buildings.find((building) => building.id === action.targetBuildingId)
    : undefined;
  const targetResident = action?.targetResidentId
    ? world.residents.find((candidate) => candidate.id === action.targetResidentId)
    : undefined;
  const hint = resident.aiHint;
  const hintTarget =
    hint?.targetKind === "building"
      ? buildingName(world.buildings, hint.targetId)
      : hint?.targetKind === "resident"
        ? residentName(world.residents, hint.targetId)
        : "—";

  return (
    <PanelSection
      title="当前行动"
      right={action ? <Tag tone={PHASE_TONE[action.phase] ?? "neutral"}>{ACTION_PHASE_LABELS[action.phase]}</Tag> : undefined}
    >
      {action ? (
        <div className="action-box">
          <div className="action-head">
            <span className="action-label">{ACTION_META[action.action].label}</span>
            <Tag tone={action.source === "ai" ? "magenta" : action.source === "player" ? "gold" : "cyan"}>
              {ACTION_SOURCE_LABELS[action.source]}
            </Tag>
            <span className="action-remaining mono">
              剩余 {Math.max(0, action.endsTick - world.clock.tick)} tick
            </span>
          </div>
          <p className="action-reason">{action.reason || ACTION_META[action.action].description}</p>
          {targetBuilding || targetResident ? (
            <DataRow label="目标">
              {targetBuilding ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => simulationStore.select({ kind: "building", id: targetBuilding.id })}
                >
                  {targetBuilding.name}
                </button>
              ) : null}
              {targetResident ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => simulationStore.select({ kind: "resident", id: targetResident.id })}
                >
                  {targetResident.name}
                </button>
              ) : null}
              {!targetBuilding && !targetResident && action.targetId ? <span className="mono">{action.targetId}</span> : null}
            </DataRow>
          ) : null}
          {action.path.length > 0 ? (
            <DataRow label="路径">
              剩余 {Math.max(0, action.path.length - action.pathIndex)} 个路径点
            </DataRow>
          ) : null}
        </div>
      ) : (
        <EmptyHint>
          {resident.paused ? "个人行动已被造物主暂停。" : "当前没有进行中的行动，正在等待下一次决策。"}
        </EmptyHint>
      )}

      {hint ? (
        <div className="ai-hint-box">
          <div className="ai-hint-head">
            <Tag tone="magenta">AI 建议</Tag>
            <span className="mono">创建于 t{hint.createdTick} · 到期 t{hint.expiresTick}</span>
          </div>
          <p>
            建议行动：<b>{ACTION_META[hint.action].label}</b>
            {hint.targetId ? ` → ${hintTarget}` : ""}
          </p>
          <p className="ai-hint-reason">{hint.reason}</p>
        </div>
      ) : null}
    </PanelSection>
  );
}

function VitalsSection({
  world,
  resident,
  activeGoalTitle,
}: {
  world: WorldState;
  resident: Resident;
  activeGoalTitle?: string;
}) {
  return (
    <PanelSection title="状态与需求" hint={`tick ${world.clock.tick}`}>
      <div className="vital-grid">
        <MetricBar
          label="健康"
          value={resident.health}
          display={`${Math.round(resident.health)} · ${healthLabel(resident.health)}`}
          tone={resident.health >= 65 ? "good" : resident.health >= 42 ? "warn" : "bad"}
        />
        <MetricBar
          label="情绪"
          value={resident.mood}
          display={`${Math.round(resident.mood)} · ${moodLabel(resident.mood)}`}
          tone={resident.mood >= 62 ? "good" : resident.mood >= 40 ? "warn" : "bad"}
        />
        <MetricBar
          label="压力"
          value={resident.stress}
          display={`${Math.round(resident.stress)} · ${stressLabel(resident.stress)}`}
          tone={resident.stress <= 40 ? "good" : resident.stress <= 60 ? "warn" : "bad"}
        />
        {NEED_KEYS.map((key) => {
          const value = resident.needs[key];
          return (
            <MetricBar
              key={key}
              label={needLabel(key)}
              value={value}
              display={String(Math.round(value))}
              tone={needTone(key, value)}
              title={key === "hunger" ? "0 = 吃饱，100 = 极度饥饿" : "数值越高越满足"}
            />
          );
        })}
      </div>
      <div className="vital-foot">
        <DataRow label="财富" mono>
          {formatMoney(resident.wealth)} <span className="muted">（{Math.round(resident.wealth)}）</span>
        </DataRow>
        <DataRow label="声望" mono>
          {Math.round(resident.reputation)}
        </DataRow>
        <DataRow label="核心动机">{activeGoalTitle ?? "尚无明确长期目标"}</DataRow>
      </div>
    </PanelSection>
  );
}

function ProfileEditor({ world, resident }: { world: WorldState; resident: Resident }) {
  const [draft, setDraft] = useState({
    name: resident.name,
    age: String(Math.round(resident.age)),
    jobTitle: resident.jobTitle,
    factionId: resident.factionId,
    homeBuildingId: resident.homeBuildingId,
    workBuildingId: resident.workBuildingId,
  });
  const [error, setError] = useState<string | null>(null);

  const homeOptions = world.buildings
    .filter((building) => building.type === "residential")
    .map((building) => ({ value: building.id, label: building.name }));
  const workOptions = world.buildings.map((building) => ({
    value: building.id,
    label: `${building.name}（${BUILDING_TYPE_META[building.type].label}）`,
  }));
  const factionOptions = world.factions.map((faction) => ({ value: faction.id, label: faction.name }));

  function submit() {
    const name = draft.name.trim();
    if (name.length === 0) {
      setError("姓名不能为空。");
      return;
    }
    const ageCheck = validateNumberRange(draft.age, "年龄", 0, 120, true);
    if (ageCheck.error) {
      setError(ageCheck.error);
      return;
    }
    if (!draft.factionId || !draft.homeBuildingId || !draft.workBuildingId) {
      setError("势力、住所与工作地点都必须选择。");
      return;
    }
    setError(null);
    simulationStore.editResident(resident.id, {
      name,
      age: ageCheck.value ?? undefined,
      jobTitle: draft.jobTitle.trim(),
      factionId: draft.factionId,
      homeBuildingId: draft.homeBuildingId,
      workBuildingId: draft.workBuildingId,
    });
  }

  return (
    <div className="editor-block">
      <h5 className="editor-title">身份档案</h5>
      <div className="form-grid">
        <TextField label="姓名" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={20} />
        <NumberField
          label="年龄"
          value={draft.age}
          min={0}
          max={120}
          step={1}
          onChange={(age) => setDraft({ ...draft, age })}
        />
        <TextField
          label="职业"
          value={draft.jobTitle}
          onChange={(jobTitle) => setDraft({ ...draft, jobTitle })}
          maxLength={30}
        />
        <SelectField
          label="势力"
          value={draft.factionId}
          onChange={(factionId) => setDraft({ ...draft, factionId })}
          options={factionOptions}
        />
        <SelectField
          label="住所"
          value={draft.homeBuildingId}
          onChange={(homeBuildingId) => setDraft({ ...draft, homeBuildingId })}
          options={homeOptions}
        />
        <SelectField
          label="工作地点"
          value={draft.workBuildingId}
          onChange={(workBuildingId) => setDraft({ ...draft, workBuildingId })}
          options={workOptions}
        />
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={submit}>
          保存身份档案
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            setDraft({
              name: resident.name,
              age: String(Math.round(resident.age)),
              jobTitle: resident.jobTitle,
              factionId: resident.factionId,
              homeBuildingId: resident.homeBuildingId,
              workBuildingId: resident.workBuildingId,
            })
          }
        >
          重置
        </button>
      </div>
    </div>
  );
}

function StatsEditor({ resident }: { resident: Resident }) {
  const [draft, setDraft] = useState({
    health: String(Math.round(resident.health)),
    mood: String(Math.round(resident.mood)),
    stress: String(Math.round(resident.stress)),
    reputation: String(Math.round(resident.reputation)),
    wealth: String(Math.round(resident.wealth)),
    hunger: String(Math.round(resident.needs.hunger)),
    energy: String(Math.round(resident.needs.energy)),
    social: String(Math.round(resident.needs.social)),
    safety: String(Math.round(resident.needs.safety)),
  });
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const errors: string[] = [];
    const values: Record<string, number> = {};
    const fields: Array<{ key: keyof typeof draft; label: string; min: number; max: number }> = [
      { key: "health", label: "健康", min: 0, max: 100 },
      { key: "mood", label: "情绪", min: 0, max: 100 },
      { key: "stress", label: "压力", min: 0, max: 100 },
      { key: "reputation", label: "声望", min: 0, max: 100 },
      { key: "wealth", label: "财富", min: 0, max: 1_000_000 },
      { key: "hunger", label: "饥饿", min: 0, max: 100 },
      { key: "energy", label: "精力", min: 0, max: 100 },
      { key: "social", label: "社交", min: 0, max: 100 },
      { key: "safety", label: "安全感", min: 0, max: 100 },
    ];
    for (const field of fields) {
      const check = validateNumberRange(draft[field.key], field.label, field.min, field.max);
      if (check.error) errors.push(check.error);
      else if (check.value !== null) values[field.key] = check.value;
    }
    if (errors.length > 0) {
      setError(errors[0] ?? "输入不合法。");
      return;
    }
    setError(null);
    simulationStore.editResident(resident.id, {
      health: values.health,
      mood: values.mood,
      stress: values.stress,
      reputation: values.reputation,
      wealth: values.wealth,
      needs: {
        hunger: values.hunger,
        energy: values.energy,
        social: values.social,
        safety: values.safety,
      },
    });
  }

  return (
    <div className="editor-block">
      <h5 className="editor-title">属性、需求与财富</h5>
      <div className="form-grid form-grid-3">
        <NumberField label="健康" value={draft.health} min={0} max={100} step={1} onChange={(health) => setDraft({ ...draft, health })} />
        <NumberField label="情绪" value={draft.mood} min={0} max={100} step={1} onChange={(mood) => setDraft({ ...draft, mood })} />
        <NumberField label="压力" value={draft.stress} min={0} max={100} step={1} onChange={(stress) => setDraft({ ...draft, stress })} />
        <NumberField label="声望" value={draft.reputation} min={0} max={100} step={1} onChange={(reputation) => setDraft({ ...draft, reputation })} />
        <NumberField label="财富" value={draft.wealth} min={0} max={1_000_000} step={1} onChange={(wealth) => setDraft({ ...draft, wealth })} />
        <NumberField label="饥饿" value={draft.hunger} min={0} max={100} step={1} onChange={(hunger) => setDraft({ ...draft, hunger })} />
        <NumberField label="精力" value={draft.energy} min={0} max={100} step={1} onChange={(energy) => setDraft({ ...draft, energy })} />
        <NumberField label="社交" value={draft.social} min={0} max={100} step={1} onChange={(social) => setDraft({ ...draft, social })} />
        <NumberField label="安全感" value={draft.safety} min={0} max={100} step={1} onChange={(safety) => setDraft({ ...draft, safety })} />
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={submit}>
          写入状态与需求
        </button>
      </div>
    </div>
  );
}

function TeleportControls({ resident }: { resident: Resident }) {
  const [x, setX] = useState(String(Math.round(resident.position.x)));
  const [z, setZ] = useState(String(Math.round(resident.position.z)));
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const xCheck = validateNumberRange(x, "X 坐标", 0, MAP_WIDTH - 1, true);
    const zCheck = validateNumberRange(z, "Z 坐标", 0, MAP_DEPTH - 1, true);
    if (xCheck.error || zCheck.error) {
      setError(xCheck.error ?? zCheck.error);
      return;
    }
    setError(null);
    simulationStore.runCommand({
      type: "teleport_resident",
      residentId: resident.id,
      x: xCheck.value ?? 0,
      z: zCheck.value ?? 0,
    });
  }

  return (
    <div className="editor-block">
      <h5 className="editor-title">传送</h5>
      <div className="form-grid form-grid-3">
        <NumberField label="X 坐标" value={x} min={0} max={MAP_WIDTH - 1} step={1} onChange={setX} hint={`0–${MAP_WIDTH - 1}`} />
        <NumberField label="Z 坐标" value={z} min={0} max={MAP_DEPTH - 1} step={1} onChange={setZ} hint={`0–${MAP_DEPTH - 1}`} />
        <div className="form-inline-actions">
          <button type="button" className="btn btn-primary" onClick={submit}>
            传送到坐标
          </button>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <p className="form-hint">落点会被自动修正到最近的可行走地块；室内状态与当前行动会被清空。</p>
    </div>
  );
}

function DeleteResidentButton({ resident }: { resident: Resident }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const ok = await confirm({
      title: `删除居民「${resident.name}」？`,
      message:
        "不可撤销：这个人会从世界中抹除，所有指向TA的关系、印象、承诺记录与建筑到访记录都会被清理，居民列表会立即更新。",
      details: (
        <ul className="confirm-list">
          <li>当前存活状态：{resident.alive ? "存活" : "已故"}</li>
          <li>所属势力成员数将减少 1</li>
          <li>该操作会写入一条造物主事件日志</li>
        </ul>
      ),
      tone: "danger",
      confirmText: "确认删除居民",
    });
    if (!ok) return;
    setBusy(true);
    const result = simulationStore.runCommand({ type: "delete_resident", residentId: resident.id });
    setBusy(false);
    if (result.ok) simulationStore.closeInspector();
  }

  return (
    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void handleClick()}>
      {busy ? "删除中…" : "删除居民"}
    </button>
  );
}

function PersonalitySection({ resident }: { resident: Resident }) {
  return (
    <PanelSection title="人格与背景" hint={`创造于 t${resident.createdAtTick}`}>
      <div className="personality-box">
        <div className="tag-line">
          {resident.personality.labels.map((label) => (
            <Tag key={label} tone="cyan">
              {label}
            </Tag>
          ))}
        </div>
        <div className="tag-line">
          {resident.personality.values.map((value) => (
            <Tag key={value} tone="purple">
              {value}
            </Tag>
          ))}
        </div>
      </div>
      <div className="trait-list">
        {TRAITS.map((trait) => (
          <MetricBar
            key={trait.key}
            label={trait.label}
            value={resident.personality.traits[trait.key]}
            display={String(Math.round(resident.personality.traits[trait.key]))}
            tone="purple"
            compact
          />
        ))}
      </div>
      <p className="backstory">{resident.backstory}</p>
      <div className="tag-line">
        <span className="muted">技能：</span>
        {Object.entries(resident.skills).map(([skill, value]) => (
          <Tag key={skill} tone="neutral">
            {skill} {Math.round(value)}
          </Tag>
        ))}
      </div>
      <DataRow label="日程">
        醒 {formatClock(resident.routine.wakeMinute)} · 睡 {formatClock(resident.routine.sleepMinute)} · 工作{" "}
        {formatClock(resident.routine.workStartMinute)}–{formatClock(resident.routine.workEndMinute)}
      </DataRow>
    </PanelSection>
  );
}

function GoalBoard({ resident, editable }: { resident: Resident; editable: boolean }) {
  const confirm = useConfirm();
  const [kind, setKind] = useState<"long" | "short">("short");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("6");
  const [error, setError] = useState<string | null>(null);

  const goals = [...resident.goals].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return b.priority - a.priority;
  });

  function addGoal() {
    const trimmed = title.trim();
    if (trimmed.length < 2) {
      setError("目标标题至少需要 2 个字符。");
      return;
    }
    const priorityCheck = validateNumberRange(priority, "优先级", 1, 10, true);
    if (priorityCheck.error) {
      setError(priorityCheck.error);
      return;
    }
    setError(null);
    const result = simulationStore.runCommand({
      type: "set_goal",
      residentId: resident.id,
      title: trimmed,
      description: description.trim(),
      kind,
      priority: priorityCheck.value ?? 5,
    });
    if (result.ok) {
      setTitle("");
      setDescription("");
    }
  }

  async function removeGoal(goalId: string, goalTitle: string) {
    const ok = await confirm({
      title: "撤销这个目标？",
      message: `「${goalTitle}」将从${resident.name}的计划中移除。`,
      tone: "danger",
      confirmText: "撤销目标",
    });
    if (!ok) return;
    simulationStore.runCommand({ type: "delete_goal", residentId: resident.id, goalId });
  }

  return (
    <PanelSection title="目标" hint={`${goals.filter((goal) => goal.status === "active").length} 个进行中`}>
      {goals.length === 0 ? <EmptyHint>这名居民暂时没有目标。</EmptyHint> : null}
      <div className="goal-list">
        {goals.map((goal) => (
          <div className={cx("goal-row", `goal-${goal.status}`)} key={goal.id}>
            <div className="goal-head">
              <Tag tone={goal.kind === "long" ? "purple" : "cyan"}>{GOAL_KIND_LABELS[goal.kind]}</Tag>
              <span className="goal-title">{goal.title}</span>
              <Tag tone={goal.status === "active" ? "good" : goal.status === "completed" ? "neutral" : "warn"}>
                {GOAL_STATUS_LABELS[goal.status]}
              </Tag>
              <span className="goal-priority mono">P{goal.priority}</span>
            </div>
            <p className="goal-desc">{goal.description}</p>
            <div className="goal-meta">
              <span className="mono">进度 {Math.round(goal.progress)}%</span>
              {goal.deadlineDay ? <span className="mono">截止 D{goal.deadlineDay}</span> : null}
              <span>创建于 D{goal.createdDay}</span>
              {goal.relatedResidentId ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => simulationStore.select({ kind: "resident", id: goal.relatedResidentId! })}
                >
                  关联人物
                </button>
              ) : null}
            </div>
            <div className="progress-track">
              <i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} />
            </div>
            {editable ? (
              <button type="button" className="btn btn-tiny btn-danger-ghost" onClick={() => void removeGoal(goal.id, goal.title)}>
                删除目标
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {editable ? (
        <div className="editor-block">
          <h5 className="editor-title">设定新目标</h5>
          <div className="form-grid">
            <SelectField
              label="类型"
              value={kind}
              onChange={(value) => setKind(value === "long" ? "long" : "short")}
              options={[
                { value: "short", label: "短期目标" },
                { value: "long", label: "长期目标" },
              ]}
            />
            <NumberField label="优先级" value={priority} min={1} max={10} step={1} onChange={setPriority} hint="1–10" />
            <TextField
              label="标题"
              value={title}
              onChange={setTitle}
              maxLength={60}
              placeholder="例如：在酸雨季到来前修好备用电路"
              wide
            />
            <TextAreaField
              label="描述"
              value={description}
              onChange={setDescription}
              rows={2}
              maxLength={180}
              placeholder="这个目标对TA意味着什么？"
            />
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={addGoal}>
              写入目标
            </button>
          </div>
        </div>
      ) : null}
    </PanelSection>
  );
}

function MemoryBoard({ world, resident, editable }: { world: WorldState; resident: Resident; editable: boolean }) {
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [importance, setImportance] = useState("6");
  const [error, setError] = useState<string | null>(null);

  const seen = new Set<string>();
  const memories: Memory[] = [];
  for (const memory of [...resident.memories.important, ...resident.memories.recent]) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    memories.push(memory);
    if (memories.length >= 18) break;
  }

  async function removeMemory(memory: Memory) {
    const ok = await confirm({
      title: "删除这段记忆？",
      message: memory.text.slice(0, 120),
      details: <p className="muted">记忆会从近期与重要记忆中同时移除，不可撤销。</p>,
      tone: "danger",
      confirmText: "删除记忆",
    });
    if (!ok) return;
    simulationStore.runCommand({ type: "delete_memory", residentId: resident.id, memoryId: memory.id });
  }

  function addMemory() {
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setError("记忆内容至少需要 2 个字符。");
      return;
    }
    const importanceCheck = validateNumberRange(importance, "重要度", 1, 10, true);
    if (importanceCheck.error) {
      setError(importanceCheck.error);
      return;
    }
    setError(null);
    const result = simulationStore.runCommand({
      type: "add_memory",
      residentId: resident.id,
      text: trimmed,
      importance: importanceCheck.value ?? 5,
      subjectIds: [],
    });
    if (result.ok) setText("");
  }

  return (
    <PanelSection
      title="记忆"
      hint={`重要 ${resident.memories.important.length} · 近期 ${resident.memories.recent.length}`}
    >
      {memories.length === 0 ? <EmptyHint>还没有任何记忆。</EmptyHint> : null}
      <div className="memory-list">
        {memories.map((memory) => (
          <div className={cx("memory-item", memory.importance >= 6 && "is-important")} key={memory.id}>
            <div className="memory-head">
              <span className="memory-time mono">
                D{memory.day} {formatClock(memory.minuteOfDay)}
              </span>
              <Tag tone="purple">{MEMORY_KIND_LABELS[memory.kind]}</Tag>
              <span className="memory-source muted">
                {MEMORY_SOURCE_LABELS[memory.source]} · 可靠度 {Math.round(memory.reliability * 100)}%
              </span>
              <ImportanceDots value={memory.importance} />
              {editable ? (
                <button
                  type="button"
                  className="btn btn-tiny btn-danger-ghost"
                  title="删除这条记忆"
                  onClick={() => void removeMemory(memory)}
                >
                  删除
                </button>
              ) : null}
            </div>
            <p className="memory-text">{memory.text}</p>
            {memory.subjectIds.length > 0 ? (
              <div className="memory-subjects">
                {memory.subjectIds.map((subjectId) => {
                  const subject = world.residents.find((candidate) => candidate.id === subjectId);
                  return subject ? (
                    <button
                      key={subjectId}
                      type="button"
                      className="link-btn"
                      onClick={() => simulationStore.select({ kind: "resident", id: subject.id })}
                    >
                      @{subject.name}
                    </button>
                  ) : (
                    <span key={subjectId} className="muted mono">
                      @{subjectId}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {resident.memories.longTerm.length > 0 ? (
        <div className="longterm-box">
          <span className="editor-title">长期记忆摘要</span>
          <ul className="longterm-list">
            {resident.memories.longTerm.slice(-6).map((summary) => (
              <li key={summary}>{summary}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {editable ? (
        <div className="editor-block">
          <h5 className="editor-title">写入新记忆</h5>
          <TextAreaField
            label="记忆内容"
            value={text}
            onChange={setText}
            rows={2}
            maxLength={220}
            placeholder="造物主在TA的认知里写下……"
          />
          <div className="form-grid form-grid-3">
            <NumberField
              label="重要度"
              value={importance}
              min={1}
              max={10}
              step={1}
              onChange={setImportance}
              hint="1–10，≥6 进入重要记忆"
            />
            <div className="form-inline-actions">
              <button type="button" className="btn btn-primary" onClick={addMemory}>
                写入记忆
              </button>
            </div>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : null}
    </PanelSection>
  );
}

interface RelationDraft {
  type: string;
  affinity: string;
  trust: string;
  attraction: string;
  hostility: string;
  familiarity: string;
  intimacy: string;
}

function relationshipDraft(relation: Relationship): RelationDraft {
  return {
    type: relation.type,
    affinity: String(Math.round(relation.affinity)),
    trust: String(Math.round(relation.trust)),
    attraction: String(Math.round(relation.attraction)),
    hostility: String(Math.round(relation.hostility)),
    familiarity: String(Math.round(relation.familiarity)),
    intimacy: String(Math.round(relation.intimacy)),
  };
}

function RelationshipBoard({ world, resident, editable }: { world: WorldState; resident: Resident; editable: boolean }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RelationDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const relations = Object.values(resident.relationships).sort(
    (a, b) => b.familiarity + b.affinity - (a.familiarity + a.affinity),
  );

  function startEdit(relation: Relationship) {
    setEditingId(relation.residentId);
    setDraft(relationshipDraft(relation));
    setError(null);
  }

  function submit(targetId: string) {
    if (!draft) return;
    const fields: Array<{ key: keyof RelationDraft; label: string; min: number; max: number }> = [
      { key: "affinity", label: "好感", min: -100, max: 100 },
      { key: "trust", label: "信任", min: -100, max: 100 },
      { key: "attraction", label: "吸引", min: -100, max: 100 },
      { key: "hostility", label: "敌意", min: 0, max: 100 },
      { key: "familiarity", label: "熟悉", min: 0, max: 100 },
      { key: "intimacy", label: "亲密", min: 0, max: 100 },
    ];
    const errors: string[] = [];
    const values: Record<string, number> = {};
    for (const field of fields) {
      const check = validateNumberRange(draft[field.key], field.label, field.min, field.max, true);
      if (check.error) errors.push(check.error);
      else if (check.value !== null) values[field.key] = check.value;
    }
    if (errors.length > 0) {
      setError(errors[0] ?? "关系数值不合法。");
      return;
    }
    setError(null);
    const result = simulationStore.runCommand({
      type: "edit_relationship",
      residentId: resident.id,
      targetId,
      patch: {
        type: draft.type,
        affinity: values.affinity,
        trust: values.trust,
        attraction: values.attraction,
        hostility: values.hostility,
        familiarity: values.familiarity,
        intimacy: values.intimacy,
      },
    });
    if (result.ok) {
      setEditingId(null);
      setDraft(null);
    }
  }

  return (
    <PanelSection title="关系网络" hint={`${relations.length} 条关系`}>
      {relations.length === 0 ? <EmptyHint>这名居民还没有建立任何关系。</EmptyHint> : null}
      <div className="relation-list">
        {relations.map((relation) => {
          const target = world.residents.find((candidate) => candidate.id === relation.residentId);
          if (!target) return null;
          const editing = editingId === relation.residentId && draft !== null;
          return (
            <div className={cx("relation-row", editing && "is-editing")} key={relation.residentId}>
              <button
                type="button"
                className="relation-main"
                title={`查看 ${target.name} 的完整档案`}
                onClick={() => simulationStore.select({ kind: "resident", id: target.id })}
              >
                <span className="relation-name-line">
                  <span className="relation-name">{target.name}</span>
                  <Tag tone={relation.type === "enemy" || relation.type === "rival" ? "bad" : "cyan"}>
                    {RELATIONSHIP_LABELS[relation.type]}
                  </Tag>
                  <span className="muted">{target.jobTitle}</span>
                </span>
                <span className="relation-meta mono">
                  熟悉 {Math.round(relation.familiarity)} · 好感 {Math.round(relation.affinity)} · 信任{" "}
                  {Math.round(relation.trust)} · 亲密 {Math.round(relation.intimacy)} · 敌意{" "}
                  {Math.round(relation.hostility)}
                </span>
                <span className="relation-meta muted">
                  互动 {relation.interactions} 次 · 上次 D{relation.lastInteractionDay} · 始于 D{relation.sinceDay}
                </span>
              </button>
              {editable ? (
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => (editing ? setEditingId(null) : startEdit(relation))}
                >
                  {editing ? "收起" : "改写"}
                </button>
              ) : null}
              {editing && draft ? (
                <div className="relation-editor">
                  <div className="form-grid form-grid-3">
                    <SelectField
                      label="关系类型"
                      value={draft.type}
                      onChange={(type) => setDraft({ ...draft, type })}
                      options={Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => ({ value, label }))}
                    />
                    <NumberField label="好感" value={draft.affinity} min={-100} max={100} step={1} onChange={(affinity) => setDraft({ ...draft, affinity })} />
                    <NumberField label="信任" value={draft.trust} min={-100} max={100} step={1} onChange={(trust) => setDraft({ ...draft, trust })} />
                    <NumberField label="吸引" value={draft.attraction} min={-100} max={100} step={1} onChange={(attraction) => setDraft({ ...draft, attraction })} />
                    <NumberField label="敌意" value={draft.hostility} min={0} max={100} step={1} onChange={(hostility) => setDraft({ ...draft, hostility })} />
                    <NumberField label="熟悉" value={draft.familiarity} min={0} max={100} step={1} onChange={(familiarity) => setDraft({ ...draft, familiarity })} />
                    <NumberField label="亲密" value={draft.intimacy} min={0} max={100} step={1} onChange={(intimacy) => setDraft({ ...draft, intimacy })} />
                  </div>
                  {error ? <p className="form-error">{error}</p> : null}
                  <div className="form-actions">
                    <button type="button" className="btn btn-primary" onClick={() => submit(relation.residentId)}>
                      保存关系认知
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {editable ? <p className="form-hint">关系是单向认知：改写只影响{resident.name}对对方的看法。</p> : null}
    </PanelSection>
  );
}

function TimelineSection({ world, resident }: { world: WorldState; resident: Resident }) {
  const entries = resident.history.slice(0, 18);
  return (
    <PanelSection title="行动时间线" hint={`最近 ${entries.length} 条`}>
      {entries.length === 0 ? <EmptyHint>还没有行动记录。</EmptyHint> : null}
      <ol className="timeline-list">
        {entries.map((entry, index) => (
          <li className="timeline-item" key={`${entry.tick}-${entry.action}-${index}`}>
            <span className="timeline-dot" aria-hidden="true" />
            <div className="timeline-content">
              <div className="timeline-head">
                <span className="timeline-label">{entry.label}</span>
                <Tag tone={entry.source === "ai" ? "magenta" : entry.source === "player" ? "gold" : "cyan"}>
                  {ACTION_SOURCE_LABELS[entry.source]}
                </Tag>
                <span className="timeline-time mono">
                  D{entry.day} · t{entry.tick}
                </span>
              </div>
              <p className="timeline-reason">{entry.reason}</p>
              {entry.outcome ? <p className="timeline-outcome">结果：{entry.outcome}</p> : null}
              {entry.targetId ? (
                <span className="muted mono">
                  目标：
                  {world.buildings.find((building) => building.id === entry.targetId)?.name ??
                    world.residents.find((candidate) => candidate.id === entry.targetId)?.name ??
                    entry.targetId}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </PanelSection>
  );
}

function LifeEventsSection({ resident }: { resident: Resident }) {
  const events = resident.lifeEvents.slice(0, 12);
  return (
    <PanelSection title="人生事件" hint={`${resident.lifeEvents.length} 条`}>
      {events.length === 0 ? <EmptyHint>还没有被记录的人生事件。</EmptyHint> : null}
      <div className="life-list">
        {events.map((event) => (
          <div className="life-item" key={event.id}>
            <div className="life-head">
              <Tag tone="gold">{LIFE_EVENT_KIND_LABELS[event.kind] ?? event.kind}</Tag>
              <span className="life-title">{event.title}</span>
              <span className="mono muted">D{event.day}</span>
            </div>
            <p className="life-desc">{event.description}</p>
          </div>
        ))}
      </div>
    </PanelSection>
  );
}

function SecretsSection({ world, resident }: { world: WorldState; resident: Resident }) {
  if (resident.secrets.length === 0 && resident.promises.length === 0) return null;
  return (
    <PanelSection title="秘密与承诺" hint="造物主可见">
      {resident.secrets.length > 0 ? (
        <div className="secret-list">
          {resident.secrets.map((secret) => (
            <div className="secret-item" key={secret.id}>
              <div className="secret-head">
                <Tag tone="magenta">秘密</Tag>
                <ImportanceDots value={secret.importance} />
                {secret.subjectId ? (
                  <span className="muted mono">
                    {world.buildings.find((building) => building.id === secret.subjectId)?.name ??
                      world.residents.find((candidate) => candidate.id === secret.subjectId)?.name ??
                      secret.subjectId}
                  </span>
                ) : null}
              </div>
              <p className="secret-text">{secret.text}</p>
              <span className="muted">知情者：{secret.knownBy.length} 人</span>
            </div>
          ))}
        </div>
      ) : null}
      {resident.promises.length > 0 ? (
        <div className="promise-list">
          {resident.promises.map((promise) => (
            <div className="promise-item" key={promise.id}>
              <Tag tone={promise.status === "kept" ? "good" : promise.status === "broken" ? "bad" : "warn"}>
                {promise.status === "kept" ? "已兑现" : promise.status === "broken" ? "已违背" : "待兑现"}
              </Tag>
              <span>{promise.text}</span>
              <span className="muted mono">
                与 {residentName(world.residents, promise.withId)} · 截止 D{promise.dueDay}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </PanelSection>
  );
}
