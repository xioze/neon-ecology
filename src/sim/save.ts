import { z } from "zod";
import { APP_VERSION, MAP_DEPTH, MAP_WIDTH, SCHEMA_VERSION } from "../shared/constants";
import type {
  SaveFile,
  SnapshotRecord,
  SnapshotSummary,
  WorldComparison,
  WorldState,
} from "../shared/types";

const vec2Schema = z.object({ x: z.number().finite(), z: z.number().finite() }).passthrough();

const needsSchema = z
  .object({
    hunger: z.number().min(0).max(100),
    energy: z.number().min(0).max(100),
    social: z.number().min(0).max(100),
    safety: z.number().min(0).max(100),
  })
  .passthrough();

const relationshipSchema = z
  .object({
    residentId: z.string().min(1),
    familiarity: z.number().min(0).max(100),
    affinity: z.number().min(-100).max(100),
    trust: z.number().min(-100).max(100),
    intimacy: z.number().min(0).max(100),
    attraction: z.number().min(-100).max(100),
    hostility: z.number().min(0).max(100),
    type: z.string().min(1),
  })
  .passthrough();

const memorySchema = z
  .object({
    id: z.string().min(1),
    tick: z.number().int().nonnegative(),
    text: z.string(),
    importance: z.number().min(1).max(10),
    subjectIds: z.array(z.string()),
  })
  .passthrough();

const goalSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    kind: z.enum(["long", "short"]),
    status: z.enum(["active", "completed", "blocked", "abandoned"]),
    progress: z.number().min(0).max(100),
  })
  .passthrough();

const residentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    age: z.number().min(0).max(140),
    health: z.number().min(0).max(100),
    mood: z.number().min(0).max(100),
    stress: z.number().min(0).max(100),
    wealth: z.number().finite().min(0).max(1_000_000_000),
    alive: z.boolean(),
    homeBuildingId: z.string().min(1),
    workBuildingId: z.string().min(1),
    position: vec2Schema,
    needs: needsSchema,
    relationships: z.record(relationshipSchema),
    memories: z
      .object({
        recent: z.array(memorySchema).max(100),
        important: z.array(memorySchema).max(100),
        longTerm: z.array(z.string()).max(50),
      })
      .passthrough(),
    goals: z.array(goalSchema).max(50),
    factionId: z.string().min(1),
  })
  .passthrough();

const buildingSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(["residential", "shop", "workplace", "public", "medical", "utility"]),
    x: z.number().int().min(0).max(MAP_WIDTH),
    z: z.number().int().min(0).max(MAP_DEPTH),
    w: z.number().int().min(1).max(MAP_WIDTH),
    d: z.number().int().min(1).max(MAP_DEPTH),
    capacity: z.number().int().min(1).max(500),
    condition: z.number().min(0).max(100),
    operational: z.boolean(),
    open: z.boolean(),
    inventory: z
      .object({
        food: z.number().min(0),
        meds: z.number().min(0),
        energy: z.number().min(0),
        credits: z.number().min(0),
      })
      .passthrough(),
  })
  .passthrough();

const factionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["corporation", "community", "underground"]),
    funds: z.number().min(0),
    influence: z.number().min(0).max(100),
    memberIds: z.array(z.string()),
  })
  .passthrough();

