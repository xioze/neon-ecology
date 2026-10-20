import { memo, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { MAP_DEPTH, MAP_WIDTH, TILE_SIZE } from "../../shared/constants";
import { tileFromWorld } from "./sceneLayout";
import {
  CURB_STRIPS,
  LANE_DASHES,
  MAP_TILES,
  PALETTE,
  ROAD_TILES,
  SIDEWALK_TILES,
  STREET_LAMPS,
  type Cell,
  type InstanceTransform,
} from "./sceneLayout";
import { Instances } from "./Instances";

interface GroundProps {
  onGroundClick: (tile: Cell) => void;
  onGroundPointerMove: (tile: Cell, event: ThreeEvent<PointerEvent>) => void;
  onGroundPointerOut: () => void;
}

const CITY_HALF_WIDTH = (MAP_WIDTH * TILE_SIZE) / 2;
const CITY_HALF_DEPTH = (MAP_DEPTH * TILE_SIZE) / 2;

function buildGridGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const y = 0.085;
  for (let i = 0; i <= MAP_WIDTH; i++) {
    const x = -CITY_HALF_WIDTH + i * TILE_SIZE;
    positions.push(x, y, -CITY_HALF_DEPTH, x, y, CITY_HALF_DEPTH);
  }
  for (let i = 0; i <= MAP_DEPTH; i++) {
    const z = -CITY_HALF_DEPTH + i * TILE_SIZE;
    positions.push(-CITY_HALF_WIDTH, y, z, CITY_HALF_WIDTH, y, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

const ROAD_TRANSFORMS: readonly InstanceTransform[] = ROAD_TILES.map((tile) => {
  const world = tileToWorldXZ(tile.x, tile.z);
  return {
    position: [world.x, 0.035, world.z],
    scale: [TILE_SIZE - 0.08, 0.08, TILE_SIZE - 0.08],
  };
});

const SIDEWALK_TRANSFORMS: readonly InstanceTransform[] = SIDEWALK_TILES.map((tile) => {
  const world = tileToWorldXZ(tile.x, tile.z);
  return {
    position: [world.x, 0.115, world.z],
    scale: [TILE_SIZE + 0.03, 0.19, TILE_SIZE + 0.03],
  };
});

const LAMP_POLE_TRANSFORMS: readonly InstanceTransform[] = STREET_LAMPS.map((lamp) => ({
  position: [lamp.x, 1.45, lamp.z],
  scale: [0.1, 2.7, 0.1],
}));

const LAMP_BULB_TRANSFORMS: readonly InstanceTransform[] = STREET_LAMPS.map((lamp) => ({
  position: [lamp.x, 2.84, lamp.z],
  scale: [0.26, 0.14, 0.26],
  color: lamp.color,
}));

const MAP_FRAME_TRANSFORMS: readonly InstanceTransform[] = [
  {
    position: [0, 0.1, -CITY_HALF_DEPTH],
    scale: [CITY_HALF_WIDTH * 2 + 0.4, 0.1, 0.14],
    color: PALETTE.cyan,
  },
  {
    position: [0, 0.1, CITY_HALF_DEPTH],
    scale: [CITY_HALF_WIDTH * 2 + 0.4, 0.1, 0.14],
    color: PALETTE.magenta,
  },
  {
    position: [-CITY_HALF_WIDTH, 0.1, 0],
    scale: [0.14, 0.1, CITY_HALF_DEPTH * 2],
    color: PALETTE.purple,
  },
  {
    position: [CITY_HALF_WIDTH, 0.1, 0],
    scale: [0.14, 0.1, CITY_HALF_DEPTH * 2],
    color: PALETTE.purple,
  },
];

function tileToWorldXZ(x: number, z: number): { x: number; z: number } {
  return {
    x: (x - (MAP_WIDTH - 1) / 2) * TILE_SIZE,
    z: (z - (MAP_DEPTH - 1) / 2) * TILE_SIZE,
  };
}

export const Ground = memo(function Ground({
  onGroundClick,
  onGroundPointerMove,
  onGroundPointerOut,
}: GroundProps) {
  const gridGeometry = useMemo(() => buildGridGeometry(), []);

  const roadMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#0a111a",
        roughness: 0.55,
        metalness: 0.42,
        emissive: "#040b12",
        emissiveIntensity: 0.9,
      }),
    [],
  );
  const sidewalkMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#151f29",
        roughness: 0.88,
        metalness: 0.16,
        emissive: "#0a1620",
        emissiveIntensity: 0.55,
      }),
    [],
  );
  const curbMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        opacity: 0.92,
      }),
    [],
  );
  const dashMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#d8f5ff",
        toneMapped: false,
        transparent: true,
        opacity: 0.38,
      }),
    [],
  );
  const lampPoleMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1b2430",
        roughness: 0.6,
        metalness: 0.7,
      }),
    [],
  );
  const lampBulbMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false }),
    [],
  );
  const frameMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false }),
    [],
  );

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 6) return;
    const point = event.point;
    const tile = tileFromWorld(point.x, point.z);
    if (!tile) return;
    event.stopPropagation();
    onGroundClick(tile);
  };

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    const tile = tileFromWorld(event.point.x, event.point.z);
    if (!tile) return;
    onGroundPointerMove(tile, event);
  };

  return (
    <group>
      {/* Distant dead ground under the fog. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.62, 0]}>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#02050a" roughness={1} metalness={0} />
      </mesh>
      {/* City platform slab. */}
      <mesh position={[0, -0.26, 0]}>
        <boxGeometry args={[CITY_HALF_WIDTH * 2 + 2.4, 0.6, CITY_HALF_DEPTH * 2 + 2.4]} />
        <meshStandardMaterial
          color="#060d16"
          roughness={0.9}
          metalness={0.3}
          emissive="#061019"
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Tile grid. */}
      <lineSegments geometry={gridGeometry}>
        <lineBasicMaterial color="#123647" transparent opacity={0.42} toneMapped={false} />
      </lineSegments>

      <Instances transforms={ROAD_TRANSFORMS} material={roadMaterial} />
      <Instances transforms={SIDEWALK_TRANSFORMS} material={sidewalkMaterial} />
      <Instances transforms={LANE_DASHES} material={dashMaterial} />
      <Instances transforms={CURB_STRIPS} material={curbMaterial} />
      <Instances transforms={MAP_FRAME_TRANSFORMS} material={frameMaterial} />

      {/* Street lamps. */}
      <Instances transforms={LAMP_POLE_TRANSFORMS} material={lampPoleMaterial} />
      <Instances transforms={LAMP_BULB_TRANSFORMS} material={lampBulbMaterial} />

      {/* A handful of warm/cold pools of light on the busiest crossings. */}
      <pointLight position={[-16, 5.5, -14]} color={PALETTE.cyan} intensity={38} distance={30} decay={2} />
      <pointLight position={[8, 5.5, -14]} color={PALETTE.blue} intensity={34} distance={28} decay={2} />
      <pointLight position={[-16, 5, 2]} color={PALETTE.magenta} intensity={34} distance={28} decay={2} />
      <pointLight position={[8, 5, 18]} color={PALETTE.gold} intensity={30} distance={26} decay={2} />
      <pointLight position={[-20, 4.5, 23]} color={PALETTE.green} intensity={30} distance={26} decay={2} />
      <pointLight position={[16, 5, -7]} color={PALETTE.purple} intensity={30} distance={26} decay={2} />

      {/* Invisible click/move surface for the whole map. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0.16, 0]}
        onClick={handleClick}
        onPointerMove={handleMove}
        onPointerOut={onGroundPointerOut}
        renderOrder={-1}
      >
        <planeGeometry args={[CITY_HALF_WIDTH * 2, CITY_HALF_DEPTH * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
});

export const TILE_COUNT = MAP_TILES.length;
