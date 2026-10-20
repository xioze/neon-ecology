import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { TILE_SIZE } from "../../shared/constants";
import type { Building } from "../../shared/types";
import { buildingCenterWorld, getBuildingDoor, tileToWorld } from "../../sim/city";
import { simulationStore } from "../../store/useSimulation";
import {
  DEG2RAD,
  PALETTE,
  getBuildingWorld,
  hash01,
  typeLabel,
} from "./sceneLayout";
import { makeNeonSignTexture } from "./signs";

/* ------------------------------------------------------------------ */
/* Shared interaction helpers (module level keeps memo props stable)    */
/* ------------------------------------------------------------------ */

function selectBuilding(id: string, event: ThreeEvent<MouseEvent>): void {
  if (event.delta > 6) return;
  event.stopPropagation();
  simulationStore.select({ kind: "building", id });
}

function hoverBuilding(id: string, event: ThreeEvent<PointerEvent>): void {
  event.stopPropagation();
  simulationStore.setHovered({ kind: "building", id });
}

function clearBuildingHover(id: string): void {
  const hovered = simulationStore.getSnapshot().hovered;
  if (hovered && hovered.kind === "building" && hovered.id === id) {
    simulationStore.setHovered(null);
  }
}

function buildingSignature(building: Building): string {
  return [
    building.name,
    building.type,
    building.neonColor,
    building.w,
    building.d,
    building.rotation,
    building.openAir ? 1 : 0,
  ].join("|");
}

/* ------------------------------------------------------------------ */
/* Building collection                                                 */
/* ------------------------------------------------------------------ */

export function Buildings({ buildings }: { buildings: Building[] }) {
  return (
    <group>
      {buildings.map((building) => (
        <BuildingMesh key={building.id} building={building} signature={buildingSignature(building)} />
      ))}
    </group>
  );
}

interface BuildingMeshProps {
  building: Building;
  /** Primitive signature so memo refreshes when an edit changes the look. */
  signature: string;
}

const BuildingMesh = memo(function BuildingMesh({ building, signature }: BuildingMeshProps) {
  const center = useMemo(
    () => buildingCenterWorld(building),
    [building.x, building.z, building.w, building.d],
  );
  const world = useMemo(
    () => getBuildingWorld(building),
    [building.x, building.z, building.w, building.d, building.capacity, building.type, building.id],
  );

  if (building.openAir) {
    return (
      <group position={[center.x, 0, center.z]}>
        <ParkSpace building={building} width={world.width} depth={world.depth} />
        {/*
         * Keep the open-air building's hit target at ground level. A tall
         * invisible box here would swallow all residents standing in the park,
         * making them impossible to select without walking outside.
         */}
        <BuildingHitbox
          building={building}
          size={[world.width, 0.22, world.depth]}
          y={0.11}
          signature={signature}
        />
      </group>
    );
  }

  return (
    <group position={[center.x, 0, center.z]}>
      <group rotation-y={building.rotation * DEG2RAD}>
        <BuildingShell
          building={building}
          width={world.width}
          depth={world.depth}
          height={world.height}
        />
        <NeonSign building={building} width={world.width} depth={world.depth} height={world.height} />
      </group>
      <DoorGlow building={building} center={center} />
      <BuildingHitbox
        building={building}
        size={[world.width + 0.5, world.height + 0.8, world.depth + 0.5]}
        y={(world.height + 0.8) / 2}
        signature={signature}
      />
    </group>
  );
});