const worldSchema = z
  .object({
    schemaVersion: z.number().int(),
    worldId: z.string().min(1),
    name: z.string(),
    seed: z.number().int(),
    rngState: z.number().int(),
    clock: z
      .object({
        tick: z.number().int().nonnegative(),
        day: z.number().int().positive(),
        minuteOfDay: z.number().min(0).max(1439),
      })
      .passthrough(),
    rules: z
      .object({
        wageMultiplier: z.number().finite().min(0.01).max(100),
        priceMultiplier: z.number().finite().min(0.01).max(100),
        foodConsumption: z.number().finite().min(0).max(100),
        resourceRegen: z.number().finite().min(0).max(100),
        pollutionDecay: z.number().finite().min(0).max(100),
        taxRate: z.number().finite().min(0).max(1),
        welfare: z.number().finite().min(0).max(100),
        safetyBudget: z.number().finite().min(0).max(100),
        lifespanModifier: z.number().finite().min(0.1).max(10),
        socialVolatility: z.number().finite().min(0).max(100),
        factionsActive: z.boolean(),
        unrestSensitivity: z.number().finite().min(0).max(100),
        aiAdvisorFrequencyTicks: z.number().int().min(1).max(10000),
      })
      .passthrough(),
    reserves: z
      .object({
        credits: z.number().min(0),
        food: z.number().min(0),
        energy: z.number().min(0),
        meds: z.number().min(0),
      })
      .passthrough(),
    metrics: z
      .object({
        stability: z.number().min(0).max(100),
        pollution: z.number().min(0).max(100),
        trust: z.number().min(0).max(100),
        inequality: z.number().min(0).max(100),
        resourceSupply: z.number().min(0).max(100),
        averageMood: z.number().min(0).max(100),
        averageWealth: z.number().min(0),
        population: z.number().int().min(0),
      })
      .passthrough(),
    buildings: z.array(buildingSchema).min(1).max(200),
    residents: z.array(residentSchema).max(300),
    factions: z.array(factionSchema).min(1).max(20),
    events: z.array(z.unknown()).max(1000),
    history: z.array(z.unknown()).max(1000),
    weather: z
      .object({
        condition: z.enum(["clear", "rain", "acid_rain", "smog", "heatwave", "storm"]),
        intensity: z.number().min(0).max(1),
        untilTick: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();

export const saveFileSchema = z
  .object({
    schemaVersion: z.number().int(),
    appVersion: z.string(),
    savedAt: z.string().min(1),
    world: worldSchema,
    label: z.string().max(120).optional(),
  })
  .passthrough();

export type SaveParseResult =
  | { ok: true; save: SaveFile }
  | { ok: false; error: string };

export function createSaveFile(world: WorldState, label?: string): SaveFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    world: cloneWorld(world),
    label,
  };
}

export function serializeWorld(world: WorldState): string {
  return JSON.stringify(createSaveFile(world), null, 2);
}

export function parseWorldJson(raw: string): SaveParseResult {
  if (typeof raw !== "string") return { ok: false, error: "存档内容必须是文本。" };
  if (raw.length > 12 * 1024 * 1024) return { ok: false, error: "存档文件超过 12MB，拒绝导入。" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "存档不是合法的 JSON。" };
  }
  const result = saveFileSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      error: `存档结构不合法${first ? `：${first.path.join(".")} ${first.message}` : "。"}`,
    };
  }
  const save = result.data as unknown as SaveFile;
  if (save.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `存档版本 ${save.schemaVersion} 与当前版本 ${SCHEMA_VERSION} 不兼容。` };
  }
  if (save.world.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `世界状态版本 ${save.world.schemaVersion} 与当前版本 ${SCHEMA_VERSION} 不兼容。`,
    };
  }
  const sanitary = validateWorldSanity(save.world);
  if (!sanitary.ok) return { ok: false, error: sanitary.error };
  return { ok: true, save: { ...save, world: sanitizeWorld(save.world) } };
}

