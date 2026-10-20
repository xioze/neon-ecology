import {
  MAP_DEPTH,
  MAP_WIDTH,
  ROAD_COLUMNS,
  ROAD_ROWS,
  TILE_SIZE,
} from "../shared/constants";
import type { Building, Vec2, WorldState } from "../shared/types";
import type { Rng } from "./rng";

export interface TilePoint {
  x: number;
  z: number;
}

export function insideMap(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < MAP_WIDTH && z < MAP_DEPTH;
}

export function isRoadTile(x: number, z: number): boolean {
  if (!insideMap(x, z)) return false;
  for (const [a, b] of ROAD_COLUMNS) if (x === a || x === b) return true;
  for (const [a, b] of ROAD_ROWS) if (z === a || z === b) return true;
  return false;
}

export function isSidewalkTile(x: number, z: number): boolean {
  if (!insideMap(x, z)) return false;
  if (isRoadTile(x, z)) return false;
  return (
    isRoadTile(x + 1, z) ||
    isRoadTile(x - 1, z) ||
    isRoadTile(x, z + 1) ||
    isRoadTile(x, z - 1)
  );
}

export function getBuildingFootprint(building: Building): {
  x: number;
  z: number;
  w: number;
  d: number;
} {
  return { x: building.x, z: building.z, w: building.w, d: building.d };
}

export function isTileInsideBuilding(building: Building, x: number, z: number): boolean {
  if (building.openAir) return false;
  return x >= building.x && x < building.x + building.w && z >= building.z && z < building.z + building.d;
}

export function buildingAtTile(buildings: Building[], x: number, z: number): Building | null {
  for (const building of buildings) {
    if (isTileInsideBuilding(building, x, z)) return building;
  }
  return null;
}

export function isWalkableTile(buildings: Building[], x: number, z: number): boolean {
  if (!insideMap(x, z)) return false;
  return buildingAtTile(buildings, x, z) === null;
}

export function clampToWalkable(
  buildings: Building[],
  x: number,
  z: number,
): Vec2 {
  const tx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(x)));
  const tz = Math.max(0, Math.min(MAP_DEPTH - 1, Math.round(z)));
  if (isWalkableTile(buildings, tx, tz)) return { x: tx, z: tz };

  for (let radius = 1; radius <= 6; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (isWalkableTile(buildings, nx, nz)) return { x: nx, z: nz };
      }
    }
  }
  return { x: 0, z: 0 };
}

/**
 * A door is a walkable tile adjacent to the building, preferentially facing a
 * road. Residents always path to a door before entering.
 */
export function getBuildingDoor(building: Building): TilePoint {
  const candidates: TilePoint[] = [
    { x: building.x + Math.floor(building.w / 2), z: building.z + building.d },
    { x: building.x + Math.floor(building.w / 2), z: building.z - 1 },
    { x: building.x - 1, z: building.z + Math.floor(building.d / 2) },
    { x: building.x + building.w, z: building.z + Math.floor(building.d / 2) },
  ];
  for (const candidate of candidates) {
    if (!insideMap(candidate.x, candidate.z)) continue;
    if (isRoadTile(candidate.x, candidate.z)) return candidate;
  }
  return candidates.find((candidate) => insideMap(candidate.x, candidate.z)) ?? { x: 0, z: 0 };
}

export function getBuildingCenter(building: Building): Vec2 {
  return {
    x: building.x + building.w / 2 - 0.5,
    z: building.z + building.d / 2 - 0.5,
  };
}

/** Convert a simulation tile coordinate into a Three.js world coordinate. */
export function tileToWorld(x: number, z: number): { x: number; z: number } {
  return {
    x: (x - (MAP_WIDTH - 1) / 2) * TILE_SIZE,
    z: (z - (MAP_DEPTH - 1) / 2) * TILE_SIZE,
  };
}

/** Convert a Three.js ground coordinate into a tile coordinate. */
export function worldToTile(x: number, z: number): { x: number; z: number } {
  return {
    x: x / TILE_SIZE + (MAP_WIDTH - 1) / 2,
    z: z / TILE_SIZE + (MAP_DEPTH - 1) / 2,
  };
}

export function buildingCenterWorld(building: Building): { x: number; z: number } {
  return tileToWorld(building.x + building.w / 2 - 0.5, building.z + building.d / 2 - 0.5);
}