function BuildingHitbox({
  building,
  size,
  y,
  signature: _signature,
}: {
  building: Building;
  size: [number, number, number];
  y: number;
  signature: string;
}) {
  const handleOver = (event: ThreeEvent<PointerEvent>) => hoverBuilding(building.id, event);
  const handleOut = () => clearBuildingHover(building.id);
  const handleClick = (event: ThreeEvent<MouseEvent>) => selectBuilding(building.id, event);
  return (
    <mesh
      position={[0, y, 0]}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onClick={handleClick}
    >
      <boxGeometry args={size} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Type-specific silhouettes                                           */
/* ------------------------------------------------------------------ */

function BuildingShell({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  switch (building.type) {
    case "residential":
      return <ResidentialBody building={building} width={width} depth={depth} height={height} />;
    case "shop":
      return <ShopBody building={building} width={width} depth={depth} height={height} />;
    case "workplace":
      return <WorkplaceBody building={building} width={width} depth={depth} height={height} />;
    case "public":
      return <PublicBody building={building} width={width} depth={depth} height={height} />;
    case "medical":
      return <MedicalBody building={building} width={width} depth={depth} height={height} />;
    case "utility":
      return <UtilityBody building={building} width={width} depth={depth} height={height} />;
    default:
      return null;
  }
}

function NeonStrip({
  position,
  size,
  color,
  opacity = 0.9,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  opacity?: number;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={color} toneMapped={false} transparent opacity={opacity} />
    </mesh>
  );
}

function Beacon({ position, color }: { position: [number, number, number]; color: string }) {
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.opacity = 0.25 + (Math.sin(clock.elapsedTime * 3.2) + 1) * 0.32;
    }
  });
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.24, 10, 10]} />
      <meshBasicMaterial ref={materialRef} color={color} toneMapped={false} transparent opacity={0.7} />
    </mesh>
  );
}

interface WindowItem {
  x: number;
  y: number;
  z: number;
  rotY: number;
  color: string;
}

/** Instanced emissive window grid, one draw call per facade set. */
function FacadeWindows({
  width,
  depth,
  top,
  y0 = 1.35,
  color,
  seed,
}: {
  width: number;
  depth: number;
  /** Absolute height (from the ground) where the facade stops. */
  top: number;
  y0?: number;
  color: string;
  seed: string;
}) {
  const items = useMemo<WindowItem[]>(() => {
    const list: WindowItem[] = [];
    const faces = [
      { axis: "z" as const, sign: 1, span: width, rotY: 0 },
      { axis: "z" as const, sign: -1, span: width, rotY: Math.PI },
      { axis: "x" as const, sign: 1, span: depth, rotY: Math.PI / 2 },
      { axis: "x" as const, sign: -1, span: depth, rotY: -Math.PI / 2 },
    ];
    const accents = [color, color, color, PALETTE.gold, PALETTE.blue, PALETTE.magenta];
    for (const face of faces) {
      const cols = Math.max(1, Math.floor(face.span / 1.32));
      const rows = Math.max(1, Math.floor((top - y0) / 1.72));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const along = -face.span / 2 + ((col + 0.5) * face.span) / cols;
          const hash = hash01(`${seed}-${face.axis}-${face.sign}-${row}-${col}`, 5);
          const lit = hash < 0.58;
          const accent = accents[Math.floor(hash01(`${seed}-${row}-${col}`, 9) * accents.length) % accents.length]!;
          const windowColor = lit ? accent : "#08111a";
          const y = y0 + row * 1.72;
          if (face.axis === "z") {
            list.push({
              x: along,
              y,
              z: face.sign * (depth / 2 + 0.03),
              rotY: face.rotY,
              color: windowColor,
            });
          } else {
            list.push({
              x: face.sign * (width / 2 + 0.03),
              y,
              z: along,
              rotY: face.rotY,
              color: windowColor,
            });
          }
        }
      }
    }
    return list;
  }, [width, depth, top, y0, color, seed]);

  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.44, 0.3), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const colorValue = new THREE.Color();
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, item.rotY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, colorValue.set(item.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(1, items.length)]}
      count={items.length}
      frustumCulled={false}
    />
  );
}

/* ------------------------ residential ----------------------------- */

