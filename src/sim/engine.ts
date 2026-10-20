import {
  ACTION_META,
  DAY_START_MINUTE,
  MAX_HISTORY,
  TICK_MINUTES,
  TICKS_PER_DAY,
} from "../shared/constants";
import type {
  ActionId,
  ActionSource,
  Building,
  CurrentAction,
  GameEvent,
  MemoryKind,
  Resident,
  Vec2,
  WorldState,
} from "../shared/types";
import { ACTION_TARGET_KIND } from "../shared/ai";
import {
  adjacentTo,
  clampToWalkable,
  distance,
  findPath,
  getBuildingDoor,
  isWalkableTile,
  randomWalkablePosition,
} from "./city";
import {
  addEvent,
  addGoal,
  addLifeEvent,
  clamp,
  formatClock,
  pushActionHistory,
  recordMemory,
  updateImpression,
} from "./events";
import { computeInequality, refreshDerivedMetrics, trustBaseline } from "./metrics";
import { Rng } from "./rng";
import {
  adjustRelationship,
  compatibilityScore,
  ensureRelationship,
  exchangeMemory,
  getRelationship,
  type RelationshipDelta,
} from "./social";

export interface TickReport {
  tick: number;
  day: number;
  minuteOfDay: number;
  newDay: boolean;
  actionsStarted: number;
  actionsCompleted: number;
  eventsCreated: number;
}

interface Intent {
  action: ActionId;
  label: string;
  reason: string;
  source: ActionSource;
  targetBuildingId?: string;
  targetResidentId?: string;
  destination?: Vec2;
}

export interface AiHintInput {
  action: ActionId;
  targetId?: string;
  targetKind?: "resident" | "building";
  reason: string;
}

export const HEALTHY = {
  deathBaseAge: 78,
};

type ResidentPair = { actor: Resident; target: Resident };

/**
 * Advance the authoritative simulation by exactly one fixed timestep (30 sim
 * minutes). Rendering is never involved, and no network/AI call happens here.
 */
export function tickWorld(world: WorldState): TickReport {
  const rng = new Rng(world.rngState);
  const startEventCount = world.events.length;
  const newDay = advanceClock(world);

  if (newDay) {
    processNewDay(world, rng);
  }

  updateWeather(world, rng);
  applyWeatherAndEnvironment(world, rng);

  let actionsStarted = 0;
  let actionsCompleted = 0;

  for (const resident of world.residents) {
    if (!resident.alive) continue;
    if (resident.paused) continue;

    updateNeeds(world, resident, rng);

    if (resident.currentAction) {
      const result = progressAction(world, resident, rng);
      if (result.completed) actionsCompleted++;
    } else if (world.clock.tick - resident.lastDecisionTick >= 1) {
      ensureShortTermGoals(world, resident);
      const intent = decideIntent(world, resident, rng);
      resident.lastDecisionTick = world.clock.tick;
      if (intent && startIntent(world, resident, intent, rng)) {
        actionsStarted++;
      }
    }

    if (resident.health <= 0 && resident.alive) {
      killResident(world, resident, "健康彻底崩溃", rng);
    }
  }

  if (world.clock.tick % 3 === 0) {
    driftPublicMetrics(world);
  }
  if (world.clock.tick % 12 === 0) {
    processFactions(world, rng);
  }
  if (world.clock.tick % 4 === 0) {
    recordHistory(world);
  }

  refreshDerivedMetrics(world);
  world.rngState = rng.state;
  return {
    tick: world.clock.tick,
    day: world.clock.day,
    minuteOfDay: world.clock.minuteOfDay,
    newDay,
    actionsStarted,
    actionsCompleted,
    eventsCreated: Math.max(0, world.events.length - startEventCount),
  };
}

function advanceClock(world: WorldState): boolean {
  world.clock.tick += 1;
  world.clock.minuteOfDay += TICK_MINUTES;
  let newDay = false;
  if (world.clock.minuteOfDay >= 1440) {
    world.clock.minuteOfDay -= 1440;
    world.clock.day += 1;
    newDay = true;
  }
  return newDay;
}

function getResident(world: WorldState, id: string): Resident | undefined {
  return world.residents.find((resident) => resident.id === id);
}

function getBuilding(world: WorldState, id: string | null | undefined): Building | undefined {
  if (!id) return undefined;
  return world.buildings.find((building) => building.id === id);
}

function aliveResidents(world: WorldState): Resident[] {
  return world.residents.filter((resident) => resident.alive);
}

function buildingUsable(building: Building | undefined): building is Building {
  return !!building && building.operational && building.open && building.condition > 0;
}

function occupancy(world: WorldState, buildingId: string): number {
  return world.residents.filter(
    (resident) => resident.alive && resident.insideBuildingId === buildingId,
  ).length;
}

function nearestBuilding(
  world: WorldState,
  resident: Resident,
  predicate: (building: Building) => boolean,
): Building | null {
  let best: Building | null = null;
  let bestDistance = Infinity;
  for (const building of world.buildings) {
    if (!predicate(building)) continue;
    const door = getBuildingDoor(building);
    const dist = distance(resident.position, door);
    if (dist < bestDistance) {
      best = building;
      bestDistance = dist;
    }
  }
  return best;
}

function chooseBuildingForAction(
  world: WorldState,
  resident: Resident,
  action: ActionId,
): Building | null {
  switch (action) {
    case "work":
      return buildingUsable(getBuilding(world, resident.workBuildingId))
        ? getBuilding(world, resident.workBuildingId)!
        : null;
    case "go_home":
    case "rest":
    case "eat": {
      const home = getBuilding(world, resident.homeBuildingId);
      if (action === "eat") {
        if (home && buildingUsable(home) && home.inventory.food >= 1) return home;
        return nearestBuilding(
          world,
          resident,
          (building) =>
            (building.type === "shop" || building.type === "public") &&
            buildingUsable(building) &&
            building.inventory.food >= 1,
        );
      }
      if (home) return home;
      return nearestBuilding(
        world,
        resident,
        (building) => building.type === "public" && buildingUsable(building),
      );
    }
    case "shop":
      return nearestBuilding(
        world,
        resident,
        (building) => building.type === "shop" && buildingUsable(building),
      );
    case "heal":
      return nearestBuilding(
        world,
        resident,
        (building) => building.type === "medical" && buildingUsable(building),
      );
    case "study":
      return (
        getBuilding(world, resident.homeBuildingId) ??
        nearestBuilding(
          world,
          resident,
          (building) => building.type === "public" && buildingUsable(building),
        )
      );
    case "wander":
      return nearestBuilding(
        world,
        resident,
        (building) =>
          (building.type === "public" ||
            building.type === "shop" ||
            building.type === "medical") &&
          buildingUsable(building),
      );
    default:
      return null;
  }
}

function reasonAge(hour: number): string {
  if (hour < 6) return "夜色还深";
  if (hour < 9) return "清晨的街区刚刚醒来";
  if (hour < 12) return "上午的城市开始忙碌";
  if (hour < 14) return "午后的光线有些刺眼";
  if (hour < 18) return "下班前的时间过得很慢";
  if (hour < 22) return "霓虹灯逐一亮起";
  return "夜晚让街道变得安静";
}

