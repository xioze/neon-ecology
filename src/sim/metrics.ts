import type { WorldState } from "../shared/types";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number): number {
  return Math.round(value);
}

/** Recompute aggregate values that are pure functions of current state. */
export function refreshDerivedMetrics(world: WorldState): void {
  const alive = world.residents.filter((resident) => resident.alive);
  const population = alive.length;
  world.metrics.population = population;
  world.metrics.averageMood = population
    ? round(alive.reduce((sum, resident) => sum + resident.mood, 0) / population)
    : 0;
  world.metrics.averageWealth = population
    ? round(alive.reduce((sum, resident) => sum + resident.wealth, 0) / population)
    : 0;
  world.metrics.inequality = computeInequality(alive.map((resident) => resident.wealth));
  world.metrics.resourceSupply = computeResourceSupply(world);

  const avgSafety = population
    ? alive.reduce((sum, resident) => sum + resident.needs.safety, 0) / population
    : 50;
  const avgMood = world.metrics.averageMood;
  const avgStress = population
    ? alive.reduce((sum, resident) => sum + resident.stress, 0) / population
    : 50;
  const hostility = alive.reduce((sum, resident) => {
    let host = 0;
    for (const relation of Object.values(resident.relationships)) {
      host += Math.max(0, relation.hostility);
    }
    return sum + host;
  }, 0);
  const hostilityPressure = population
    ? clamp(hostility / Math.max(1, population * 2), 0, 60)
    : 0;

  const stability =
    17 +
    avgMood * 0.25 +
    world.metrics.trust * 0.22 +
    world.metrics.resourceSupply * 0.19 +
    avgSafety * 0.12 +
    (100 - world.metrics.inequality) * 0.09 -
    world.metrics.pollution * 0.1 -
    avgStress * 0.08 -
    hostilityPressure * 0.22;
  world.metrics.stability = clamp(round(stability), 0, 100);
}

export function computeResourceSupply(world: WorldState): number {
  const population = Math.max(1, world.residents.filter((resident) => resident.alive).length);
  const foodCoverage = clamp(world.reserves.food / (population * 12), 0, 1);
  const energyCoverage = clamp(world.reserves.energy / (population * 40), 0, 1);
  const medsCoverage = clamp(world.reserves.meds / (population * 8), 0, 1);
  const buildingCoverage = clamp(
    world.buildings.filter((building) => building.operational && building.open).length / 12,
    0,
    1,
  );
  return clamp(
    round(
      8 +
        foodCoverage * 31 +
        energyCoverage * 29 +
        medsCoverage * 20 +
        buildingCoverage * 12,
    ),
    0,
    100,
  );
}

export function computeInequality(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i]!;
  const gini = (2 * weighted) / (n * sum) - (n + 1) / n;
  return clamp(round(gini * 100), 0, 100);
}

export function trustBaseline(world: WorldState): number {
  return clamp(
    30 +
      world.rules.welfare * 0.27 +
      world.metrics.resourceSupply * 0.22 +
      30 -
      world.metrics.pollution * 0.18,
    0,
    100,
  );
}
