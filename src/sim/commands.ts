import {
  ACTION_META,
  AI_ACTION_SET,
  BUILDING_TYPE_META,
  EVENT_INJECTIONS,
  MAP_DEPTH,
  MAP_WIDTH,
  RULES_BOUNDS,
  type EventInjectionId,
} from "../shared/constants";
import type {
  ActionId,
  Building,
  BuildingInventory,
  BuildingType,
  CreateResidentInput,
  GameEvent,
  Goal,
  Memory,
  Needs,
  PlaceBuildingInput,
  Resident,
  WeatherCondition,
  WorldRules,
  WorldState,
} from "../shared/types";
import { getBuildingDoor, isWalkableTile, clampToWalkable, insideMap } from "./city";
import {
  addEvent,
  addGoal,
  clamp,
  recordMemory,
} from "./events";
import { refreshDerivedMetrics } from "./metrics";
import { Rng, hashString } from "./rng";
import { adjustRelationship, ensureRelationship } from "./social";

export type WorldCommand =
  | {
      type: "edit_resident";
      residentId: string;
      patch: {
        name?: string;
        age?: number;
        jobTitle?: string;
        wealth?: number;
        health?: number;
        mood?: number;
        stress?: number;
        reputation?: number;
        factionId?: string;
        homeBuildingId?: string;
        workBuildingId?: string;
        paused?: boolean;
        needs?: Partial<Needs>;
        personalityLabels?: string[];
      };
    }
  | { type: "pause_resident"; residentId: string; paused: boolean }
  | { type: "teleport_resident"; residentId: string; x: number; z: number }
  | {
      type: "add_memory";
      residentId: string;
      text: string;
      importance: number;
      subjectIds?: string[];
    }
  | { type: "delete_memory"; residentId: string; memoryId: string }
  | {
      type: "set_goal";
      residentId: string;
      title: string;
      description: string;
      kind: Goal["kind"];
      priority: number;
    }
  | { type: "delete_goal"; residentId: string; goalId: string }
  | {
      type: "edit_relationship";
      residentId: string;
      targetId: string;
      patch: {
        affinity?: number;
        trust?: number;
        attraction?: number;
        hostility?: number;
        familiarity?: number;
        intimacy?: number;
        type?: string;
      };
    }
  | { type: "create_resident"; spec: CreateResidentInput }
  | { type: "delete_resident"; residentId: string }
  | {
      type: "edit_building";
      buildingId: string;
      patch: {
        name?: string;
        description?: string;
        capacity?: number;
        condition?: number;
        open?: boolean;
        operational?: boolean;
        ownerFactionId?: string | null;
        neonColor?: string;
        emissions?: number;
      };
    }
  | {
      type: "adjust_building_inventory";
      buildingId: string;
      key: keyof BuildingInventory;
      delta: number;
    }
  | { type: "repair_building"; buildingId: string }
  | { type: "place_building"; spec: PlaceBuildingInput }
  | { type: "move_building"; buildingId: string; x: number; z: number }
  | { type: "rotate_building"; buildingId: string }
  | { type: "demolish_building"; buildingId: string }
  | { type: "inject_event"; eventId: EventInjectionId }
  | { type: "update_rules"; patch: Partial<WorldRules> }
  | { type: "set_weather"; condition: WeatherCondition; intensity?: number }
  | { type: "set_reserves"; key: "credits" | "food" | "energy" | "meds"; value: number };

export interface CommandResult {
  ok: boolean;
  message: string;
  event?: GameEvent;
}

const RESIDENT_NAME_POOL = [
  "洛",
  "眠",
  "雾",
  "岚",
  "岚",
  "栖",
  "渡",
  "焰",
  "铃",
  "罔",
  "昼",
  "辰",
  "雪",
  "弦",
  "遥",
  "原",
  "灰",
  "棠",
];
const NAME_GIVEN = ["小", "阿", "洛", "南", "临", "青", "星", "遥", "知", "未", "白", "景", "拾", "无"];
const NAME_FAMILY = ["秦", "沈", "陆", "江", "唐", "顾", "白", "林", "宋", "叶", "楚", "商"];

export function executeCommand(world: WorldState, command: WorldCommand): CommandResult {
  switch (command.type) {
    case "edit_resident":
      return editResident(world, command.residentId, command.patch);
    case "pause_resident":
      return pauseResident(world, command.residentId, command.paused);
    case "teleport_resident":
      return teleportResident(world, command.residentId, command.x, command.z);
    case "add_memory":
      return addMemoryCommand(world, command);
    case "delete_memory":
      return deleteMemoryCommand(world, command.residentId, command.memoryId);
    case "set_goal":
      return setGoalCommand(world, command);
    case "delete_goal":
      return deleteGoalCommand(world, command.residentId, command.goalId);
    case "edit_relationship":
      return editRelationshipCommand(world, command);
    case "create_resident":
      return createResident(world, command.spec);
    case "delete_resident":
      return deleteResident(world, command.residentId);
    case "edit_building":
      return editBuilding(world, command.buildingId, command.patch);
    case "adjust_building_inventory":
      return adjustInventory(world, command.buildingId, command.key, command.delta);
    case "repair_building":
      return repairBuilding(world, command.buildingId);
    case "place_building":
      return placeBuilding(world, command.spec);
    case "move_building":
      return moveBuilding(world, command.buildingId, command.x, command.z);
    case "rotate_building":
      return rotateBuilding(world, command.buildingId);
    case "demolish_building":
      return demolishBuilding(world, command.buildingId);
    case "inject_event":
      return injectEvent(world, command.eventId);
    case "update_rules":
      return updateRules(world, command.patch);
    case "set_weather":
      return setWeather(world, command.condition, command.intensity);
    case "set_reserves":
      return setReserves(world, command.key, command.value);
    default:
      return { ok: false, message: "未知的造物主操作。" };
  }
}

function findResident(world: WorldState, id: string): Resident | undefined {
  return world.residents.find((resident) => resident.id === id);
}

function findBuilding(world: WorldState, id: string): Building | undefined {
  return world.buildings.find((building) => building.id === id);
}