function ResidentialBody({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  const neon = building.neonColor;
  const lowerHeight = height * 0.64;
  const upperHeight = height - lowerHeight;
  const balconies = lowerHeight > 7 ? 3 : 2;
  return (
    <group>
      <mesh position={[0, lowerHeight / 2, 0]}>
        <boxGeometry args={[width, lowerHeight, depth]} />
        <meshStandardMaterial
          color="#16212c"
          roughness={0.78}
          metalness={0.28}
          emissive="#08161d"
          emissiveIntensity={0.7}
        />
      </mesh>
      <mesh position={[0, lowerHeight + upperHeight / 2, 0]}>
        <boxGeometry args={[width * 0.74, upperHeight, depth * 0.74]} />
        <meshStandardMaterial
          color="#101a24"
          roughness={0.82}
          metalness={0.3}
          emissive="#091620"
          emissiveIntensity={0.6}
        />
      </mesh>
      {/* Balcony slabs + neon handrails. */}
      {Array.from({ length: balconies }, (_, index) => {
        const y = 2.8 + index * 2.15;
        if (y > lowerHeight - 1) return null;
        return (
          <group key={`balcony-${index}`} position={[0, y, depth / 2]}>
            <mesh position={[0, 0, 0.28]}>
              <boxGeometry args={[width * 0.52, 0.14, 0.56]} />
              <meshStandardMaterial color="#0d1722" roughness={0.9} metalness={0.2} />
            </mesh>
            <mesh position={[0, 0.4, 0.52]}>
              <boxGeometry args={[width * 0.52, 0.05, 0.05]} />
              <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.9} />
            </mesh>
          </group>
        );
      })}
      {/* Rooftop utilities. */}
      <mesh position={[width * 0.18, height + 0.9, -depth * 0.12]}>
        <cylinderGeometry args={[0.62, 0.62, 1.8, 10]} />
        <meshStandardMaterial color="#1a2630" roughness={0.7} metalness={0.5} />
      </mesh>
      <mesh position={[-width * 0.24, height + 1.6, depth * 0.1]}>
        <cylinderGeometry args={[0.07, 0.07, 3.4, 6]} />
        <meshStandardMaterial color="#26333d" roughness={0.5} metalness={0.8} />
      </mesh>
      <Beacon position={[-width * 0.24, height + 3.35, depth * 0.1]} color={PALETTE.magenta} />
      <NeonStrip position={[0, height + 0.18, 0]} size={[width * 0.78, 0.1, depth * 0.78]} color={neon} />
      <NeonStrip position={[0, 1.1, depth / 2 + 0.06]} size={[width * 0.6, 0.08, 0.04]} color={neon} opacity={0.75} />
      <FacadeWindows
        width={width}
        depth={depth}
        top={lowerHeight}
        y0={1.5}
        color={neon}
        seed={`${building.id}-lower`}
      />
      <FacadeWindows
        width={width * 0.74}
        depth={depth * 0.74}
        top={height}
        y0={lowerHeight + 1.1}
        color={neon}
        seed={`${building.id}-upper`}
      />
    </group>
  );
}

/* --------------------------- shop --------------------------------- */

function ShopBody({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  const neon = building.neonColor;
  const awningY = Math.min(height * 0.62, height - 1.4);
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color="#211b1c"
          roughness={0.8}
          metalness={0.2}
          emissive="#1a1012"
          emissiveIntensity={0.55}
        />
      </mesh>
      {/* Warm storefront glow. */}
      <mesh position={[0, 1.35, depth / 2 + 0.05]}>
        <planeGeometry args={[width * 0.72, 1.7]} />
        <meshBasicMaterial color={PALETTE.gold} toneMapped={false} transparent opacity={0.5} />
      </mesh>
      {/* Striped awning. */}
      {Array.from({ length: 6 }, (_, index) => (
        <mesh
          key={`awning-${index}`}
          position={[-width * 0.42 + (index * width * 0.84) / 6 + width * 0.07, awningY, depth / 2 + 0.42]}
          rotation-x={-0.22}
        >
          <boxGeometry args={[width * 0.12, 0.08, 1.2]} />
          <meshBasicMaterial
            color={index % 2 === 0 ? neon : "#221820"}
            toneMapped={false}
            transparent
            opacity={index % 2 === 0 ? 0.95 : 0.9}
          />
        </mesh>
      ))}
      {/* Roof vent + neon trim. */}
      <mesh position={[width * 0.24, height + 0.35, -depth * 0.1]}>
        <boxGeometry args={[1.2, 0.7, 1.0]} />
        <meshStandardMaterial color="#1a2028" roughness={0.8} metalness={0.4} />
      </mesh>
      <NeonStrip position={[0, height + 0.05, 0]} size={[width + 0.12, 0.1, depth + 0.12]} color={neon} />
      <NeonStrip
        position={[-width / 2 - 0.06, height * 0.55, 0]}
        size={[0.06, height * 0.6, 0.06]}
        color={PALETTE.magenta}
        opacity={0.8}
      />
      {/* Crates outside the door. */}
      {Array.from({ length: 3 }, (_, index) => (
        <mesh
          key={`crate-${index}`}
          position={[width * 0.32 + index * 0.55, 0.32, depth / 2 + 0.7]}
          rotation-y={index * 0.5}
        >
          <boxGeometry args={[0.5, 0.55, 0.5]} />
          <meshStandardMaterial color="#2a211b" roughness={0.9} metalness={0.15} />
        </mesh>
      ))}
      <FacadeWindows
        width={width}
        depth={depth}
        top={height}
        y0={Math.max(awningY + 1.0, height * 0.62)}
        color={neon}
        seed={`${building.id}-shop`}
      />
    </group>
  );
}

