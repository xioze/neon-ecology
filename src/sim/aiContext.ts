import {
  ACTION_META,
  AI_ACTION_SET,
  BUILDING_TYPE_META,
  WEATHER_META,
} from "../shared/constants";
import type {
  AiDecisionRequest,
  AiDecisionTarget,
  AiProposal,
} from "../shared/ai";
import { ACTION_TARGET_KIND } from "../shared/ai";
import type { AiActionId, Building, Resident, WorldState } from "../shared/types";
import { queueAiHint, type AiHintInput } from "./engine";

export interface AiApplyResult {
  ok: boolean;
  message: string;
  event?: import("../shared/types").GameEvent;
}

export function buildAiDecisionRequest(
  world: WorldState,
  residentId: string,
  requestId?: string,
): AiDecisionRequest | null {
  const resident = world.residents.find(
    (candidate) => candidate.id === residentId && candidate.alive,
  );
  if (!resident) return null;
  const faction = world.factions.find((candidate) => candidate.id === resident.factionId);
  const others = world.residents.filter(
    (candidate) => candidate.alive && candidate.id !== resident.id,
  );
  const relevantBuildings = rankBuildingsForResident(world, resident);
  const allowedActions = new Set<AiActionId>([
    "work",
    "rest",
    "eat",
    "shop",
    "go_home",
    "wander",
    "talk",
    "befriend",
    "seek_help",
    "heal",
    "study",
  ]);
  if (others.length > 0) {
    allowedActions.add("talk");
    allowedActions.add("befriend");
    if (others.some((other) => resident.relationships[other.id]?.trust !== undefined)) {
      allowedActions.add("seek_help");
    }
    if (
      others.some((other) => {
        const view = resident.relationships[other.id];
        return view && (view.hostility > 4 || view.affinity < -4);
      })
    ) {
      allowedActions.add("argue");
      allowedActions.add("reconcile");
    }
    if (
      others.some((other) => {
        const view = resident.relationships[other.id];
        return view && view.trust > 20;
      })
    ) {
      allowedActions.add("cooperate");
    }
    if (
      others.some((other) => {
        const view = resident.relationships[other.id];
        const reverse = other.relationships[resident.id];
        return (
          (view?.attraction ?? 0) >= 10 ||
          (reverse?.attraction ?? 0) >= 8
        );
      })
    ) {
      allowedActions.add("date");
    }
    if (
      resident.personality.traits.agreeableness < 55 &&
      (resident.stress > 45 || resident.wealth < 40)
    ) {
      allowedActions.add("betray");
    }
  }
  if (resident.secrets.length > 0) allowedActions.add("conceal");

  const targets: AiDecisionTarget[] = [
    ...relevantBuildings.slice(0, 8).map((building) => ({
      id: building.id,
      kind: "building" as const,
      name: building.name,
      note: `${BUILDING_TYPE_META[building.type].label}，状况${Math.round(building.condition)}，容量${building.capacity}`,
    })),
    ...others.slice(0, 8).map((other) => {
      const view = resident.relationships[other.id];
      return {
        id: other.id,
        kind: "resident" as const,
        name: other.name,
        note: view
          ? `${relationshipLabel(view.type)}，信任${Math.round(view.trust)}，好感${Math.round(view.affinity)}`
          : "还不熟悉",
      };
    }),
  ];

  const currentPlace = resident.insideBuildingId
    ? world.buildings.find((building) => building.id === resident.insideBuildingId)?.name ?? "建筑内"
    : "街道上";
  const actionLine = resident.currentAction
    ? `${resident.currentAction.label}：${resident.currentAction.reason}`
    : "正在决定下一步";
  const goals = resident.goals
    .filter((goal) => goal.status === "active")
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5)
    .map((goal) => `${goal.kind === "long" ? "长期" : "短期"}：${goal.title}（${Math.round(goal.progress)}%）`);

  const memories = [
    ...resident.memories.important.slice(0, 4),
    ...resident.memories.recent.slice(0, 4),
  ]
    .slice(0, 5)
    .map((memory) => memory.text.slice(0, 150));

  const relationships = Object.values(resident.relationships)
    .sort(
      (a, b) =>
        b.familiarity + b.affinity - a.familiarity - a.affinity,
    )
    .slice(0, 8)
    .flatMap((relation) => {
      const other = world.residents.find((candidate) => candidate.id === relation.residentId);
      if (!other) return [];
      return [
        {
          name: other.name.slice(0, 20),
          type: relationshipLabel(relation.type),
          trust: Math.round(relation.trust),
          affinity: Math.round(relation.affinity),
          attraction: Math.round(relation.attraction),
          targetId: other.id,
        },
      ];
    });

  return {
    requestId: requestId ?? `${world.worldId}-${world.clock.tick}-${resident.id}`.slice(0, 60),
    residentId: resident.id,
    resident: {
      name: resident.name,
      age: Math.floor(resident.age),
      pronouns: resident.pronouns,
      jobTitle: resident.jobTitle,
      factionName: faction?.name ?? "无归属",
      personalityLabels: resident.personality.labels.slice(0, 8),
      values: resident.personality.values.slice(0, 6),
      backstory: resident.backstory.slice(0, 240),
      mood: Math.round(resident.mood),
      stress: Math.round(resident.stress),
      health: Math.round(resident.health),
      wealth: Math.max(0, Math.round(resident.wealth)),
      needs: {
        hunger: Math.round(resident.needs.hunger),
        energy: Math.round(resident.needs.energy),
        social: Math.round(resident.needs.social),
        safety: Math.round(resident.needs.safety),
      },
      goals,
      importantMemories: memories,
      relationships,
      currentPlace: currentPlace.slice(0, 60),
      currentAction: actionLine.slice(0, 80),
      recentDecisionReasons: resident.history
        .slice(0, 3)
        .map((entry) => entry.reason.slice(0, 120)),
    },
    world: {
      day: world.clock.day,
      time: `${String(Math.floor(world.clock.minuteOfDay / 60)).padStart(2, "0")}:${String(world.clock.minuteOfDay % 60).padStart(2, "0")}`,
      weather: WEATHER_META[world.weather.condition].label,
      metrics: {
        stability: Math.round(world.metrics.stability),
        pollution: Math.round(world.metrics.pollution),
        trust: Math.round(world.metrics.trust),
        inequality: Math.round(world.metrics.inequality),
        resourceSupply: Math.round(world.metrics.resourceSupply),
      },
      reserves: {
        food: Math.max(0, Math.round(world.reserves.food)),
        energy: Math.max(0, Math.round(world.reserves.energy)),
        meds: Math.max(0, Math.round(world.reserves.meds)),
      },
      recentEvents: world.events
        .slice(0, 6)
        .map((event) => event.title.slice(0, 150)),
    },
    allowedActions: [...allowedActions].filter((action) => AI_ACTION_SET.has(action)),
    targets: targets.filter((target) => target.id !== resident.id),
  };
}