export function validateWorldSanity(world: WorldState): { ok: true } | { ok: false; error: string } {
  if (!world || typeof world !== "object") return { ok: false, error: "世界状态缺失。" };
  const buildingIds = new Set(world.buildings.map((building) => building.id));
  if (buildingIds.size !== world.buildings.length) return { ok: false, error: "建筑 ID 存在重复。" };
  const residentIds = new Set(world.residents.map((resident) => resident.id));
  if (residentIds.size !== world.residents.length) return { ok: false, error: "居民 ID 存在重复。" };
  if (!world.residents.some((resident) => resident.alive)) {
    return { ok: false, error: "世界中没有存活的居民，无法继续模拟。" };
  }
  for (const building of world.buildings) {
    if (
      building.x < 0 ||
      building.z < 0 ||
      building.x + building.w > MAP_WIDTH ||
      building.z + building.d > MAP_DEPTH
    ) {
      return { ok: false, error: `建筑 ${building.name} 超出城市边界。` };
    }
  }
  for (const resident of world.residents) {
    if (!buildingIds.has(resident.homeBuildingId)) {
      return { ok: false, error: `居民 ${resident.name} 的住所不存在。` };
    }
    if (!buildingIds.has(resident.workBuildingId)) {
      return { ok: false, error: `居民 ${resident.name} 的工作地点不存在。` };
    }
    if (resident.insideBuildingId && !buildingIds.has(resident.insideBuildingId)) {
      return { ok: false, error: `居民 ${resident.name} 所在的建筑不存在。` };
    }
    if (resident.currentAction) {
      const action = resident.currentAction as unknown as Record<string, unknown>;
      if (
        typeof action.action !== "string" ||
        (action.phase !== "moving" && action.phase !== "acting") ||
        !Array.isArray(action.path)
      ) {
        return { ok: false, error: `居民 ${resident.name} 的当前行动状态损坏。` };
      }
      for (const waypoint of action.path as unknown[]) {
        if (
          !waypoint ||
          typeof waypoint !== "object" ||
          !Number.isFinite((waypoint as { x?: number }).x) ||
          !Number.isFinite((waypoint as { z?: number }).z)
        ) {
          return { ok: false, error: `居民 ${resident.name} 的行动路径损坏。` };
        }
      }
    }
    if (
      !Number.isFinite(resident.position.x) ||
      !Number.isFinite(resident.position.z) ||
      resident.position.x < 0 ||
      resident.position.z < 0 ||
      resident.position.x >= MAP_WIDTH ||
      resident.position.z >= MAP_DEPTH
    ) {
      return { ok: false, error: `居民 ${resident.name} 的位置非法。` };
    }
    for (const relationship of Object.values(resident.relationships)) {
      if (!residentIds.has(relationship.residentId)) {
        return { ok: false, error: `居民 ${resident.name} 的关系记录指向了不存在的居民。` };
      }
    }
    for (const goal of resident.goals) {
      if (!Number.isFinite(goal.progress)) return { ok: false, error: "目标进度不是有限数字。" };
    }
  }
  if (!Number.isFinite(world.rngState)) return { ok: false, error: "随机数状态损坏。" };
  for (const [key, value] of Object.entries(world.rules)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return { ok: false, error: `规则 ${key} 不是有限数字。` };
    }
  }
  return { ok: true };
}

function sanitizeWorld(world: WorldState): WorldState {
  // Rebuild arrays and guarantee bounded values for data imported from disk.
  const cloned = cloneWorld(world);
  cloned.metrics.stability = clamp(cloned.metrics.stability, 0, 100);
  cloned.metrics.pollution = clamp(cloned.metrics.pollution, 0, 100);
  cloned.metrics.trust = clamp(cloned.metrics.trust, 0, 100);
  cloned.metrics.inequality = clamp(cloned.metrics.inequality, 0, 100);
  cloned.metrics.resourceSupply = clamp(cloned.metrics.resourceSupply, 0, 100);
  for (const resident of cloned.residents) {
    resident.wealth = Math.max(0, resident.wealth);
    resident.health = clamp(resident.health, 0, 100);
    resident.mood = clamp(resident.mood, 0, 100);
    resident.stress = clamp(resident.stress, 0, 100);
    resident.age = clamp(resident.age, 0, 140);
    resident.paused = Boolean(resident.paused);
    resident.position = { x: clamp(resident.position.x, 0, MAP_WIDTH - 1), z: clamp(resident.position.z, 0, MAP_DEPTH - 1) };
  }
  return cloned;
}