/* ------------------------- workplace ------------------------------ */

function WorkplaceBody({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  const neon = building.neonColor;
  const podiumHeight = Math.min(3.6, height * 0.26);
  const towerHeight = height - podiumHeight;
  const towerWidth = width * 0.72;
  const towerDepth = depth * 0.72;
  const bandCount = Math.max(3, Math.floor(towerHeight / 2.6));
  const corners: Array<[number, number]> = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  return (
    <group>
      <mesh position={[0, podiumHeight / 2, 0]}>
        <boxGeometry args={[width, podiumHeight, depth]} />
        <meshStandardMaterial
          color="#0c1824"
          roughness={0.5}
          metalness={0.55}
          emissive="#08151f"
          emissiveIntensity={0.8}
        />
      </mesh>
      <mesh position={[0, podiumHeight + towerHeight / 2, 0]}>
        <boxGeometry args={[towerWidth, towerHeight, towerDepth]} />
        <meshStandardMaterial
          color="#0a1a2b"
          roughness={0.2}
          metalness={0.82}
          emissive="#0a2740"
          emissiveIntensity={0.9}
        />
      </mesh>
      {Array.from({ length: bandCount }, (_, index) => {
        const y = podiumHeight + 1.6 + (index * (towerHeight - 2.2)) / bandCount;
        return (
          <NeonStrip
            key={`band-${index}`}
            position={[0, y, 0]}
            size={[towerWidth + 0.14, 0.14, towerDepth + 0.14]}
            color={index % 3 === 1 ? PALETTE.ice : neon}
            opacity={0.7}
          />
        );
      })}
      {corners.map(([sx, sz]) => (
        <mesh
          key={`fin-${sx}-${sz}`}
          position={[(sx * towerWidth) / 2, podiumHeight + towerHeight / 2, (sz * towerDepth) / 2]}
        >
          <boxGeometry args={[0.1, towerHeight, 0.1]} />
          <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.85} />
        </mesh>
      ))}
      <mesh position={[0, height - 0.55, 0]}>
        <boxGeometry args={[towerWidth * 0.66, 1.1, towerDepth * 0.66]} />
        <meshStandardMaterial color="#122334" roughness={0.35} metalness={0.7} emissive="#0b2233" emissiveIntensity={0.9} />
      </mesh>
      <NeonStrip position={[0, height + 0.05, 0]} size={[towerWidth * 0.7, 0.1, towerDepth * 0.7]} color={neon} />
      <mesh position={[0, height + 3.4, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 6.6, 5]} />
        <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.7} />
      </mesh>
      <Beacon position={[0, height + 6.8, 0]} color={PALETTE.magenta} />
      <FacadeWindows
        width={width}
        depth={depth}
        top={podiumHeight}
        y0={1.2}
        color={neon}
        seed={`${building.id}-podium`}
      />
    </group>
  );
}

/* --------------------------- public -------------------------------- */

