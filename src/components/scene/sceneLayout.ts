import * as THREE from "three";
import {
  BUILDING_TYPE_META,
  DEFAULT_CAMERA,
  MAP_DEPTH,
  MAP_WIDTH,
  ROAD_COLUMNS,
  ROAD_ROWS,
  TILE_SIZE,
} from "../../shared/constants";
import type { Building, BuildingType, Vec2 } from "../../shared/types";
import {
  buildingCenterWorld,
  insideMap,
  isRoadTile,
  isSidewalkTile,
  tileToWorld,
} from "../../sim/city";

/* ------------------------------------------------------------------ */
/* Palette & scene constants                                           */
/* ------------------------------------------------------------------ */

export const SCENE_BG = "#04070d";
export const FOG_COLOR = "#07131f";

/**
 * Establishing shot. Kept slightly below the geometric centre so the dense
 * grid sits above the bottom console instead of hiding behind it.
 */
export const SCENE_CAMERA_POSITION: [number, number, number] = [
  DEFAULT_CAMERA.position[0],
  DEFAULT_CAMERA.position[1],
  DEFAULT_CAMERA.position[2],
];
export const SCENE_CAMERA_TARGET: [number, number, number] = [0, -2.5, 2];

export const PALETTE = {
  cyan: "#5af2d0",
  magenta: "#ff4fa3",
  purple: "#a48aff",
  gold: "#ffcf6a",
  blue: "#59b8ff",
  pink: "#ff6e9f",
  green: "#8fffc8",
  ice: "#bfe9ff",
} as const;

export const SELECTED_COLOR = PALETTE.cyan;
export const HOVERED_COLOR = PALETTE.magenta;

