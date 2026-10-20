import {
  MAX_ACTION_HISTORY,
  MAX_EVENTS,
  MAX_IMPORTANT_MEMORIES,
  MAX_LONG_TERM_SUMMARIES,
  MAX_RECENT_MEMORIES,
} from "../shared/constants";
import type {
  ActionHistoryEntry,
  ActionSource,
  GameEvent,
  GameEventSource,
  GameEventType,
  Goal,
  LifeEvent,
  Memory,
  MemoryKind,
  MemorySource,
  Resident,
  WorldState,
} from "../shared/types";

export interface EventInput {
  type: GameEventType;
  title: string;
  description: string;
  actorId?: string;
  targetIds?: string[];
  source: GameEventSource;
  importance?: number;
  tag?: string;
}

export function addEvent(world: WorldState, input: EventInput): GameEvent {
  const event: GameEvent = {
    id: makeId("evt", world),
    tick: world.clock.tick,
    day: world.clock.day,
    minuteOfDay: world.clock.minuteOfDay,
    type: input.type,
    title: input.title,
    description: input.description,
    actorId: input.actorId,
    targetIds: input.targetIds,
    source: input.source,
    importance: input.importance ?? 2,
    tag: input.tag ?? input.type.toUpperCase(),
  };
  world.events.unshift(event);
  if (world.events.length > MAX_EVENTS) world.events.length = MAX_EVENTS;
  return event;
}

export interface MemoryInput {
  text: string;
  kind: MemoryKind;
  importance?: number;
  subjectIds?: string[];
  valence?: number;
  source?: MemorySource;
  reliability?: number;
}

export function recordMemory(world: WorldState, resident: Resident, input: MemoryInput): Memory {
  const importance = clamp(input.importance ?? 3, 1, 10);
  const memory: Memory = {
    id: makeId("mem", world, resident.id),
    tick: world.clock.tick,
    day: world.clock.day,
    minuteOfDay: world.clock.minuteOfDay,
    kind: input.kind,
    text: input.text.slice(0, 220),
    subjectIds: (input.subjectIds ?? []).slice(0, 6),
    importance,
    valence: clamp(input.valence ?? 0, -1, 1),
    source: input.source ?? "experienced",
    reliability:
      input.reliability ??
      (input.source === "told" ? 0.66 : input.source === "inferred" ? 0.5 : 0.95),
    recalledAtTick: world.clock.tick,
  };

  resident.memories.recent.unshift(memory);
  resident.memories.recent = resident.memories.recent
    .sort((a, b) => b.tick - a.tick || a.id.localeCompare(b.id))
    .slice(0, MAX_RECENT_MEMORIES);

  if (importance >= 6) {
    resident.memories.important.unshift(memory);
    resident.memories.important = resident.memories.important
      .sort((a, b) => b.importance - a.importance || b.tick - a.tick)
      .slice(0, MAX_IMPORTANT_MEMORIES);
  }

  if (importance >= 8) {
    const summary = `第${world.clock.day}天：${memory.text}`;
    if (!resident.memories.longTerm.some((existing) => existing.includes(memory.text.slice(0, 24)))) {
      resident.memories.longTerm.push(summary.slice(0, 120));
      resident.memories.longTerm = resident.memories.longTerm.slice(-MAX_LONG_TERM_SUMMARIES);
    }
  }
  return memory;
}

export function addLifeEvent(
  world: WorldState,
  resident: Resident,
  kind: LifeEvent["kind"],
  title: string,
  description: string,
): LifeEvent {
  const event: LifeEvent = {
    id: makeId("life", world, resident.id),
    tick: world.clock.tick,
    day: world.clock.day,
    title,
    description,
    kind,
  };
  resident.lifeEvents.unshift(event);
  resident.lifeEvents = resident.lifeEvents.slice(0, 60);
  return event;
}

export function pushActionHistory(
  resident: Resident,
  world: WorldState,
  action: ActionHistoryEntry["action"],
  label: string,
  reason: string,
  source: ActionSource,
  outcome: string,
  targetId?: string,
): void {
  resident.history.unshift({
    tick: world.clock.tick,
    day: world.clock.day,
    action,
    label,
    reason,
    source,
    outcome,
    targetId,
  });
  resident.history = resident.history.slice(0, MAX_ACTION_HISTORY);
}

export function addGoal(
  resident: Resident,
  world: WorldState,
  goal: {
    kind: Goal["kind"];
    title: string;
    description: string;
    priority: number;
    deadlineDay?: number;
    source?: Goal["source"];
    relatedResidentId?: string;
    relatedBuildingId?: string;
  },
): Goal {
  const record: Goal = {
    id: makeId("goal", world, resident.id),
    kind: goal.kind,
    title: goal.title,
    description: goal.description,
    priority: goal.priority,
    progress: 0,
    status: "active",
    createdDay: world.clock.day,
    deadlineDay: goal.deadlineDay,
    source: goal.source ?? "need",
    relatedResidentId: goal.relatedResidentId,
    relatedBuildingId: goal.relatedBuildingId,
  };
  resident.goals.push(record);
  return record;
}

export function updateImpression(
  resident: Resident,
  targetId: string,
  summary: string,
  perceivedTraits: string[],
  world: WorldState,
  reliability = 0.65,
): void {
  resident.impressions[targetId] = {
    summary: summary.slice(0, 180),
    perceivedTraits: perceivedTraits.slice(0, 6),
    reliability: clamp(reliability, 0, 1),
    updatedDay: world.clock.day,
  };
}

export function makeId(prefix: string, world: WorldState, suffix = ""): string {
  const seed = `${world.worldId}-${world.clock.tick}-${world.events.length}-${world.rngState}-${suffix}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${world.clock.tick.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export function formatClock(world: WorldState): string {
  const hours = Math.floor(world.clock.minuteOfDay / 60);
  const minutes = world.clock.minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
