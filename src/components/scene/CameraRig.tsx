import { useCallback, useEffect, useRef } from "react";
import type { ComponentRef, MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DEFAULT_CAMERA } from "../../shared/constants";
import type { Selection, WorldState } from "../../shared/types";
import { SCENE_CAMERA_TARGET, getBuildingWorld } from "./sceneLayout";
import { tileToWorld } from "../../sim/city";

export interface SceneCameraApi {
  /** Smoothly frame the current selection (resident or building). */
  focusSelection(): void;
  /** Smoothly return to the default establishing shot. */
  resetCamera(): void;
}

interface CameraRigProps {
  apiRef: MutableRefObject<SceneCameraApi | null>;
  world: WorldState;
  selected: Selection;
  follow: boolean;
}

interface CameraTween {
  elapsed: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

type OrbitControlsInstance = ComponentRef<typeof OrbitControls>;

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

/**
 * Owns OrbitControls and all camera choreography. The HUD talks to this
 * component through an imperative ref, so camera motion never triggers a
 * React state update inside useFrame.
 */
export function CameraRig({ apiRef, world, selected, follow }: CameraRigProps) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsInstance | null>(null);
  const tweenRef = useRef<CameraTween | null>(null);
  const stateRef = useRef({ world, selected, follow });
  stateRef.current = { world, selected, follow };

  const direction = useRef(new THREE.Vector3());
  const targetPoint = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3());

  const startTween = useCallback(
    (toTarget: THREE.Vector3, toPosition: THREE.Vector3, duration = 0.75) => {
      const controls = controlsRef.current;
      if (!controls) return;
      tweenRef.current = {
        elapsed: 0,
        duration,
        fromPosition: camera.position.clone(),
        toPosition: toPosition.clone(),
        fromTarget: controls.target.clone(),
        toTarget: toTarget.clone(),
      };
      controls.enabled = false;
    },
    [camera],
  );

  const focusSelection = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const current = stateRef.current;
    const selection = current.selected;
    if (!selection) return;

    const toTarget = new THREE.Vector3();
    let distance = 18;

    if (selection.kind === "resident") {
      const resident = current.world.residents.find((item) => item.id === selection.id);
      if (!resident || !resident.alive) return;
      const position = tileToWorld(resident.position.x, resident.position.z);
      toTarget.set(position.x, 1.5, position.z);
      distance = 16;
    } else {
      const building = current.world.buildings.find((item) => item.id === selection.id);
      if (!building) return;
      const worldBox = getBuildingWorld(building);
      toTarget.set(worldBox.cx, building.openAir ? 1.2 : worldBox.height * 0.42, worldBox.cz);
      distance = building.openAir
        ? Math.max(20, Math.max(worldBox.width, worldBox.depth) * 2.4)
        : Math.min(78, Math.max(22, Math.max(worldBox.width, worldBox.depth) * 2.1 + worldBox.height * 1.15));
    }

    direction.current.copy(camera.position).sub(controls.target);
    if (direction.current.lengthSq() < 0.01) direction.current.set(1, 0.9, 1);
    direction.current.normalize();
    direction.current.y = Math.max(direction.current.y, 0.42);
    direction.current.normalize();

    const toPosition = toTarget
      .clone()
      .addScaledVector(direction.current, distance);
    toPosition.y = Math.max(toPosition.y, 6);
    startTween(toTarget, toPosition, 0.75);
  }, [camera, startTween]);

  const resetCamera = useCallback(() => {
    const toTarget = new THREE.Vector3(
      SCENE_CAMERA_TARGET[0],
      SCENE_CAMERA_TARGET[1],
      SCENE_CAMERA_TARGET[2],
    );
    const toPosition = new THREE.Vector3(
      DEFAULT_CAMERA.position[0],
      DEFAULT_CAMERA.position[1],
      DEFAULT_CAMERA.position[2],
    );
    startTween(toTarget, toPosition, 0.85);
  }, [startTween]);

  useEffect(() => {
    apiRef.current = { focusSelection, resetCamera };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, focusSelection, resetCamera]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(
      SCENE_CAMERA_TARGET[0],
      SCENE_CAMERA_TARGET[1],
      SCENE_CAMERA_TARGET[2],
    );
    controls.update();
  }, []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const dt = Math.min(Math.max(delta, 0.001), 0.1);
    const tween = tweenRef.current;

    if (tween) {
      tween.elapsed += dt;
      const progress = Math.min(1, tween.elapsed / tween.duration);
      const eased = easeInOutCubic(progress);
      camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      controls.update();
      if (progress >= 1) {
        tweenRef.current = null;
        controls.enabled = true;
      }
      return;
    }

    const current = stateRef.current;
    const followSelection = current.selected;
    if (!current.follow || !followSelection || followSelection.kind !== "resident") return;
    const resident = current.world.residents.find((item) => item.id === followSelection.id);
    if (!resident || !resident.alive) return;

    const position = tileToWorld(resident.position.x, resident.position.z);
    targetPoint.current.set(position.x, 1.4, position.z);
    offset.current.copy(targetPoint.current).sub(controls.target);
    const damping = 1 - Math.exp(-4.5 * dt);
    offset.current.multiplyScalar(damping);
    controls.target.add(offset.current);
    camera.position.add(offset.current);
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.075}
      rotateSpeed={0.62}
      zoomSpeed={0.9}
      panSpeed={0.85}
      screenSpacePanning={false}
      minDistance={9}
      maxDistance={150}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI / 2.06}
    />
  );
}
