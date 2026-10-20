import { performance } from "node:perf_hooks";

import { afterEach, describe, expect, it, vi } from "vitest";

import { aiDecisionRequestSchema } from "../src/shared/ai";
import {
  AI_ACTIONS,
  type Relationship,
  type WorldRules,
} from "../src/shared/types";
import {
  DAY_START_MINUTE,
  MAX_RECENT_MEMORIES,
  TICK_MINUTES,
  TICK_MS,
} from "../src/shared/constants";
import { applyAiProposal, buildAiDecisionRequest } from "../src/sim/aiContext";
import { executeCommand, type WorldCommand } from "../src/sim/commands";
import { tickWorld } from "../src/sim/engine";
import { recordMemory } from "../src/sim/events";
import { SimulationStore } from "../src/store/simulationStore";
import {
  FIXED_CREATED_AT,
  FIXED_SEED,
  clone,
  expectResidentPositionLegal,
  expectResidentReferencesLegal,
  findBuilding,
  findResident,
  makeWorld,
  tickWorldMany,
} from "./setup";

const REQUIRED_BUILDING_TYPES = ["residential", "shop", "workplace", "public", "medical"] as const;

const RELATIONSHIP_NUMERIC_KEYS = [
  "familiarity",
  "affinity",
  "trust",
  "intimacy",
  "attraction",
  "hostility",
] as const satisfies ReadonlyArray<keyof Relationship>;

describe("初始世界", () => {
  it("生成 18 名居民、20 座建筑与 3 个势力", () => {
    const world = makeWorld();

    expect(world.residents).toHaveLength(18);
    expect(world.buildings).toHaveLength(20);
    expect(world.factions).toHaveLength(3);

    expect(world.residents.filter((resident) => resident.alive)).toHaveLength(18);
    expect(world.initialResidentIds).toHaveLength(18);
    expect(world.seed).toBe(FIXED_SEED);
    expect(world.createdAtIso).toBe(FIXED_CREATED_AT);
    expect(world.clock).toEqual({ tick: 0, day: 1, minuteOfDay: DAY_START_MINUTE });
  });

  it("建筑类型覆盖住宅、商店、工作场所、公共空间与医疗设施", () => {
    const world = makeWorld();
    const types = new Set(world.buildings.map((building) => building.type));
    for (const type of REQUIRED_BUILDING_TYPES) {
      expect(types.has(type), `missing building type ${type}`).toBe(true);
    }
    // 每个建筑都有完整占地与库存结构。
    for (const building of world.buildings) {
      expect(building.w).toBeGreaterThan(0);
      expect(building.d).toBeGreaterThan(0);
      expect(building.x).toBeGreaterThanOrEqual(0);
      expect(building.z).toBeGreaterThanOrEqual(0);
      expect(building.x + building.w).toBeLessThanOrEqual(32);
      expect(building.z + building.d).toBeLessThanOrEqual(28);
      expect(building.inventory.food).toBeGreaterThanOrEqual(0);
      expect(building.inventory.meds).toBeGreaterThanOrEqual(0);
      expect(building.inventory.energy).toBeGreaterThanOrEqual(0);
      expect(building.inventory.credits).toBeGreaterThanOrEqual(0);
    }
  });

  it("每名居民都有目标、关系、记忆与合法住所/工作地点", () => {
    const world = makeWorld();
    const buildingIds = new Set(world.buildings.map((building) => building.id));

    for (const resident of world.residents) {
      expect(resident.alive).toBe(true);
      expect(resident.goals.length, `${resident.id} should have goals`).toBeGreaterThan(0);
      for (const goal of resident.goals) {
        expect(goal.id.length).toBeGreaterThan(0);
        expect(goal.title.length).toBeGreaterThan(0);
        expect(["long", "short"]).toContain(goal.kind);
        expect(["active", "completed", "blocked", "abandoned"]).toContain(goal.status);
        expect(Number.isFinite(goal.progress)).toBe(true);
      }

      expect(
        Object.keys(resident.relationships).length,
        `${resident.id} should have relationships`,
      ).toBeGreaterThan(0);
      for (const [targetId, relation] of Object.entries(resident.relationships)) {
        expect(relation.residentId).toBe(targetId);
        expect(world.residents.some((candidate) => candidate.id === targetId)).toBe(true);
        expect(typeof relation.type).toBe("string");
        for (const key of RELATIONSHIP_NUMERIC_KEYS) {
          expect(Number.isFinite(relation[key]), `${resident.id}.${targetId}.${key}`).toBe(true);
        }
      }

      const memoryCount = resident.memories.recent.length + resident.memories.important.length;
      expect(memoryCount, `${resident.id} should have memories`).toBeGreaterThan(0);
      expect(resident.memories.longTerm.length).toBeGreaterThan(0);
      for (const memory of [...resident.memories.recent, ...resident.memories.important]) {
        expect(memory.id.length).toBeGreaterThan(0);
        expect(memory.text.length).toBeGreaterThan(0);
        expect(memory.importance).toBeGreaterThanOrEqual(1);
        expect(memory.importance).toBeLessThanOrEqual(10);
        expect(Array.isArray(memory.subjectIds)).toBe(true);
      }

      expect(buildingIds.has(resident.homeBuildingId)).toBe(true);
      expect(buildingIds.has(resident.workBuildingId)).toBe(true);
      expect(findBuilding(world, resident.homeBuildingId).type).toBe("residential");
      expectResidentPositionLegal(world, resident);
    }
    expectResidentReferencesLegal(world);
  });

  it("实体 ID 唯一，势力成员/领导者引用合法", () => {
    const world = makeWorld();
    expect(new Set(world.residents.map((resident) => resident.id)).size).toBe(world.residents.length);
    expect(new Set(world.buildings.map((building) => building.id)).size).toBe(world.buildings.length);
    expect(new Set(world.factions.map((faction) => faction.id)).size).toBe(world.factions.length);

    const residentIds = new Set(world.residents.map((resident) => resident.id));
    for (const resident of world.residents) {
      expect(world.factions.some((faction) => faction.id === resident.factionId)).toBe(true);
    }
    for (const faction of world.factions) {
      expect(residentIds.has(faction.leaderId)).toBe(true);
      expect(faction.memberIds.length).toBeGreaterThan(0);
      for (const memberId of faction.memberIds) {
        expect(residentIds.has(memberId), `${faction.id} member ${memberId}`).toBe(true);
      }
    }
    for (const building of world.buildings) {
      if (building.ownerFactionId !== null) {
        expect(world.factions.some((faction) => faction.id === building.ownerFactionId)).toBe(true);
      }
    }
  });
});

