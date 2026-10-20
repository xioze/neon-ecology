import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Building, Selection, WorldState } from "../../shared/types";
import { HOVERED_COLOR, SELECTED_COLOR, getBuildingWorld } from "./sceneLayout";

interface HighlightsProps {
  world: WorldState;
  selected: Selection;
  hovered: Selection;
}

/** Ground/volume highlight for hovered and selected buildings. */
export function Highlights({ world, selected, hovered }: HighlightsProps) {
  const selectedBuilding =
    selected && selected.kind === "building"
      ? world.buildings.find((building) => building.id === selected.id)
      : undefined;
  const hoveredBuilding =
    hovered && hovered.kind === "building" && hovered.id !== selectedBuilding?.id
      ? world.buildings.find((building) => building.id === hovered.id)
      : undefined;

  return (
    <>
      {selectedBuilding && <BuildingHighlight building={selectedBuilding} variant="selected" />}
      {hoveredBuilding && <BuildingHighlight building={hoveredBuilding} variant="hovered" />}
    </>
  );
}

function BuildingHighlight({
  building,
  variant,
}: {
  building: Building;
  variant: "selected" | "hovered";
}) {
  const world = useMemo(
    () => getBuildingWorld(building),
    [building.x, building.z, building.w, building.d, building.capacity, building.type, building.id],
  );
  const color = variant === "selected" ? SELECTED_COLOR : HOVERED_COLOR;
  const highlightHeight = building.openAir ? 2.4 : world.height;

  const frameGeometry = useMemo(() => {
    const hw = world.width / 2 + 0.3;
    const hd = world.depth / 2 + 0.3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -hw, 0, -hd, hw, 0, -hd,
          hw, 0, -hd, hw, 0, hd,
          hw, 0, hd, -hw, 0, hd,
          -hw, 0, hd, -hw, 0, -hd,
        ],
        3,
      ),
    );
    return geometry;
  }, [world.width, world.depth]);

  const cornerGeometry = useMemo(() => {
    const hw = world.width / 2 + 0.3;
    const hd = world.depth / 2 + 0.3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -hw, 0, -hd, -hw, highlightHeight + 0.4, -hd,
          hw, 0, -hd, hw, highlightHeight + 0.4, -hd,
          hw, 0, hd, hw, highlightHeight + 0.4, hd,
          -hw, 0, hd, -hw, highlightHeight + 0.4, hd,
        ],
        3,
      ),
    );
    return geometry;
  }, [world.width, world.depth, highlightHeight]);

  const lineMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const cornerMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const boxMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const pulse = 0.55 + (Math.sin(time * (variant === "selected" ? 3 : 5)) + 1) * 0.2;
    if (lineMaterialRef.current) lineMaterialRef.current.opacity = pulse;
    if (cornerMaterialRef.current) cornerMaterialRef.current.opacity = pulse * 0.85;
    if (boxMaterialRef.current) boxMaterialRef.current.opacity = 0.08 + pulse * 0.1;
  });

  return (
    <group position={[world.cx, 0, world.cz]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.22, 0]}>
        <planeGeometry args={[world.width + 0.7, world.depth + 0.7]} />
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={frameGeometry} position={[0, highlightHeight + 0.55, 0]}>
        <lineBasicMaterial
          ref={lineMaterialRef}
          color={color}
          toneMapped={false}
          transparent
          opacity={0.8}
        />
      </lineSegments>
      <lineSegments geometry={cornerGeometry} position={[0, 0.2, 0]}>
        <lineBasicMaterial
          ref={cornerMaterialRef}
          color={color}
          toneMapped={false}
          transparent
          opacity={0.6}
        />
      </lineSegments>
      {!building.openAir && (
        <mesh position={[0, highlightHeight / 2, 0]}>
          <boxGeometry args={[world.width + 0.5, highlightHeight, world.depth + 0.5]} />
          <meshBasicMaterial
            ref={boxMaterialRef}
            color={color}
            wireframe
            toneMapped={false}
            transparent
            opacity={0.14}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
