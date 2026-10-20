import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { Resident, Selection } from "../../shared/types";
import { tileToWorld } from "../../sim/city";
import { simulationStore } from "../../store/useSimulation";
import { HOVERED_COLOR, SELECTED_COLOR, residentVisualOffset } from "./sceneLayout";

interface ResidentsProps {
  residents: Resident[];
  selected: Selection;
  hovered: Selection;
  paused: boolean;
}

export function Residents({ residents, selected, hovered, paused }: ResidentsProps) {
  return (
    <group>
      {residents.map((resident) => {
        if (!resident.alive) return null;
        return (
          <ResidentActor
            key={resident.id}
            resident={resident}
            isSelected={selected?.kind === "resident" && selected.id === resident.id}
            isHovered={hovered?.kind === "resident" && hovered.id === resident.id}
            paused={paused}
          />
        );
      })}
    </group>
  );
}

interface ResidentActorProps {
  resident: Resident;
  isSelected: boolean;
  isHovered: boolean;
  paused: boolean;
}

const ResidentActor = memo(function ResidentActor({
  resident,
  isSelected,
  isHovered,
  paused,
}: ResidentActorProps) {
  const groupRef = useRef<THREE.Group | null>(null);
  const bodyRef = useRef<THREE.Group | null>(null);
  const legLeftRef = useRef<THREE.Group | null>(null);
  const legRightRef = useRef<THREE.Group | null>(null);
  const armLeftRef = useRef<THREE.Group | null>(null);
  const armRightRef = useRef<THREE.Group | null>(null);
  const headRef = useRef<THREE.Group | null>(null);

  const offset = useMemo(() => residentVisualOffset(resident.id), [resident.id]);
  const targetPosition = useMemo(() => new THREE.Vector3(), []);
  const initialized = useRef(false);
  const facingRef = useRef(resident.facing);
  const walkPhase = useRef(0);
  const insideRef = useRef<boolean | null>(null);
  const baseScale = useRef(resident.appearance.heightScale);

  useFrame((_, delta) => {
    const group = groupRef.current;
    const body = bodyRef.current;
    if (!group || !body) return;
    const dt = Math.min(Math.max(delta, 0.001), 0.1);

    const inside = resident.insideBuildingId !== null;
    const worldPosition = tileToWorld(resident.position.x, resident.position.z);
    targetPosition.set(worldPosition.x + offset.x, 0, worldPosition.z + offset.z);

    if (!initialized.current) {
      group.position.copy(targetPosition);
      facingRef.current = resident.facing;
      initialized.current = true;
    }

    const smooth = 1 - Math.exp(-10 * dt);
    group.position.x += (targetPosition.x - group.position.x) * smooth;
    group.position.z += (targetPosition.z - group.position.z) * smooth;
    if (group.position.distanceToSquared(targetPosition) < 0.0004) {
      group.position.copy(targetPosition);
    }

    let angleDelta = resident.facing - facingRef.current;
    angleDelta = Math.atan2(Math.sin(angleDelta), Math.cos(angleDelta));
    facingRef.current += angleDelta * (1 - Math.exp(-11 * dt));
    group.rotation.y = facingRef.current;

    const actionMoving = resident.currentAction?.phase === "moving";
    const distanceToTarget = Math.hypot(
      targetPosition.x - group.position.x,
      targetPosition.z - group.position.z,
    );
    const walking = !paused && !inside && (actionMoving || distanceToTarget > 0.35);
    walkPhase.current += dt * (walking ? 8.4 : 1.1);

    const swing = walking ? Math.sin(walkPhase.current) * 0.72 : Math.sin(walkPhase.current) * 0.045;
    if (legLeftRef.current) legLeftRef.current.rotation.x = swing;
    if (legRightRef.current) legRightRef.current.rotation.x = -swing;
    if (armLeftRef.current) armLeftRef.current.rotation.x = -swing * 0.82;
    if (armRightRef.current) armRightRef.current.rotation.x = swing * 0.82;
    body.position.y = walking
      ? Math.abs(Math.sin(walkPhase.current)) * 0.085
      : 0.02 + Math.sin(walkPhase.current) * 0.02;
    if (headRef.current) {
      headRef.current.rotation.x = walking ? Math.sin(walkPhase.current * 2) * 0.04 : 0;
    }

    if (insideRef.current !== inside) {
      insideRef.current = inside;
      applyIndoorVisual(group, inside);
      body.scale.set(1, baseScale.current * (inside ? 0.86 : 1), 1);
    }
  });

  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    simulationStore.setHovered({ kind: "resident", id: resident.id });
  };
  const handleOut = () => {
    const hovered = simulationStore.getSnapshot().hovered;
    if (hovered && hovered.kind === "resident" && hovered.id === resident.id) {
      simulationStore.setHovered(null);
    }
  };
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 6) return;
    event.stopPropagation();
    simulationStore.select({ kind: "resident", id: resident.id });
  };

  const { appearance } = resident;

  return (
    <group ref={groupRef}>
      {/* Fake blob shadow (real shadows are disabled for performance). */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]}>
        <circleGeometry args={[0.46, 18]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.38} depthWrite={false} />
      </mesh>

      <group ref={bodyRef} scale={[1, appearance.heightScale, 1]}>
        {/* Legs. */}
        <group ref={legLeftRef} position={[-0.155, 0.82, 0]}>
          <mesh position={[0, -0.38, 0]}>
            <capsuleGeometry args={[0.1, 0.42, 4, 8]} />
            <meshStandardMaterial color="#121a22" roughness={0.8} metalness={0.2} />
          </mesh>
        </group>
        <group ref={legRightRef} position={[0.155, 0.82, 0]}>
          <mesh position={[0, -0.38, 0]}>
            <capsuleGeometry args={[0.1, 0.42, 4, 8]} />
            <meshStandardMaterial color="#121a22" roughness={0.8} metalness={0.2} />
          </mesh>
        </group>

        {/* Torso. */}
        <mesh position={[0, 1.28, 0]}>
          <capsuleGeometry args={[0.27, 0.5, 6, 12]} />
          <meshStandardMaterial
            color={appearance.bodyColor}
            emissive={appearance.accentColor}
            emissiveIntensity={0.22}
            roughness={0.55}
            metalness={0.35}
          />
        </mesh>
        <mesh position={[0, 1.34, 0.235]}>
          <boxGeometry args={[0.24, 0.09, 0.06]} />
          <meshBasicMaterial color={appearance.accentColor} toneMapped={false} />
        </mesh>
        {/* Shoulder accents. */}
        {[-1, 1].map((sign) => (
          <mesh key={`shoulder-${sign}`} position={[sign * 0.29, 1.52, 0]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshBasicMaterial color={appearance.accentColor} toneMapped={false} transparent opacity={0.85} />
          </mesh>
        ))}

        {/* Arms. */}
        <group ref={armLeftRef} position={[-0.35, 1.5, 0]}>
          <mesh position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.075, 0.36, 4, 8]} />
            <meshStandardMaterial color={appearance.bodyColor} roughness={0.6} metalness={0.3} />
          </mesh>
        </group>
        <group ref={armRightRef} position={[0.35, 1.5, 0]}>
          <mesh position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.075, 0.36, 4, 8]} />
            <meshStandardMaterial color={appearance.bodyColor} roughness={0.6} metalness={0.3} />
          </mesh>
        </group>

        {/* Head + hair + cyber visor (visor marks the facing direction). */}
        <group ref={headRef} position={[0, 1.83, 0]}>
          <mesh>
            <sphereGeometry args={[0.245, 16, 12]} />
            <meshStandardMaterial
              color={appearance.skinColor}
              roughness={0.75}
              metalness={0.08}
              emissive={appearance.skinColor}
              emissiveIntensity={0.06}
            />
          </mesh>
          <mesh position={[0, 0.075, -0.02]} scale={[1.03, 0.78, 1.03]}>
            <sphereGeometry args={[0.245, 14, 10]} />
            <meshStandardMaterial
              color={appearance.hairColor}
              emissive={appearance.hairColor}
              emissiveIntensity={0.18}
              roughness={0.72}
            />
          </mesh>
          <mesh position={[0, 0.02, 0.215]}>
            <boxGeometry args={[0.27, 0.065, 0.06]} />
            <meshBasicMaterial color={appearance.accentColor} toneMapped={false} />
          </mesh>
          <mesh position={[0, -0.02, 0.238]}>
            <boxGeometry args={[0.2, 0.03, 0.04]} />
            <meshBasicMaterial color="#e8fbff" toneMapped={false} />
          </mesh>
        </group>
      </group>

      {isSelected && <SelectionRing variant="selected" />}
      {isHovered && <SelectionRing variant="hovered" />}

      {/* Invisible click capsule. */}
      <mesh
        position={[0, 1.3, 0]}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
        onClick={handleClick}
        userData={{ ignoreGhost: true }}
      >
        <cylinderGeometry args={[0.56, 0.56, 2.6, 10]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          depthWrite={false}
          colorWrite={false}
          userData={{ ignoreGhost: true }}
        />
      </mesh>
    </group>
  );
});

