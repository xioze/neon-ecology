import { describe, expect, it } from "vitest";

import { MAP_DEPTH, MAP_WIDTH } from "../src/shared/constants";
import type { Vec2, WorldState } from "../src/shared/types";
import {
  clampToWalkable,
  findPath,
  getBuildingCenter,
  getBuildingDoor,
  insideMap,
  isTileInsideBuilding,
  isWalkableTile,
} from "../src/sim/city";
import { tickWorld } from "../src/sim/engine";
import { expectResidentReferencesLegal, findBuilding, makeWorld } from "./setup";

/**
 * Assert an A* result is structurally legal: every waypoint is an in-map,
 * walkable tile that is not inside a blocking building, and consecutive
 * waypoints are single grid steps.
 */
function expectLegalPath(world: WorldState, path: Vec2[] | null, label: string): Vec2[] {
  expect(path, `${label}: findPath returned null`).not.toBeNull();
  const points = path as Vec2[];
  expect(points.length, `${label}: path must not be empty`).toBeGreaterThan(0);

  for (const point of points) {
    expect(Number.isInteger(point.x), `${label}: x integer`).toBe(true);
    expect(Number.isInteger(point.z), `${label}: z integer`).toBe(true);
    expect(insideMap(point.x, point.z), `${label}: (${point.x}, ${point.z}) inside map`).toBe(true);
    expect(
      isWalkableTile(world.buildings, point.x, point.z),
      `${label}: (${point.x}, ${point.z}) must be walkable`,
    ).toBe(true);
    for (const building of world.buildings) {
      if (building.openAir) continue;
      expect(
        isTileInsideBuilding(building, point.x, point.z),
        `${label}: (${point.x}, ${point.z}) inside blocking building ${building.id}`,
      ).toBe(false);
    }
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const dx = Math.abs(current.x - previous.x);
    const dz = Math.abs(current.z - previous.z);
    expect(dx, `${label}: step dx`).toBeLessThanOrEqual(1);
    expect(dz, `${label}: step dz`).toBeLessThanOrEqual(1);
    expect(dx + dz, `${label}: waypoints must advance`).toBeGreaterThan(0);
  }
  return points;
}