/** Invalidate any in-flight movement/action aimed at a building that changed. */
function clearActionsReferencingBuilding(world: WorldState, buildingId: string): number {
  let affected = 0;
  for (const resident of world.residents) {
    const action = resident.currentAction;
    if (
      action &&
      (action.targetBuildingId === buildingId || action.targetId === buildingId)
    ) {
      resident.currentAction = null;
      affected++;
    }
    if (resident.aiHint?.targetId === buildingId) resident.aiHint = null;
  }
  return affected;
}

/** Invalidate any in-flight movement/action aimed at a resident who is gone. */
function clearActionsTargetingResident(world: WorldState, residentId: string): number {
  let affected = 0;
  for (const resident of world.residents) {
    if (resident.id === residentId) continue;
    const action = resident.currentAction;
    if (
      action &&
      (action.targetResidentId === residentId || action.targetId === residentId)
    ) {
      resident.currentAction = null;
      affected++;
    }
    if (resident.aiHint?.targetId === residentId) resident.aiHint = null;
  }
  return affected;
}

function creatorEvent(world: WorldState, title: string, description: string, actorId?: string): GameEvent {
  return addEvent(world, {
    type: "player",
    title,
    description,
    actorId,
    source: "player",
    importance: 4,
    tag: "CREATOR",
  });
}

function editResident(
  world: WorldState,
  residentId: string,
  patch: NonNullable<Extract<WorldCommand, { type: "edit_resident" }>["patch"]>,
): CommandResult {
  const resident = findResident(world, residentId);
  if (!resident) return { ok: false, message: "居民不存在。" };
  const changes: string[] = [];

  // Validate every reference first. A rejected edit must never leave a partial
  // mutation behind: the UI and save layer treat {ok:false} as "nothing changed".
  const normalizedName =
    patch.name !== undefined ? patch.name.trim().slice(0, 20) : undefined;
  if (patch.name !== undefined && !normalizedName) {
    return { ok: false, message: "姓名不能为空。" };
  }
  const faction =
    patch.factionId !== undefined
      ? world.factions.find((candidate) => candidate.id === patch.factionId)
      : undefined;
  if (patch.factionId !== undefined && !faction) {
    return { ok: false, message: "目标势力不存在。" };
  }
  const home =
    patch.homeBuildingId !== undefined
      ? findBuilding(world, patch.homeBuildingId)
      : undefined;
  if (patch.homeBuildingId !== undefined && !home) {
    return { ok: false, message: "住宅建筑不存在。" };
  }
  if (home && home.type !== "residential") {
    return { ok: false, message: "该建筑不是住宅。" };
  }
  const work =
    patch.workBuildingId !== undefined
      ? findBuilding(world, patch.workBuildingId)
      : undefined;
  if (patch.workBuildingId !== undefined && !work) {
    return { ok: false, message: "工作建筑不存在。" };
  }

  if (normalizedName !== undefined) {
    resident.name = normalizedName;
    changes.push(`姓名改为${normalizedName}`);
  }
  if (patch.age !== undefined) {
    resident.age = clamp(patch.age, 0, 120);
    changes.push(`年龄改为${Math.round(resident.age)}`);
  }
  if (patch.jobTitle !== undefined) {
    resident.jobTitle = patch.jobTitle.trim().slice(0, 30) || resident.jobTitle;
    changes.push(`职业改为${resident.jobTitle}`);
  }
  for (const key of ["wealth", "health", "mood", "stress", "reputation"] as const) {
    if (patch[key] !== undefined) {
      const max = key === "wealth" ? 1_000_000 : 100;
      resident[key] = clamp(Number(patch[key]) || 0, 0, max);
      changes.push(`${key === "wealth" ? "财富" : key === "health" ? "健康" : key === "mood" ? "情绪" : key === "stress" ? "压力" : "声望"}调整`);
    }
  }
  if (patch.needs) {
    for (const key of ["hunger", "energy", "social", "safety"] as const) {
      const value = patch.needs[key];
      if (value !== undefined) resident.needs[key] = clamp(value, 0, 100);
    }
    changes.push("需求值调整");
  }
  if (patch.personalityLabels) {
    resident.personality.labels = patch.personalityLabels
      .map((label) => String(label).trim().slice(0, 12))
      .filter(Boolean)
      .slice(0, 6);
    changes.push("性格标签调整");
  }
  if (faction) {
    const oldFaction = world.factions.find((candidate) => candidate.id === resident.factionId);
    if (oldFaction) oldFaction.memberIds = oldFaction.memberIds.filter((id) => id !== resident.id);
    resident.factionId = faction.id;
    if (!faction.memberIds.includes(resident.id)) faction.memberIds.push(resident.id);
    changes.push(`归属改为${faction.name}`);
  }
  if (home) {
    resident.homeBuildingId = home.id;
    changes.push(`住所改为${home.name}`);
  }
  if (work) {
    resident.workBuildingId = work.id;
    changes.push(`工作地改为${work.name}`);
  }
  if (patch.paused !== undefined) {
    resident.paused = Boolean(patch.paused);
    if (resident.paused) resident.currentAction = null;
    changes.push(resident.paused ? "暂停个人行动" : "恢复个人行动");
  }
  refreshDerivedMetrics(world);
  const event = creatorEvent(
    world,
    `造物主修改了${resident.name}`,
    changes.length ? changes.join("；") + "。" : "参数已更新。",
    resident.id,
  );
  return { ok: true, message: `${resident.name}的参数已同步到模拟。`, event };
}

function pauseResident(world: WorldState, residentId: string, paused: boolean): CommandResult {
  return editResident(world, residentId, { paused });
}