export function cloneWorld(world: WorldState): WorldState {
  return JSON.parse(JSON.stringify(world)) as WorldState;
}

export function createSnapshotRecord(
  world: WorldState,
  name: string,
  note?: string,
  branchOf?: string,
): SnapshotRecord {
  return {
    id: `snap-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`,
    name: name.slice(0, 80),
    savedAt: new Date().toISOString(),
    day: world.clock.day,
    tick: world.clock.tick,
    ruleVersion: world.ruleVersion,
    world: cloneWorld(world),
    note,
    branchOf,
  };
}

export function snapshotSummary(snapshot: SnapshotRecord): SnapshotSummary {
  return {
    id: snapshot.id,
    name: snapshot.name,
    savedAt: snapshot.savedAt,
    day: snapshot.day,
    tick: snapshot.tick,
    population: snapshot.world.residents.filter((resident) => resident.alive).length,
    metrics: { ...snapshot.world.metrics },
    ruleVersion: snapshot.ruleVersion,
    branchOf: snapshot.branchOf,
  };
}

export function compareSnapshots(a: SnapshotRecord, b: SnapshotRecord): WorldComparison {
  const summaryA = snapshotSummary(a);
  const summaryB = snapshotSummary(b);
  const delta = (key: keyof typeof summaryA.metrics) => summaryB.metrics[key] - summaryA.metrics[key];
  const residentsA = new Map(
    a.world.residents.filter((resident) => resident.alive).map((resident) => [resident.id, resident]),
  );
  const residentsB = new Map(
    b.world.residents.filter((resident) => resident.alive).map((resident) => [resident.id, resident]),
  );
  const names = new Set([
    ...a.world.residents.map((resident) => resident.name),
    ...b.world.residents.map((resident) => resident.name),
  ]);
  const wealthShifts: Array<{ name: string; a: number; b: number; delta: number }> = [];
  for (const name of names) {
    const residentA = [...residentsA.values()].find((resident) => resident.name === name);
    const residentB = [...residentsB.values()].find((resident) => resident.name === name);
    const wealthA = residentA?.wealth ?? 0;
    const wealthB = residentB?.wealth ?? 0;
    wealthShifts.push({ name, a: wealthA, b: wealthB, delta: wealthB - wealthA });
  }
  wealthShifts.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const relationshipChanges: Array<{ pair: string; a: string; b: string }> = [];
  for (const resident of a.world.residents) {
    const counterpart = b.world.residents.find((candidate) => candidate.id === resident.id);
    if (!counterpart) continue;
    for (const [targetId, relationA] of Object.entries(resident.relationships)) {
      const relationB = counterpart.relationships[targetId];
      if (!relationB) continue;
      if (relationA.type !== relationB.type) {
        const target = b.world.residents.find((candidate) => candidate.id === targetId);
        relationshipChanges.push({
          pair: `${resident.name} ↔ ${target?.name ?? targetId}`,
          a: relationA.type,
          b: relationB.type,
        });
      }
    }
  }
  return {
    a: summaryA,
    b: summaryB,
    metricDelta: {
      stability: delta("stability"),
      pollution: delta("pollution"),
      trust: delta("trust"),
      inequality: delta("inequality"),
      resourceSupply: delta("resourceSupply"),
      averageMood: delta("averageMood"),
      averageWealth: delta("averageWealth"),
      population: delta("population"),
    },
    biggestWealthShifts: wealthShifts.slice(0, 8),
    relationshipChanges: relationshipChanges.slice(0, 12),
    eventCount: { a: a.world.events.length, b: b.world.events.length },
    conditions: {
      rulesA: { ...a.world.rules },
      rulesB: { ...b.world.rules },
      weatherA: a.world.weather.condition,
      weatherB: b.world.weather.condition,
      ruleVersionA: a.ruleVersion,
      ruleVersionB: b.ruleVersion,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
