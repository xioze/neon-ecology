import { expect } from "vitest";

import { MAP_DEPTH, MAP_WIDTH } from "../src/shared/constants";
import type { Building, Resident, WorldState } from "../src/shared/types";
import { isTileInsideBuilding } from "../src/sim/city";
import { createInitialWorld } from "../src/sim/data";
import { tickWorld } from "../src/sim/engine";

// Deterministic tests must not depend on the machine time zone. The world's
// createdAtIso is fixed explicitly, but a stable TZ also keeps any Date-based
// diagnostics reproducible.
process.env.TZ = "UTC";

/** Fixed timestamp used by every deterministic world construction. */
export const FIXED_CREATED_AT = "2026-10-20T00:00:00.000Z";
/** Fixed seed used by the main deterministic scenarios. */
export const FIXED_SEED = 12345;

export function makeWorld(seed: number = FIXED_SEED, createdAtIso: string = FIXED_CREATED_AT): WorldState {
  return createInitialWorld({ seed, createdAtIso });
}

/** Deep clone through JSON: the domain model is JSON-safe. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function tickWorldMany(world: WorldState, count: number): void {
  for (let i = 0; i < count; i += 1) tickWorld(world);
}

export function findBuilding(world: WorldState, id: string): Building {
  const building = world.buildings.find((candidate) => candidate.id === id);
  expect(building, `building ${id} should exist`).toBeDefined();
  return building as Building;
}

export function findResident(world: WorldState, id: string): Resident {
  const resident = world.residents.find((candidate) => candidate.id === id);
  expect(resident, `resident ${id} should exist`).toBeDefined();
  return resident as Resident;
}

/** Position must stay inside the 32x28 grid and never inside a blocking footprint. */
export function expectResidentPositionLegal(world: WorldState, resident: Resident): void {
  const { x, z } = resident.position;
  expect(Number.isInteger(x), `${resident.id} x must be an integer tile (got ${x})`).toBe(true);
  expect(Number.isInteger(z), `${resident.id} z must be an integer tile (got ${z})`).toBe(true);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(z).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThan(MAP_WIDTH);
  expect(z).toBeLessThan(MAP_DEPTH);
  for (const building of world.buildings) {
    if (building.openAir) continue;
    expect(
      isTileInsideBuilding(building, x, z),
      `${resident.id} stands inside blocking building ${building.id} at (${x}, ${z})`,
    ).toBe(false);
  }
}

/** Structural references a live resident must satisfy after any command or tick. */
export function expectResidentReferencesLegal(world: WorldState): void {
  const buildingIds = new Set(world.buildings.map((building) => building.id));
  const residentIds = new Set(world.residents.map((resident) => resident.id));
  const factionIds = new Set(world.factions.map((faction) => faction.id));
  for (const resident of world.residents) {
    expect(buildingIds.has(resident.homeBuildingId), `${resident.id} home ref`).toBe(true);
    expect(buildingIds.has(resident.workBuildingId), `${resident.id} work ref`).toBe(true);
    expect(factionIds.has(resident.factionId), `${resident.id} faction ref`).toBe(true);
    if (resident.insideBuildingId) {
      expect(buildingIds.has(resident.insideBuildingId), `${resident.id} inside ref`).toBe(true);
    }
    if (resident.currentAction?.targetBuildingId) {
      expect(
        buildingIds.has(resident.currentAction.targetBuildingId),
        `${resident.id} action building ref`,
      ).toBe(true);
    }
    if (resident.currentAction?.targetResidentId) {
      expect(
        residentIds.has(resident.currentAction.targetResidentId),
        `${resident.id} action resident ref`,
      ).toBe(true);
    }
    for (const targetId of Object.keys(resident.relationships)) {
      expect(residentIds.has(targetId), `${resident.id} relationship ref ${targetId}`).toBe(true);
    }
  }
}