export function doorWorld(building: Building): { x: number; z: number } {
  const door = getBuildingDoor(building);
  return tileToWorld(door.x, door.z);
}

export function footprintWorldSize(building: Building): { w: number; d: number } {
  return { w: building.w * TILE_SIZE, d: building.d * TILE_SIZE };
}

const DIRECTIONS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** A* on the walkable tile grid. Returns an inclusive path of tile centres. */
export function findPath(
  buildings: Building[],
  start: Vec2,
  goal: Vec2,
): Vec2[] | null {
  const startTile = clampToWalkable(buildings, start.x, start.z);
  const goalTile = clampToWalkable(buildings, goal.x, goal.z);
  if (startTile.x === goalTile.x && startTile.z === goalTile.z) return [startTile];
  if (!isWalkableTile(buildings, goalTile.x, goalTile.z)) return null;

  const total = MAP_WIDTH * MAP_DEPTH;
  const indexOf = (x: number, z: number) => z * MAP_WIDTH + x;
  const open: Array<{ x: number; z: number; g: number; f: number }> = [];
  const gScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startIndex = indexOf(startTile.x, startTile.z);
  const goalIndex = indexOf(goalTile.x, goalTile.z);
  gScore[startIndex] = 0;
  open.push({
    x: startTile.x,
    z: startTile.z,
    g: 0,
    f: heuristic(startTile, goalTile),
  });

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[best]!.f) best = i;
    const current = open.splice(best, 1)[0]!;
    const currentIndex = indexOf(current.x, current.z);
    if (closed[currentIndex]) continue;
    closed[currentIndex] = 1;
    if (currentIndex === goalIndex) {
      const path: Vec2[] = [];
      let cursor = goalIndex;
      while (cursor !== -1) {
        path.push({ x: cursor % MAP_WIDTH, z: Math.floor(cursor / MAP_WIDTH) });
        if (cursor === startIndex) break;
        cursor = cameFrom[cursor]!;
      }
      return path.reverse();
    }

    for (const [dx, dz, cost] of DIRECTIONS) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      if (!isWalkableTile(buildings, nx, nz)) continue;
      if (dx !== 0 && dz !== 0) {
        if (!isWalkableTile(buildings, current.x + dx, current.z)) continue;
        if (!isWalkableTile(buildings, current.x, current.z + dz)) continue;
      }
      const neighborIndex = indexOf(nx, nz);
      if (closed[neighborIndex]) continue;
      const tentative = current.g + cost;
      if (tentative >= gScore[neighborIndex]!) continue;
      cameFrom[neighborIndex] = currentIndex;
      gScore[neighborIndex] = tentative;
      const f = tentative + heuristic({ x: nx, z: nz }, goalTile);
      const existing = open.find((node) => node.x === nx && node.z === nz);
      if (existing) {
        existing.g = tentative;
        existing.f = f;
      } else {
        open.push({ x: nx, z: nz, g: tentative, f });
      }
    }
  }
  return null;
}

function heuristic(a: TilePoint, b: TilePoint): number {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}

/** Remove collinear nodes while retaining corner turns. */
export function simplifyPath(path: Vec2[]): Vec2[] {
  if (path.length <= 2) return path;
  const result: Vec2[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]!;
    const current = path[i]!;
    const next = path[i + 1]!;
    const d1x = Math.sign(current.x - prev.x);
    const d1z = Math.sign(current.z - prev.z);
    const d2x = Math.sign(next.x - current.x);
    const d2z = Math.sign(next.z - current.z);
    if (d1x !== d2x || d1z !== d2z) result.push(current);
  }
  result.push(path[path.length - 1]!);
  return result;
}

export function nearestWalkableToResident(
  world: Pick<WorldState, "buildings">,
  target: Vec2,
): Vec2 {
  return clampToWalkable(world.buildings, target.x, target.z);
}

export function randomWalkablePosition(world: Pick<WorldState, "buildings">, rng: Rng): Vec2 {
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = rng.int(0, MAP_WIDTH - 1);
    const z = rng.int(0, MAP_DEPTH - 1);
    if (isWalkableTile(world.buildings, x, z)) return { x, z };
  }
  return { x: 1, z: 1 };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function adjacentTo(a: Vec2, b: Vec2, tolerance = 2.2): boolean {
  return distance(a, b) <= tolerance;
}