function teleportResident(world: WorldState, residentId: string, x: number, z: number): CommandResult {
  const resident = findResident(world, residentId);
  if (!resident) return { ok: false, message: "居民不存在。" };
  const wx = Math.round(Number(x));
  const wz = Math.round(Number(z));
  if (!insideMap(wx, wz)) return { ok: false, message: "传送目标超出城市边界。" };
  const target = isWalkableTile(world.buildings, wx, wz) ? { x: wx, z: wz } : clampToWalkable(world.buildings, wx, wz);
  resident.position = { ...target };
  resident.insideBuildingId = null;
  resident.currentAction = null;
  resident.aiHint = null;
  const event = creatorEvent(
    world,
    `造物主传送了${resident.name}`,
    `位置移动到 (${target.x}, ${target.z})。`,
    resident.id,
  );
  return { ok: true, message: `${resident.name}已被传送到新的位置。`, event };
}

function addMemoryCommand(
  world: WorldState,
  command: Extract<WorldCommand, { type: "add_memory" }>,
): CommandResult {
  const resident = findResident(world, command.residentId);
  if (!resident) return { ok: false, message: "居民不存在。" };
  const text = command.text.trim().slice(0, 220);
  if (text.length < 2) return { ok: false, message: "记忆内容太短。" };
  const memory = recordMemory(world, resident, {
    text,
    kind: "player",
    importance: clamp(Math.round(command.importance), 1, 10),
    subjectIds: (command.subjectIds ?? []).slice(0, 6),
    source: "player",
    reliability: 1,
    valence: 0,
  });
  const event = creatorEvent(world, `造物主写下了一段记忆`, `${resident.name}：${memory.text}`, resident.id);
  return { ok: true, message: `记忆已写入${resident.name}的认知。`, event };
}

function deleteMemoryCommand(world: WorldState, residentId: string, memoryId: string): CommandResult {
  const resident = findResident(world, residentId);
  if (!resident) return { ok: false, message: "居民不存在。" };
  const before = resident.memories.recent.length + resident.memories.important.length;
  resident.memories.recent = resident.memories.recent.filter((memory) => memory.id !== memoryId);
  resident.memories.important = resident.memories.important.filter(
    (memory) => memory.id !== memoryId,
  );
  const after = resident.memories.recent.length + resident.memories.important.length;
  if (before === after) return { ok: false, message: "没有找到这条记忆。" };
  const event = creatorEvent(world, "造物主删除了一段记忆", `一段记忆从${resident.name}的脑海中消失。`, resident.id);
  return { ok: true, message: "记忆已删除。", event };
}

function setGoalCommand(
  world: WorldState,
  command: Extract<WorldCommand, { type: "set_goal" }>,
): CommandResult {
  const resident = findResident(world, command.residentId);
  if (!resident) return { ok: false, message: "居民不存在。" };
  const title = command.title.trim().slice(0, 60);
  if (title.length < 2) return { ok: false, message: "目标标题太短。" };
  const goal = addGoal(resident, world, {
    kind: command.kind === "long" ? "long" : "short",
    title,
    description: command.description.trim().slice(0, 180) || "由造物主直接设定的目标。",
    priority: clamp(Math.round(command.priority), 1, 10),
    source: "player",
  });
  const event = creatorEvent(world, "造物主设定了新目标", `${resident.name}：${goal.title}`, resident.id);
  return { ok: true, message: "目标已加入居民计划。", event };
}

function deleteGoalCommand(world: WorldState, residentId: string, goalId: string): CommandResult {
  const resident = findResident(world, residentId);
  if (!resident) return { ok: false, message: "居民不存在。" };
  const before = resident.goals.length;
  resident.goals = resident.goals.filter((goal) => goal.id !== goalId);
  if (resident.goals.length === before) return { ok: false, message: "没有找到这个目标。" };
  const event = creatorEvent(world, "造物主撤销了一个目标", `一个目标从${resident.name}的计划中移除。`, resident.id);
  return { ok: true, message: "目标已撤销。", event };
}

function editRelationshipCommand(
  world: WorldState,
  command: Extract<WorldCommand, { type: "edit_relationship" }>,
): CommandResult {
  const resident = findResident(world, command.residentId);
  const target = findResident(world, command.targetId);
  if (!resident || !target) return { ok: false, message: "关系双方必须都存在。" };
  if (resident.id === target.id) return { ok: false, message: "不能和自己建立关系。" };
  const relationship = ensureRelationship(world, resident, target.id);
  if (command.patch.affinity !== undefined) relationship.affinity = clamp(command.patch.affinity, -100, 100);
  if (command.patch.trust !== undefined) relationship.trust = clamp(command.patch.trust, -100, 100);
  if (command.patch.attraction !== undefined) relationship.attraction = clamp(command.patch.attraction, -100, 100);
  if (command.patch.hostility !== undefined) relationship.hostility = clamp(command.patch.hostility, 0, 100);
  if (command.patch.familiarity !== undefined) relationship.familiarity = clamp(command.patch.familiarity, 0, 100);
  if (command.patch.intimacy !== undefined) relationship.intimacy = clamp(command.patch.intimacy, 0, 100);
  if (command.patch.type) {
    const valid = [
      "stranger",
      "acquaintance",
      "friend",
      "close_friend",
      "partner",
      "ex_partner",
      "rival",
      "enemy",
      "family",
    ];
    if (!valid.includes(command.patch.type)) return { ok: false, message: "未知的关系类型。" };
    relationship.type = command.patch.type as typeof relationship.type;
  }
  adjustRelationship(world, resident, target.id, { note: "造物主调整了两人的关系认知" });
  const event = creatorEvent(
    world,
    "造物主修改了关系",
    `${resident.name} 对 ${target.name} 的认知被改写。`,
    resident.id,
  );
  return { ok: true, message: "关系认知已更新。", event };
}