describe("确定性", () => {
  it("相同种子 + 固定创建时间推进 100 tick 后状态完全一致", () => {
    const first = makeWorld();
    const second = makeWorld();
    expect(first.worldId).toBe(second.worldId);

    tickWorldMany(first, 100);
    tickWorldMany(second, 100);

    expect(first.clock).toEqual(second.clock);
    expect(first.metrics).toEqual(second.metrics);
    expect(first.rngState).toBe(second.rngState);
    expect(first.seed).toBe(second.seed);

    expect(first.residents.map((resident) => ({ id: resident.id, position: resident.position, alive: resident.alive }))).toEqual(
      second.residents.map((resident) => ({ id: resident.id, position: resident.position, alive: resident.alive })),
    );
    expect(first.residents.map((resident) => clone(resident.relationships))).toEqual(
      second.residents.map((resident) => clone(resident.relationships)),
    );
    expect(first.events.map((event) => event.title)).toEqual(second.events.map((event) => event.title));
    expect(first.history.length).toBe(second.history.length);
  });

  it("不同种子产生不同的世界与演化结果", () => {
    const first = makeWorld(FIXED_SEED);
    const second = makeWorld(99999);
    expect(second.seed).toBe(99999);
    expect(second.worldId).not.toBe(first.worldId);

    tickWorldMany(first, 100);
    tickWorldMany(second, 100);

    expect(second.rngState).not.toBe(first.rngState);
    expect(second.metrics).not.toEqual(first.metrics);
    expect(second.residents.map((resident) => resident.position)).not.toEqual(
      first.residents.map((resident) => resident.position),
    );
  });
});