export const DEG2RAD = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Deterministic hashing helpers                                       */
/* ------------------------------------------------------------------ */

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hash01(value: string, salt = 0): number {
  const hash = hashString(`${value}#${salt}`);
  return (hash % 100000) / 100000;
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

export interface BuildingWorld {
  cx: number;
  cz: number;
  width: number;
  depth: number;
  height: number;
}

const TYPE_HEIGHT_BASE: Record<BuildingType, number> = {
  residential: 6,
  shop: 4.2,
  workplace: 13,
  public: 6.5,
  medical: 7.5,
  utility: 8.5,
};

const TYPE_CAPACITY_HEIGHT: Record<BuildingType, number> = {
  residential: 0.26,
  shop: 0.08,
  workplace: 0.28,
  public: 0.09,
  medical: 0.2,
  utility: 0.45,
};

export function getBuildingHeight(building: Pick<Building, "type" | "capacity" | "id">): number {
  const base = TYPE_HEIGHT_BASE[building.type];
  const jitter = (hash01(building.id, 7) - 0.5) * 2.2;
  const raw = base + building.capacity * TYPE_CAPACITY_HEIGHT[building.type] + jitter;
  return Math.max(3.4, Math.round(raw * 10) / 10);
}

export function getBuildingWorld(building: Building): BuildingWorld {
  const center = buildingCenterWorld(building);
  return {
    cx: center.x,
    cz: center.z,
    width: building.w * TILE_SIZE,
    depth: building.d * TILE_SIZE,
    height: getBuildingHeight(building),
  };
}

export function typeColor(type: BuildingType): string {
  return BUILDING_TYPE_META[type].color;
}

export function typeLabel(type: BuildingType): string {
  return BUILDING_TYPE_META[type].label;
}

/** Visual-only nudge so residents sharing the same door tile stay readable. */
export function residentVisualOffset(id: string): { x: number; z: number } {
  const angle = hash01(id, 11) * Math.PI * 2;
  const radius = 0.34 + hash01(id, 23) * 0.52;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

export function tileWorldCenter(x: number, z: number): { x: number; z: number } {
  return tileToWorld(x, z);
}

/* Placement footprints mirror the simulation store exactly. */
const PLACEMENT_DIMENSIONS: Record<BuildingType, [number, number]> = {
  residential: [4, 3],
  shop: [3, 3],
  workplace: [4, 4],
  public: [4, 3],
  medical: [3, 3],
  utility: [3, 3],
};

export function getPlacementDimensions(type: BuildingType): { w: number; d: number } {
  const [w, d] = PLACEMENT_DIMENSIONS[type];
  return { w, d };
}

export function placementOrigin(tileX: number, tileZ: number, type: BuildingType): Vec2 {
  const { w, d } = getPlacementDimensions(type);
  return {
    x: Math.round(tileX - Math.floor(w / 2)),
    z: Math.round(tileZ - Math.floor(d / 2)),
  };
}

/* ------------------------------------------------------------------ */
/* Static city ground layout (roads / sidewalks / neon curbs / lamps)  */
/* ------------------------------------------------------------------ */

export interface Cell {
  x: number;
  z: number;
}

export interface InstanceTransform {
  position: [number, number, number];
  rotationY?: number;
  scale?: [number, number, number];
  color?: string;
}

const ALL_TILES: Cell[] = [];
for (let z = 0; z < MAP_DEPTH; z++) {
  for (let x = 0; x < MAP_WIDTH; x++) {
    ALL_TILES.push({ x, z });
  }
}

export const MAP_TILES: readonly Cell[] = ALL_TILES;

function cellWorld(x: number, z: number): { x: number; z: number } {
  return tileToWorld(x, z);
}

export const ROAD_TILES: readonly Cell[] = ALL_TILES.filter((tile) => isRoadTile(tile.x, tile.z));

export const SIDEWALK_TILES: readonly Cell[] = ALL_TILES.filter(
  (tile) => isSidewalkTile(tile.x, tile.z),
);

/** Thin emissive strips on the sidewalk/road boundary. */
export const CURB_STRIPS: readonly InstanceTransform[] = (() => {
  const strips: InstanceTransform[] = [];
  const directions: Array<[number, number]> = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const colors = [PALETTE.cyan, PALETTE.magenta, PALETTE.purple, PALETTE.blue];
  for (const tile of SIDEWALK_TILES) {
    if ((tile.x * 7 + tile.z * 13) % 7 !== 0) continue;
    const base = cellWorld(tile.x, tile.z);
    for (const [dx, dz] of directions) {
      if (!isRoadTile(tile.x + dx, tile.z + dz)) continue;
      const horizontal = dz !== 0;
      strips.push({
        position: [
          base.x + (dx * TILE_SIZE) / 2,
          0.19,
          base.z + (dz * TILE_SIZE) / 2,
        ],
        rotationY: horizontal ? 0 : Math.PI / 2,
        scale: [TILE_SIZE * 0.92, 0.07, 0.12],
        color: colors[(tile.x + tile.z) % colors.length] ?? PALETTE.cyan,
      });
    }
  }
  return strips;
})();

export interface LampInstance {
  x: number;
  z: number;
  color: string;
}

export const STREET_LAMPS: readonly LampInstance[] = (() => {
  const lamps: LampInstance[] = [];
  const directions: Array<[number, number]> = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const colors = [PALETTE.cyan, PALETTE.magenta, PALETTE.purple];
  for (const tile of SIDEWALK_TILES) {
    if ((tile.x * 11 + tile.z * 17) % 13 !== 0) continue;
    const roadNeighbor = directions.find(([dx, dz]) => isRoadTile(tile.x + dx, tile.z + dz));
    if (!roadNeighbor) continue;
    const base = cellWorld(tile.x, tile.z);
    const color = colors[(tile.x + tile.z) % colors.length] ?? PALETTE.cyan;
    lamps.push({
      x: base.x + roadNeighbor[0] * 0.72,
      z: base.z + roadNeighbor[1] * 0.72,
      color,
    });
  }
  return lamps;
})();

/** Dashed lane markings between the paired road tiles. */
export const LANE_DASHES: readonly InstanceTransform[] = (() => {
  const dashes: InstanceTransform[] = [];
  const columnSet = new Set<number>(ROAD_COLUMNS.flatMap(([a, b]) => [a, b]));
  const rowSet = new Set<number>(ROAD_ROWS.flatMap(([a, b]) => [a, b]));
  for (const [a, b] of ROAD_ROWS) {
    const z = (a + b) / 2;
    for (let x = 0.5; x < MAP_WIDTH; x += 2) {
      if (columnSet.has(Math.floor(x))) continue;
      const world = tileToWorld(x, z);
      dashes.push({
        position: [world.x, 0.075, world.z],
        scale: [1.15, 0.02, 0.16],
        color: PALETTE.ice,
      });
    }
  }
  for (const [a, b] of ROAD_COLUMNS) {
    const x = (a + b) / 2;
    for (let z = 0.5; z < MAP_DEPTH; z += 2) {
      if (rowSet.has(Math.floor(z))) continue;
      const world = tileToWorld(x, z);
      dashes.push({
        position: [world.x, 0.075, world.z],
        rotationY: Math.PI / 2,
        scale: [1.15, 0.02, 0.16],
        color: PALETTE.ice,
      });
    }
  }
  return dashes;
})();

/* ------------------------------------------------------------------ */
/* District labels (rendered as Chinese HTML labels inside the scene)  */
/* ------------------------------------------------------------------ */

export interface ZoneLabel {
  id: string;
  x: number;
  z: number;
  title: string;
  subtitle: string;
  color: string;
}

export const ZONE_LABELS: readonly ZoneLabel[] = [
  {
    id: "zone-north-harbor",
    x: 3,
    z: 5.4,
    title: "自由港北岸",
    subtitle: "霓虹公寓 · 社区互助网络",
    color: PALETTE.cyan,
  },
  {
    id: "zone-corp",
    x: 24.5,
    z: 5.4,
    title: "企业穹顶",
    subtitle: "新纪元塔 · 企业生活区",
    color: PALETTE.blue,
  },
  {
    id: "zone-harbor-market",
    x: 17,
    z: 10.6,
    title: "第七码头市场带",
    subtitle: "面馆 · 义体诊所 · 旧城商业",
    color: PALETTE.gold,
  },
  {
    id: "zone-rain-homes",
    x: 11.5,
    z: 20.9,
    title: "雨棚住宅区",
    subtitle: "自由港居民 · 夜班街区",
    color: PALETTE.green,
  },
  {
    id: "zone-lab",
    x: 24,
    z: 21.2,
    title: "科研医疗区",
    subtitle: "神经实验室 · 企业安保",
    color: PALETTE.purple,
  },
  {
    id: "zone-park",
    x: 5.5,
    z: 23.2,
    title: "霓虹公园",
    subtitle: "公共空间 · 旧防波堤",
    color: PALETTE.cyan,
  },
  {
    id: "zone-south-clinic",
    x: 19.5,
    z: 27.2,
    title: "南岸诊所街",
    subtitle: "地下医疗 · 零件黑市",
    color: PALETTE.pink,
  },
];

export function clampTile(x: number, z: number): Cell {
  return {
    x: Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(x))),
    z: Math.max(0, Math.min(MAP_DEPTH - 1, Math.round(z))),
  };
}

export function tileFromWorld(x: number, z: number): Cell | null {
  const tileX = Math.round(x / TILE_SIZE + (MAP_WIDTH - 1) / 2);
  const tileZ = Math.round(z / TILE_SIZE + (MAP_DEPTH - 1) / 2);
  if (!insideMap(tileX, tileZ)) return null;
  return { x: tileX, z: tileZ };
}

/** Convert a value in tile units (fractional tile centre) to a world XZ vector. */
export function tilePointToWorld(x: number, z: number): { x: number; z: number } {
  return tileToWorld(x, z);
}

export const UNIT_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

export function makeBoxTransform(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  color?: string,
  rotationY?: number,
): InstanceTransform {
  return { position: [x, y, z], scale: [sx, sy, sz], color, rotationY };
}
