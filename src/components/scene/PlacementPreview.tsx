import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { TILE_SIZE } from "../../shared/constants";
import type { BuildingType, Vec2, WorldState } from "../../shared/types";
import { canPlaceAt } from "../../sim/commands";
import { tileToWorld } from "../../sim/city";
import { PALETTE, getPlacementDimensions, placementOrigin } from "./sceneLayout";

export interface PointerTile extends Vec2 {
  active: boolean;
}

interface PlacementPreviewProps {
  world: WorldState;
  type: BuildingType | null;
  pointerRef: MutableRefObject<PointerTile | null>;
  revision: number;
}

/**
 * Footprint ghost that follows the pointer while a building type is selected.
 * Position/color updates are imperative (refs) so hovering the map never causes
 * React state updates.
 */
export function PlacementPreview({ world, type, pointerRef, revision }: PlacementPreviewProps) {
  const groupRef = useRef<THREE.Group | null>(null);
  const fillMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const edgeMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const cacheRef = useRef<{ key: string; valid: boolean }>({ key: "", valid: false });

  const dims = type ? getPlacementDimensions(type) : { w: 3, d: 3 };
  const { w, d } = dims;

  const gridGeometry = useMemo(() => {
    const positions: number[] = [];
    const halfW = (w * TILE_SIZE) / 2;
    const halfD = (d * TILE_SIZE) / 2;
    for (let i = 0; i <= w; i++) {
      const x = -halfW + i * TILE_SIZE;
      positions.push(x, 0.02, -halfD, x, 0.02, halfD);
    }
    for (let i = 0; i <= d; i++) {
      const z = -halfD + i * TILE_SIZE;
      positions.push(-halfW, 0.02, z, halfW, 0.02, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, [w, d]);

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const pointer = pointerRef.current;
    if (!type || !pointer || !pointer.active) {
      group.visible = false;
      return;
    }
    const origin = placementOrigin(pointer.x, pointer.z, type);
    const center = tileToWorld(origin.x + w / 2 - 0.5, origin.z + d / 2 - 0.5);
    group.visible = true;
    group.position.set(center.x, 0, center.z);

    const key = `${origin.x},${origin.z},${w},${d},${type},${revision}`;
    if (key !== cacheRef.current.key) {
      cacheRef.current.key = key;
      const result = canPlaceAt(world, origin.x, origin.z, w, d);
      cacheRef.current.valid = result.ok;
      const color = result.ok ? PALETTE.cyan : PALETTE.magenta;
      if (fillMaterialRef.current) {
        fillMaterialRef.current.color.set(color);
        fillMaterialRef.current.opacity = result.ok ? 0.22 : 0.3;
      }
      if (edgeMaterialRef.current) edgeMaterialRef.current.color.set(color);
    }

    const pulse = 0.72 + (Math.sin(clock.elapsedTime * 4.2) + 1) * 0.12;
    if (fillMaterialRef.current) {
      fillMaterialRef.current.opacity = (cacheRef.current.valid ? 0.18 : 0.26) + (pulse - 0.72) * 0.5;
    }
    if (delta > 0 && edgeMaterialRef.current) edgeMaterialRef.current.opacity = pulse;
  });

  if (!type) return null;

  return (
    <group ref={groupRef} visible={false}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.34, 0]}>
        <planeGeometry args={[w * TILE_SIZE, d * TILE_SIZE]} />
        <meshBasicMaterial
          ref={fillMaterialRef}
          color={PALETTE.cyan}
          transparent
          opacity={0.24}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <boxGeometry args={[w * TILE_SIZE, 1.4, d * TILE_SIZE]} />
        <meshBasicMaterial
          ref={edgeMaterialRef}
          color={PALETTE.cyan}
          wireframe
          transparent
          opacity={0.8}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={gridGeometry} position={[0, 0.36, 0]}>
        <lineBasicMaterial color="#e8fbff" transparent opacity={0.45} toneMapped={false} depthWrite={false} />
      </lineSegments>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.9, 0]}>
        <ringGeometry args={[0.5, 0.68, 24]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