describe("时间推进", () => {
  it("每次 tickWorld 恰好 +1 tick 与 +30 分钟", () => {
    const world = makeWorld();
    for (let index = 0; index < 96; index += 1) {
      const previousTick = world.clock.tick;
      const report = tickWorld(world);
      const totalMinutes = DAY_START_MINUTE + TICK_MINUTES * (previousTick + 1);
      expect(world.clock.tick).toBe(previousTick + 1);
      expect(world.clock.minuteOfDay).toBe(totalMinutes % 1440);
      expect(world.clock.day).toBe(1 + Math.floor(totalMinutes / 1440));
      expect(report).toMatchObject({
        tick: world.clock.tick,
        day: world.clock.day,
        minuteOfDay: world.clock.minuteOfDay,
      });
      expect(report.eventsCreated).toBeGreaterThanOrEqual(0);
    }
    expect(world.clock.tick).toBe(96);
  });

  it("跨日时 day+1，且 newDay 只在跨日 tick 为 true", () => {
    const world = makeWorld();
    const dayBoundaryTicks: number[] = [];
    for (let index = 0; index < 96; index += 1) {
      const dayBefore = world.clock.day;
      const report = tickWorld(world);
      const crossedDay = world.clock.day === dayBefore + 1;
      expect(report.newDay).toBe(crossedDay);
      if (crossedDay) dayBoundaryTicks.push(world.clock.tick);
    }
    // 世界从 08:00 开始：08:00 + 48 tick = 次日 08:00；边界落在 tick 32 与 tick 80。
    expect(dayBoundaryTicks).toEqual([32, 80]);
    expect(world.clock.day).toBe(3);
    expect(world.clock.minuteOfDay).toBe(DAY_START_MINUTE);
  });

  it("首次推进产生居民行动，报告字段与状态一致", () => {
    const world = makeWorld();
    const eventsBefore = world.events.length;
    const report = tickWorld(world);
    expect(report.actionsStarted).toBeGreaterThan(0);
    expect(report.actionsCompleted).toBeGreaterThanOrEqual(0);
    expect(report.eventsCreated).toBe(Math.max(0, world.events.length - eventsBefore));
    expect(world.residents.filter((resident) => resident.alive && resident.currentAction)).not.toHaveLength(0);
  });

  describe("暂停与单步（SimulationStore）", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("暂停后不会自动推进，stepOnce 恰好推进 1 tick", () => {
      vi.useFakeTimers();
      const store = new SimulationStore(null);
      try {
        const startTick = store.getWorld().clock.tick;
        expect(store.getSnapshot().paused).toBe(false);

        store.setPaused(true);
        expect(store.getSnapshot().paused).toBe(true);

        vi.advanceTimersByTime(TICK_MS[1] * 5);
        expect(store.getWorld().clock.tick).toBe(startTick);

        store.stepOnce();
        expect(store.getWorld().clock.tick).toBe(startTick + 1);
        expect(store.getSnapshot().world.clock.tick).toBe(startTick + 1);

        store.stepOnce();
        expect(store.getWorld().clock.tick).toBe(startTick + 2);
      } finally {
        store.stop();
      }
    });

    it("start 后计时器推进，暂停时停止，恢复后继续", () => {
      vi.useFakeTimers();
      const store = new SimulationStore(null);
      try {
        const startTick = store.getWorld().clock.tick;
        store.start();

        vi.advanceTimersByTime(TICK_MS[1]);
        expect(store.getWorld().clock.tick).toBe(startTick + 1);

        store.setPaused(true);
        vi.advanceTimersByTime(TICK_MS[1] * 4);
        expect(store.getWorld().clock.tick).toBe(startTick + 1);

        store.stepOnce();
        expect(store.getWorld().clock.tick).toBe(startTick + 2);

        store.setPaused(false);
        vi.advanceTimersByTime(TICK_MS[1]);
        expect(store.getWorld().clock.tick).toBe(startTick + 3);

        store.stop();
        const stoppedAt = store.getWorld().clock.tick;
        vi.advanceTimersByTime(TICK_MS[1] * 4);
        expect(store.getWorld().clock.tick).toBe(stoppedAt);
      } finally {
        store.stop();
      }
    });

    it("未 start 的 store 不会被 setPaused/setSpeed 自行启动", () => {
      vi.useFakeTimers();
      const store = new SimulationStore(null);
      const speedStore = new SimulationStore(null);
      try {
        const startTick = store.getWorld().clock.tick;
        store.setPaused(true);
        store.setPaused(false);
        vi.advanceTimersByTime(TICK_MS[1] * 3);
        expect(store.getWorld().clock.tick).toBe(startTick);

        const speedTick = speedStore.getWorld().clock.tick;
        speedStore.setSpeed(4);
        expect(speedStore.getSnapshot().speed).toBe(4);
        vi.advanceTimersByTime(TICK_MS[4] * 4);
        expect(speedStore.getWorld().clock.tick).toBe(speedTick);
      } finally {
        store.stop();
        speedStore.stop();
      }
    });
  });
});