export function applyAiProposal(
  world: WorldState,
  request: AiDecisionRequest,
  proposal: AiProposal,
  meta?: { model?: string; latencyMs?: number },
): AiApplyResult {
  const resident = world.residents.find(
    (candidate) => candidate.id === request.residentId && candidate.alive,
  );
  if (!resident) return { ok: false, message: "AI 提案的居民已经不存在。" };
  if (!request.allowedActions.includes(proposal.action)) {
    return { ok: false, message: "AI 提案的行动不在本地允许列表中。" };
  }
  const requiresTarget = [
    "talk",
    "befriend",
    "seek_help",
    "date",
    "argue",
    "reconcile",
    "cooperate",
    "conceal",
    "betray",
  ].includes(proposal.action);
  if (requiresTarget && !proposal.targetId) {
    return { ok: false, message: "AI 提案缺少该行动所需的互动目标。" };
  }
  if (proposal.targetId) {
    const target = request.targets.find((candidate) => candidate.id === proposal.targetId);
    if (!target) return { ok: false, message: "AI 提案目标不在请求的白名单里。" };
    if (!["resident", "building"].includes(target.kind)) {
      return { ok: false, message: "AI 提案目标类型非法。" };
    }
    const expectedKind = ACTION_TARGET_KIND[proposal.action];
    if (expectedKind && expectedKind !== target.kind) {
      return { ok: false, message: "AI 提案的行动类型与目标类型不匹配。" };
    }
  }
  const hint: AiHintInput = {
    action: proposal.action,
    targetId: proposal.targetId ?? undefined,
    targetKind: proposal.targetId
      ? request.targets.find((candidate) => candidate.id === proposal.targetId)?.kind
      : undefined,
    reason: proposal.reason,
  };
  const queued = queueAiHint(world, resident.id, hint);
  if (!queued.ok) return { ok: false, message: queued.message };
  // Attach non-authoritative metadata to the event for debugging/recap.
  if (queued.event) {
    queued.event.description += meta?.model
      ? `（模型 ${meta.model}，耗时 ${meta.latencyMs ?? 0}ms）`
      : "";
  }
  return { ok: true, message: queued.message, event: queued.event };
}

export function hasTargetForAction(
  request: AiDecisionRequest,
  action: AiActionId,
  targetId?: string | null,
): boolean {
  if (!request.allowedActions.includes(action)) return false;
  if (!targetId) return !requiresTarget(action);
  return request.targets.some((target) => target.id === targetId);
}

function requiresTarget(action: AiActionId): boolean {
  return [
    "talk",
    "befriend",
    "seek_help",
    "date",
    "argue",
    "reconcile",
    "cooperate",
    "conceal",
    "betray",
  ].includes(action);
}

function rankBuildingsForResident(world: WorldState, resident: Resident): Building[] {
  const relevantTypes = new Set<Building["type"]>([
    "residential",
    "shop",
    "workplace",
    "public",
    "medical",
  ]);
  return [...world.buildings]
    .filter((building) => relevantTypes.has(building.type) && building.operational)
    .sort((a, b) => {
      const priorityA = buildingPriority(a, resident);
      const priorityB = buildingPriority(b, resident);
      return priorityB - priorityA;
    });
}

function buildingPriority(building: Building, resident: Resident): number {
  if (building.id === resident.homeBuildingId) return 100;
  if (building.id === resident.workBuildingId) return 90;
  if (building.type === "shop") return 60;
  if (building.type === "medical") return 50;
  if (building.type === "public") return 40;
  return 10;
}

function relationshipLabel(type: string): string {
  const labels: Record<string, string> = {
    stranger: "陌生人",
    acquaintance: "点头之交",
    friend: "朋友",
    close_friend: "挚友",
    partner: "伴侣",
    ex_partner: "前任",
    rival: "竞争对手",
    enemy: "敌人",
    family: "家人",
  };
  return labels[type] ?? "认识的人";
}

export function describeActionForAi(action: AiActionId): string {
  return ACTION_META[action].description;
}

/** Re-exported so UI can match AI actions to action labels. */
export const AI_ACTION_LABEL_MAP = Object.fromEntries(
  Object.entries(ACTION_META).map(([key, value]) => [key, value.label]),
) as Record<string, string>;