function createResident(world: WorldState, spec: CreateResidentInput): CommandResult {
  const name = spec.name.trim().slice(0, 20);
  if (name.length < 1) return { ok: false, message: "居民需要姓名。" };
  const home = findBuilding(world, spec.homeBuildingId);
  const work = findBuilding(world, spec.workBuildingId);
  const faction = world.factions.find((candidate) => candidate.id === spec.factionId);
  if (!home || home.type !== "residential") return { ok: false, message: "必须选择一个住宅作为住所。" };
  if (!work) return { ok: false, message: "工作建筑不存在。" };
  if (!faction) return { ok: false, message: "势力不存在。" };
  const hash = hashString(`${world.worldId}-${world.residents.length}-${name}-${world.clock.tick}`);
  const colorPool = ["#5af2d0", "#ff4fa3", "#a48aff", "#ffcf6a", "#59b8ff", "#8fffc8", "#d36bff"];
  const idBase = `r_c_${(hash % 0xffffff).toString(16)}`;
  let id = idBase;
  let suffix = 1;
  while (world.residents.some((resident) => resident.id === id)) {
    id = `${idBase}_${suffix++}`;
  }
  const age = clamp(Math.round(Number(spec.age) || 26), 16, 90);
  const door = getBuildingDoor(home);
  const traits = [55, 55, 55, 55, 50].map((base, index) =>
    clamp(base + ((hash >> (index * 4)) % 31) - 15, 5, 95),
  );
  const jobTitle = (spec.jobTitle || "自由职业者").trim().slice(0, 30);
  const goals: Goal[] = [
    {
      id: `${id}-goal-1`,
      kind: "long",
      title: spec.longTermGoal?.trim().slice(0, 60) || "在第七码头站稳脚跟",
      description: "由造物主投放的新居民，需要在这个城市找到自己的位置。",
      priority: 7,
      progress: 0,
      status: "active",
      createdDay: world.clock.day,
      source: "player",
    },
  ];
  const resident: Resident = {
    id,
    name,
    age,
    pronouns: spec.pronouns ?? "TA",
    jobTitle,
    factionId: faction.id,
    homeBuildingId: home.id,
    workBuildingId: work.id,
    workSkill: spec.workSkill?.trim().slice(0, 20) || "适应",
    personality: {
      traits: {
        openness: traits[0]!,
        conscientiousness: traits[1]!,
        extraversion: traits[2]!,
        agreeableness: traits[3]!,
        neuroticism: traits[4]!,
      },
      labels: (spec.personalityLabels?.length
        ? spec.personalityLabels
        : ["新来者", "谨慎", "观察中"]
      )
        .map((label) => String(label).trim().slice(0, 12))
        .filter(Boolean)
        .slice(0, 6),
      values: ["生存", "归属", "找到自己的位置"],
    },
    backstory: "造物主将一个全新的意识放进了第七码头。TA还没有任何记忆，但城市已经开始了。",
    skills: {
      [spec.workSkill?.trim() || "适应"]: 30 + (hash % 25),
      体力: 35 + (hash % 30),
      社交: 25 + ((hash >> 3) % 35),
    },
    wealth: clamp(Math.round(Number(spec.wealth) || 30), 0, 10_000),
    health: 82,
    mood: 62,
    stress: 22,
    needs: { hunger: 35, energy: 72, social: 45, safety: 58 },
    reputation: 20,
    position: { ...door },
    facing: Math.PI,
    insideBuildingId: null,
    currentAction: null,
    aiHint: null,
    relationships: {},
    memories: {
      recent: [],
      important: [],
      longTerm: ["造物主将TA带到了第七码头。"],
    },
    impressions: {},
    goals,
    secrets: [],
    promises: [],
    history: [],
    lifeEvents: [],
    routine: { wakeMinute: 420, sleepMinute: 1380, workStartMinute: 540, workEndMinute: 1020 },
    appearance: {
      bodyColor: colorPool[hash % colorPool.length]!,
      accentColor: colorPool[(hash >> 3) % colorPool.length]!,
      skinColor: ["#d8b090", "#c49a7d", "#e9c5a3", "#b78f76", "#e0b696"][(hash >> 5) % 5]!,
      hairColor: ["#1a2733", "#4b2b23", "#5a3254", "#2b2320", "#3c3c45"][(hash >> 7) % 5]!,
      heightScale: 0.88 + ((hash >> 9) % 22) / 100,
      seed: hash,
    },
    alive: true,
    paused: false,
    lastDecisionTick: -999,
    createdAtTick: world.clock.tick,
  };
  recordMemory(world, resident, {
    text: "睁开眼时，霓虹灯在雨里晕成一片。有人告诉自己，这里叫第七码头。",
    kind: "life",
    importance: 9,
    source: "experienced",
    valence: 0.2,
  });
  world.residents.push(resident);
  faction.memberIds.push(resident.id);
  refreshDerivedMetrics(world);
  const event = creatorEvent(
    world,
    `造物主创造了一位新居民：${name}`,
    `${name}，${age} 岁，${jobTitle}。被安置在${home.name}，隶属于${faction.name}。`,
    resident.id,
  );
  return { ok: true, message: `${name}已进入第七码头，居民列表已更新。`, event };
}

function deleteResident(world: WorldState, residentId: string): CommandResult {
  const resident = findResident(world, residentId);
  if (!resident) return { ok: false, message: "居民不存在。" };
  const name = resident.name;
  const disruptedActions = clearActionsTargetingResident(world, residentId);
  world.residents = world.residents.filter((candidate) => candidate.id !== residentId);
  for (const other of world.residents) {
    delete other.relationships[residentId];
    delete other.impressions[residentId];
    other.promises = other.promises.filter((promise) => promise.withId !== residentId);
  }
  for (const faction of world.factions) {
    faction.memberIds = faction.memberIds.filter((id) => id !== residentId);
    if (faction.leaderId === residentId) {
      faction.leaderId = faction.memberIds[0] ?? "";
    }
  }
  for (const building of world.buildings) {
    building.recentVisits = building.recentVisits.filter((visit) => visit.residentId !== residentId);
  }
  refreshDerivedMetrics(world);
  const event = creatorEvent(
    world,
    `造物主删除了居民${name}`,
    `这个人从世界中被抹除，所有相关的关系记录也已清理。${disruptedActions > 0 ? ` ${disruptedActions} 个正在寻找TA的行动被中止。` : ""}该操作不可撤销。`,
  );
  return { ok: true, message: `${name}已从世界中移除。`, event };
}

