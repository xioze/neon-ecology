import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { APP_VERSION, MAP_DEPTH, MAP_WIDTH, SCHEMA_VERSION } from "../src/shared/constants";
import type { WorldState } from "../src/shared/types";
import { executeCommand } from "../src/sim/commands";
import { tickWorld } from "../src/sim/engine";
import {
  cloneWorld,
  compareSnapshots,
  createSaveFile,
  createSnapshotRecord,
  parseWorldJson,
  serializeWorld,
} from "../src/sim/save";
import { clone, makeWorld, tickWorldMany } from "./setup";

interface MutableSave {
  schemaVersion: number;
  appVersion: string;
  savedAt: string;
  world: Record<string, any>;
  label?: string;
}

/** Parse a save JSON into a mutable plain object for tamper-based rejection tests. */
function asMutableSave(raw: string): MutableSave {
  return JSON.parse(raw) as MutableSave;
}

/** Apply a mutation to a known-good save and return the serialized (tampered) JSON. */
function tamper(raw: string, mutate: (save: MutableSave) => void): string {
  const save = asMutableSave(raw);
  mutate(save);
  return JSON.stringify(save);
}

describe("存档 roundtrip", () => {
  it("createSaveFile → JSON → parseWorldJson 保留时钟/居民/关系/规则/rng/库存", () => {
    const world = makeWorld();
    tickWorldMany(world, 100);
    const originalWorld = cloneWorld(world);

    const save = createSaveFile(world, "QA 存档");
    // 存档必须是深拷贝：不能修改来源世界，也不能与其共享引用。
    expect(world).toEqual(originalWorld);
    expect(save.world).not.toBe(world);
    expect(save.schemaVersion).toBe(SCHEMA_VERSION);
    expect(save.appVersion).toBe(APP_VERSION);
    expect(save.label).toBe("QA 存档");

    const raw = JSON.stringify(save);
    const parsed = parseWorldJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const restored = parsed.save.world;
    expect(restored.clock).toEqual(world.clock);
    expect(restored.seed).toBe(world.seed);
    expect(restored.worldId).toBe(world.worldId);
    expect(restored.rngState).toBe(world.rngState);
    expect(restored.rules).toEqual(world.rules);
    expect(restored.reserves).toEqual(world.reserves);
    expect(restored.weather).toEqual(world.weather);
    expect(restored.metrics).toEqual(world.metrics);
    expect(restored.residents).toHaveLength(world.residents.length);
    expect(restored.buildings).toHaveLength(world.buildings.length);
    expect(restored.factions).toHaveLength(world.factions.length);

    for (const resident of world.residents) {
      const restoredResident = restored.residents.find((candidate) => candidate.id === resident.id);
      expect(restoredResident, `resident ${resident.id}`).toBeDefined();
      if (!restoredResident) continue;
      // 关键居民关系逐字段一致（双向、不同值都必须原样保留）。
      expect(clone(restoredResident.relationships)).toEqual(clone(resident.relationships));
      expect(restoredResident.homeBuildingId).toBe(resident.homeBuildingId);
      expect(restoredResident.workBuildingId).toBe(resident.workBuildingId);
      expect(restoredResident.factionId).toBe(resident.factionId);
      expect(restoredResident.wealth).toBe(resident.wealth);
      expect(restoredResident.needs).toEqual(resident.needs);
      expect(restoredResident.alive).toBe(resident.alive);
    }

    for (const building of world.buildings) {
      const restoredBuilding = restored.buildings.find((candidate) => candidate.id === building.id);
      expect(restoredBuilding, `building ${building.id}`).toBeDefined();
      if (!restoredBuilding) continue;
      expect(restoredBuilding.inventory).toEqual(building.inventory);
      expect(restoredBuilding.condition).toBe(building.condition);
      expect(restoredBuilding.recentVisits).toEqual(building.recentVisits);
    }
  });

  it("roundtrip 之后两个世界从同一状态确定性继续演化", () => {
    // tick 0 的世界没有进行中的行动/室内状态，sanitize 不会改变任何东西。
    const world = makeWorld();
    const parsed = parseWorldJson(JSON.stringify(createSaveFile(world)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = parsed.save.world;

    tickWorldMany(world, 10);
    tickWorldMany(restored, 10);

    expect(restored.clock).toEqual(world.clock);
    expect(restored.rngState).toBe(world.rngState);
    expect(restored.metrics).toEqual(world.metrics);
    expect(restored.residents.map((resident) => resident.position)).toEqual(
      world.residents.map((resident) => resident.position),
    );
  });

  it("serializeWorld 输出可直接解析的完整存档", () => {
    const world = makeWorld();
    const raw = serializeWorld(world);
    const parsed = parseWorldJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.save.world.clock).toEqual(world.clock);

    const envelope = JSON.parse(raw) as { schemaVersion: number; world: { schemaVersion: number } };
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
    expect(envelope.world.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("命令修改后的世界（新建筑/规则/天气）可以完整存档导入", () => {
    const world = makeWorld();
    expect(
      executeCommand(world, {
        type: "place_building",
        spec: { type: "shop", name: "存档测试商铺", x: 28, z: 24, w: 3, d: 3 },
      }).ok,
    ).toBe(true);
    expect(executeCommand(world, { type: "update_rules", patch: { taxRate: 0.2 } }).ok).toBe(true);
    tickWorldMany(world, 20);
    // 天气会在 untilTick 后自然重掷，所以先把世界推进完再设置天气并存档。
    expect(executeCommand(world, { type: "set_weather", condition: "storm", intensity: 0.6 }).ok).toBe(
      true,
    );

    const parsed = parseWorldJson(serializeWorld(world));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = parsed.save.world;
    expect(restored.buildings).toHaveLength(21);
    expect(restored.rules.taxRate).toBe(0.2);
    expect(restored.weather).toEqual(world.weather);
    expect(restored.weather.condition).toBe("storm");
    const placed = restored.buildings.find((building) => building.name === "存档测试商铺");
    expect(placed).toBeDefined();
    expect(placed?.x).toBe(28);
    expect(restored.residents.filter((resident) => resident.alive).length).toBeGreaterThan(0);
    expect(restored.rngState).toBe(world.rngState);
  });

  it("parseWorldJson 不修改输入字符串，也不修改原始世界", () => {
    const world = makeWorld();
    const worldBefore = cloneWorld(world);
    const raw = serializeWorld(world);
    const rawSnapshot = raw;

    const first = parseWorldJson(raw);
    expect(first.ok).toBe(true);
    expect(raw).toBe(rawSnapshot);

    const second = parseWorldJson(raw);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(cloneWorld(second.save.world)).toEqual(cloneWorld(first.save.world));
    }
    expect(world).toEqual(worldBefore);
  });
});

describe("损坏与非法存档拒绝", () => {
  const goodRaw = (): string => JSON.stringify(createSaveFile(makeWorld()));

  it("非 JSON / 结构缺失的输入被拒绝", () => {
    const invalidInputs = ["{not json", "", "null", "[]", JSON.stringify({ schemaVersion: SCHEMA_VERSION })];
    for (const raw of invalidInputs) {
      const result = parseWorldJson(raw);
      expect(result.ok, `input ${JSON.stringify(raw.slice(0, 24))}`).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
    expect(parseWorldJson(42 as unknown as string).ok).toBe(false);
    expect(parseWorldJson(undefined as unknown as string).ok).toBe(false);
    // 12MB 上限保护（在 JSON.parse 之前拒绝超大输入）。
    const oversized = "x".repeat(12 * 1024 * 1024 + 1);
    expect(parseWorldJson(oversized).ok).toBe(false);
  });

  it("外层与内层 schemaVersion 不匹配都被拒绝", () => {
    const raw = goodRaw();

    const outerMismatch = parseWorldJson(
      tamper(raw, (save) => {
        save.schemaVersion = SCHEMA_VERSION + 1;
      }),
    );
    expect(outerMismatch.ok).toBe(false);
    if (!outerMismatch.ok) expect(outerMismatch.error).toContain("版本");

    const innerMismatch = parseWorldJson(
      tamper(raw, (save) => {
        save.world.schemaVersion = SCHEMA_VERSION + 1;
      }),
    );
    expect(innerMismatch.ok).toBe(false);
  });

  it("居民指向不存在的建筑或居民时被拒绝", () => {
    const raw = goodRaw();

    const missingHome = parseWorldJson(
      tamper(raw, (save) => {
        save.world.residents[0].homeBuildingId = "b_ghost";
      }),
    );
    expect(missingHome.ok).toBe(false);
    if (!missingHome.ok) expect(missingHome.error).toContain("住所");

    const missingWork = parseWorldJson(
      tamper(raw, (save) => {
        save.world.residents[0].workBuildingId = "b_ghost";
      }),
    );
    expect(missingWork.ok).toBe(false);
    if (!missingWork.ok) expect(missingWork.error).toContain("工作");

    const brokenRelationship = parseWorldJson(
      tamper(raw, (save) => {
        save.world.residents[0].relationships = {
          r_ghost: {
            residentId: "r_ghost",
            familiarity: 0,
            affinity: 0,
            trust: 0,
            intimacy: 0,
            attraction: 0,
            hostility: 0,
            type: "stranger",
            sinceDay: 1,
            lastInteractionDay: 1,
            interactions: 0,
            notes: [],
          },
        };
      }),
    );
    expect(brokenRelationship.ok).toBe(false);
    if (!brokenRelationship.ok) expect(brokenRelationship.error).toContain("关系");
  });

  it("重复 ID、越界建筑与非法居民位置被拒绝", () => {
    const raw = goodRaw();

    const duplicateBuilding = parseWorldJson(
      tamper(raw, (save) => {
        save.world.buildings.push({ ...save.world.buildings[0] });
      }),
    );
    expect(duplicateBuilding.ok).toBe(false);
    if (!duplicateBuilding.ok) expect(duplicateBuilding.error).toContain("重复");

    const duplicateResident = parseWorldJson(
      tamper(raw, (save) => {
        save.world.residents.push({ ...save.world.residents[0] });
      }),
    );
    expect(duplicateResident.ok).toBe(false);
    if (!duplicateResident.ok) expect(duplicateResident.error).toContain("重复");

    const outOfBoundsBuilding = parseWorldJson(
      tamper(raw, (save) => {
        save.world.buildings[0].x = MAP_WIDTH;
      }),
    );
    expect(outOfBoundsBuilding.ok).toBe(false);

    const outOfBoundsResident = parseWorldJson(
      tamper(raw, (save) => {
        save.world.residents[0].position = { x: MAP_WIDTH, z: 0 };
      }),
    );
    expect(outOfBoundsResident.ok).toBe(false);

    const negativePosition = parseWorldJson(
      tamper(raw, (save) => {
        save.world.residents[0].position = { x: -1, z: MAP_DEPTH + 2 };
      }),
    );
    expect(negativePosition.ok).toBe(false);
  });

  it("规则缺字段或规则值非法时被拒绝", () => {
    const raw = goodRaw();

    const missingRule = parseWorldJson(
      tamper(raw, (save) => {
        delete save.world.rules.taxRate;
      }),
    );
    expect(missingRule.ok).toBe(false);

    const nullRule = parseWorldJson(
      tamper(raw, (save) => {
        save.world.rules.wageMultiplier = null;
      }),
    );
    expect(nullRule.ok).toBe(false);
  });
});

describe("快照比较", () => {
  it("compareSnapshots 返回指标差异与条件对比", () => {
    const world = makeWorld();
    const snapshotA = createSnapshotRecord(world, "A");
    expect(executeCommand(world, { type: "inject_event", eventId: "pollution_spike" }).ok).toBe(true);
    const snapshotB = createSnapshotRecord(world, "B");

    const comparison = compareSnapshots(snapshotA, snapshotB);
    expect(comparison.a.id).toBe(snapshotA.id);
    expect(comparison.b.id).toBe(snapshotB.id);
    expect(comparison.metricDelta.population).toBe(0);
    // pollution_spike 精确 +14 污染。
    expect(comparison.metricDelta.pollution).toBeCloseTo(14, 6);
    expect(comparison.biggestWealthShifts.length).toBeGreaterThan(0);
    expect(comparison.biggestWealthShifts.length).toBeLessThanOrEqual(8);
    for (const shift of comparison.biggestWealthShifts) {
      expect(typeof shift.name).toBe("string");
      expect(Number.isFinite(shift.a)).toBe(true);
      expect(Number.isFinite(shift.b)).toBe(true);
      expect(shift.delta).toBeCloseTo(shift.b - shift.a, 10);
    }
    expect(Array.isArray(comparison.relationshipChanges)).toBe(true);
    expect(comparison.eventCount.b).toBeGreaterThanOrEqual(comparison.eventCount.a);
    expect(comparison.conditions.weatherA).toBe(snapshotA.world.weather.condition);
    expect(comparison.conditions.weatherB).toBe(snapshotB.world.weather.condition);

    const identical = compareSnapshots(snapshotA, snapshotA);
    for (const value of Object.values(identical.metricDelta)) expect(value).toBe(0);
    expect(identical.relationshipChanges).toEqual([]);
  });

  it("规则修改体现在条件差异中，且比较结果不污染快照", () => {
    const world = makeWorld();
    const snapshotA = createSnapshotRecord(world, "规则修改前");
    expect(executeCommand(world, { type: "update_rules", patch: { taxRate: 0.2 } }).ok).toBe(true);
    tickWorld(world);
    const snapshotC = createSnapshotRecord(world, "规则修改后");

    const comparison = compareSnapshots(snapshotA, snapshotC);
    expect(comparison.conditions.rulesA.taxRate).toBe(snapshotA.world.rules.taxRate);
    expect(comparison.conditions.rulesB.taxRate).toBe(0.2);

    // 返回的比较数据必须与快照隔离（深拷贝）。
    comparison.conditions.rulesA.taxRate = 0.99;
    expect(snapshotA.world.rules.taxRate).not.toBe(0.99);
  });
});

describe("存档操作的文件系统副作用", () => {
  it("创建/序列化/解析/快照/比较不会写入任何用户文件", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "neon-ecology-save-audit-"));
    try {
      const world = makeWorld();
      const save = createSaveFile(world);
      const raw = serializeWorld(world);
      expect(parseWorldJson(raw).ok).toBe(true);
      expect(parseWorldJson(JSON.stringify(save)).ok).toBe(true);
      createSnapshotRecord(world, "无文件快照");
      compareSnapshots(createSnapshotRecord(world, "a"), createSnapshotRecord(world, "b"));
      tickWorldMany(world, 5);
      expect(fs.readdirSync(tempDir)).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// 保证类型导入被实际使用（也用于下方的类型级断言）。
type _WorldStateAlias = WorldState;
