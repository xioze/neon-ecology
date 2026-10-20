import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { InstanceTransform } from "./sceneLayout";

interface InstancesProps {
  transforms: readonly InstanceTransform[];
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material;
  castShadow?: boolean;
}

/**
 * A thin wrapper around THREE.InstancedMesh that bakes a static transform list
 * once. Used for road tiles, sidewalk plates, lane markings, neon curbs and
 * street lamps so the deco layers cost only a handful of draw calls.
 */
export function Instances({
  transforms,
  geometry,
  material,
  castShadow = false,
}: InstancesProps) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  const boxGeometry = useMemo(() => geometry ?? new THREE.BoxGeometry(1, 1, 1), [geometry]);
  const defaultMaterial = useMemo(
    () =>
      material ??
      new THREE.MeshStandardMaterial({
        color: "#10181f",
        roughness: 0.92,
        metalness: 0.12,
      }),
    [material],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let hasColor = false;
    for (let i = 0; i < transforms.length; i++) {
      const item = transforms[i]!;
      dummy.position.set(item.position[0], item.position[1], item.position[2]);
      dummy.rotation.set(0, item.rotationY ?? 0, 0);
      const scale = item.scale ?? [1, 1, 1];
      dummy.scale.set(scale[0], scale[1], scale[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (item.color) {
        hasColor = true;
        mesh.setColorAt(i, color.set(item.color));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (hasColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [transforms, boxGeometry, defaultMaterial]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[boxGeometry, defaultMaterial, Math.max(1, transforms.length)]}
      count={transforms.length}
      castShadow={castShadow}
      frustumCulled={false}
    />
  );
}