describe("规则与造物主干预", () => {
  it("update_rules 拒绝越界值、未知字段与错误类型，且不改变状态", () => {
    const world = makeWorld();
    const before = clone(world.rules);

    const outOfBounds = executeCommand(world, { type: "update_rules", patch: { taxRate: 9 } });
    expect(outOfBounds.ok).toBe(false);
    expect(world.rules).toEqual(before);

    const belowMinimum = executeCommand(world, { type: "update_rules", patch: { welfare: -1 } });
    expect(belowMinimum.ok).toBe(false);
    expect(world.rules).toEqual(before);

    const unknownField = executeCommand(world, {
      type: "update_rules",
      patch: { notARule: 1 },
    } as unknown as WorldCommand);
    expect(unknownField.ok).toBe(false);
    expect(world.rules).toEqual(before);

    const wrongType = executeCommand(world, {
      type: "update_rules",
      patch: { factionsActive: "yes" },
    } as unknown as WorldCommand);
    expect(wrongType.ok).toBe(false);
    expect(world.rules).toEqual(before);
  });

  it("update_rules 有效值写入世界规则并产生事件", () => {
    const world = makeWorld();
    const result = executeCommand(world, {
      type: "update_rules",
      patch: { taxRate: 0.12, welfare: 42, factionsActive: false },
    });
    expect(result.ok).toBe(true);
    expect(world.rules.taxRate).toBe(0.12);
    expect(world.rules.welfare).toBe(42);
    expect(world.rules.factionsActive).toBe(false);
    expect(result.event).toBeDefined();
    expect(world.events[0]?.id).toBe(result.event?.id);
    expect(result.event?.type).toBe("player");
  });

  it("update_rules 混合合法与非法 patch 必须原子失败", () => {
    const world = makeWorld();
    const before: WorldRules = clone(world.rules);

    // 合法项写在非法项之前：整体必须被拒绝，合法项也不能残留。
    const result = executeCommand(world, {
      type: "update_rules",
      patch: { wageMultiplier: 1.5, taxRate: 9 },
    });
    expect(result.ok).toBe(false);
    expect(world.rules).toEqual(before);

    const resultUnknown = executeCommand(world, {
      type: "update_rules",
      patch: { wageMultiplier: 1.5, notARule: 1 },
    } as unknown as WorldCommand);
    expect(resultUnknown.ok).toBe(false);
    expect(world.rules).toEqual(before);
  });

  it("inject_event 实际改变资源/指标并写入世界事件", () => {
    const stateFingerprint = (world: ReturnType<typeof makeWorld>): string =>
      JSON.stringify({
        reserves: world.reserves,
        metrics: world.metrics,
        rules: world.rules,
        residents: world.residents.map((resident) => ({
          health: resident.health,
          mood: resident.mood,
          stress: resident.stress,
          needs: resident.needs,
        })),
        buildings: world.buildings.map((building) => ({
          condition: building.condition,
          inventory: building.inventory,
        })),
      });

    for (const eventId of ["blackout", "pollution_spike", "festival", "funding"] as const) {
      const world = makeWorld();
      const before = stateFingerprint(world);
      const result = executeCommand(world, { type: "inject_event", eventId });
      expect(result.ok, `event ${eventId} should apply`).toBe(true);
      expect(stateFingerprint(world), `event ${eventId} should change state`).not.toBe(before);
      expect(world.events[0]?.tag).toBe("WORLD EVENT");
      expect(result.event).toBeDefined();
      expect(world.events[0]?.id).toBe(result.event?.id);
    }

    const world = makeWorld();
    const before = stateFingerprint(world);
    const unknown = executeCommand(world, {
      type: "inject_event",
      eventId: "not_an_event",
    } as unknown as WorldCommand);
    expect(unknown.ok).toBe(false);
    expect(stateFingerprint(world)).toBe(before);
  });

  it("edit_resident 修改财富/需求/情绪并立即写入世界", () => {
    const world = makeWorld();
    const result = executeCommand(world, {
      type: "edit_resident",
      residentId: "r_linlan",
      patch: { wealth: 321, mood: 77, needs: { hunger: 12, energy: 88 } },
    });
    expect(result.ok).toBe(true);

    const resident = findResident(world, "r_linlan");
    expect(resident.wealth).toBe(321);
    expect(resident.mood).toBe(77);
    expect(resident.needs.hunger).toBe(12);
    expect(resident.needs.energy).toBe(88);
    expect(world.events[0]?.tag).toBe("CREATOR");
  });

  it("edit_resident 非法引用必须原子失败", () => {
    const world = makeWorld();
    const resident = findResident(world, "r_linlan");
    const before = clone(resident);

    const missingHome = executeCommand(world, {
      type: "edit_resident",
      residentId: resident.id,
      patch: { wealth: 500, homeBuildingId: "b_does_not_exist" },
    });
    expect(missingHome.ok).toBe(false);
    expect(resident.wealth).toBe(before.wealth);

    const missingFaction = executeCommand(world, {
      type: "edit_resident",
      residentId: resident.id,
      patch: { mood: 12, factionId: "ghost_faction" },
    });
    expect(missingFaction.ok).toBe(false);
    expect(resident.mood).toBe(before.mood);
    expect(resident.factionId).toBe(before.factionId);

    const invalidHomeType = executeCommand(world, {
      type: "edit_resident",
      residentId: resident.id,
      patch: { wealth: 999, homeBuildingId: "b_corp" },
    });
    expect(invalidHomeType.ok).toBe(false);
    expect(resident.wealth).toBe(before.wealth);
  });

  it("edit_resident paused 后引擎跳过该居民，其他人继续生活", () => {
    const world = makeWorld();
    const paused = findResident(world, "r_linlan");
    const active = findResident(world, "r_zhouyi");
    const result = executeCommand(world, {
      type: "edit_resident",
      residentId: paused.id,
      patch: { paused: true },
    });
    expect(result.ok).toBe(true);

    const pausedBefore = JSON.stringify({
      position: paused.position,
      needs: paused.needs,
      mood: paused.mood,
      stress: paused.stress,
      currentAction: paused.currentAction,
    });
    const activeHungerBefore = active.needs.hunger;

    tickWorld(world);

    expect(
      JSON.stringify({
        position: paused.position,
        needs: paused.needs,
        mood: paused.mood,
        stress: paused.stress,
        currentAction: paused.currentAction,
      }),
    ).toBe(pausedBefore);
    expect(active.needs.hunger).toBeGreaterThan(activeHungerBefore);
  });

  it("place_building 拒绝道路、越界与重叠，且不改变建筑数量", () => {
    const world = makeWorld();
    const count = world.buildings.length;

    const onRoad = executeCommand(world, {
      type: "place_building",
      spec: { type: "shop", x: 7, z: 1, w: 3, d: 3 },
    });
    expect(onRoad.ok).toBe(false);

    const outOfBounds = executeCommand(world, {
      type: "place_building",
      spec: { type: "shop", x: 31, z: 26, w: 3, d: 3 },
    });
    expect(outOfBounds.ok).toBe(false);

    const negative = executeCommand(world, {
      type: "place_building",
      spec: { type: "shop", x: -2, z: 2, w: 3, d: 3 },
    });
    expect(negative.ok).toBe(false);

    const overlap = executeCommand(world, {
      type: "place_building",
      spec: { type: "residential", x: 1, z: 1, w: 3, d: 3 },
    });
    expect(overlap.ok).toBe(false);

    expect(world.buildings).toHaveLength(count);
  });

  it("place_building 在空位成功落地，建筑 +1 且字段正确", () => {
    const world = makeWorld();
    const count = world.buildings.length;
    const result = executeCommand(world, {
      type: "place_building",
      spec: { type: "shop", name: "QA 测试商铺", x: 28, z: 24, w: 3, d: 3, capacity: 12 },
    });
    expect(result.ok).toBe(true);
    expect(world.buildings).toHaveLength(count + 1);

    const placed = world.buildings[world.buildings.length - 1]!;
    expect(placed.name).toBe("QA 测试商铺");
    expect(placed.type).toBe("shop");
    expect({ x: placed.x, z: placed.z, w: placed.w, d: placed.d }).toEqual({ x: 28, z: 24, w: 3, d: 3 });
    expect(placed.operational).toBe(true);
    expect(placed.open).toBe(true);
    expect(placed.capacity).toBe(12);
    expectResidentReferencesLegal(world);
  });

  it("demolish_building 移除住宅并修复居民的住所引用", () => {
    const world = makeWorld();
    tickWorldMany(world, 30);
    const target = findBuilding(world, "b_home_neon");
    const affected = world.residents
      .filter((resident) => resident.homeBuildingId === target.id)
      .map((resident) => resident.id);
    expect(affected.length).toBeGreaterThan(0);

    const result = executeCommand(world, { type: "demolish_building", buildingId: target.id });
    expect(result.ok).toBe(true);
    expect(world.buildings.some((building) => building.id === target.id)).toBe(false);
    expect(world.buildings).toHaveLength(19);
    expectResidentReferencesLegal(world);

    for (const residentId of affected) {
      const resident = findResident(world, residentId);
      expect(world.buildings.some((building) => building.id === resident.homeBuildingId)).toBe(true);
      expect(findBuilding(world, resident.homeBuildingId).type).toBe("residential");
    }

    // 拆除之后继续演进不应崩溃，也不应产生非法位置。
    tickWorldMany(world, 100);
    expectResidentReferencesLegal(world);
    for (const resident of world.residents.filter((candidate) => candidate.alive)) {
      expectResidentPositionLegal(world, resident);
    }
  });

  it("demolish_building 移除工作场所并修复工作引用", () => {
    const world = makeWorld();
    tickWorldMany(world, 30);
    const target = findBuilding(world, "b_workshop");
    const affected = world.residents
      .filter((resident) => resident.workBuildingId === target.id)
      .map((resident) => resident.id);
    expect(affected.length).toBeGreaterThan(0);

    const result = executeCommand(world, { type: "demolish_building", buildingId: target.id });
    expect(result.ok).toBe(true);
    expect(world.buildings.some((building) => building.id === target.id)).toBe(false);

    for (const residentId of affected) {
      const resident = findResident(world, residentId);
      expect(world.buildings.some((building) => building.id === resident.workBuildingId)).toBe(true);
    }
    expectResidentReferencesLegal(world);
    tickWorldMany(world, 100);
    expectResidentReferencesLegal(world);
  });

  it("delete_resident 清理其他居民指向该居民的行动引用与关系", () => {
    const world = makeWorld();
    let victimId: string | null = null;
    for (let tick = 0; tick < 80 && victimId === null; tick += 1) {
      tickWorld(world);
      for (const resident of world.residents) {
        const targeting = world.residents.find(
          (other) => other.currentAction?.targetResidentId === resident.id,
        );
        if (targeting) {
          victimId = resident.id;
          break;
        }
      }
    }
    expect(victimId, "应当存在一名被他人行动追踪的居民").not.toBeNull();
    if (!victimId) return;

    const result = executeCommand(world, { type: "delete_resident", residentId: victimId });
    expect(result.ok).toBe(true);
    expect(world.residents.some((resident) => resident.id === victimId)).toBe(false);

    const dangling = world.residents.filter(
      (resident) =>
        resident.currentAction?.targetResidentId !== undefined &&
        !world.residents.some(
          (candidate) => candidate.id === resident.currentAction?.targetResidentId,
        ),
    );
    expect(dangling.map((resident) => resident.id)).toEqual([]);
    for (const resident of world.residents) {
      expect(resident.relationships[victimId]).toBeUndefined();
    }
    expectResidentReferencesLegal(world);
  });

  it("create_resident 增加居民且引用全部合法", () => {
    const world = makeWorld();
    const before = world.residents.length;

    const result = executeCommand(world, {
      type: "create_resident",
      spec: {
        name: "QA 新居民",
        age: 28,
        jobTitle: "测试工程师",
        factionId: "free",
        homeBuildingId: "b_home_harbor",
        workBuildingId: "b_corp",
      },
    });
    expect(result.ok).toBe(true);
    expect(world.residents).toHaveLength(before + 1);

    const created = world.residents[world.residents.length - 1]!;
    expect(created.name).toBe("QA 新居民");
    expect(created.alive).toBe(true);
    expect(created.homeBuildingId).toBe("b_home_harbor");
    expect(created.workBuildingId).toBe("b_corp");
    expect(findBuilding(world, created.homeBuildingId).type).toBe("residential");
    expect(world.buildings.some((building) => building.id === created.workBuildingId)).toBe(true);
    expect(world.factions).toContainEqual(
      expect.objectContaining({ id: created.factionId, memberIds: expect.arrayContaining([created.id]) }),
    );
    expect(created.goals.length).toBeGreaterThan(0);
    expect(created.memories.recent.length + created.memories.important.length).toBeGreaterThan(0);
    expect(world.metrics.population).toBe(before + 1);
    expectResidentReferencesLegal(world);
  });

  it("create_resident 引用非法时被拒绝且不增员", () => {
    const world = makeWorld();
    const before = world.residents.length;
    const invalidHome = executeCommand(world, {
      type: "create_resident",
      spec: {
        name: "无效居民",
        age: 22,
        jobTitle: "测试",
        factionId: "free",
        homeBuildingId: "b_corp",
        workBuildingId: "b_corp",
      },
    });
    expect(invalidHome.ok).toBe(false);
    expect(world.residents).toHaveLength(before);
  });

  it("set_weather 立即生效，非法天气被拒绝", () => {
    const world = makeWorld();
    const result = executeCommand(world, { type: "set_weather", condition: "acid_rain", intensity: 0.7 });
    expect(result.ok).toBe(true);
    expect(world.weather.condition).toBe("acid_rain");
    expect(world.weather.intensity).toBe(0.7);
    expect(world.weather.untilTick).toBe(world.clock.tick + 8);

    const invalid = executeCommand(world, {
      type: "set_weather",
      condition: "snow",
    } as unknown as WorldCommand);
    expect(invalid.ok).toBe(false);
    expect(world.weather.condition).toBe("acid_rain");
  });
});