function SelectionRing({ variant }: { variant: "selected" | "hovered" }) {
  const ringRef = useRef<THREE.Mesh | null>(null);
  const markerRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const isSelected = variant === "selected";
  const color = isSelected ? SELECTED_COLOR : HOVERED_COLOR;

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const pulse = 1 + Math.sin(time * (isSelected ? 3.4 : 5)) * 0.08;
    if (ringRef.current) ringRef.current.scale.setScalar(pulse);
    if (materialRef.current) {
      materialRef.current.opacity = 0.5 + (Math.sin(time * (isSelected ? 3.4 : 5)) + 1) * 0.22;
    }
    if (markerRef.current) {
      markerRef.current.rotation.y = time * 1.6;
      markerRef.current.position.y = 2.95 + Math.sin(time * 2.2) * 0.12;
    }
  });

  return (
    <group userData={{ ignoreGhost: true }}>
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position={[0, 0.06, 0]}>
        <ringGeometry args={isSelected ? [0.52, 0.74, 40] : [0.78, 0.94, 40]} />
        <meshBasicMaterial
          ref={materialRef}
          color={color}
          toneMapped={false}
          transparent
          opacity={0.75}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {isSelected && (
        <mesh ref={markerRef} position={[0, 2.95, 0]} userData={{ ignoreGhost: true }}>
          <octahedronGeometry args={[0.15, 0]} />
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.95} />
        </mesh>
      )}
    </group>
  );
}

/** Fades a resident out when the engine reports them inside a building. */
function applyIndoorVisual(group: THREE.Group, inside: boolean): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.ignoreGhost) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      const record = material.userData as {
        baseOpacity?: number;
        baseTransparent?: boolean;
        baseDepthWrite?: boolean;
      };
      if (record.baseOpacity === undefined) {
        record.baseOpacity = material.opacity;
        record.baseTransparent = material.transparent;
        record.baseDepthWrite = material.depthWrite;
      }
      material.opacity = inside ? record.baseOpacity * 0.3 : record.baseOpacity;
      material.transparent = inside ? true : (record.baseTransparent ?? false);
      material.depthWrite = inside ? false : (record.baseDepthWrite ?? true);
      material.needsUpdate = true;
    }
  });
}