function PublicBody({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  const neon = building.neonColor;
  const radius = Math.min(width, depth) / 2 - 0.3;
  const lowerHeight = height * 0.56;
  const upperHeight = height * 0.22;
  const columns = 6;
  return (
    <group>
      <mesh position={[0, lowerHeight / 2, 0]}>
        <cylinderGeometry args={[radius, radius, lowerHeight, 18]} />
        <meshStandardMaterial
          color="#1a1726"
          roughness={0.62}
          metalness={0.35}
          emissive="#140f24"
          emissiveIntensity={0.7}
        />
      </mesh>
      <mesh position={[0, lowerHeight + upperHeight / 2, 0]}>
        <cylinderGeometry args={[radius * 0.8, radius * 0.9, upperHeight, 18]} />
        <meshStandardMaterial
          color="#201a30"
          roughness={0.55}
          metalness={0.4}
          emissive="#1a1030"
          emissiveIntensity={0.8}
        />
      </mesh>
      <mesh position={[0, height - 0.2, 0]}>
        <sphereGeometry args={[radius * 0.82, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={neon}
          emissive={neon}
          emissiveIntensity={0.45}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      <mesh position={[0, lowerHeight + 0.08, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[radius * 1.02, 0.09, 8, 40]} />
        <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, height - 0.25, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[radius * 0.84, 0.07, 8, 36]} />
        <meshBasicMaterial color={PALETTE.magenta} toneMapped={false} transparent opacity={0.85} />
      </mesh>
      {Array.from({ length: columns }, (_, index) => {
        const angle = (index / columns) * Math.PI * 2;
        return (
          <mesh
            key={`column-${index}`}
            position={[Math.cos(angle) * radius * 1.06, lowerHeight / 2, Math.sin(angle) * radius * 1.06]}
          >
            <boxGeometry args={[0.28, lowerHeight, 0.28]} />
            <meshStandardMaterial color="#241f33" roughness={0.6} metalness={0.4} />
          </mesh>
        );
      })}
      <mesh position={[0, 1.2, depth / 2 + 0.2]}>
        <boxGeometry args={[width * 0.36, 2.4, 0.1]} />
        <meshBasicMaterial color={PALETTE.gold} toneMapped={false} transparent opacity={0.32} />
      </mesh>
      <NeonStrip position={[0, 0.38, depth / 2 - 0.05]} size={[width * 0.7, 0.12, 0.06]} color={neon} opacity={0.75} />
    </group>
  );
}

/* -------------------------- medical -------------------------------- */

function MedicalBody({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  const neon = building.neonColor;
  const bodyHeight = height * 0.94;
  return (
    <group>
      <mesh position={[0, bodyHeight / 2, 0]}>
        <boxGeometry args={[width, bodyHeight, depth]} />
        <meshStandardMaterial
          color="#182a31"
          roughness={0.65}
          metalness={0.3}
          emissive="#0d2028"
          emissiveIntensity={0.75}
        />
      </mesh>
      {/* Neon medical cross. */}
      <mesh position={[0, height * 0.62, depth / 2 + 0.08]}>
        <boxGeometry args={[0.6, 2.6, 0.12]} />
        <meshBasicMaterial color={PALETTE.pink} toneMapped={false} />
      </mesh>
      <mesh position={[0, height * 0.62, depth / 2 + 0.09]}>
        <boxGeometry args={[2.2, 0.6, 0.12]} />
        <meshBasicMaterial color={PALETTE.pink} toneMapped={false} />
      </mesh>
      {/* Rooftop helipad ring. */}
      <mesh position={[0, bodyHeight + 0.18, 0]}>
        <cylinderGeometry args={[Math.min(width, depth) * 0.28, Math.min(width, depth) * 0.28, 0.2, 18]} />
        <meshStandardMaterial color="#101a20" roughness={0.8} metalness={0.35} />
      </mesh>
      <mesh position={[0, bodyHeight + 0.3, 0]} rotation-x={Math.PI / 2}>
        <ringGeometry args={[Math.min(width, depth) * 0.19, Math.min(width, depth) * 0.23, 24]} />
        <meshBasicMaterial color={PALETTE.pink} toneMapped={false} side={THREE.DoubleSide} transparent opacity={0.8} />
      </mesh>
      <Beacon position={[width * 0.3, bodyHeight + 0.6, -depth * 0.24]} color={neon} />
      <NeonStrip position={[0, bodyHeight + 0.04, 0]} size={[width + 0.16, 0.08, depth + 0.16]} color={neon} opacity={0.8} />
      <FacadeWindows
        width={width}
        depth={depth}
        top={bodyHeight}
        y0={1.6}
        color={neon}
        seed={`${building.id}-clinic`}
      />
    </group>
  );
}

/* -------------------------- utility -------------------------------- */

function UtilityBody({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  const neon = building.neonColor;
  const mainHeight = height * 0.6;
  const tankRadius = Math.min(1.15, width * 0.16);
  return (
    <group>
      <mesh position={[0, mainHeight / 2, 0]}>
        <boxGeometry args={[width, mainHeight, depth]} />
        <meshStandardMaterial
          color="#141d23"
          roughness={0.72}
          metalness={0.55}
          emissive="#0b151c"
          emissiveIntensity={0.6}
        />
      </mesh>
      {/* Storage tanks. */}
      {[-1, 1].map((sign) => (
        <group key={`tank-${sign}`} position={[sign * width * 0.24, 0, -depth * 0.18]}>
          <mesh position={[0, height * 0.34, 0]}>
            <cylinderGeometry args={[tankRadius, tankRadius, height * 0.68, 14]} />
            <meshStandardMaterial color="#243039" roughness={0.55} metalness={0.7} />
          </mesh>
          <mesh position={[0, height * 0.68 + 0.1, 0]}>
            <sphereGeometry args={[tankRadius, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#2a3742" roughness={0.5} metalness={0.75} />
          </mesh>
          <mesh position={[0, height * 0.52, 0]}>
            <torusGeometry args={[tankRadius + 0.05, 0.06, 6, 18]} />
            <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.75} />
          </mesh>
        </group>
      ))}
      {/* Pipes. */}
      <mesh position={[0, mainHeight - 0.5, -depth * 0.18]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.16, 0.16, width * 0.6, 8]} />
        <meshStandardMaterial color="#3a4650" roughness={0.45} metalness={0.85} />
      </mesh>
      {/* Exhaust tower. */}
      <mesh position={[width * 0.3, height * 0.52, depth * 0.28]}>
        <boxGeometry args={[0.9, height * 1.04, 0.9]} />
        <meshStandardMaterial color="#1b242b" roughness={0.6} metalness={0.6} />
      </mesh>
      <NeonStrip
        position={[width * 0.3, height * 1.04, depth * 0.28]}
        size={[0.96, 0.12, 0.96]}
        color={PALETTE.gold}
        opacity={0.85}
      />
      <Beacon position={[width * 0.3, height * 1.16, depth * 0.28]} color={PALETTE.magenta} />
      <NeonStrip position={[0, 1.0, depth / 2 + 0.05]} size={[width * 0.5, 0.1, 0.05]} color={neon} opacity={0.7} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Open-air park                                                       */
/* ------------------------------------------------------------------ */

function ParkSpace({
  building,
  width,
  depth,
}: {
  building: Building;
  width: number;
  depth: number;
}) {
  const neon = building.neonColor;
  const trees = useMemo(() => {
    const count = Math.max(3, Math.min(7, Math.round((width * depth) / 44)));
    return Array.from({ length: count }, (_, index) => {
      const fx = 0.18 + hash01(building.id, index * 3 + 1) * 0.64;
      const fz = 0.22 + hash01(building.id, index * 3 + 2) * 0.56;
      return {
        x: (fx - 0.5) * (width - 1.6),
        z: (fz - 0.5) * (depth - 1.4),
        scale: 0.85 + hash01(building.id, index * 3 + 3) * 0.45,
        color: index % 3 === 0 ? PALETTE.magenta : neon,
      };
    });
  }, [building.id, width, depth]);

  const signTexture = useMemo(
    () => makeNeonSignTexture(building.name, "公共空间 · PUBLIC PARK", neon),
    [building.name, neon],
  );
  useEffect(() => () => signTexture.dispose(), [signTexture]);

  return (
    <group>
      {/* Raised plaza deck. */}
      <mesh position={[0, 0.14, 0]}>
        <boxGeometry args={[width - 0.2, 0.28, depth - 0.2]} />
        <meshStandardMaterial
          color="#0d2a25"
          roughness={0.9}
          metalness={0.12}
          emissive="#0a332c"
          emissiveIntensity={0.45}
        />
      </mesh>
      {/* Crossing paths. */}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[width - 0.6, 0.06, depth * 0.28]} />
        <meshStandardMaterial color="#194a42" roughness={0.9} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.31, 0]}>
        <boxGeometry args={[width * 0.24, 0.06, depth - 0.6]} />
        <meshStandardMaterial color="#194a42" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Pond. */}
      <mesh position={[width * 0.26, 0.32, -depth * 0.2]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[Math.min(1.6, width * 0.12), 22]} />
        <meshStandardMaterial
          color="#0b2b3c"
          roughness={0.15}
          metalness={0.7}
          emissive="#0d4a5f"
          emissiveIntensity={0.55}
        />
      </mesh>
      {/* Trees. */}
      {trees.map((tree, index) => (
        <group key={`tree-${index}`} position={[tree.x, 0.28, tree.z]} scale={tree.scale}>
          <mesh position={[0, 0.9, 0]}>
            <cylinderGeometry args={[0.11, 0.17, 1.8, 6]} />
            <meshStandardMaterial color="#2a1d2c" roughness={0.9} />
          </mesh>
          <mesh position={[0, 2.15, 0]}>
            <icosahedronGeometry args={[0.85, 0]} />
            <meshStandardMaterial
              color={tree.color}
              emissive={tree.color}
              emissiveIntensity={0.75}
              roughness={0.45}
              flatShading
            />
          </mesh>
          <mesh position={[0.32, 2.62, 0.14]}>
            <icosahedronGeometry args={[0.46, 0]} />
            <meshStandardMaterial
              color={tree.color}
              emissive={tree.color}
              emissiveIntensity={0.55}
              roughness={0.5}
              flatShading
            />
          </mesh>
        </group>
      ))}
      {/* Benches. */}
      {[-1, 1].map((sign) => (
        <group key={`bench-${sign}`} position={[sign * width * 0.26, 0.3, depth * 0.3]}>
          <mesh position={[0, 0.42, 0]}>
            <boxGeometry args={[2.1, 0.14, 0.6]} />
            <meshStandardMaterial color="#26333a" roughness={0.7} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.72, -0.24]}>
            <boxGeometry args={[2.1, 0.5, 0.1]} />
            <meshStandardMaterial color="#26333a" roughness={0.7} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.72, -0.18]}>
            <boxGeometry args={[2.0, 0.05, 0.05]} />
            <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.8} />
          </mesh>
        </group>
      ))}
      {/* Park lamps. */}
      {[-1, 1].map((sign) => (
        <group key={`park-lamp-${sign}`} position={[sign * (width * 0.42), 0.28, depth * 0.42]}>
          <mesh position={[0, 1.4, 0]}>
            <cylinderGeometry args={[0.06, 0.09, 2.8, 6]} />
            <meshStandardMaterial color="#22303a" roughness={0.6} metalness={0.7} />
          </mesh>
          <mesh position={[0, 2.9, 0]}>
            <sphereGeometry args={[0.24, 10, 10]} />
            <meshBasicMaterial color={PALETTE.cyan} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* Perimeter neon frame. */}
      <NeonStrip position={[0, 0.44, -depth / 2 + 0.12]} size={[width - 0.2, 0.1, 0.1]} color={neon} opacity={0.75} />
      <NeonStrip position={[0, 0.44, depth / 2 - 0.12]} size={[width - 0.2, 0.1, 0.1]} color={neon} opacity={0.75} />
      <NeonStrip position={[-width / 2 + 0.12, 0.44, 0]} size={[0.1, 0.1, depth - 0.2]} color={PALETTE.magenta} opacity={0.6} />
      <NeonStrip position={[width / 2 - 0.12, 0.44, 0]} size={[0.1, 0.1, depth - 0.2]} color={PALETTE.magenta} opacity={0.6} />
      {/* Freestanding park sign. */}
      <group position={[0, 0, depth / 2 - 0.35]}>
        {[-1, 1].map((sign) => (
          <mesh key={`post-${sign}`} position={[sign * 1.6, 1.35, 0]}>
            <boxGeometry args={[0.12, 2.7, 0.12]} />
            <meshStandardMaterial color="#1f2b2d" roughness={0.6} metalness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 2.15, 0]}>
          <planeGeometry args={[3.7, 1.22]} />
          <meshBasicMaterial map={signTexture} transparent toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Neon signs & doorway glow                                           */
/* ------------------------------------------------------------------ */

function NeonSign({
  building,
  width,
  depth,
  height,
}: {
  building: Building;
  width: number;
  depth: number;
  height: number;
}) {
  const texture = useMemo(
    () =>
      makeNeonSignTexture(
        building.name,
        `${typeLabel(building.type)} · ${building.type.toUpperCase()}`,
        building.neonColor,
      ),
    [building.name, building.type, building.neonColor],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  const aspect = 512 / 168;
  const panelWidth = Math.min(width * 0.94, 8.2);
  const panelHeight = panelWidth / aspect;
  const facadeY = Math.max(2.3, Math.min(height - panelHeight * 0.55, height * 0.74));
  const isTower = building.type === "workplace";
  const isShop = building.type === "shop";
  const hasBlade = building.type === "shop" || building.type === "public" || building.type === "medical";
  const bladeWidth = Math.min(depth * 0.9, 4.6);
  const bladeHeight = bladeWidth / aspect;

  const sign = (
    <mesh position={[0, facadeY, depth / 2 + 0.09]}>
      <planeGeometry args={[panelWidth, panelHeight]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );

  return (
    <group>
      {sign}
      {isShop && (
        <mesh position={[0, Math.min(facadeY + panelHeight * 0.78, height - 0.12), depth / 2 + 0.14]}>
          <boxGeometry args={[panelWidth + 0.4, 0.1, 0.12]} />
          <meshBasicMaterial color={building.neonColor} toneMapped={false} transparent opacity={0.85} />
        </mesh>
      )}
      {isTower && (
        <group position={[0, height + panelHeight * 0.62, 0.2]}>
          <mesh>
            <planeGeometry args={[panelWidth * 0.78, panelHeight * 0.78]} />
            <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -panelHeight * 0.5, -0.08]}>
            <boxGeometry args={[panelWidth * 0.72, 0.14, 0.16]} />
            <meshBasicMaterial color={building.neonColor} toneMapped={false} transparent opacity={0.8} />
          </mesh>
        </group>
      )}
      {hasBlade && (
        <mesh position={[width / 2 + 0.08, Math.min(height * 0.55, facadeY), 0]} rotation-y={Math.PI / 2}>
          <planeGeometry args={[bladeWidth, bladeHeight]} />
          <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function DoorGlow({ building, center }: { building: Building; center: { x: number; z: number } }) {
  const door = useMemo(
    () => getBuildingDoor(building),
    [building.x, building.z, building.w, building.d],
  );
  const doorWorld = useMemo(() => tileToWorld(door.x, door.z), [door.x, door.z]);
  const width = building.w * TILE_SIZE;
  const depth = building.d * TILE_SIZE;
  const relX = doorWorld.x - center.x;
  const relZ = doorWorld.z - center.z;
  const xSide = Math.abs(relX) > Math.abs(relZ);
  const neon = building.neonColor;

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[relX, 0.32, relZ]}>
        <ringGeometry args={[0.7, 1.2, 26]} />
        <meshBasicMaterial
          color={neon}
          toneMapped={false}
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {xSide ? (
        <>
          <mesh position={[Math.sign(relX) * (width / 2 + 0.06), 1.55, 0]}>
            <boxGeometry args={[0.08, 2.5, 1.8]} />
            <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.85} />
          </mesh>
          <mesh position={[Math.sign(relX) * (width / 2 + 0.3), 3.0, 0]}>
            <boxGeometry args={[0.7, 0.08, 2.0]} />
            <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.65} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, 1.55, Math.sign(relZ) * (depth / 2 + 0.06)]}>
            <boxGeometry args={[1.8, 2.5, 0.08]} />
            <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.85} />
          </mesh>
          <mesh position={[0, 3.0, Math.sign(relZ) * (depth / 2 + 0.3)]}>
            <boxGeometry args={[2.0, 0.08, 0.7]} />
            <meshBasicMaterial color={neon} toneMapped={false} transparent opacity={0.65} />
          </mesh>
        </>
      )}
      <mesh position={[relX, 2.9, relZ]}>
        <sphereGeometry args={[0.18, 10, 10]} />
        <meshBasicMaterial color={neon} toneMapped={false} />
      </mesh>
    </group>
  );
}