function editBuilding(
  world: WorldState,
  buildingId: string,
  patch: NonNullable<Extract<WorldCommand, { type: "edit_building" }>["patch"]>,
): CommandResult {
  const building = findBuilding(world, buildingId);
  if (!building) return { ok: false, message: "建筑不存在。" };
  const changes: string[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 30);
    if (!name) return { ok: false, message: "建筑名称不能为空。" };
    building.name = name;
    changes.push("名称");
  }
  if (patch.description !== undefined) building.description = patch.description.slice(0, 240);
  if (patch.capacity !== undefined) {
    building.capacity = clamp(Math.round(patch.capacity), 1, 200);
    changes.push("容量");
  }
  if (patch.condition !== undefined) {
    building.condition = clamp(patch.condition, 0, 100);
    if (building.condition > 0 && patch.operational === undefined) building.operational = true;
    changes.push("状况");
  }
  if (patch.open !== undefined) {
    building.open = Boolean(patch.open);
    changes.push(building.open ? "开放" : "关闭");
  }
  if (patch.operational !== undefined) {
    building.operational = Boolean(patch.operational);
    changes.push(building.operational ? "恢复运行" : "停止运行");
  }
  if (patch.ownerFactionId !== undefined) {
    if (patch.ownerFactionId !== null && !world.factions.some((faction) => faction.id === patch.ownerFactionId)) {
      return { ok: false, message: "所有者势力不存在。" };
    }
    building.ownerFactionId = patch.ownerFactionId;
    changes.push("所有权");
  }
  if (patch.neonColor !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(patch.neonColor)) return { ok: false, message: "霓虹颜色格式无效。" };
    building.neonColor = patch.neonColor;
    changes.push("霓虹色");
  }
  if (patch.emissions !== undefined) {
    building.emissions = clamp(patch.emissions, 0, 20);
    changes.push("排放量");
  }
  if (changes.length === 0) return { ok: false, message: "没有可应用的建筑参数。" };
  const event = creatorEvent(world, `造物主修改了${building.name}`, changes.join("、") + "已更新。");
  return { ok: true, message: `${building.name}已更新。`, event };
}

function adjustInventory(
  world: WorldState,
  buildingId: string,
  key: keyof BuildingInventory,
  delta: number,
): CommandResult {
  const building = findBuilding(world, buildingId);
  if (!building) return { ok: false, message: "建筑不存在。" };
  if (!(key in building.inventory)) return { ok: false, message: "未知库存类型。" };
  const safeDelta = clamp(Math.round(Number(delta) || 0), -100_000, 100_000);
  building.inventory[key] = Math.max(0, Math.round(building.inventory[key] + safeDelta));
  const labels: Record<keyof BuildingInventory, string> = {
    food: "食物",
    meds: "医疗物资",
    energy: "能源",
    credits: "资金",
  };
  const event = creatorEvent(
    world,
    `造物主调整了${building.name}的库存`,
    `${labels[key]} ${safeDelta >= 0 ? "+" : ""}${safeDelta}，当前 ${building.inventory[key]}。`,
  );
  return { ok: true, message: `${building.name}的${labels[key]}已调整。`, event };
}

function repairBuilding(world: WorldState, buildingId: string): CommandResult {
  const building = findBuilding(world, buildingId);
  if (!building) return { ok: false, message: "建筑不存在。" };
  const before = building.condition;
  building.condition = 100;
  building.operational = true;
  building.lastServicedDay = world.clock.day;
  const event = creatorEvent(
    world,
    `造物主修复了${building.name}`,
    `建筑状况从 ${Math.round(before)} 恢复到 100，已恢复运行。`,
  );
  return { ok: true, message: `${building.name}已完全修复。`, event };
}

export function canPlaceAt(
  world: WorldState,
  x: number,
  z: number,
  w: number,
  d: number,
  ignoreBuildingId?: string,
): { ok: boolean; reason?: string } {
  if (x < 0 || z < 0 || x + w > MAP_WIDTH || z + d > MAP_DEPTH) {
    return { ok: false, reason: "建筑超出城市边界。" };
  }
  for (let tx = x; tx < x + w; tx++) {
    for (let tz = z; tz < z + d; tz++) {
      if (isRoadOrReserved(tx, tz)) return { ok: false, reason: "建筑不能覆盖道路。" };
      for (const building of world.buildings) {
        if (building.id === ignoreBuildingId) continue;
        if (
          tx >= building.x &&
          tx < building.x + building.w &&
          tz >= building.z &&
          tz < building.z + building.d
        ) {
          return { ok: false, reason: `与${building.name}的占地冲突。` };
        }
      }
    }
  }
  return { ok: true };
}

function isRoadOrReserved(x: number, z: number): boolean {
  const roadColumns = [7, 8, 19, 20];
  const roadRows = [6, 7, 14, 15, 22, 23];
  return roadColumns.includes(x) || roadRows.includes(z);
}