describe("关系与记忆", () => {
  it("初始关系双向存在，且双向认知不必相同", () => {
    const world = makeWorld();
    let bilateralPairs = 0;
    let asymmetricPairs = 0;

    for (const resident of world.residents) {
      for (const [targetId, relation] of Object.entries(resident.relationships)) {
        const other = world.residents.find((candidate) => candidate.id === targetId);
        if (!other) continue;
        const reverse = other.relationships[resident.id];
        if (!reverse) continue;
        bilateralPairs += 1;
        expect(relation.residentId).toBe(targetId);
        expect(reverse.residentId).toBe(resident.id);
        // 双向条目独立存储，值不要求相等（可能是不同方向的认知）。
        if (JSON.stringify(relation) !== JSON.stringify(reverse)) asymmetricPairs += 1;
      }
    }

    expect(bilateralPairs).toBeGreaterThan(0);
    expect(asymmetricPairs).toBeGreaterThan(0);
  });

  it("推进 200 tick 过程中至少出现一次关系变化", () => {
    const world = makeWorld();
    const before = world.residents.map((resident) => ({
      id: resident.id,
      relationships: clone(resident.relationships),
    }));

    tickWorldMany(world, 200);

    let changedEntries = 0;
    for (const resident of world.residents) {
      const previous = before.find((entry) => entry.id === resident.id);
      if (!previous) {
        changedEntries += 1;
        continue;
      }
      for (const [targetId, relation] of Object.entries(resident.relationships)) {
        const old = previous.relationships[targetId];
        if (!old) {
          changedEntries += 1;
          continue;
        }
        const numericChanged = RELATIONSHIP_NUMERIC_KEYS.some((key) => relation[key] !== old[key]);
        if (numericChanged || relation.type !== old.type || relation.interactions !== old.interactions) {
          changedEntries += 1;
        }
      }
    }
    expect(changedEntries).toBeGreaterThan(0);
  });

  it("recordMemory 写入结构化字段并进入近期/重要记忆", () => {
    const world = makeWorld();
    const resident = findResident(world, "r_linlan");

    const memory = recordMemory(world, resident, {
      text: "一句结构化的测试记忆",
      kind: "observation",
      importance: 7,
      subjectIds: ["r_chenmo"],
      valence: -0.4,
      source: "told",
      reliability: 0.55,
    });

    expect(memory.id).toMatch(/^mem-/);
    expect(memory.tick).toBe(world.clock.tick);
    expect(memory.day).toBe(world.clock.day);
    expect(memory.minuteOfDay).toBe(world.clock.minuteOfDay);
    expect(memory.kind).toBe("observation");
    expect(memory.text).toBe("一句结构化的测试记忆");
    expect(memory.subjectIds).toEqual(["r_chenmo"]);
    expect(memory.importance).toBe(7);
    expect(memory.valence).toBe(-0.4);
    expect(memory.source).toBe("told");
    expect(memory.reliability).toBe(0.55);
    expect(memory.recalledAtTick).toBe(world.clock.tick);

    expect(resident.memories.recent[0]?.id).toBe(memory.id);
    expect(resident.memories.important.some((entry) => entry.id === memory.id)).toBe(true);
  });

  it("重要记忆不会被 40 条以上的普通记忆挤出", () => {
    const world = makeWorld();
    const resident = findResident(world, "r_linlan");
    resident.memories.recent = [];
    resident.memories.important = [];
    resident.memories.longTerm = [];

    const important = recordMemory(world, resident, {
      text: "高重要度记忆：诊所的发电机被修好了",
      kind: "life",
      importance: 8,
      valence: 0.9,
    });
    for (let index = 0; index < 60; index += 1) {
      recordMemory(world, resident, {
        text: `普通记忆 ${index}`,
        kind: "action",
        importance: 2,
      });
    }

    expect(resident.memories.recent).toHaveLength(MAX_RECENT_MEMORIES);
    expect(resident.memories.important.some((memory) => memory.id === important.id)).toBe(true);
    expect(resident.memories.important.every((memory) => memory.importance >= 6)).toBe(true);
    expect(resident.memories.recent.every((memory) => memory.importance === 2)).toBe(true);
    // importance >= 8 同时进入长期摘要。
    expect(resident.memories.longTerm.length).toBeGreaterThan(0);
    expect(resident.memories.longTerm.some((line) => line.includes("高重要度记忆"))).toBe(true);

    // 更高重要度的记忆排在重要记忆最前面。
    const moreImportant = recordMemory(world, resident, {
      text: "最高重要度记忆：街区停电",
      kind: "trauma",
      importance: 10,
      valence: -1,
    });
    expect(resident.memories.important[0]?.id).toBe(moreImportant.id);
  });
});