function isWithinMinuteRange(minute: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

function formatWage(world: WorldState, base: number): number {
  return Math.max(1, Math.round(base * world.rules.wageMultiplier));
}

function currentHour(world: WorldState): number {
  return world.clock.minuteOfDay / 60;
}

function relationFeeling(actor: Resident, targetId: string): string {
  const relationship = actor.relationships[targetId];
  if (!relationship) return "陌生人";
  if (relationship.type === "family") return "家人";
  if (relationship.type === "partner") return "伴侣";
  if (relationship.type === "enemy") return "敌人";
  if (relationship.type === "rival") return "对手";
  if (relationship.hostility > 20) return "关系紧张的人";
  if (relationship.affinity > 40) return "让TA放松的人";
  return "认识的人";
}

function targetIsSingle(world: WorldState, resident: Resident): boolean {
  return !Object.values(resident.relationships).some(
    (relation) => relation.type === "partner",
  );
}

function partnerOf(world: WorldState, resident: Resident): Resident | null {
  const relation = Object.values(resident.relationships).find(
    (candidate) => candidate.type === "partner",
  );
  return relation ? getResident(world, relation.residentId) ?? null : null;
}

/* ------------------------------------------------------------------ */
/* Needs, mood and health                                              */
/* ------------------------------------------------------------------ */

function updateNeeds(world: WorldState, resident: Resident, rng: Rng): void {
  const hour = currentHour(world);
  const weather = world.weather.condition;
  const outdoors = resident.insideBuildingId === null;
  const isWorking = resident.currentAction?.action === "work";
  const isResting = resident.currentAction?.action === "rest";

  resident.needs.hunger = clamp(
    resident.needs.hunger + 1.35 * world.rules.foodConsumption + (isWorking ? 0.35 : 0),
    0,
    100,
  );
  resident.needs.energy = clamp(
    resident.needs.energy - (isResting ? 0.2 : isWorking ? 2.1 : 1.55),
    0,
    100,
  );
  resident.needs.social = clamp(
    resident.needs.social - (isWorking ? 0.45 : 1.05),
    0,
    100,
  );

  let safetyDrift = world.rules.safetyBudget / 100 * 0.65 - world.metrics.pollution * 0.008;
  if (outdoors && (weather === "acid_rain" || weather === "storm")) safetyDrift -= 0.7;
  resident.needs.safety = clamp(resident.needs.safety + safetyDrift, 0, 100);

  let stressDelta = 0.11;
  if (resident.needs.hunger > 72) stressDelta += 0.55;
  if (resident.needs.energy < 24) stressDelta += 0.42;
  if (resident.needs.safety < 32) stressDelta += 0.35;
  if (resident.needs.social < 25) stressDelta += 0.22;
  if (isResting) stressDelta -= 0.65;
  if (resident.currentAction?.action === "wander") stressDelta -= 0.3;
  if (isWorking) stressDelta += 0.18;
  resident.stress = clamp(resident.stress + stressDelta, 0, 100);

  if (resident.health > 0) {
    let healthDelta = 0;
    if (resident.needs.hunger > 86) healthDelta -= 0.42;
    if (resident.needs.energy < 8) healthDelta -= 0.15;
    if (resident.stress > 88) healthDelta -= 0.12;
    if (resident.needs.safety < 15) healthDelta -= 0.08;
    if (resident.health < 45 && resident.needs.hunger < 55 && resident.needs.energy > 35) {
      healthDelta += 0.08;
    }
    if (outdoors && weather === "acid_rain") healthDelta -= 0.16;
    if (outdoors && weather === "smog") healthDelta -= 0.12;
    resident.health = clamp(resident.health + healthDelta, 0, 100);
  }

  const safeMoodTarget =
    34 +
    (100 - resident.needs.hunger) * 0.18 +
    resident.needs.energy * 0.18 +
    resident.needs.social * 0.17 +
    resident.needs.safety * 0.15 +
    resident.health * 0.1 -
    resident.stress * 0.2 +
    (hour >= 22 || hour < 6 ? -2 : 2);
  resident.mood = clamp(
    resident.mood + (clamp(safeMoodTarget, 0, 100) - resident.mood) * 0.035,
    0,
    100,
  );

  if (rng.chance(0.002) && resident.health < 92 && resident.needs.hunger > 70) {
    resident.health = clamp(resident.health - 1, 0, 100);
    recordMemory(world, resident, {
      text: "身体因为长时间的饥饿和疲惫发出了警告。",
      kind: "observation",
      importance: 3,
      valence: -0.5,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Actions: movement, acting, resolution                               */
/* ------------------------------------------------------------------ */

function makeCurrentAction(
  world: WorldState,
  resident: Resident,
  intent: Intent,
  path: Vec2[],
): CurrentAction {
  const meta = ACTION_META[intent.action];
  return {
    id: `${resident.id}-act-${world.clock.tick}`,
    action: intent.action,
    label: intent.label,
    phase: path.length > 0 ? "moving" : "acting",
    source: intent.source,
    reason: intent.reason,
    startedTick: world.clock.tick,
    endsTick: path.length > 0 ? world.clock.tick + path.length + meta.duration : world.clock.tick + meta.duration,
    targetId: intent.targetBuildingId ?? intent.targetResidentId,
    targetKind: intent.targetBuildingId ? "building" : intent.targetResidentId ? "resident" : "location",
    targetBuildingId: intent.targetBuildingId,
    targetResidentId: intent.targetResidentId,
    path,
    pathIndex: 0,
  };
}

function startIntent(
  world: WorldState,
  resident: Resident,
  intent: Intent,
  rng: Rng,
): boolean {
  if (resident.currentAction) return false;
  const meta = ACTION_META[intent.action];
  const now = world.clock.tick;
  resident.aiHint = null;

  if (intent.action === "betray" || intent.action === "argue" || intent.action === "date") {
    const target = intent.targetResidentId ? getResident(world, intent.targetResidentId) : null;
    if (!target || !target.alive || target.id === resident.id) return false;
  }

  leaveBuildingIfNeeded(world, resident);

  if (intent.targetBuildingId) {
    const building = getBuilding(world, intent.targetBuildingId);
    if (!building) return false;
    if (resident.insideBuildingId === building.id) {
      resident.currentAction = makeCurrentAction(world, resident, intent, []);
      resident.currentAction.endsTick = now + meta.duration;
      return true;
    }
    if (!building.operational || building.condition <= 0) return false;
    const door = getBuildingDoor(building);
    const path = findPath(world.buildings, resident.position, door);
    if (!path) return false;
    if (path.length <= 1) {
      resident.position = { ...door };
      resident.currentAction = makeCurrentAction(world, resident, intent, []);
      enterBuilding(world, resident, building, rng);
      return true;
    }
    resident.currentAction = makeCurrentAction(world, resident, intent, path.slice(1));
    return true;
  }

  if (intent.targetResidentId) {
    const target = getResident(world, intent.targetResidentId);
    if (!target || !target.alive) return false;
    if (target.insideBuildingId) {
      const building = getBuilding(world, target.insideBuildingId);
      if (!building) return false;
      const door = getBuildingDoor(building);
      const path = findPath(world.buildings, resident.position, door);
      if (!path) return false;
      const nextIntent: Intent = { ...intent, targetBuildingId: building.id };
      if (path.length <= 1) {
        resident.position = { ...door };
        resident.currentAction = makeCurrentAction(world, resident, nextIntent, []);
        enterBuilding(world, resident, building, rng);
        return true;
      }
      resident.currentAction = makeCurrentAction(world, resident, nextIntent, path.slice(1));
      return true;
    }
    const path = findPath(world.buildings, resident.position, target.position);
    if (!path) return false;
    resident.currentAction = makeCurrentAction(world, resident, intent, path.slice(1));
    return true;
  }

  const destination = intent.destination ?? randomWalkablePosition(world, rng);
  const path = findPath(world.buildings, resident.position, destination);
  if (!path) return false;
  resident.currentAction = makeCurrentAction(world, resident, intent, path.slice(1));
  return true;
}

function progressAction(
  world: WorldState,
  resident: Resident,
  rng: Rng,
): { completed: boolean } {
  const action = resident.currentAction;
  if (!action) return { completed: false };

  if (action.phase === "moving") {
    const maxSteps = 2;
    for (let step = 0; step < maxSteps && action.pathIndex < action.path.length; step++) {
      const next = action.path[action.pathIndex];
      if (!next) break;
      if (!isWalkableTile(world.buildings, next.x, next.z)) {
        failCurrentAction(world, resident, "前方道路被阻断", rng);
        return { completed: true };
      }
      resident.facing = Math.atan2(
        next.x - resident.position.x,
        next.z - resident.position.z,
      );
      resident.position = { ...next };
      action.pathIndex++;
    }
    if (action.pathIndex >= action.path.length || action.path.length === 0) {
      arriveAtDestination(world, resident, action, rng);
    }
    return { completed: false };
  }

  if (action.phase === "acting") {
    if (action.targetBuildingId && !resident.insideBuildingId) {
      const building = getBuilding(world, action.targetBuildingId);
      if (!building) {
        failCurrentAction(world, resident, "建筑已经不存在", rng);
        return { completed: true };
      }
      enterBuilding(world, resident, building, rng);
    }
    if (world.clock.tick >= action.endsTick) {
      completeAction(world, resident, action, rng);
      return { completed: true };
    }
  }
  return { completed: false };
}

function arriveAtDestination(
  world: WorldState,
  resident: Resident,
  action: CurrentAction,
  rng: Rng,
): void {
  if (action.targetBuildingId) {
    const building = getBuilding(world, action.targetBuildingId);
    if (!building) {
      failCurrentAction(world, resident, "目的地建筑已经消失", rng);
      return;
    }
    if (!building.operational || building.condition <= 0) {
      failCurrentAction(world, resident, "目的地已经关闭", rng);
      return;
    }
    if (occupancy(world, building.id) >= building.capacity + 4) {
      failCurrentAction(world, resident, "建筑已经超员", rng);
      return;
    }
    const door = getBuildingDoor(building);
    resident.position = { ...door };
    enterBuilding(world, resident, building, rng);
    action.phase = "acting";
    action.endsTick = world.clock.tick + ACTION_META[action.action].duration;
    return;
  }

  if (action.targetResidentId) {
    const target = getResident(world, action.targetResidentId);
    if (!target || !target.alive) {
      failCurrentAction(world, resident, "目标已经离开", rng);
      return;
    }
    if (
      target.insideBuildingId &&
      target.insideBuildingId === resident.insideBuildingId
    ) {
      action.phase = "acting";
      action.endsTick = world.clock.tick + ACTION_META[action.action].duration;
      return;
    }
    if (!adjacentTo(resident.position, target.position, 3.2)) {
      failCurrentAction(world, resident, "没能追上对方", rng);
      return;
    }
    action.phase = "acting";
    action.endsTick = world.clock.tick + ACTION_META[action.action].duration;
    return;
  }

  action.phase = "acting";
  action.endsTick = world.clock.tick + ACTION_META[action.action].duration;
}

function enterBuilding(
  world: WorldState,
  resident: Resident,
  building: Building,
  _rng: Rng,
): void {
  if (resident.insideBuildingId === building.id) return;
  leaveBuildingIfNeeded(world, resident);
  resident.insideBuildingId = building.id;
  resident.position = { ...getBuildingDoor(building) };
  building.recentVisits.unshift({
    residentId: resident.id,
    tick: world.clock.tick,
    day: world.clock.day,
    kind: "enter",
  });
  building.recentVisits = building.recentVisits.slice(0, 20);
}

function leaveBuildingIfNeeded(world: WorldState, resident: Resident): void {
  if (!resident.insideBuildingId) return;
  const current = getBuilding(world, resident.insideBuildingId);
  if (current) {
    current.recentVisits.unshift({
      residentId: resident.id,
      tick: world.clock.tick,
      day: world.clock.day,
      kind: "leave",
    });
    current.recentVisits = current.recentVisits.slice(0, 20);
    resident.position = { ...getBuildingDoor(current) };
  }
  resident.insideBuildingId = null;
}

function failCurrentAction(
  world: WorldState,
  resident: Resident,
  message: string,
  _rng: Rng,
): void {
  const action = resident.currentAction;
  if (!action) return;
  pushActionHistory(
    resident,
    world,
    action.action,
    action.label,
    action.reason,
    action.source,
    `行动失败：${message}`,
    action.targetId,
  );
  if (action.source === "ai") {
    addEvent(world, {
      type: "warn",
      title: `${resident.name}的 AI 建议未能执行`,
      description: `${action.reason} 但${message}。已回退到常规生活。`,
      actorId: resident.id,
      source: "ai",
      importance: 3,
      tag: "AI FALLBACK",
    });
  }
  resident.currentAction = null;
  resident.lastDecisionTick = world.clock.tick;
}

function completeAction(
  world: WorldState,
  resident: Resident,
  action: CurrentAction,
  rng: Rng,
): void {
  const targetResident = action.targetResidentId
    ? getResident(world, action.targetResidentId)
    : undefined;
  const targetBuilding = action.targetBuildingId
    ? getBuilding(world, action.targetBuildingId)
    : undefined;

  if (action.targetResidentId && targetResident) {
    if (
      !targetResident.alive ||
      (!adjacentTo(resident.position, targetResident.position, 3.8) &&
        targetResident.insideBuildingId !== resident.insideBuildingId)
    ) {
      failCurrentAction(world, resident, "对方已经离开", rng);
      return;
    }
  }

  let outcome = "";
  let memoryKind: MemoryKind = "action";
  let importance = 2;
  let valence = 0;
  let shouldLog = false;
  let logTitle = "";
  let logDescription = "";
  let logType: GameEvent["type"] = "social";
  const targetIds: string[] = [];
  if (targetResident) targetIds.push(targetResident.id);
  if (targetBuilding) targetIds.push(targetBuilding.id);

  switch (action.action) {
    case "work": {
      const workplace = targetBuilding ?? getBuilding(world, resident.workBuildingId);
      if (!workplace) {
        failCurrentAction(world, resident, "工作场所不存在", rng);
        return;
      }
      const baseWage = 7 + (resident.skills[resident.workSkill] ?? 40) / 14;
      let wage = formatWage(world, baseWage + rng.float(-1.2, 1.6));
      if (!workplace.operational) wage = 0;
      if (workplace.inventory.credits < wage) {
        const faction = world.factions.find((candidate) => candidate.id === workplace.ownerFactionId);
        if (faction && faction.funds >= wage * 2) {
          faction.funds -= wage;
        } else {
          wage = Math.max(0, Math.floor(workplace.inventory.credits * 0.5));
        }
      }
      wage = Math.min(wage, Math.max(0, Math.floor(workplace.inventory.credits)));
      workplace.inventory.credits -= wage;
      workplace.income += wage;
      resident.wealth += wage;
      if (wage > 0 && world.rules.taxRate > 0) {
        const tax = Math.max(0, Math.round(wage * world.rules.taxRate));
        resident.wealth -= tax;
        world.reserves.credits += tax;
      }
      resident.skills[resident.workSkill] = clamp(
        (resident.skills[resident.workSkill] ?? 40) + 0.35,
        0,
        100,
      );
      resident.stress = clamp(resident.stress + 3.2, 0, 100);
      resident.needs.energy = clamp(resident.needs.energy - 4, 0, 100);
      outcome = `完成了一轮${resident.jobTitle}工作，获得 ${wage} 信用点。`;
      memoryKind = "action";
      importance = wage >= 18 ? 4 : 2;
      valence = 0.2;
      if (rng.chance(0.35)) {
        shouldLog = true;
        logTitle = `${resident.name}完成工作`;
        logDescription = `${outcome}${resident.stress > 65 ? "持续加班让TA的精力和情绪都在透支。" : ""}`;
        logType = "economy";
      }
      break;
    }
    case "rest": {
      resident.needs.energy = clamp(resident.needs.energy + 24, 0, 100);
      resident.stress = clamp(resident.stress - 10, 0, 100);
      resident.health = clamp(resident.health + 1.2, 0, 100);
      resident.mood = clamp(resident.mood + 2.5, 0, 100);
      outcome = "休息了一会儿，精力和压力都得到了恢复。";
      memoryKind = "action";
      importance = 1;
      valence = 0.3;
      break;
    }
    case "eat": {
      const foodSource = targetBuilding ?? getBuilding(world, resident.homeBuildingId);
      let ate = false;
      if (foodSource && foodSource.inventory.food >= 1) {
        if (foodSource.type === "shop") {
          const cost = Math.max(1, Math.round(3 * world.rules.priceMultiplier));
          if (resident.wealth >= cost) {
            resident.wealth -= cost;
            foodSource.inventory.credits += cost;
            foodSource.inventory.food -= 1;
            foodSource.income += cost;
            ate = true;
          }
        } else {
          foodSource.inventory.food -= 1;
          ate = true;
        }
      }
      if (ate) {
        resident.needs.hunger = clamp(resident.needs.hunger - 38, 0, 100);
        resident.health = clamp(resident.health + 1.5, 0, 100);
        resident.mood = clamp(resident.mood + 2, 0, 100);
        outcome = "吃了一顿热饭，饥饿感明显缓解。";
        completionShortGoal(world, resident, "吃");
      } else {
        resident.needs.hunger = clamp(resident.needs.hunger - 8, 0, 100);
        resident.mood = clamp(resident.mood - 1, 0, 100);
        outcome = "没能获得足够的食物，只能勉强撑着。";
      }
      memoryKind = "action";
      importance = 2;
      valence = ate ? 0.5 : -0.3;
      break;
    }
    case "shop": {
      const shop = targetBuilding;
      if (!shop || !shop.operational) {
        failCurrentAction(world, resident, "商店已经无法营业", rng);
        return;
      }
      const budget = Math.min(resident.wealth, 28);
      let bought = 0;
      const unitFood = Math.max(1, Math.round(5 * world.rules.priceMultiplier));
      const unitMed = Math.max(2, Math.round(8 * world.rules.priceMultiplier));
      let spent = 0;
      if (shop.inventory.food >= 1 && resident.needs.hunger > 25 && budget - spent >= unitFood) {
        shop.inventory.food -= 2;
        shop.inventory.credits += unitFood * 2;
        spent += unitFood * 2;
        bought += 2;
      }
      if (resident.health < 70 && shop.inventory.meds >= 1 && budget - spent >= unitMed) {
        shop.inventory.meds -= 1;
        shop.inventory.credits += unitMed;
        spent += unitMed;
        resident.health = clamp(resident.health + 8, 0, 100);
        bought += 1;
      }
      resident.wealth = Math.max(0, resident.wealth - spent);
      shop.income += spent;
      resident.mood = clamp(resident.mood + 1.5, 0, 100);
      outcome =
        bought > 0
          ? `在${shop.name}购买了生活物资，花费 ${spent} 信用点。`
          : "逛了一圈，但什么都没舍得买。";
      memoryKind = "action";
      importance = 2;
      valence = bought > 0 ? 0.3 : -0.1;
      break;
    }
    case "go_home": {
      resident.needs.safety = clamp(resident.needs.safety + 8, 0, 100);
      resident.needs.energy = clamp(resident.needs.energy + 5, 0, 100);
      resident.mood = clamp(resident.mood + 1, 0, 100);
      outcome = "回到住处，紧绷的神经稍微放松下来。";
      memoryKind = "action";
      importance = 1;
      break;
    }
    case "wander": {
      resident.mood = clamp(resident.mood + 4, 0, 100);
      resident.stress = clamp(resident.stress - 4, 0, 100);
      resident.needs.energy = clamp(resident.needs.energy - 3, 0, 100);
      outcome = "在城市的公共空间里走了一圈，观察着街区的变化。";
      memoryKind = "observation";
      importance = 1;
      valence = 0.3;
      if (targetBuilding && rng.chance(0.22)) {
        const observation = rng.pick([
          `在${targetBuilding.name}听见有人谈论最近的价格上涨。`,
          `在${targetBuilding.name}附近看到一张被撕掉一半的寻人启事。`,
          `在${targetBuilding.name}的霓虹灯下，发现了一条新涂鸦。`,
          `在${targetBuilding.name}旁边短暂地遇到了一个不愿透露姓名的人。`,
        ]);
        recordMemory(world, resident, {
          text: observation,
          kind: "observation",
          importance: 2,
          valence: 0.1,
        });
      }
      break;
    }
    case "talk":
    case "befriend":
    case "date":
    case "argue":
    case "reconcile":
    case "cooperate":
    case "conceal":
    case "betray": {
      if (!targetResident) {
        failCurrentAction(world, resident, "对方已经不在附近", rng);
        return;
      }
      const result = resolveSocialAction(world, resident, targetResident, action.action, rng);
      outcome = result.outcome;
      memoryKind = result.memoryKind;
      importance = result.importance;
      valence = result.valence;
      shouldLog = result.log;
      logTitle = result.logTitle;
      logDescription = result.logDescription;
      logType = result.logType;
      break;
    }
    case "seek_help": {
      if (!targetResident) {
        failCurrentAction(world, resident, "求助对象已经离开", rng);
        return;
      }
      const targetView = getRelationship(targetResident, resident.id);
      const accept =
        targetResident.alive &&
        (targetView?.trust ?? 0) >= 18 &&
        targetResident.personality.traits.agreeableness > 35;
      if (accept && targetResident.wealth >= 6) {
        const amount = Math.min(28, Math.max(5, Math.round(targetResident.wealth * 0.08)));
        targetResident.wealth -= amount;
        resident.wealth += amount;
        const foodSource = getBuilding(world, targetResident.homeBuildingId);
        if (foodSource && foodSource.inventory.food > 0) foodSource.inventory.food -= 1;
        resident.needs.hunger = clamp(resident.needs.hunger - 14, 0, 100);
        resident.mood = clamp(resident.mood + 4, 0, 100);
        adjustRelationship(world, resident, targetResident.id, {
          familiarity: 4,
          affinity: 5,
          trust: 8,
          note: "在困难时伸出了手",
        });
        adjustRelationship(world, targetResident, resident.id, {
          familiarity: 3,
          affinity: 2,
          trust: 2,
          note: "向自己求助",
        });
        outcome = `${targetResident.name}在犹豫后拿出了 ${amount} 信用点，并分了一些食物。`;
        memoryKind = "gift";
        importance = 5;
        valence = 0.6;
        shouldLog = true;
        logTitle = `${targetResident.name}帮助了${resident.name}`;
        logDescription = `${outcome}这段互相依靠的关系变得更牢固了一些。`;
      } else {
        resident.needs.social = clamp(resident.needs.social - 5, 0, 100);
        resident.mood = clamp(resident.mood - 3, 0, 100);
        resident.stress = clamp(resident.stress + 5, 0, 100);
        adjustRelationship(world, resident, targetResident.id, {
          familiarity: 3,
          affinity: -3,
          trust: -2,
          note: `求助被拒绝`,
        });
        outcome = `${targetResident.name}拒绝了求助，气氛变得尴尬。`;
        memoryKind = "social";
        importance = 4;
        valence = -0.4;
        shouldLog = true;
        logTitle = `${resident.name}的求助被拒绝`;
        logDescription = outcome;
        logType = "warn";
      }
      break;
    }
    case "heal": {
      const clinic = targetBuilding;
      if (!clinic) {
        failCurrentAction(world, resident, "医疗设施不存在", rng);
        return;
      }
      const cost = Math.max(0, Math.round(10 * world.rules.priceMultiplier));
      const canPay = resident.wealth >= cost;
      const hasMeds = clinic.inventory.meds >= 1;
      if (!hasMeds) {
        outcome = "诊所的药物已经用完，只能进行最基础的包扎。";
        resident.health = clamp(resident.health + 4, 0, 100);
      } else {
        clinic.inventory.meds -= 1;
        if (canPay) {
          resident.wealth -= cost;
          clinic.inventory.credits += cost;
          clinic.income += cost;
        } else {
          world.reserves.credits = Math.max(0, world.reserves.credits - cost);
        }
        resident.health = clamp(resident.health + 18, 0, 100);
        resident.needs.energy = clamp(resident.needs.energy + 6, 0, 100);
        resident.needs.safety = clamp(resident.needs.safety + 6, 0, 100);
        outcome = canPay
          ? `在${clinic.name}接受了治疗，健康明显好转。`
          : `在${clinic.name}接受了免费治疗，福利系统支付了费用。`;
      }
      memoryKind = "observation";
      importance = 4;
      valence = 0.4;
      shouldLog = true;
      logTitle = `${resident.name}前往${clinic.name}就医`;
      logDescription = outcome;
      logType = "info";
      break;
    }
    case "study": {
      resident.skills[resident.workSkill] = clamp(
        (resident.skills[resident.workSkill] ?? 40) + 1.6,
        0,
        100,
      );
      resident.stress = clamp(resident.stress + 2.5, 0, 100);
      resident.needs.energy = clamp(resident.needs.energy - 5, 0, 100);
      outcome = "花时间学习新的技能，感到离目标又近了一点。";
      memoryKind = "action";
      importance = 3;
      valence = 0.35;
      break;
    }
    default:
      outcome = "完成了一个日常行动。";
  }

  resident.needs.social = clamp(resident.needs.social + (action.action === "talk" ? 7 : 0), 0, 100);
  progressGoals(world, resident, action.action, targetResident, targetBuilding);
  pushActionHistory(
    resident,
    world,
    action.action,
    action.label,
    action.reason,
    action.source,
    outcome,
    action.targetId,
  );
  recordMemory(world, resident, {
    text: outcome,
    kind: memoryKind,
    importance,
    subjectIds: targetIds,
    valence,
    source: action.source === "ai" ? "ai" : "experienced",
  });

  if (action.source === "ai") {
    addEvent(world, {
      type: "ai",
      title: `${resident.name}采纳了 AI 顾问建议`,
      description: `${action.reason} → ${outcome}`,
      actorId: resident.id,
      targetIds,
      source: "ai",
      importance: Math.max(4, importance),
      tag: "AI ADVISOR",
    });
  }

  if (shouldLog) {
    addEvent(world, {
      type: logType,
      title: logTitle,
      description: logDescription || outcome,
      actorId: resident.id,
      targetIds,
      source: action.source === "ai" ? "ai" : "local",
      importance,
      tag: action.action.toUpperCase(),
    });
  }

  if (resident.insideBuildingId) {
    const building = getBuilding(world, resident.insideBuildingId);
    if (building) {
      building.recentVisits.unshift({
        residentId: resident.id,
        tick: world.clock.tick,
        day: world.clock.day,
        kind: "leave",
      });
      building.recentVisits = building.recentVisits.slice(0, 20);
    }
    resident.insideBuildingId = null;
  } else if (targetBuilding) {
    // Normally the resident is already inside the target building. Keep a
    // single leave record for edge cases (e.g. open-air actions interrupted).
    targetBuilding.recentVisits.unshift({
      residentId: resident.id,
      tick: world.clock.tick,
      day: world.clock.day,
      kind: "leave",
    });
    targetBuilding.recentVisits = targetBuilding.recentVisits.slice(0, 20);
  }
  resident.currentAction = null;
  resident.lastDecisionTick = world.clock.tick;
}

/* ------------------------------------------------------------------ */
/* Social action resolution                                           */
/* ------------------------------------------------------------------ */

interface SocialResult {
  outcome: string;
  memoryKind: MemoryKind;
  importance: number;
  valence: number;
  log: boolean;
  logTitle: string;
  logDescription: string;
  logType: GameEvent["type"];
}

function resolveSocialAction(
  world: WorldState,
  actor: Resident,
  target: Resident,
  action: ActionId,
  rng: Rng,
): SocialResult {
  const compatibility = compatibilityScore(actor, target);
  const actorView = ensureRelationship(world, actor, target.id);
  const targetView = ensureRelationship(world, target, actor.id);
  const actorName = actor.name;
  const targetName = target.name;
  const base = {
    outcome: "",
    memoryKind: "social" as MemoryKind,
    importance: 3,
    valence: 0.2,
    log: false,
    logTitle: "",
    logDescription: "",
    logType: "social" as GameEvent["type"],
  };

  switch (action) {
    case "talk": {
      const familiarityGain = 3 + Math.round(actor.personality.traits.extraversion / 30);
      const affinityGain = Math.round((compatibility - 50) / 14) + rng.int(-1, 2);
      adjustRelationship(world, actor, target.id, {
        familiarity: familiarityGain,
        affinity: affinityGain,
        trust: Math.max(0, Math.round(compatibility / 60)),
        intimacy: actorView.type === "partner" ? 2 : 0,
        note: `在${formatClock(world)}聊了聊近况`,
      });
      adjustRelationship(world, target, actor.id, {
        familiarity: familiarityGain - 1,
        affinity: Math.round((compatibility - 50) / 16) + rng.int(-1, 2),
        trust: Math.max(0, Math.round(compatibility / 80)),
        note: `和${actorName}聊了一会儿`,
      });
      exchangeMemory(world, actor, target, rng);
      if (rng.chance(0.28)) exchangeMemory(world, target, actor, rng);
      actor.needs.social = clamp(actor.needs.social + 10, 0, 100);
      target.needs.social = clamp(target.needs.social + 8, 0, 100);
      actor.mood = clamp(actor.mood + 3, 0, 100);
      target.mood = clamp(target.mood + 2, 0, 100);
      base.outcome = `${actorName}和${targetName}聊了一会儿${compatibility > 60 ? "，气氛很自然" : "，话题不多但没有冷场"}。`;
      base.importance = 2;
      base.valence = compatibility > 60 ? 0.5 : 0.1;
      const newType = actorView.type;
      if (newType === "friend" && actorView.interactions <= 3) {
        base.log = true;
        base.logTitle = `${actorName}与${targetName}成为了朋友`;
        base.logDescription = "共同经历和谈话让两个人逐渐靠近。";
        base.importance = 5;
        addLifeEvent(world, actor, "milestone", "新朋友", `与${targetName}成为了朋友。`);
        addLifeEvent(world, target, "milestone", "新朋友", `与${actorName}成为了朋友。`);
      }
      break;
    }
    case "befriend": {
      const willing =
        target.personality.traits.agreeableness + (targetView.affinity + targetView.trust) / 2 >
        (targetView.hostility > 25 ? 90 : 45);
      if (!willing) {
        adjustRelationship(world, actor, target.id, {
          familiarity: 3,
          affinity: -4,
          trust: -2,
          note: "主动示好但没有得到回应",
        });
        actor.mood = clamp(actor.mood - 3, 0, 100);
        base.outcome = `${targetName}明显不想深聊，${actorName}只能收回话题。`;
        base.importance = 3;
        base.valence = -0.3;
        base.log = false;
        break;
      }
      const gain = 6 + Math.round(compatibility / 20);
      adjustRelationship(world, actor, target.id, {
        familiarity: 8,
        affinity: gain,
        trust: 6,
        intimacy: 3,
        note: "被主动邀请成为朋友",
      });
      adjustRelationship(world, target, actor.id, {
        familiarity: 6,
        affinity: Math.round(gain * 0.8),
        trust: 4,
        intimacy: 2,
        note: "被主动邀请成为朋友",
      });
      actor.needs.social = clamp(actor.needs.social + 14, 0, 100);
      target.needs.social = clamp(target.needs.social + 8, 0, 100);
      base.outcome = `${actorName}主动走进${targetName}的生活，两人聊了很久。`;
      base.importance = 4;
      base.valence = 0.5;
      base.log = true;
      base.logTitle = `${actorName}尝试结交${targetName}`;
      base.logDescription = base.outcome;
      break;
    }
    case "date": {
      const attractionToTarget = actorView.attraction;
      const targetAttraction = targetView.attraction;
      if (
        !target.alive ||
        !targetIsSingle(world, actor) ||
        !targetIsSingle(world, target) ||
        actorView.type === "family" ||
        actorView.type === "enemy"
      ) {
        actor.mood = clamp(actor.mood - 5, 0, 100);
        base.outcome = "这场约会并没有发生——两个人之间还有很多没有理清的事情。";
        base.importance = 3;
        base.valence = -0.2;
        break;
      }
      const mutual = attractionToTarget >= 12 && targetAttraction >= 8;
      if (!mutual) {
        adjustRelationship(world, actor, target.id, {
          familiarity: 2,
          affinity: -3,
          trust: -2,
          note: "暗示没有得到回应",
        });
        actor.mood = clamp(actor.mood - 4, 0, 100);
        base.outcome = `${targetName}没有领会${actorName}的暗示，这次“约会”更像是普通的碰面。`;
        base.importance = 3;
        base.valence = -0.2;
        break;
      }
      const comfort = compatibility > 55 ? 3 : 1;
      adjustRelationship(world, actor, target.id, {
        familiarity: 7,
        affinity: 7 + comfort,
        trust: 4,
        intimacy: 7,
        attraction: 6,
        note: "一次小心翼翼的约会",
      });
      adjustRelationship(world, target, actor.id, {
        familiarity: 6,
        affinity: 6 + comfort,
        trust: 3,
        intimacy: 6,
        attraction: 5,
        note: "一次小心翼翼的约会",
      });
      actor.needs.social = clamp(actor.needs.social + 16, 0, 100);
      target.needs.social = clamp(target.needs.social + 14, 0, 100);
      actor.mood = clamp(actor.mood + 8, 0, 100);
      target.mood = clamp(target.mood + 7, 0, 100);
      base.outcome = `${actorName}和${targetName}一起度过了一个有些笨拙、但足够真实的夜晚。`;
      base.importance = 6;
      base.valence = 0.8;
      base.log = true;
      base.logTitle = `${actorName}与${targetName}约会`;
      base.logDescription = "两人之间的距离在这次见面后明显缩短了。";
      const updatedActorView = actor.relationships[target.id]!;
      const updatedTargetView = target.relationships[actor.id]!;
      const readiness =
        updatedActorView.affinity >= 42 &&
        updatedActorView.trust >= 34 &&
        updatedActorView.intimacy >= 32 &&
        updatedActorView.attraction >= 32 &&
        updatedTargetView.affinity >= 34 &&
        updatedTargetView.trust >= 25 &&
        updatedTargetView.attraction >= 24 &&
        updatedActorView.interactions >= 8;
      if (readiness && rng.chance(0.72)) {
        updatedActorView.type = "partner";
        updatedActorView.sinceDay = world.clock.day;
        updatedTargetView.type = "partner";
        updatedTargetView.sinceDay = world.clock.day;
        updatedActorView.notes.unshift("决定成为伴侣");
        updatedTargetView.notes.unshift("决定成为伴侣");
        actor.mood = clamp(actor.mood + 10, 0, 100);
        target.mood = clamp(target.mood + 10, 0, 100);
        addLifeEvent(world, actor, "romance", "成为伴侣", `与${targetName}确立了伴侣关系。`);
        addLifeEvent(world, target, "romance", "成为伴侣", `与${actorName}确立了伴侣关系。`);
        recordMemory(world, actor, {
          text: `和${targetName}决定成为伴侣。`,
          kind: "romance",
          importance: 9,
          subjectIds: [target.id],
          valence: 0.9,
        });
        recordMemory(world, target, {
          text: `和${actorName}决定成为伴侣。`,
          kind: "romance",
          importance: 9,
          subjectIds: [actor.id],
          valence: 0.9,
        });
        base.logTitle = `${actorName}与${targetName}成为伴侣`;
        base.logDescription = "关系在多次相处后自然发生，而不是一次随机判定。";
        base.importance = 9;
        addEvent(world, {
          type: "social",
          title: base.logTitle,
          description: base.logDescription,
          actorId: actor.id,
          targetIds: [target.id],
          source: "local",
          importance: 9,
          tag: "ROMANCE",
        });
        base.log = false;
      }
      break;
    }
    case "argue": {
      const severity = 6 + Math.round(actor.stress / 16) + rng.int(0, 5);
      const targetBacklash = target.personality.traits.agreeableness < 45 ? 2 : 0;
      adjustRelationship(world, actor, target.id, {
        familiarity: 3,
        affinity: -severity,
        trust: -severity,
        hostility: severity,
        note: "发生了争执",
      });
      adjustRelationship(world, target, actor.id, {
        familiarity: 3,
        affinity: -severity - 2,
        trust: -severity - 2,
        hostility: severity + targetBacklash,
        note: `和${actorName}发生了争执`,
      });
      actor.stress = clamp(actor.stress + 7, 0, 100);
      target.stress = clamp(target.stress + 9, 0, 100);
      actor.needs.social = clamp(actor.needs.social - 6, 0, 100);
      target.needs.social = clamp(target.needs.social - 8, 0, 100);
      actor.impressions[target.id] = {
        summary: `${targetName}在这件事上让人失望。`,
        perceivedTraits: ["固执"],
        reliability: 0.7,
        updatedDay: world.clock.day,
      };
      base.outcome = `${actorName}和${targetName}的争执升级了，旧账被重新翻了出来。`;
      base.importance = 6;
      base.valence = -0.8;
      base.log = true;
      base.logTitle = `${actorName}与${targetName}发生争执`;
      base.logDescription = "街区里的熟人都听到了这场争吵，双方关系明显恶化。";
      base.logType = "warn";
      break;
    }
    case "reconcile": {
      const willingness =
        (actor.personality.traits.agreeableness + target.personality.traits.agreeableness) / 200 +
        (actorView.affinity + targetView.affinity) / 300 +
        0.18;
      if (willingness > 0.48 || rng.chance(0.35)) {
        adjustRelationship(world, actor, target.id, {
          familiarity: 3,
          affinity: 6,
          trust: 8,
          hostility: -18,
          note: "主动伸出了和解的手",
        });
        adjustRelationship(world, target, actor.id, {
          familiarity: 3,
          affinity: 4,
          trust: 5,
          hostility: -14,
          note: `接受了${actorName}的和解`,
        });
        actor.stress = clamp(actor.stress - 8, 0, 100);
        target.stress = clamp(target.stress - 6, 0, 100);
        base.outcome = `${actorName}先开了口，${targetName}沉默了一会儿，最终没有再争下去。`;
        base.importance = 5;
        base.valence = 0.6;
        base.log = true;
        base.logTitle = `${actorName}与${targetName}尝试和解`;
        base.logDescription = base.outcome;
        base.logType = "social";
      } else {
        adjustRelationship(world, actor, target.id, {
          familiarity: 2,
          affinity: -2,
          hostility: 3,
          note: "和解没有成功",
        });
        base.outcome = `和解没有成功。${targetName}还没有准备好原谅${actorName}。`;
        base.importance = 4;
        base.valence = -0.3;
        base.log = false;
      }
      break;
    }
    case "cooperate": {
      const cityShare = Math.min(18, Math.max(0, Math.floor(world.reserves.credits * 0.001)));
      const bonus = 5 + cityShare;
      actor.wealth += bonus;
      target.wealth += bonus;
      world.reserves.credits = Math.max(0, world.reserves.credits - bonus * 2);
      adjustRelationship(world, actor, target.id, {
        familiarity: 6,
        affinity: 6,
        trust: 10,
        intimacy: 2,
        note: "一起完成了一项困难的工作",
      });
      adjustRelationship(world, target, actor.id, {
        familiarity: 6,
        affinity: 5,
        trust: 9,
        note: "一起完成了一项困难的工作",
      });
      actor.mood = clamp(actor.mood + 5, 0, 100);
      target.mood = clamp(target.mood + 5, 0, 100);
      actor.needs.social = clamp(actor.needs.social + 10, 0, 100);
      target.needs.social = clamp(target.needs.social + 10, 0, 100);
      base.outcome = `${actorName}与${targetName}合作解决了一件街区难题，两人都得到了一些报酬。`;
      base.importance = 5;
      base.valence = 0.6;
      base.log = true;
      base.logTitle = `${actorName}与${targetName}展开合作`;
      base.logDescription = base.outcome;
      base.logType = "social";
      break;
    }
    case "conceal": {
      actor.stress = clamp(actor.stress - 6, 0, 100);
      actor.needs.social = clamp(actor.needs.social - 4, 0, 100);
      const secret = actor.secrets[0];
      if (secret) {
        base.outcome = `${actorName}把一些话咽了回去，没有让${targetName}知道全部真相。`;
      } else {
        base.outcome = `${actorName}选择了沉默，把不想解释的部分留在自己这里。`;
      }
      base.importance = 3;
      base.valence = -0.2;
      base.log = false;
      break;
    }
    case "betray": {
      if (actorView.trust < 15) {
        base.outcome = "背叛没有发生：两个人之间还没有建立起足够的信任。";
        base.importance = 2;
        break;
      }
      const amount = Math.min(60, Math.max(8, Math.round(target.wealth * 0.18)));
      target.wealth = Math.max(0, target.wealth - amount);
      actor.wealth += amount;
      actor.factionId = actor.factionId;
      adjustRelationship(world, target, actor.id, {
        familiarity: 4,
        affinity: -60,
        trust: -80,
        hostility: 70,
        intimacy: -40,
        note: "被背叛了",
      });
      adjustRelationship(world, actor, target.id, {
        familiarity: 2,
        affinity: -22,
        trust: -25,
        hostility: 18,
        note: "背叛了对方的信任",
      });
      target.stress = clamp(target.stress + 28, 0, 100);
      target.mood = clamp(target.mood - 24, 0, 100);
      target.health = clamp(target.health - 5, 0, 100);
      actor.stress = clamp(actor.stress + 16, 0, 100);
      actor.mood = clamp(actor.mood - 8, 0, 100);
      actor.impressions[target.id] = {
        summary: `${targetName}很信任自己，而自己利用了这一点。`,
        perceivedTraits: ["信任他人"],
        reliability: 0.9,
        updatedDay: world.clock.day,
      };
      base.outcome = `${actorName}利用了${targetName}的信任，带走了 ${amount} 信用点。`;
      base.importance = 10;
      base.valence = -0.95;
      base.log = true;
      base.logTitle = `${actorName}背叛了${targetName}`;
      base.logDescription = "一段信任关系在街区眼皮底下破裂。";
      base.logType = "danger";
      addLifeEvent(world, target, "betrayal", "被背叛", `被${actorName}背叛，失去 ${amount} 信用点。`);
      addLifeEvent(world, actor, "betrayal", "背叛", `背叛了${targetName}。`);
      addEvent(world, {
        type: "social",
        title: `${actorName}与${targetName}的关系破裂`,
        description: amount > 20 ? "损失的信用点与背叛让这段关系几乎无法修复。" : base.outcome,
        actorId: target.id,
        targetIds: [actor.id],
        source: "local",
        importance: 9,
        tag: "BETRAYAL",
      });
      break;
    }
    default:
      base.outcome = "发生了一次普通的互动。";
  }

  return base;
}

/* ------------------------------------------------------------------ */
/* Decision making                                                     */
/* ------------------------------------------------------------------ */

interface ScoredIntent extends Intent {
  score: number;
}

function decideIntent(world: WorldState, resident: Resident, rng: Rng): Intent | null {
  const hintIntent = consumeAiHint(world, resident, rng);
  if (hintIntent) return hintIntent;

  const minute = world.clock.minuteOfDay;
  const hour = minute / 60;
  const isWorkTime = isWithinMinuteRange(
    minute,
    resident.routine.workStartMinute,
    resident.routine.workEndMinute,
  );
  const isRestTime = isWithinMinuteRange(
    minute,
    resident.routine.sleepMinute,
    resident.routine.wakeMinute,
  );
  const traits = resident.personality.traits;
  const candidates: ScoredIntent[] = [];
  const home = getBuilding(world, resident.homeBuildingId);
  const work = getBuilding(world, resident.workBuildingId);
  const others = aliveResidents(world).filter((candidate) => candidate.id !== resident.id);

  const add = (
    intent: Intent,
    score: number,
  ) => {
    if (!Number.isFinite(score) || score <= 0) return;
    candidates.push({ ...intent, score: score + rng.float(-1.8, 1.8) });
  };

  // Basic survival actions
  const eatBuilding = chooseBuildingForAction(world, resident, "eat");
  if (eatBuilding && resident.needs.hunger > 24) {
    add(
      {
        action: "eat",
        label: "进食",
        reason:
          resident.needs.hunger > 72
            ? `${reasonAge(hour)}，饥饿已经让人无法集中精神。`
            : "需要补充一点食物，让身体撑过接下来的时间。",
        source: "local",
        targetBuildingId: eatBuilding.id,
      },
      18 + resident.needs.hunger * 1.08 + (resident.needs.hunger > 70 ? 24 : 0),
    );
  }

  if (resident.needs.energy < 70 || resident.stress > 58 || isRestTime) {
    const restBuilding =
      (home && buildingUsable(home) ? home : null) ??
      nearestBuilding(world, resident, (b) => b.type === "public" && buildingUsable(b));
    if (restBuilding) {
      add(
        {
          action: "rest",
          label: "休息",
          reason:
            isRestTime && resident.needs.energy < 70
              ? "到了该睡觉的时间，身体已经撑不住了。"
              : "精力和压力都到了临界点，需要停下来。",
          source: "local",
          targetBuildingId: restBuilding.id,
        },
        (100 - resident.needs.energy) * 0.9 +
          resident.stress * 0.5 +
          (isRestTime ? 44 : 0) -
          8,
      );
    }
  }

  const homeFood = home?.inventory.food ?? 0;
  if (
    resident.needs.hunger > 42 &&
    homeFood < 2 &&
    getBuilding(world, resident.homeBuildingId)
  ) {
    const shop = chooseBuildingForAction(world, resident, "shop");
    if (shop) {
      add(
        {
          action: "shop",
          label: "采购",
          reason: "家里的食物快吃完了，得去市场补一点。",
          source: "local",
          targetBuildingId: shop.id,
        },
        12 + resident.needs.hunger * 0.35 + (resident.wealth > 8 ? 10 : 0),
      );
    }
  }

  if (resident.health < 64) {
    const clinic = chooseBuildingForAction(world, resident, "heal");
    if (clinic) {
      add(
        {
          action: "heal",
          label: "就医",
          reason: resident.health < 35 ? "身体状况已经很糟，不得不去诊所。" : "身体有些不对劲，应该去看一下。",
          source: "local",
          targetBuildingId: clinic.id,
        },
        (70 - resident.health) * 1.3 + (resident.health < 30 ? 28 : 0),
      );
    }
  }

  if (buildingUsable(work)) {
    let workScore =
      (isWorkTime ? 44 : 4) +
      Math.max(0, 55 - resident.wealth) * 0.18 +
      traits.conscientiousness * 0.22 +
      (resident.goals.some((goal) => goal.status === "active" && goal.title.includes("企业")) ? 6 : 0) -
      (resident.needs.energy < 22 ? 34 : 0) -
      (resident.health < 30 ? 30 : 0);
    if (isRestTime) workScore -= 30;
    add(
      {
        action: "work",
        label: "工作",
        reason: isWorkTime
          ? `${reasonAge(hour)}，该去${work.name}处理今天的工作了。`
          : "即使不是班次时间，也想再赚一些信用点。",
        source: "local",
        targetBuildingId: work.id,
      },
      workScore,
    );
  }

  if (isRestTime && home && buildingUsable(home) && resident.insideBuildingId !== home.id) {
    add(
      {
        action: "go_home",
        label: "回家",
        reason: "夜已经深了，回住处比继续待在外面更安全。",
        source: "local",
        targetBuildingId: home.id,
      },
      20 + (resident.needs.safety < 50 ? 15 : 0),
    );
  }

  if (resident.needs.social < 68 && !isRestTime) {
    const socialTarget = pickSocialTarget(world, resident, others, "talk");
    if (socialTarget) {
      add(
        {
          action: "talk",
          label: "交谈",
          reason: `想找个人说说话，最后想到了${socialTarget.name}。`,
          source: "local",
          targetResidentId: socialTarget.id,
        },
        (80 - resident.needs.social) * 0.7 +
          traits.extraversion * 0.24 +
          (resident.relationships[socialTarget.id]?.affinity ?? 0) * 0.08,
      );
    }
    if (traits.extraversion > 44 || resident.needs.social < 32) {
      const friendTarget = pickSocialTarget(world, resident, others, "befriend");
      if (friendTarget) {
        add(
          {
            action: "befriend",
            label: "结交",
            reason: `想更了解${friendTarget.name}，也许能成为朋友。`,
            source: "local",
            targetResidentId: friendTarget.id,
          },
          9 + traits.extraversion * 0.2 + (80 - resident.needs.social) * 0.2,
        );
      }
    }
  }

  const helpTarget = pickSocialTarget(world, resident, others, "seek_help");
  if (
    helpTarget &&
    (resident.wealth < 20 || resident.needs.hunger > 67 || resident.health < 55)
  ) {
    add(
      {
        action: "seek_help",
        label: "求助",
        reason: `手头已经撑不住了，${helpTarget.name}也许是愿意帮忙的人。`,
        source: "local",
        targetResidentId: helpTarget.id,
      },
      18 + (resident.wealth < 10 ? 18 : 0) + (resident.needs.hunger > 67 ? 14 : 0),
    );
  }

  if (!isRestTime) {
    const dateTarget = pickSocialTarget(world, resident, others, "date");
    if (dateTarget && targetIsSingle(world, resident) && targetIsSingle(world, dateTarget)) {
      const actorView = resident.relationships[dateTarget.id];
      const targetView = dateTarget.relationships[resident.id];
      if (
        actorView &&
        targetView &&
        actorView.attraction >= 16 &&
        targetView.attraction >= 10 &&
        actorView.type !== "family"
      ) {
        add(
          {
            action: "date",
            label: "约会",
            reason: `最近总会想起${dateTarget.name}，想和TA单独待一会儿。`,
            source: "local",
            targetResidentId: dateTarget.id,
          },
          8 + actorView.attraction * 0.35 + traits.openness * 0.08,
        );
      }
    }
  }

  if (resident.stress > 48 || (traits.agreeableness < 45 && resident.stress > 38)) {
    const argueTarget = pickSocialTarget(world, resident, others, "argue");
    if (argueTarget) {
      const view = resident.relationships[argueTarget.id];
      if (view && (view.hostility > 8 || view.affinity < -10)) {
        add(
          {
            action: "argue",
            label: "争执",
            reason: `积压的不满已经压不住了，${argueTarget.name}必须给个说法。`,
            source: "local",
            targetResidentId: argueTarget.id,
          },
          6 + view.hostility * 0.5 + resident.stress * 0.12 - traits.agreeableness * 0.16,
        );
      }
    }
  }

  if (!isRestTime && traits.agreeableness > 45) {
    const reconcileTarget = pickSocialTarget(world, resident, others, "reconcile");
    if (reconcileTarget) {
      const view = resident.relationships[reconcileTarget.id];
      if (
        view &&
        (view.hostility > 8 || view.type === "rival" || view.type === "ex_partner")
      ) {
        add(
          {
            action: "reconcile",
            label: "和解",
            reason: `不想再和${reconcileTarget.name}这样僵着了。`,
            source: "local",
            targetResidentId: reconcileTarget.id,
          },
          7 + view.hostility * 0.28 + traits.agreeableness * 0.14,
        );
      }
    }
  }

  if (!isRestTime && traits.agreeableness > 38) {
    const cooperateTarget = pickSocialTarget(world, resident, others, "cooperate");
    if (cooperateTarget) {
      const view = resident.relationships[cooperateTarget.id];
      if (view && view.trust > 32) {
        add(
          {
            action: "cooperate",
            label: "合作",
            reason: `和${cooperateTarget.name}一起做事比单打独斗更靠谱。`,
            source: "local",
            targetResidentId: cooperateTarget.id,
          },
          5 + view.trust * 0.18 + traits.agreeableness * 0.06,
        );
      }
    }
  }

  if (resident.secrets.length > 0 && resident.stress > 56) {
    const concealTarget = pickSocialTarget(world, resident, others, "conceal");
    if (concealTarget) {
      add(
        {
          action: "conceal",
          label: "隐瞒",
          reason: "有些事不能说出口，哪怕对眼前这个人也不行。",
          source: "local",
          targetResidentId: concealTarget.id,
        },
        3 + resident.stress * 0.08 + traits.conscientiousness * 0.03,
      );
    }
  }

  if (
    traits.agreeableness < 48 &&
    resident.stress > 54 &&
    resident.wealth < 90 &&
    traits.openness > 35
  ) {
    const betrayTarget = pickSocialTarget(world, resident, others, "betray");
    if (betrayTarget) {
      const view = resident.relationships[betrayTarget.id];
      if (view && view.trust > 28) {
        add(
          {
            action: "betray",
            label: "背叛",
            reason: "活不下去了。眼前这个人的信任，是唯一能换钱的东西。",
            source: "local",
            targetResidentId: betrayTarget.id,
          },
          1.5 + resident.stress * 0.035 + (100 - resident.wealth) * 0.012,
        );
      }
    }
  }

  if (!isRestTime && (resident.needs.energy > 28 || traits.openness > 65)) {
    const wanderBuilding = chooseBuildingForAction(world, resident, "wander");
    if (wanderBuilding) {
      const weatherPenalty =
        world.weather.condition === "acid_rain" || world.weather.condition === "storm"
          ? 9
          : world.weather.condition === "rain"
            ? 4
            : 0;
      add(
        {
          action: "wander",
          label: "闲逛",
          reason: "暂时没什么必须做的事，想在街上走一走。",
          source: "local",
          targetBuildingId: wanderBuilding.id,
        },
        5 + traits.openness * 0.18 + (isWorkTime ? 0 : 7) - weatherPenalty,
      );
    }
  }

  if (!isRestTime && resident.needs.energy > 36) {
    const studyBuilding = chooseBuildingForAction(world, resident, "study");
    const longGoal = resident.goals.find(
      (goal) => goal.kind === "long" && goal.status === "active",
    );
    if (studyBuilding && longGoal) {
      add(
        {
          action: "study",
          label: "学习",
          reason: `为了“${longGoal.title}”，需要再提升一点本事。`,
          source: "local",
          targetBuildingId: studyBuilding.id,
        },
        4 + traits.openness * 0.12 + traits.conscientiousness * 0.08 + (isRestTime ? -15 : 0),
      );
    }
  }

  if (resident.needs.hunger < 30 && resident.needs.energy > 45 && home && buildingUsable(home)) {
    if (isRestTime) {
      add(
        {
          action: "go_home",
          label: "回家",
          reason: "该回家了，明天还有很长的一天。",
          source: "local",
          targetBuildingId: home.id,
        },
        16,
      );
    }
  }

  if (candidates.length === 0) {
    const homeFallback = home && buildingUsable(home) ? home : null;
    const fallbackBuilding =
      homeFallback ??
      nearestBuilding(world, resident, (building) => building.type === "public" && buildingUsable(building));
    return {
      action: fallbackBuilding ? "wander" : "rest",
      label: fallbackBuilding ? "闲逛" : "原地休息",
      reason: "今天没有特别想做的事，就顺着街区走走。",
      source: "local",
      ...(fallbackBuilding ? { targetBuildingId: fallbackBuilding.id } : { destination: resident.position }),
    };
  }

  // Weighted choice gives residents agency while keeping low-value options possible.
  const chosen = weightedPick(candidates, rng);
  if (chosen) {
    const { score: _score, ...intent } = chosen;
    return intent;
  }
  return null;
}

function weightedPick<T extends { score: number }>(items: T[], rng: Rng): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + Math.max(0, item.score), 0);
  if (total <= 0) return rng.pick(items);
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, item.score);
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}

function pickSocialTarget(
  world: WorldState,
  resident: Resident,
  others: Resident[],
  action: ActionId,
): Resident | null {
  const candidates = others.filter((candidate) => candidate.alive);
  if (candidates.length === 0) return null;
  const actor = resident;
  const scored = candidates
    .map((candidate) => {
      const view = actor.relationships[candidate.id];
      const reverse = candidate.relationships[actor.id];
      const outdoors = candidate.insideBuildingId === null;
      let score = 0;
      switch (action) {
        case "talk":
          score =
            (view?.familiarity ?? 0) * 0.2 +
            (view?.affinity ?? 0) * 0.4 +
            (view?.trust ?? 0) * 0.25 -
            (view?.hostility ?? 0) * 0.5 +
            (outdoors ? 6 : 1);
          if ((view?.hostility ?? 0) > 40) score -= 30;
          break;
        case "befriend":
          score =
            (view?.familiarity ?? 0) * 0.1 -
            (view?.hostility ?? 0) * 0.8 +
            (reverse?.affinity ?? 0) * 0.1 +
            (outdoors ? 4 : 0);
          if (view && ["friend", "close_friend", "rival", "enemy"].includes(view.type)) score -= 15;
          break;
        case "seek_help":
          score =
            (reverse?.trust ?? 0) * 0.5 +
            (reverse?.affinity ?? 0) * 0.3 +
            (candidate.wealth / 20) +
            (outdoors ? 3 : 0);
          if ((view?.hostility ?? 0) > 20) score -= 20;
          break;
        case "date": {
          const mutual = (view?.attraction ?? 0) * 0.6 + (reverse?.attraction ?? 0) * 0.4;
          score = mutual + (view?.affinity ?? 0) * 0.15;
          if (!view || view.type === "partner" || view.type === "family") score -= 100;
          if (!targetIsSingle(world, candidate)) score -= 80;
          break;
        }
        case "argue":
          score =
            (view?.hostility ?? 0) * 0.7 +
            (view?.familiarity ?? 0) * 0.1 +
            (outdoors ? 3 : 0);
          break;
        case "reconcile":
          score =
            (view?.hostility ?? 0) * 0.5 +
            (view?.affinity ?? 0) * 0.3 +
            (reverse?.affinity ?? 0) * 0.2;
          break;
        case "cooperate":
          score =
            (view?.trust ?? 0) * 0.4 +
            (view?.affinity ?? 0) * 0.2 +
            (outdoors ? 4 : 0);
          break;
        case "conceal":
          score = (view?.familiarity ?? 0) * 0.2 + (outdoors ? 3 : 0);
          break;
        case "betray":
          score =
            (view?.trust ?? 0) * 0.35 +
            (candidate.wealth / 12) -
            (reverse?.trust ?? 0) * 0.15;
          break;
        default:
          score = 0;
      }
      return { candidate, score: score + 0.001 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.candidate ?? null;
}

function consumeAiHint(world: WorldState, resident: Resident, _rng: Rng): Intent | null {
  const hint = resident.aiHint;
  if (!hint) return null;
  if (world.clock.tick > hint.expiresTick) {
    resident.aiHint = null;
    return null;
  }
  resident.aiHint = null;

  if (!resident.aiHint && hint) {
    // Hint is consumed once; the action still has to pass all engine checks.
  }

  const intent: Intent = {
    action: hint.action,
    label: ACTION_META[hint.action].label,
    reason: `AI 顾问建议：${hint.reason}`,
    source: "ai",
  };
  if (hint.targetKind === "resident" && hint.targetId) {
    const target = getResident(world, hint.targetId);
    if (!target || !target.alive || target.id === resident.id) {
      addEvent(world, {
        type: "warn",
        title: `${resident.name}的 AI 建议被丢弃`,
        description: "提案目标不存在或已离开，引擎回退到本地决策。",
        actorId: resident.id,
        source: "ai",
        importance: 3,
        tag: "AI REJECTED",
      });
      return null;
    }
    intent.targetResidentId = target.id;
    return intent;
  }
  if (hint.targetKind === "building" && hint.targetId) {
    const building = getBuilding(world, hint.targetId);
    if (!building) {
      addEvent(world, {
        type: "warn",
        title: `${resident.name}的 AI 建议被丢弃`,
        description: "提案中的建筑不存在，引擎回退到本地决策。",
        actorId: resident.id,
        source: "ai",
        importance: 3,
        tag: "AI REJECTED",
      });
      return null;
    }
    intent.targetBuildingId = building.id;
    return intent;
  }

  // No target supplied: derive a safe default for local targetless actions.
  switch (hint.action) {
    case "work":
    case "rest":
    case "eat":
    case "shop":
    case "go_home":
    case "wander":
    case "heal":
    case "study": {
      const building = chooseBuildingForAction(world, resident, hint.action);
      if (!building) {
        addEvent(world, {
          type: "warn",
          title: `${resident.name}的 AI 建议无法执行`,
          description: "当前没有满足条件的建筑，引擎回退到本地决策。",
          actorId: resident.id,
          source: "ai",
          importance: 2,
          tag: "AI REJECTED",
        });
        return null;
      }
      intent.targetBuildingId = building.id;
      return intent;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Goals                                                              */
/* ------------------------------------------------------------------ */

function ensureShortTermGoals(world: WorldState, resident: Resident): void {
  const activeShort = resident.goals.filter(
    (goal) => goal.kind === "short" && goal.status === "active",
  );
  if (activeShort.length >= 3) return;

  const candidates: Array<{ title: string; description: string; priority: number; deadlineDay: number }> = [];
  if (resident.needs.hunger > 68) {
    candidates.push({
      title: "找点吃的",
      description: "饥饿正在影响判断力，先解决今天的一顿饭。",
      priority: 8,
      deadlineDay: world.clock.day + 2,
    });
  }
  if (resident.wealth < 12) {
    candidates.push({
      title: "赚些信用点",
      description: "钱包已经见底，需要尽快找到收入。",
      priority: 8,
      deadlineDay: world.clock.day + 3,
    });
  }
  if (resident.needs.social < 30) {
    candidates.push({
      title: "找人聊一聊",
      description: "太久没有和任何人说话，孤独感在累积。",
      priority: 5,
      deadlineDay: world.clock.day + 2,
    });
  }
  if (resident.health < 45) {
    candidates.push({
      title: "去医院检查",
      description: "身体状况需要专业的帮助。",
      priority: 7,
      deadlineDay: world.clock.day + 2,
    });
  }
  for (const candidate of candidates) {
    if (activeShort.length >= 3) break;
    if (resident.goals.some((goal) => goal.title === candidate.title && goal.status === "active")) {
      continue;
    }
    addGoal(resident, world, {
      kind: "short",
      title: candidate.title,
      description: candidate.description,
      priority: candidate.priority,
      deadlineDay: candidate.deadlineDay,
      source: "need",
    });
  }
}

function completionShortGoal(world: WorldState, resident: Resident, keyword: string): void {
  for (const goal of resident.goals) {
    if (goal.kind === "short" && goal.status === "active" && goal.title.includes(keyword)) {
      goal.status = "completed";
      goal.progress = 100;
      addEvent(world, {
        type: "info",
        title: `${resident.name}完成了短期目标`,
        description: `“${goal.title}”已经完成。`,
        actorId: resident.id,
        source: "local",
        importance: 2,
        tag: "GOAL",
      });
    }
  }
}

function progressGoals(
  world: WorldState,
  resident: Resident,
  action: ActionId,
  targetResident?: Resident,
  targetBuilding?: Building,
): void {
  for (const goal of resident.goals) {
    if (goal.status !== "active") continue;
    let gain = 0;
    if (
      (action === "work" || action === "study") &&
      (goal.kind === "long" || goal.title.includes("信用点") || goal.title.includes("工作"))
    ) {
      gain += 1.5 + (resident.personality.traits.conscientiousness / 50);
    }
    if (
      ["talk", "befriend", "date", "reconcile", "cooperate", "seek_help"].includes(action) &&
      (goal.kind === "short" || goal.title.includes("朋友") || goal.title.includes("关系"))
    ) {
      gain += 1;
    }
    if (targetBuilding && goal.relatedBuildingId === targetBuilding.id) gain += 1;
    if (targetResident && goal.relatedResidentId === targetResident.id) gain += 1;
    if (gain <= 0) continue;
    goal.progress = clamp(goal.progress + gain, 0, 100);
    if (goal.progress >= 100) {
      goal.status = "completed";
      addLifeEvent(world, resident, "milestone", "目标达成", goal.title);
      addEvent(world, {
        type: "info",
        title: `${resident.name}实现了目标`,
        description: `长期目标“${goal.title}”已经达成。`,
        actorId: resident.id,
        source: "local",
        importance: 4,
        tag: "GOAL",
      });
      recordMemory(world, resident, {
        text: `终于实现了目标：${goal.title}。`,
        kind: "life",
        importance: 8,
        valence: 0.9,
      });
    }
  }
  // Goal conditions that are directly observable in state can complete early.
  for (const goal of resident.goals) {
    if (goal.status !== "active" || goal.kind !== "short") continue;
    if (goal.title.includes("吃") && resident.needs.hunger < 42) {
      goal.status = "completed";
      goal.progress = 100;
    } else if (goal.title.includes("聊") && resident.needs.social > 58) {
      goal.status = "completed";
      goal.progress = 100;
    } else if (goal.title.includes("医院") && resident.health > 65) {
      goal.status = "completed";
      goal.progress = 100;
    } else if (goal.title.includes("信用点") && resident.wealth > 80) {
      goal.status = "completed";
      goal.progress = 100;
    }
  }
}

function reviewGoals(world: WorldState, resident: Resident, rng: Rng): void {
  for (const goal of resident.goals) {
    if (goal.status !== "active" || !goal.deadlineDay) continue;
    if (goal.deadlineDay >= world.clock.day) continue;
    if (goal.kind === "short") {
      goal.status = "abandoned";
      recordMemory(world, resident, {
        text: `没有在期限内完成“${goal.title}”，只好放弃。`,
        kind: "observation",
        importance: 3,
        valence: -0.5,
      });
      continue;
    }
    goal.status = "blocked";
    recordMemory(world, resident, {
      text: `“${goal.title}”被现实挡住了，需要换一种方式。`,
      kind: "life",
      importance: 6,
      valence: -0.6,
    });
    addLifeEvent(world, resident, "milestone", "目标受阻", goal.title);
    addEvent(world, {
      type: "info",
      title: `${resident.name}的目标受阻`,
      description: `“${goal.title}”未能在期限内推进，居民开始寻找新的策略。`,
      actorId: resident.id,
      source: "local",
      importance: 3,
      tag: "GOAL",
    });
    // Residents adapt: replace a blocked long-term goal with a plausible short-term plan.
    const alternative = rng.pick([
      { title: "寻找新的收入来源", description: "原来的计划行不通了，先保证生存。" },
      { title: "向信任的人寻求建议", description: "也许别人能看到自己没看到的路。" },
      { title: "降低目标，先稳住现在", description: "不是放弃，而是换一种更现实的节奏。" },
    ]);
    addGoal(resident, world, {
      kind: "short",
      title: alternative.title,
      description: alternative.description,
      priority: 6,
      deadlineDay: world.clock.day + 5,
      source: "event",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Weather, metrics, daily upkeep, factions, lifecycle                */
/* ------------------------------------------------------------------ */

function updateWeather(world: WorldState, rng: Rng): void {
  if (world.clock.tick < world.weather.untilTick) return;
  const current = world.weather.condition;
  const pool = [
    { value: "clear" as const, weight: 24 },
    { value: "rain" as const, weight: 26 },
    { value: "acid_rain" as const, weight: 19 },
    { value: "smog" as const, weight: 15 },
    { value: "heatwave" as const, weight: 8 },
    { value: "storm" as const, weight: 8 },
  ].filter((entry) => entry.value !== current);
  const next = rng.weighted(pool);
  const intensity =
    next === "clear" ? 0.1 : next === "storm" || next === "acid_rain" ? rng.float(0.4, 0.9) : rng.float(0.2, 0.7);
  world.weather = { condition: next, intensity, untilTick: world.clock.tick + rng.int(4, 10) };
  const labels = {
    clear: "云层散开",
    rain: "降雨",
    acid_rain: "酸雨",
    smog: "雾霾",
    heatwave: "热浪",
    storm: "电磁风暴",
  };
  addEvent(world, {
    type: next === "acid_rain" || next === "storm" ? "warn" : "info",
    title: `天气变化：${labels[next]}`,
    description:
      next === "acid_rain"
        ? "酸性降水开始腐蚀户外设备，居民的健康与安全感缓慢下降。"
        : next === "storm"
          ? "电磁风暴干扰了城市电网，户外行动变得更加危险。"
          : next === "smog"
            ? "污染颗粒笼罩街区，能见度与呼吸质量下降。"
            : next === "heatwave"
              ? "热浪让城市能源需求上升，户外工作变得更难熬。"
              : next === "clear"
                ? "空气短暂变得清澈，霓虹灯在干净的天空下显得锐利。"
                : "雨水冲刷着街道，居民更倾向留在室内。",
    source: "world",
    importance: 2,
    tag: "WEATHER",
  });
}

function applyWeatherAndEnvironment(world: WorldState, rng: Rng): void {
  const weather = world.weather.condition;
  const intensity = world.weather.intensity;
  const operationalEmissions = world.buildings
    .filter((building) => building.operational && building.condition > 0)
    .reduce((sum, building) => sum + building.emissions, 0);
  const pollutionDelta =
    operationalEmissions * 0.006 +
    (weather === "smog" ? 0.5 + intensity * 0.45 : 0) +
    (weather === "storm" ? 0.1 : 0) -
    world.rules.pollutionDecay * 0.09;
  world.metrics.pollution = clamp(world.metrics.pollution + pollutionDelta, 0, 100);

  if (weather === "heatwave" || weather === "storm") {
    for (const building of world.buildings) {
      if (building.type === "utility" || building.type === "workplace") {
        building.inventory.energy = Math.max(0, building.inventory.energy - (weather === "storm" ? 2 : 1));
      }
    }
  }

  if (weather === "storm" && rng.chance(0.012)) {
    const vulnerable = world.buildings.filter(
      (building) => building.operational && building.type !== "residential",
    );
    if (vulnerable.length > 0) {
      const damaged = rng.pick(vulnerable);
      damaged.condition = clamp(damaged.condition - rng.int(3, 9), 0, 100);
      if (damaged.condition < 15) damaged.operational = false;
      addEvent(world, {
        type: "warn",
        title: `电磁风暴损坏了${damaged.name}`,
        description: `建筑状况下降到 ${Math.round(damaged.condition)}，可能需要修复。`,
        source: "world",
        importance: 3,
        tag: "INFRASTRUCTURE",
      });
    }
  }
}

function driftPublicMetrics(world: WorldState): void {
  const baseline = trustBaseline(world);
  world.metrics.trust = clamp(
    world.metrics.trust + (baseline - world.metrics.trust) * 0.015,
    0,
    100,
  );
  const alive = aliveResidents(world);
  if (alive.length > 0) {
    const avgStress = alive.reduce((sum, resident) => sum + resident.stress, 0) / alive.length;
    if (avgStress > 70 && world.metrics.stability < 40) {
      world.metrics.trust = clamp(world.metrics.trust - 0.12, 0, 100);
    }
  }
  world.metrics.pollution = clamp(world.metrics.pollution, 0, 100);
}

function processNewDay(world: WorldState, rng: Rng): void {
  const alive = aliveResidents(world);
  const population = alive.length;
  const day = world.clock.day;

  // Resource production and consumption are deterministic, not AI-generated.
  const operationalUtilities = world.buildings.filter(
    (building) =>
      building.type === "utility" && building.operational && building.condition > 0,
  );
  const operationalMedical = world.buildings.filter(
    (building) => building.type === "medical" && building.operational,
  );
  const operationalShops = world.buildings.filter(
    (building) => building.type === "shop" && building.operational,
  );
  const utilityProduction = operationalUtilities.reduce(
    (sum, building) => sum + 14 * (building.condition / 100),
    0,
  );
  const medsProduction = operationalMedical.length * 1.2;
  const foodProduction = operationalShops.length * 1.4;
  world.reserves.energy += Math.round((6 + utilityProduction) * world.rules.resourceRegen);
  world.reserves.food += Math.round((4 + foodProduction) * world.rules.resourceRegen);
  world.reserves.meds += Math.round((2 + medsProduction) * world.rules.resourceRegen);

  const foodNeed = Math.round(population * 0.55 * world.rules.foodConsumption);
  const energyNeed = Math.round(population * 1.15);
  if (world.reserves.food >= foodNeed) {
    world.reserves.food -= foodNeed;
  } else {
    world.reserves.food = 0;
    for (const resident of alive) {
      resident.needs.hunger = clamp(resident.needs.hunger + 13, 0, 100);
      resident.mood = clamp(resident.mood - 4, 0, 100);
    }
    addEvent(world, {
      type: "danger",
      title: "公共食物储备见底",
      description: "配给系统无法覆盖今天的消耗，居民的饥饿感正在上升。",
      source: "world",
      importance: 6,
      tag: "SHORTAGE",
    });
  }
  if (world.reserves.energy >= energyNeed) {
    world.reserves.energy -= energyNeed;
  } else {
    world.reserves.energy = 0;
    for (const resident of alive) {
      resident.needs.safety = clamp(resident.needs.safety - 5, 0, 100);
      resident.stress = clamp(resident.stress + 3, 0, 100);
    }
    addEvent(world, {
      type: "warn",
      title: "能源配给不足",
      description: "夜间限电开始影响居民，安全感与压力指标恶化。",
      source: "world",
      importance: 4,
      tag: "ENERGY",
    });
  }

  // Shops restock from the shared supply chain.
  for (const shop of operationalShops) {
    const restockFood = Math.min(7, Math.floor(world.reserves.food * 0.04));
    const restockMeds = Math.min(2, Math.floor(world.reserves.meds * 0.02));
    if (restockFood > 0) {
      shop.inventory.food += restockFood;
      world.reserves.food -= restockFood;
    }
    if (restockMeds > 0) {
      shop.inventory.meds += restockMeds;
      world.reserves.meds -= restockMeds;
    }
  }

  // Taxes and welfare are applied to real balances.
  const taxableIncome = world.buildings.reduce((sum, building) => sum + building.income, 0);
  const tax = Math.round(taxableIncome * world.rules.taxRate);
  if (tax > 0) {
    world.reserves.credits += tax;
  }
  for (const building of world.buildings) {
    building.income = 0;
    building.expenses = 0;
  }
  const welfareSpend = Math.round((world.rules.welfare / 100) * 26);
  if (welfareSpend > 0 && world.reserves.credits >= welfareSpend) {
    const poorest = [...alive].sort((a, b) => a.wealth - b.wealth).slice(0, 5);
    const share = Math.max(1, Math.floor(welfareSpend / Math.max(1, poorest.length)));
    for (const resident of poorest) {
      resident.wealth += share;
      resident.needs.safety = clamp(resident.needs.safety + 1.5, 0, 100);
    }
    world.reserves.credits -= share * poorest.length;
  }

  // Maintenance: buildings decay, owners sometimes repair them.
  for (const building of world.buildings) {
    const decay = 0.1 + building.emissions * 0.025 + (world.weather.condition === "acid_rain" ? 0.15 : 0);
    building.condition = clamp(building.condition - decay, 0, 100);
    if (building.condition <= 0) building.operational = false;
    if (building.condition < 50) {
      const owner = world.factions.find((faction) => faction.id === building.ownerFactionId);
      if (owner && owner.funds > 450 && world.clock.tick % 2 === 0) {
        const repairCost = Math.round((70 - building.condition) * 4);
        if (owner.funds >= repairCost) {
          owner.funds -= repairCost;
          building.condition = clamp(building.condition + 18, 0, 100);
          building.operational = true;
          addEvent(world, {
            type: "economy",
            title: `${owner.name}修缮了${building.name}`,
            description: `投入 ${repairCost} 资金，建筑状况恢复到 ${Math.round(building.condition)}。`,
            source: "faction",
            importance: 2,
            tag: "INFRASTRUCTURE",
          });
        }
      }
    }
    if (building.type === "residential") {
      const residentsHere = alive.filter((resident) => resident.homeBuildingId === building.id);
      if (!building.operational) {
        for (const resident of residentsHere) {
          resident.needs.safety = clamp(resident.needs.safety - 6, 0, 100);
          resident.stress = clamp(resident.stress + 5, 0, 100);
        }
      }
    }
  }

  // Residents age slowly; only elderly or extremely unhealthy residents die naturally.
  for (const resident of alive) {
    resident.age += 1 / 365;
    const lifespan = HEALTHY.deathBaseAge * world.rules.lifespanModifier;
    if (resident.age > lifespan - 12 && rng.chance(0.002)) {
      killResident(world, resident, "自然衰老", rng);
      continue;
    }
    if (resident.needs.hunger >= 92 && resident.health < 34 && rng.chance(0.035)) {
      killResident(world, resident, "长期饥饿导致器官衰竭", rng);
      continue;
    }
    if (resident.health <= 0) {
      killResident(world, resident, "健康状况崩溃", rng);
      continue;
    }
    reviewGoals(world, resident, rng);
  }

  // Faction funds grow or shrink with their base of operations.
  for (const faction of world.factions) {
    const memberCount = alive.filter((resident) => resident.factionId === faction.id).length;
    if (faction.kind === "corporation") {
      faction.funds += 120 + memberCount * 8;
      faction.influence += 0.4;
    } else if (faction.kind === "community") {
      faction.funds += 20 + memberCount * 4;
      faction.influence += 0.2;
    } else {
      faction.funds += 45 + memberCount * 5;
      faction.influence += 0.3;
    }
    faction.influence = clamp(faction.influence, 0, 100);
    faction.funds = Math.max(0, faction.funds);
  }

  // Weather is re-rolled by updateWeather when this day's forecast expires.
  if (world.weather.untilTick < world.clock.tick) {
    world.weather.untilTick = world.clock.tick + 8;
  }
  addEvent(world, {
    type: "system",
    title: `第 ${day} 天开始`,
    description: `人口 ${population}，公共储备：食物 ${Math.round(world.reserves.food)} / 能源 ${Math.round(world.reserves.energy)} / 医疗 ${Math.round(world.reserves.meds)}。`,
    source: "system",
    importance: 1,
    tag: "DAY",
  });
  recordHistory(world);
}

function processFactions(world: WorldState, rng: Rng): void {
  if (!world.rules.factionsActive) return;
  for (const faction of world.factions) {
    if (world.clock.tick - faction.lastActionTick < 12) continue;
    faction.lastActionTick = world.clock.tick;
    const aliveMembers = world.residents.filter(
      (resident) => resident.alive && resident.factionId === faction.id,
    );
    faction.memberIds = aliveMembers.map((resident) => resident.id);
    if (faction.influence <= 3) {
      addEvent(world, {
        type: "warn",
        title: `${faction.name}正在衰落`,
        description: "影响力几乎耗尽，成员开始寻找其他依靠。",
        source: "faction",
        importance: 5,
        tag: "FACTION",
      });
      continue;
    }

    switch (faction.kind) {
      case "corporation": {
        const ownedWorkplaces = world.buildings.filter(
          (building) => building.ownerFactionId === faction.id && building.operational,
        );
        if (faction.funds > 700) {
          faction.funds -= 260;
          faction.influence = clamp(faction.influence + 0.8, 0, 100);
          const target = ownedWorkplaces[0];
          if (target) {
            target.condition = clamp(target.condition + 4, 0, 100);
            target.inventory.energy += 18;
          }
          world.reserves.energy += 8;
          world.metrics.pollution = clamp(world.metrics.pollution + 0.8, 0, 100);
          addEvent(world, {
            type: "faction",
            title: `${faction.name}扩建能源节点`,
            description: `投入 260 资金用于设备升级，城市获得 8 单位额外能源，污染随之上升。`,
            source: "faction",
            importance: 3,
            tag: "FACTION",
          });
        } else {
          faction.influence = clamp(faction.influence - 0.6, 0, 100);
          for (const member of aliveMembers) {
            member.stress = clamp(member.stress + 2, 0, 100);
          }
          addEvent(world, {
            type: "warn",
            title: `${faction.name}削减预算`,
            description: "企业资金紧张，员工福利与基础设施维护被推迟。",
            source: "faction",
            importance: 3,
            tag: "FACTION",
          });
        }
        // Competition with the underground network.
        const voidFaction = world.factions.find((candidate) => candidate.kind === "underground");
        if (voidFaction) {
          const relation = faction.relations[voidFaction.id];
          if (relation) {
            relation.hostility = clamp(relation.hostility + 1, 0, 100);
            relation.affinity = clamp(relation.affinity - 0.8, -100, 100);
            relation.status = relation.hostility > 45 ? "hostile" : "competing";
          }
        }
        break;
      }
      case "community": {
        const poorest = [...aliveMembers].sort((a, b) => a.wealth - b.wealth).slice(0, 2);
        const foodAvailable = Math.min(8, Math.floor(faction.resources.food));
        if (foodAvailable > 0) {
          faction.resources.food -= foodAvailable;
          for (const [index, member] of poorest.entries()) {
            const home = world.buildings.find((building) => building.id === member.homeBuildingId);
            if (home) home.inventory.food += index === 0 ? foodAvailable : 1;
            member.needs.hunger = clamp(member.needs.hunger - 5, 0, 100);
          }
          world.metrics.trust = clamp(world.metrics.trust + 0.8, 0, 100);
          addEvent(world, {
            type: "faction",
            title: `${faction.name}发放互助配给`,
            description: `向最需要帮助的居民分配了 ${foodAvailable} 单位食物。`,
            source: "faction",
            importance: 3,
            tag: "FACTION",
          });
        } else {
          faction.resources.food += 10;
          faction.funds += 50;
          addEvent(world, {
            type: "info",
            title: `${faction.name}发起新一轮募捐`,
            description: "社区网络筹集了少量食物与资金，等待下一次分配。",
            source: "faction",
            importance: 2,
            tag: "FACTION",
          });
        }
        const candidates = world.residents.filter(
          (resident) =>
            resident.alive &&
            resident.factionId !== faction.id &&
            resident.personality.traits.agreeableness > 60 &&
            (resident.relationships[faction.leaderId]?.affinity ?? 0) > 20,
        );
        if (candidates.length > 0 && rng.chance(0.2)) {
          const recruit = rng.pick(candidates);
          recruit.factionId = faction.id;
          faction.memberIds.push(recruit.id);
          addEvent(world, {
            type: "social",
            title: `${recruit.name}加入了${faction.name}`,
            description: "共同的社区经历让居民选择了新的归属。",
            actorId: recruit.id,
            source: "faction",
            importance: 4,
            tag: "RECRUIT",
          });
        }
        break;
      }
      case "underground": {
        if (faction.funds > 300) {
          faction.funds -= 90;
          faction.influence = clamp(faction.influence + 1.1, 0, 100);
          const target = rng.pick([
            ...world.residents.filter((resident) => resident.alive && resident.factionId === faction.id),
            ...world.residents.filter((resident) => resident.alive && resident.factionId !== faction.id),
          ]);
          if (target) {
            target.wealth += 12;
            target.stress = clamp(target.stress + 2, 0, 100);
          }
          world.metrics.trust = clamp(world.metrics.trust - 0.4, 0, 100);
          addEvent(world, {
            type: "faction",
            title: `${faction.name}进行了一次信息操作`,
            description: "一条未经证实的消息流入街区。有人得到了报酬，也有人开始怀疑身边的人。",
            source: "faction",
            importance: 3,
            tag: "INTEL",
          });
          const corp = world.factions.find((candidate) => candidate.kind === "corporation");
          if (corp) {
            const relation = faction.relations[corp.id];
            if (relation) relation.hostility = clamp(relation.hostility + 0.7, 0, 100);
          }
        } else {
          faction.influence = clamp(faction.influence - 0.4, 0, 100);
          addEvent(world, {
            type: "warn",
            title: `${faction.name}的资金链收紧`,
            description: "地下组织暂时无法支付线人，情报网络开始变得迟缓。",
            source: "faction",
            importance: 2,
            tag: "FACTION",
          });
        }
        break;
      }
    }
  }
}

function recordHistory(world: WorldState): void {
  world.history.push({
    tick: world.clock.tick,
    day: world.clock.day,
    minuteOfDay: world.clock.minuteOfDay,
    metrics: { ...world.metrics },
    reserves: { ...world.reserves },
    population: world.residents.filter((resident) => resident.alive).length,
  });
  if (world.history.length > MAX_HISTORY) {
    world.history = world.history.slice(-MAX_HISTORY);
  }
}

function killResident(
  world: WorldState,
  resident: Resident,
  cause: string,
  rng: Rng,
): void {
  if (!resident.alive) return;
  resident.alive = false;
  resident.diedDay = world.clock.day;
  resident.deathCause = cause;
  resident.currentAction = null;
  resident.insideBuildingId = null;
  for (const other of world.residents) {
    if (!other.alive || other.id === resident.id) continue;
    if (
      other.currentAction &&
      (other.currentAction.targetResidentId === resident.id ||
        other.currentAction.targetId === resident.id)
    ) {
      other.currentAction = null;
    }
    if (other.aiHint?.targetId === resident.id) other.aiHint = null;
  }
  addLifeEvent(world, resident, "death", "死亡", cause);
  addEvent(world, {
    type: "danger",
    title: `${resident.name}离开了这个世界`,
    description: `${cause}。第 ${world.clock.day} 天，${resident.name}的生命体征停止。`,
    actorId: resident.id,
    source: "world",
    importance: 9,
    tag: "DEATH",
  });
  const partner = partnerOf(world, resident);
  if (partner && partner.alive) {
    recordMemory(world, partner, {
      text: `${resident.name}离开了。再也没有机会把那些没说完的话说出口。`,
      kind: "trauma",
      importance: 10,
      subjectIds: [resident.id],
      valence: -1,
      source: "experienced",
      reliability: 1,
    });
    partner.mood = clamp(partner.mood - 35, 0, 100);
    partner.stress = clamp(partner.stress + 30, 0, 100);
    partner.wealth += Math.round(resident.wealth * 0.5);
    resident.wealth = Math.round(resident.wealth * 0.5);
  }
  for (const other of world.residents) {
    if (!other.alive || other.id === resident.id) continue;
    const relation = other.relationships[resident.id];
    if (!relation) continue;
    if (
      relation.type === "family" ||
      relation.type === "partner" ||
      relation.type === "close_friend" ||
      relation.familiarity > 45
    ) {
      recordMemory(world, other, {
        text: `${resident.name}去世了。街区的一部分好像也跟着暗了下去。`,
        kind: "trauma",
        importance: 8,
        subjectIds: [resident.id],
        valence: -0.9,
      });
      other.mood = clamp(other.mood - 9, 0, 100);
      other.stress = clamp(other.stress + 8, 0, 100);
    }
  }
  const faction = world.factions.find((candidate) => candidate.id === resident.factionId);
  if (faction) {
    faction.funds += Math.round(resident.wealth * 0.2);
    faction.influence = clamp(faction.influence - 0.5, 0, 100);
    faction.memberIds = faction.memberIds.filter((id) => id !== resident.id);
  }
  world.metrics.trust = clamp(world.metrics.trust - 1.2, 0, 100);
  refreshDerivedMetrics(world);
  if (rng.chance(0.5)) {
    addEvent(world, {
      type: "lifecycle",
      title: "街区为逝者默哀",
      description: `${resident.name}的离开让熟悉TA的人重新想起这座城市里脆弱的东西。`,
      source: "world",
      importance: 5,
      tag: "MEMORIAL",
    });
  }
}

/* ------------------------------------------------------------------ */
/* External AI hint & safe world accessors                             */
/* ------------------------------------------------------------------ */

export function queueAiHint(
  world: WorldState,
  residentId: string,
  hint: AiHintInput,
): { ok: boolean; message: string; event?: GameEvent } {
  const resident = getResident(world, residentId);
  if (!resident || !resident.alive) {
    return { ok: false, message: "居民不存在或已离开世界。" };
  }
  if (!(hint.action in ACTION_META)) {
    return { ok: false, message: "AI 提案包含未知行动。" };
  }
  let targetKind: "resident" | "building" | undefined;
  if (hint.targetId) {
    const targetResident = getResident(world, hint.targetId);
    const targetBuilding = getBuilding(world, hint.targetId);
    if (targetResident) targetKind = "resident";
    else if (targetBuilding) targetKind = "building";
    else return { ok: false, message: "AI 提案目标不存在。" };
    const expectedKind = ACTION_TARGET_KIND[hint.action];
    if (expectedKind && targetKind !== expectedKind) {
      return { ok: false, message: "AI 提案的行动类型与目标类型不匹配。" };
    }
  }
  resident.aiHint = {
    action: hint.action,
    targetId: hint.targetId,
    targetKind,
    reason: hint.reason.slice(0, 160),
    createdTick: world.clock.tick,
    expiresTick: world.clock.tick + 14,
  };
  resident.lastDecisionTick = Math.min(resident.lastDecisionTick, world.clock.tick - 1);
  const event = addEvent(world, {
    type: "ai",
    title: `${resident.name}收到一条 AI 建议`,
    description: `${hint.reason} 建议将进入下一次自主决策，由引擎重新检查全部前置条件。`,
    actorId: resident.id,
    source: "ai",
    importance: 2,
    tag: "AI ADVISOR",
  });
  world.lastAiEventTick = world.clock.tick;
  return { ok: true, message: "AI 建议已登记，等待居民自主评估。", event };
}

export function getAiContextSnapshot(world: WorldState, residentId: string) {
  return {
    resident: getResident(world, residentId) ?? null,
    buildings: world.buildings.map((building) => ({
      id: building.id,
      name: building.name,
      type: building.type,
      operational: building.operational,
      open: building.open,
      inventory: { ...building.inventory },
      condition: building.condition,
    })),
    aliveResidents: aliveResidents(world).map((resident) => ({
      id: resident.id,
      name: resident.name,
      jobTitle: resident.jobTitle,
      insideBuildingId: resident.insideBuildingId,
      alive: resident.alive,
    })),
    clock: { ...world.clock },
    weather: { ...world.weather },
    rules: { ...world.rules },
    metrics: { ...world.metrics },
    reserves: { ...world.reserves },
  };
}

export function safeClampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export function distanceToBuilding(resident: Resident, building: Building): number {
  return distance(resident.position, getBuildingDoor(building));
}

export { computeInequality };