describe("A* 寻路", () => {
  it("每名居民都能从住宅门寻路到工作地点门，且路径绝不穿过建筑", () => {
    const world = makeWorld();
    expect(world.residents.length).toBeGreaterThanOrEqual(10);

    for (const resident of world.residents) {
      const home = findBuilding(world, resident.homeBuildingId);
      const work = findBuilding(world, resident.workBuildingId);
      const homeDoor = getBuildingDoor(home);
      const workDoor = getBuildingDoor(work);

      expect(
        isWalkableTile(world.buildings, homeDoor.x, homeDoor.z),
        `${home.id} door must be walkable`,
      ).toBe(true);
      expect(
        isWalkableTile(world.buildings, workDoor.x, workDoor.z),
        `${work.id} door must be walkable`,
      ).toBe(true);

      const path = expectLegalPath(
        world,
        findPath(world.buildings, homeDoor, workDoor),
        `${resident.id} ${home.id}->${work.id}`,
      );
      expect(path[0]).toEqual(homeDoor);
      expect(path[path.length - 1]).toEqual(workDoor);
      expect(path.length).toBeGreaterThan(1);
    }
  });

  it("全部建筑门两两可达，且同一查询结果确定", () => {
    const world = makeWorld();
    const doors = world.buildings.map((building) => ({
      id: building.id,
      door: getBuildingDoor(building),
    }));

    for (let left = 0; left < doors.length; left += 1) {
      for (let right = left + 1; right < doors.length; right += 1) {
        const from = doors[left]!;
        const to = doors[right]!;
        const path = findPath(world.buildings, from.door, to.door);
        expectLegalPath(world, path, `${from.id}->${to.id}`);
        // 引擎不能依赖隐藏随机性：重复查询结果必须一致。
        expect(findPath(world.buildings, from.door, to.door)).toEqual(path);
      }
    }
  });

  it("起点落在建筑内部时，A* 从最近可行走瓦片出发", () => {
    const world = makeWorld();
    const building = findBuilding(world, "b_corp");
    const center = getBuildingCenter(building);
    // 中心点确实位于建筑内部（非 openAir）。
    expect(isWalkableTile(world.buildings, center.x, center.z)).toBe(false);

    const goal = getBuildingDoor(findBuilding(world, "b_market"));
    const startTile = clampToWalkable(world.buildings, center.x, center.z);
    const path = expectLegalPath(
      world,
      findPath(world.buildings, center, goal),
      "inside b_corp -> b_market door",
    );
    expect(path[0]).toEqual(startTile);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it("openAir 公共空间不阻挡通行，封闭建筑阻挡通行", () => {
    const world = makeWorld();
    const park = findBuilding(world, "b_park");
    expect(park.openAir).toBe(true);
    for (let x = park.x; x < park.x + park.w; x += 1) {
      for (let z = park.z; z < park.z + park.d; z += 1) {
        expect(isWalkableTile(world.buildings, x, z), `park tile (${x}, ${z})`).toBe(true);
      }
    }

    const corp = findBuilding(world, "b_corp");
    expect(corp.openAir).toBe(false);
    let blockingTiles = 0;
    for (let x = corp.x; x < corp.x + corp.w; x += 1) {
      for (let z = corp.z; z < corp.z + corp.d; z += 1) {
        expect(isWalkableTile(world.buildings, x, z), `corp tile (${x}, ${z})`).toBe(false);
        blockingTiles += 1;
      }
    }
    expect(blockingTiles).toBe(corp.w * corp.d);
  });
});

describe("200 tick 移动不变量", () => {
  it("所有存活居民始终在地图内、不进入非 openAir 建筑、建筑内状态引用合法", () => {
    const world = makeWorld();
    const problems: string[] = [];
    let observations = 0;

    for (let tick = 0; tick < 200; tick += 1) {
      tickWorld(world);
      for (const resident of world.residents) {
        if (!resident.alive) continue;
        observations += 1;
        const { x, z } = resident.position;
        if (!insideMap(x, z)) {
          problems.push(`tick ${world.clock.tick}: ${resident.id} out of map at (${x}, ${z})`);
          continue;
        }
        for (const building of world.buildings) {
          if (building.openAir) continue;
          if (isTileInsideBuilding(building, x, z)) {
            problems.push(
              `tick ${world.clock.tick}: ${resident.id} inside blocking ${building.id} at (${x}, ${z})`,
            );
          }
        }
        if (resident.insideBuildingId) {
          const inside = world.buildings.find((building) => building.id === resident.insideBuildingId);
          if (!inside) {
            problems.push(`tick ${world.clock.tick}: ${resident.id} inside missing building`);
          } else {
            // 进入建筑后引擎把居民放在该建筑门口；不允许借“室内”隐藏到别处。
            const door = getBuildingDoor(inside);
            if (resident.position.x !== door.x || resident.position.z !== door.z) {
              problems.push(
                `tick ${world.clock.tick}: ${resident.id} inside ${inside.id} but at (${resident.position.x}, ${resident.position.z}), door (${door.x}, ${door.z})`,
              );
            }
          }
        }
      }
    }

    expect(problems).toEqual([]);
    expect(observations).toBeGreaterThan(200 * 10);
    expect(world.clock.tick).toBe(200);
    expectResidentReferencesLegal(world);
  });

  it("居民会位移、会进入建筑，建筑会记录 enter/leave 访问", () => {
    const world = makeWorld();
    const startPositions = new Map(
      world.residents.map((resident) => [resident.id, { ...resident.position }]),
    );
    const movedResidents = new Set<string>();
    const enteredResidents = new Set<string>();
    const enteredBuildings = new Set<string>();

    for (let tick = 0; tick < 200; tick += 1) {
      tickWorld(world);
      for (const resident of world.residents) {
        if (!resident.alive) continue;
        const start = startPositions.get(resident.id)!;
        if (start.x !== resident.position.x || start.z !== resident.position.z) {
          movedResidents.add(resident.id);
        }
        if (resident.insideBuildingId) {
          enteredResidents.add(resident.id);
          enteredBuildings.add(resident.insideBuildingId);
        }
      }
    }

    expect(movedResidents.size).toBeGreaterThanOrEqual(5);
    expect(enteredResidents.size).toBeGreaterThanOrEqual(2);
    expect(enteredBuildings.size).toBeGreaterThanOrEqual(1);

    const visits = world.buildings.flatMap((building) =>
      building.recentVisits.map((visit) => ({ buildingId: building.id, ...visit })),
    );
    const enterVisits = visits.filter((visit) => visit.kind === "enter");
    const leaveVisits = visits.filter((visit) => visit.kind === "leave");
    expect(enterVisits.length).toBeGreaterThan(0);
    expect(leaveVisits.length).toBeGreaterThan(0);

    const buildingsWithEnter = new Set(enterVisits.map((visit) => visit.buildingId));
    const buildingsWithLeave = new Set(leaveVisits.map((visit) => visit.buildingId));
    expect(buildingsWithEnter.size).toBeGreaterThanOrEqual(3);
    expect(buildingsWithLeave.size).toBeGreaterThanOrEqual(3);

    const residentIds = new Set(world.residents.map((resident) => resident.id));
    for (const building of world.buildings) {
      for (const visit of building.recentVisits) {
        expect(residentIds.has(visit.residentId), `visit resident ${visit.residentId}`).toBe(true);
        expect(["enter", "leave"]).toContain(visit.kind);
        expect(Number.isInteger(visit.tick)).toBe(true);
        expect(visit.tick).toBeGreaterThanOrEqual(0);
        expect(visit.tick).toBeLessThanOrEqual(world.clock.tick);
        expect(visit.day).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("长时间运行后位置仍在边界内（500 tick 补充冒烟）", () => {
    const world = makeWorld();
    let violations = 0;
    for (let tick = 0; tick < 500; tick += 1) {
      tickWorld(world);
      for (const resident of world.residents) {
        if (!resident.alive) continue;
        const { x, z } = resident.position;
        if (x < 0 || z < 0 || x >= MAP_WIDTH || z >= MAP_DEPTH) violations += 1;
        for (const building of world.buildings) {
          if (!building.openAir && isTileInsideBuilding(building, x, z)) violations += 1;
        }
      }
    }
    expect(violations).toBe(0);
    expect(world.clock.tick).toBe(500);
    // 死亡是合法演化结果，但世界不应崩溃。
    expect(world.residents.filter((resident) => resident.alive).length).toBeGreaterThan(0);
  });
});