function placeBuilding(world: WorldState, spec: PlaceBuildingInput): CommandResult {
  const type = spec.type;
  if (!BUILDING_TYPE_META[type]) return { ok: false, message: "未知建筑类型。" };
  const name = (spec.name || BUILDING_TYPE_META[type].label).trim().slice(0, 30);
  const w = clamp(Math.round(Number(spec.w) || 3), 2, 10);
  const d = clamp(Math.round(Number(spec.d) || 3), 2, 10);
  const x = Math.round(Number(spec.x));
  const z = Math.round(Number(spec.z));
  const placement = canPlaceAt(world, x, z, w, d);
  if (!placement.ok) return { ok: false, message: placement.reason ?? "无法放置建筑。" };
  const owner = world.factions.find((faction) => faction.id === spec.ownerFactionId) ?? world.factions[0];
  if (!owner) return { ok: false, message: "没有可用的势力所有者。" };
  const color = spec.neonColor && /^#[0-9a-fA-F]{6}$/.test(spec.neonColor) ? spec.neonColor : BUILDING_TYPE_META[type].color;
  const idBase = `b_custom_${(hashString(`${name}-${x}-${z}-${world.buildings.length}`) % 0xffffff).toString(16)}`;
  let id = idBase;
  let n = 1;
  while (world.buildings.some((building) => building.id === id)) id = `${idBase}_${n++}`;
  const inventory: BuildingInventory = {
    food: ["shop", "residential", "public"].includes(type) ? 30 : 0,
    meds: type === "medical" ? 24 : 0,
    energy: type === "utility" ? 120 : 8,
    credits: ["workplace", "shop", "medical"].includes(type) ? 600 : 0,
  };
  const building: Building = {
    id,
    name,
    type,
    description: `由造物主放置的${BUILDING_TYPE_META[type].label}。`,
    x,
    z,
    w,
    d,
    rotation: 0,
    capacity: clamp(Math.round(Number(spec.capacity) || (type === "residential" ? 14 : 20)), 1, 200),
    ownerFactionId: owner.id,
    ownerResidentId: null,
    condition: 85,
    operational: true,
    open: true,
    inventory,
    recentVisits: [],
    neonColor: color,
    openAir: type === "public",
    emissions: type === "workplace" || type === "utility" ? 1.4 : 0.2,
    lastServicedDay: world.clock.day,
    income: 0,
    expenses: 0,
  };
  world.buildings.push(building);
  const event = creatorEvent(
    world,
    `造物主建造了${name}`,
    `${BUILDING_TYPE_META[type].label}，占地 ${w}×${d}，属于${owner.name}。`,
  );
  refreshDerivedMetrics(world);
  return { ok: true, message: `${name}已放置并接入模拟。`, event };
}

function moveBuilding(world: WorldState, buildingId: string, x: number, z: number): CommandResult {
  const building = findBuilding(world, buildingId);
  if (!building) return { ok: false, message: "建筑不存在。" };
  const nx = Math.round(Number(x));
  const nz = Math.round(Number(z));
  const placement = canPlaceAt(world, nx, nz, building.w, building.d, building.id);
  if (!placement.ok) return { ok: false, message: placement.reason ?? "无法移动建筑。" };
  const old = { x: building.x, z: building.z };
  building.x = nx;
  building.z = nz;
  for (const resident of world.residents) {
    if (!resident.alive || resident.insideBuildingId !== building.id) continue;
    resident.position = { ...getBuildingDoor(building) };
    resident.insideBuildingId = null;
    resident.currentAction = null;
  }
  const disrupted = clearActionsReferencingBuilding(world, building.id);
  const event = creatorEvent(
    world,
    `造物主移动了${building.name}`,
    `位置从 (${old.x}, ${old.z}) 移动到 (${nx}, ${nz})。${disrupted > 0 ? ` ${disrupted} 个前往该建筑的行动被中止。` : ""}`,
  );
  return { ok: true, message: `${building.name}已移动。`, event };
}

function rotateBuilding(world: WorldState, buildingId: string): CommandResult {
  const building = findBuilding(world, buildingId);
  if (!building) return { ok: false, message: "建筑不存在。" };
  const nextW = building.d;
  const nextD = building.w;
  const placement = canPlaceAt(world, building.x, building.z, nextW, nextD, building.id);
  if (!placement.ok) return { ok: false, message: `无法旋转：${placement.reason ?? "占地冲突"}` };
  building.w = nextW;
  building.d = nextD;
  building.rotation = ((building.rotation + 90) % 360) as Building["rotation"];
  for (const resident of world.residents) {
    if (resident.alive && resident.insideBuildingId === building.id) {
      resident.position = { ...getBuildingDoor(building) };
      resident.insideBuildingId = null;
      resident.currentAction = null;
    }
  }
  const disrupted = clearActionsReferencingBuilding(world, building.id);
  const event = creatorEvent(
    world,
    `造物主旋转了${building.name}`,
    `旋转到 ${building.rotation}°。${disrupted > 0 ? ` ${disrupted} 个前往该建筑的行动被中止。` : ""}`,
  );
  return { ok: true, message: `${building.name}已旋转。`, event };
}

function demolishBuilding(world: WorldState, buildingId: string): CommandResult {
  const building = findBuilding(world, buildingId);
  if (!building) return { ok: false, message: "建筑不存在。" };
  const residentsInside = world.residents.filter(
    (resident) => resident.alive && resident.insideBuildingId === building.id,
  );
  const homes = world.residents.filter(
    (resident) => resident.alive && resident.homeBuildingId === building.id,
  );
  const works = world.residents.filter(
    (resident) => resident.alive && resident.workBuildingId === building.id,
  );
  const fallbackHome = world.buildings.find(
    (candidate) => candidate.id !== building.id && candidate.type === "residential",
  );
  const fallbackWork = world.buildings.find(
    (candidate) => candidate.id !== building.id && candidate.operational,
  );
  for (const resident of residentsInside) {
    resident.position = { ...getBuildingDoor(building) };
    resident.insideBuildingId = null;
    resident.currentAction = null;
  }
  // Also detach residents who are still en route to the building.
  const detached = clearActionsReferencingBuilding(world, buildingId);
  for (const resident of homes) {
    if (fallbackHome) resident.homeBuildingId = fallbackHome.id;
  }
  for (const resident of works) {
    if (fallbackWork) resident.workBuildingId = fallbackWork.id;
  }
  world.buildings = world.buildings.filter((candidate) => candidate.id !== buildingId);
  refreshDerivedMetrics(world);
  const event = creatorEvent(
    world,
    `造物主拆除了${building.name}`,
    `${residentsInside.length} 人被疏散，${homes.length} 名居民失去住所，${works.length} 人失去工作地点${detached > 0 ? `，${detached} 个前往该处的中途行动被中止` : ""}。`,
  );
  return { ok: true, message: `${building.name}已被拆除。`, event };
}