describe("AI 上下文与提案安全", () => {
  it("buildAiDecisionRequest 满足 aiDecisionRequestSchema 的数量上限", () => {
    const world = makeWorld();
    tickWorldMany(world, 50);
    let checked = 0;

    for (const resident of world.residents.filter((candidate) => candidate.alive && !candidate.paused)) {
      const request = buildAiDecisionRequest(world, resident.id);
      expect(request, `request for ${resident.id}`).not.toBeNull();
      const parsed = aiDecisionRequestSchema.safeParse(request);
      expect(
        parsed.success,
        `${resident.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
      if (!request) continue;

      expect(request.targets.length).toBeLessThanOrEqual(16);
      expect(request.allowedActions.length).toBeGreaterThanOrEqual(1);
      expect(request.allowedActions.length).toBeLessThanOrEqual(AI_ACTIONS.length);
      expect(new Set(request.targets.map((target) => target.id)).size).toBe(request.targets.length);
      expect(request.targets.some((target) => target.id === resident.id)).toBe(false);
      for (const action of request.allowedActions) {
        expect(AI_ACTIONS).toContain(action);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);

    expect(buildAiDecisionRequest(world, "r_missing")).toBeNull();
  });

  it("未知目标被拒绝且不会写入 aiHint", () => {
    const world = makeWorld();
    tickWorldMany(world, 50);
    const request = buildAiDecisionRequest(world, "r_linlan")!;
    const resident = findResident(world, "r_linlan");
    resident.aiHint = null;

    const result = applyAiProposal(world, request, {
      action: "rest",
      targetId: "ghost_target",
      reason: "测试未知目标",
    });
    expect(result.ok).toBe(false);
    expect(resident.aiHint).toBeNull();
  });

  it("行动不在 request.allowedActions 时被拒绝", () => {
    const world = makeWorld();
    tickWorldMany(world, 50);

    for (const candidate of world.residents) {
      const request = buildAiDecisionRequest(world, candidate.id);
      if (!request) continue;
      const disallowed = AI_ACTIONS.find((action) => !request.allowedActions.includes(action));
      if (!disallowed) continue;

      const resident = findResident(world, candidate.id);
      resident.aiHint = null;
      const result = applyAiProposal(world, request, {
        action: disallowed,
        reason: "测试未授权行动",
      });
      expect(result.ok).toBe(false);
      expect(resident.aiHint).toBeNull();
      return;
    }
    // 安全设计上不应存在“居民拥有全部 17 个行动”的合法上下文；若出现则测试需要重新评估。
    throw new Error("没有找到任何一个 allowedActions 非全集居民，无法构造越权提案测试");
  });

  it("行动与目标类型不匹配时被拒绝（ACTION_TARGET_KIND 白名单）", () => {
    const world = makeWorld();
    tickWorldMany(world, 50);
    const request = buildAiDecisionRequest(world, "r_linlan")!;
    const resident = findResident(world, "r_linlan");
    resident.aiHint = null;

    const residentTarget = request.targets.find((target) => target.kind === "resident");
    const buildingTarget = request.targets.find((target) => target.kind === "building");
    expect(residentTarget).toBeDefined();
    expect(buildingTarget).toBeDefined();

    expect(request.allowedActions).toContain("work");
    const workOnResident = applyAiProposal(world, request, {
      action: "work",
      targetId: residentTarget!.id,
      reason: "work 不能指向居民",
    });
    expect(workOnResident.ok).toBe(false);

    expect(request.allowedActions).toContain("talk");
    const talkOnBuilding = applyAiProposal(world, request, {
      action: "talk",
      targetId: buildingTarget!.id,
      reason: "talk 不能指向建筑",
    });
    expect(talkOnBuilding.ok).toBe(false);

    expect(resident.aiHint).toBeNull();
  });

  it("需要目标的社交行动缺少 targetId 时被拒绝", () => {
    const world = makeWorld();
    tickWorldMany(world, 50);
    const request = buildAiDecisionRequest(world, "r_linlan")!;
    const resident = findResident(world, "r_linlan");
    resident.aiHint = null;
    expect(request.allowedActions).toContain("talk");

    const result = applyAiProposal(world, request, {
      action: "talk",
      reason: "没有目标的社交提案",
    });
    expect(result.ok).toBe(false);
    expect(resident.aiHint).toBeNull();
  });

  it("合法提案写入 aiHint，并被世界与事件记录", () => {
    const world = makeWorld();
    tickWorldMany(world, 50);
    const request = buildAiDecisionRequest(world, "r_linlan")!;
    const resident = findResident(world, "r_linlan");
    resident.aiHint = null;

    const buildingTarget = request.targets.find((target) => target.kind === "building")!;
    expect(request.allowedActions).toContain("work");

    const tickBefore = world.clock.tick;
    const result = applyAiProposal(world, request, {
      action: "work",
      targetId: buildingTarget.id,
      reason: "去工作场所推进项目",
    });
    expect(result.ok).toBe(true);
    // 引擎通过 world 中的同一个居民对象写入 aiHint；重新从 world 读取以避免
    // TypeScript 对前面 `resident.aiHint = null` 的控制流收窄误判。
    const hint = findResident(world, "r_linlan").aiHint;
    expect(hint).not.toBeNull();
    if (!hint) throw new Error("合法提案必须写入 aiHint");
    expect(hint.action).toBe("work");
    expect(hint.targetId).toBe(buildingTarget.id);
    expect(hint.targetKind).toBe("building");
    expect(hint.createdTick).toBe(tickBefore);
    expect(hint.expiresTick).toBe(tickBefore + 14);
    expect(world.lastAiEventTick).toBe(tickBefore);
    expect(result.event).toBeDefined();
    expect(world.events[0]?.id).toBe(result.event?.id);
    expect(world.events[0]?.tag).toBe("AI ADVISOR");
  });

  it("社交行动指向居民时是合法提案", () => {
    const world = makeWorld();
    tickWorldMany(world, 50);
    const request = buildAiDecisionRequest(world, "r_linlan")!;
    const resident = findResident(world, "r_linlan");
    resident.aiHint = null;

    const residentTarget = request.targets.find((target) => target.kind === "resident")!;
    expect(request.allowedActions).toContain("talk");
    const result = applyAiProposal(world, request, {
      action: "talk",
      targetId: residentTarget.id,
      reason: "想和熟人聊一聊近况",
    });
    expect(result.ok).toBe(true);
    const hint = findResident(world, "r_linlan").aiHint;
    expect(hint).not.toBeNull();
    expect(hint?.targetKind).toBe("resident");
  });
});

describe("性能冒烟", () => {
  it("创建世界并推进 100 tick 在合理时间内完成", () => {
    const startedAt = performance.now();
    const world = makeWorld();
    tickWorldMany(world, 100);
    const elapsedMs = performance.now() - startedAt;

    // 只记录耗时，不做严格易碎阈值：8 秒足以覆盖极慢的 CI 机器。
    console.log(`[perf] createInitialWorld + 100 ticks: ${elapsedMs.toFixed(1)}ms`);
    expect(world.clock.tick).toBe(100);
    expect(elapsedMs).toBeLessThan(8_000);
  });
});