function injectEvent(world: WorldState, eventId: EventInjectionId): CommandResult {
  const meta = EVENT_INJECTIONS.find((event) => event.id === eventId);
  if (!meta) return { ok: false, message: "未知事件类型。" };
  const rng = new Rng(world.rngState);
  const alive = world.residents.filter((resident) => resident.alive);
  let description: string = meta.description;
  const actorId: string | undefined = undefined;

  const memoryAll = (text: string, kind: Memory["kind"], importance: number, valence: number) => {
    for (const resident of alive) {
      recordMemory(world, resident, {
        text,
        kind,
        importance,
        valence,
        source: "experienced",
      });
    }
  };

  switch (eventId) {
    case "blackout": {
      world.reserves.energy = Math.max(0, world.reserves.energy - 45);
      for (const building of world.buildings) {
        if (building.type === "utility") building.condition = clamp(building.condition - 14, 0, 100);
      }
      for (const resident of alive) {
        resident.needs.safety = clamp(resident.needs.safety - 10, 0, 100);
        resident.stress = clamp(resident.stress + 7, 0, 100);
      }
      world.metrics.trust = clamp(world.metrics.trust - 3, 0, 100);
      description = "电网节点连锁失效，公共能源储备减少 45 单位，居民的安全感明显下降。";
      memoryAll("全城突然停电，黑暗里只剩下零星的应急灯。", "trauma", 5, -0.6);
      break;
    }
    case "pollution_spike": {
      world.metrics.pollution = clamp(world.metrics.pollution + 14, 0, 100);
      for (const resident of alive) resident.health = clamp(resident.health - 4, 0, 100);
      const corp = world.factions.find((faction) => faction.kind === "corporation");
      if (corp) corp.influence = clamp(corp.influence + 1.5, 0, 100);
      world.metrics.trust = clamp(world.metrics.trust - 2, 0, 100);
      description = "企业区的过滤系统失效，污染指数上升 14，所有居民的健康都受到影响。";
      break;
    }
    case "layoff": {
      const corpWorkplaces = world.buildings.filter(
        (building) => building.ownerFactionId === "corp",
      );
      const affected = alive.filter(
        (resident) =>
          resident.factionId === "corp" ||
          corpWorkplaces.some((building) => building.id === resident.workBuildingId),
      );
      for (const resident of affected) {
        const loss = Math.round(resident.wealth * 0.22);
        resident.wealth = Math.max(0, resident.wealth - loss);
        resident.stress = clamp(resident.stress + 16, 0, 100);
        resident.mood = clamp(resident.mood - 12, 0, 100);
        resident.needs.safety = clamp(resident.needs.safety - 10, 0, 100);
      }
      const corp = world.factions.find((faction) => faction.id === "corp");
      if (corp) {
        corp.funds += 600;
        corp.influence = clamp(corp.influence - 2, 0, 100);
      }
      world.metrics.trust = clamp(world.metrics.trust - 4, 0, 100);
      description = `新纪元科技宣布裁员，${affected.length} 名居民的收入受到冲击，企业账面现金反而增加。`;
      break;
    }
    case "food_shortage": {
      world.reserves.food = Math.max(0, world.reserves.food - 80);
      for (const resident of alive) {
        resident.needs.hunger = clamp(resident.needs.hunger + 17, 0, 100);
      }
      for (const building of world.buildings) {
        if (building.type === "shop" || building.type === "residential") {
          building.inventory.food = Math.floor(building.inventory.food * 0.4);
        }
      }
      world.metrics.trust = clamp(world.metrics.trust - 3, 0, 100);
      description = "供应链断裂，公共食物储备减少 80 单位，商店与家庭库存被恐慌性抢购。";
      break;
    }
    case "disease": {
      world.reserves.meds = Math.max(0, world.reserves.meds - 25);
      const infected = rng.shuffle(alive).slice(0, Math.max(2, Math.ceil(alive.length * 0.35)));
      for (const resident of infected) {
        resident.health = clamp(resident.health - 13, 0, 100);
        resident.stress = clamp(resident.stress + 9, 0, 100);
        resident.needs.energy = clamp(resident.needs.energy - 12, 0, 100);
        recordMemory(world, resident, {
          text: "一种来路不明的呼吸道疾病在街区扩散，身体像被抽空了一样。",
          kind: "trauma",
          importance: 6,
          valence: -0.7,
        });
      }
      description = `一种呼吸道疾病在街区扩散，${infected.length} 名居民染病，医疗储备减少 25。`;
      break;
    }
    case "reform": {
      world.rules.welfare = clamp(world.rules.welfare + 10, 0, 100);
      world.rules.taxRate = clamp(world.rules.taxRate + 0.02, 0, 0.5);
      world.rules.safetyBudget = clamp(world.rules.safetyBudget + 6, 0, 100);
      world.reserves.credits += 120;
      world.metrics.trust = clamp(world.metrics.trust + 4, 0, 100);
      description = "城市委员会通过福利改革：福利预算 +10，税率 +2%，治安预算 +6，公众信任回升。";
      break;
    }
    case "accident": {
      const candidates = world.buildings.filter((building) => building.operational && !building.openAir);
      if (candidates.length === 0) return { ok: false, message: "没有可发生事故的建筑。" };
      const building = rng.pick(candidates);
      building.condition = clamp(building.condition - 32, 0, 100);
      if (building.condition < 20) building.operational = false;
      for (const resident of alive) {
        if (resident.insideBuildingId === building.id) {
          resident.health = clamp(resident.health - 18, 0, 100);
          resident.stress = clamp(resident.stress + 20, 0, 100);
          recordMemory(world, resident, {
            text: `${building.name}发生严重事故，自己被碎片划伤。`,
            kind: "trauma",
            importance: 8,
            valence: -0.9,
          });
        }
      }
      world.reserves.energy = Math.max(0, world.reserves.energy - 18);
      description = `${building.name}发生结构性事故，建筑状况骤降，能源储备损失 18 单位。`;
      break;
    }
    case "festival": {
      for (const resident of alive) {
        resident.mood = clamp(resident.mood + 9, 0, 100);
        resident.stress = clamp(resident.stress - 7, 0, 100);
        resident.needs.social = clamp(resident.needs.social + 13, 0, 100);
        resident.needs.safety = clamp(resident.needs.safety + 5, 0, 100);
        recordMemory(world, resident, {
          text: "街区的霓虹灯全部亮起，人们暂时放下了分歧，在雨里跳舞。",
          kind: "social",
          importance: 4,
          valence: 0.8,
        });
      }
      const park = world.buildings.find((building) => building.id === "b_park");
      if (park) park.condition = clamp(park.condition + 12, 0, 100);
      world.metrics.trust = clamp(world.metrics.trust + 5, 0, 100);
      description = "街区庆典持续了整晚，居民情绪、社交需求与公众信任同时上升。";
      break;
    }
    case "rumor": {
      world.metrics.trust = clamp(world.metrics.trust - 6, 0, 100);
      const shuffled = rng.shuffle(alive);
      for (let i = 0; i < Math.min(6, shuffled.length); i++) {
        const resident = shuffled[i]!;
        const other = shuffled[(i + 1) % shuffled.length]!;
        if (resident.id === other.id) continue;
        const relation = ensureRelationship(world, resident, other.id);
        relation.trust = clamp(relation.trust - 9, -100, 100);
        relation.hostility = clamp(relation.hostility + 4, 0, 100);
        recordMemory(world, resident, {
          text: `一条未经证实的消息说，${other.name}参与了对街区的背叛。`,
          kind: "told",
          importance: 5,
          subjectIds: [other.id],
          valence: -0.6,
          source: "told",
          reliability: 0.35,
        });
      }
      description = "一条未经证实的消息在街区迅速传播，六对关系产生了不必要的猜疑。";
      break;
    }
    case "funding": {
      world.reserves.credits += 1500;
      world.reserves.food += 60;
      world.reserves.meds += 30;
      world.metrics.trust = clamp(world.metrics.trust + 4, 0, 100);
      description = "匿名援助资金到账：公共信用点 +1500、食物 +60、医疗物资 +30。居民对匿名善意的来源议论纷纷。";
      break;
    }
  }

  world.rngState = rng.state;
  refreshDerivedMetrics(world);
  const event = addEvent(world, {
    type: meta.tone === "danger" ? "danger" : meta.tone === "warn" ? "warn" : "info",
    title: `造物主事件：${meta.label}`,
    description,
    actorId,
    source: "event",
    importance: 6,
    tag: "WORLD EVENT",
  });
  return { ok: true, message: `事件「${meta.label}」已生效。`, event };
}

function updateRules(world: WorldState, patch: Partial<WorldRules>): CommandResult {
  const changed: string[] = [];
  // Validate the whole patch into a temporary object before writing anything,
  // so a rejected mixed patch can never partially change the world.
  const nextRules: WorldRules = { ...world.rules };
  for (const [rawKey, rawValue] of Object.entries(patch)) {
    const key = rawKey as keyof WorldRules;
    if (!(key in RULES_BOUNDS)) return { ok: false, message: `未知规则字段：${rawKey}` };
    if (key === "factionsActive") {
      if (typeof rawValue !== "boolean") return { ok: false, message: "势力模拟开关必须是布尔值。" };
      nextRules.factionsActive = rawValue;
      changed.push(`势力模拟 ${rawValue ? "开启" : "关闭"}`);
      continue;
    }
    const bounds = RULES_BOUNDS[key];
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return { ok: false, message: `${bounds.label}必须是数字。` };
    if (value < bounds.min || value > bounds.max) {
      return {
        ok: false,
        message: `${bounds.label}必须在 ${bounds.min} 到 ${bounds.max} 之间。`,
      };
    }
    if (key === "aiAdvisorFrequencyTicks") {
      nextRules.aiAdvisorFrequencyTicks = Math.round(value);
    } else {
      (nextRules as unknown as Record<string, number | boolean>)[key] = value;
    }
    changed.push(`${bounds.label}=${value}`);
  }
  if (changed.length === 0) return { ok: false, message: "没有规则被修改。" };
  world.rules = nextRules;
  refreshDerivedMetrics(world);
  const event = creatorEvent(world, "造物主改写世界规则", changed.join("；") + "。");
  return { ok: true, message: "世界规则已校验并生效。", event };
}

function setWeather(
  world: WorldState,
  condition: WeatherCondition,
  intensity?: number,
): CommandResult {
  const allowed: WeatherCondition[] = ["clear", "rain", "acid_rain", "smog", "heatwave", "storm"];
  if (!allowed.includes(condition)) return { ok: false, message: "未知天气类型。" };
  world.weather = {
    condition,
    intensity: clamp(Number(intensity ?? 0.4), 0, 1),
    untilTick: world.clock.tick + 8,
  };
  const labels: Record<WeatherCondition, string> = {
    clear: "晴朗",
    rain: "降雨",
    acid_rain: "酸雨",
    smog: "雾霾",
    heatwave: "热浪",
    storm: "电磁风暴",
  };
  const event = creatorEvent(world, "造物主改变了天气", `天空转为${labels[condition]}。`);
  return { ok: true, message: `天气已设为${labels[condition]}。`, event };
}

function setReserves(
  world: WorldState,
  key: "credits" | "food" | "energy" | "meds",
  value: number,
): CommandResult {
  if (!(key in world.reserves)) return { ok: false, message: "未知资源类型。" };
  const next = clamp(Math.round(Number(value) || 0), 0, 10_000_000);
  world.reserves[key] = next;
  refreshDerivedMetrics(world);
  const labels = { credits: "信用点", food: "食物", energy: "能源", meds: "医疗物资" };
  const event = creatorEvent(world, "造物主调整了公共资源", `${labels[key]}设为 ${next}。`);
  return { ok: true, message: `公共${labels[key]}已更新。`, event };
}

/** UI helper: all action labels for the creator console. */
export const ACTION_LABELS = Object.fromEntries(
  Object.entries(ACTION_META).map(([key, meta]) => [key, meta.label]),
) as Record<ActionId, string>;

export const VALID_AI_ACTIONS = AI_ACTION_SET;

/** Utility for tests: validate placement without mutating. */
export function checkPlacement(
  world: WorldState,
  x: number,
  z: number,
  w: number,
  d: number,
): { ok: boolean; reason?: string } {
  return canPlaceAt(world, x, z, w, d);
}
