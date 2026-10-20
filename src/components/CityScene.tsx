import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Canvas } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { BuildingType, Selection, WorldState } from "../shared/types";
import { simulationStore, useSimulation } from "../store/useSimulation";
import { Atmosphere } from "./scene/Atmosphere";
import { Buildings } from "./scene/Buildings";
import { CameraRig, type SceneCameraApi } from "./scene/CameraRig";
import { Ground } from "./scene/Ground";
import { Highlights } from "./scene/Highlights";
import { SceneHud } from "./scene/Hud";
import { SceneLabels } from "./scene/Labels";
import { MiniMap } from "./scene/MiniMap";
import { PlacementPreview, type PointerTile } from "./scene/PlacementPreview";
import { Residents } from "./scene/Residents";
import {
  FOG_COLOR,
  SCENE_BG,
  SCENE_CAMERA_POSITION,
  type Cell,
} from "./scene/sceneLayout";
import "../styles/scene.css";

const CAMERA_PROPS = {
  position: [
    SCENE_CAMERA_POSITION[0],
    SCENE_CAMERA_POSITION[1],
    SCENE_CAMERA_POSITION[2],
  ] as [number, number, number],
  fov: 46,
  near: 0.1,
  far: 420,
};

const GL_PROPS = {
  antialias: true,
  powerPreference: "high-performance" as const,
  alpha: false,
};

const DPR_RANGE: [number, number] = [1, 2];

/**
 * NEON//ECOLOGY three-dimensional city view.
 *
 * The component subscribes to the simulation store once per simulation tick
 * (never per animation frame), while all per-frame motion (resident
 * interpolation, camera follow, placement ghost) is applied imperatively to
 * three.js objects via useFrame.
 */
export function CityScene() {
  const { world, selected, hovered, placement, paused, mode, revision } = useSimulation();

  const [followSelected, setFollowSelected] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const pointerTileRef = useRef<PointerTile | null>(null);
  const cursorTipRef = useRef<HTMLDivElement | null>(null);
  const cursorCoordRef = useRef<HTMLSpanElement | null>(null);
  const cameraApiRef = useRef<SceneCameraApi | null>(null);
  const placementTypeRef = useRef<BuildingType | null>(placement.type);
  placementTypeRef.current = placement.type;

  const canFollow =
    selected?.kind === "resident" &&
    Boolean(world.residents.find((resident) => resident.id === selected.id)?.alive);

  const hideCursorTip = useCallback(() => {
    if (cursorTipRef.current) cursorTipRef.current.style.opacity = "0";
    if (pointerTileRef.current) pointerTileRef.current.active = false;
  }, []);

  const handleGroundClick = useCallback((tile: Cell) => {
    const type = placementTypeRef.current;
    if (type) {
      simulationStore.placeBuildingAt(tile.x, tile.z);
      return;
    }
    simulationStore.select(null);
  }, []);

  const handleGroundPointerMove = useCallback(
    (tile: Cell, event: ThreeEvent<PointerEvent>) => {
      pointerTileRef.current = { x: tile.x, z: tile.z, active: true };
      if (!placementTypeRef.current) {
        if (cursorTipRef.current) cursorTipRef.current.style.opacity = "0";
        return;
      }
      const tip = cursorTipRef.current;
      const host = rootRef.current;
      if (!tip || !host) return;
      const rect = host.getBoundingClientRect();
      const native = event.nativeEvent;
      tip.style.transform = `translate3d(${native.clientX - rect.left + 20}px, ${
        native.clientY - rect.top + 16
      }px, 0)`;
      tip.style.opacity = "1";
      if (cursorCoordRef.current) {
        cursorCoordRef.current.textContent = `网格 ${tile.x} , ${tile.z}`;
      }
    },
    [],
  );

  const handleGroundPointerOut = useCallback(() => {
    hideCursorTip();
  }, [hideCursorTip]);

  const handleRootPointerLeave = useCallback(() => {
    hideCursorTip();
    simulationStore.setHovered(null);
  }, [hideCursorTip]);

  // Stop following whenever the selection stops being a living resident.
  useEffect(() => {
    if (!canFollow) setFollowSelected(false);
  }, [canFollow]);

  // Leaving placement mode hides the cursor coordinate bubble.
  useEffect(() => {
    if (!placement.type) hideCursorTip();
  }, [placement.type, hideCursorTip]);

  // Esc cancels placement first, then clears the selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const state = simulationStore.getSnapshot();
      if (state.placement.type) {
        simulationStore.setPlacementType(null);
        return;
      }
      if (state.selected) simulationStore.select(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const rootClassName = [
    "scene-root",
    placement.type ? "scene-root--placing" : "",
    hovered ? "scene-root--pointing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={rootRef} className={rootClassName} onPointerLeave={handleRootPointerLeave}>
      <Canvas
        className="scene-canvas"
        dpr={DPR_RANGE}
        gl={GL_PROPS}
        camera={CAMERA_PROPS}
        frameloop="always"
      >
        <SceneContents
          world={world}
          selected={selected}
          hovered={hovered}
          paused={paused}
          placementType={placement.type}
          revision={revision}
          follow={followSelected}
          pointerTileRef={pointerTileRef}
          cameraApiRef={cameraApiRef}
          onGroundClick={handleGroundClick}
          onGroundPointerMove={handleGroundPointerMove}
          onGroundPointerOut={handleGroundPointerOut}
        />
      </Canvas>

      <SceneHud
        world={world}
        selected={selected}
        paused={paused}
        mode={mode}
        placementType={placement.type}
        follow={followSelected}
        canFollow={Boolean(canFollow)}
        collapsed={hudCollapsed}
        onToggleCollapsed={() => setHudCollapsed((value) => !value)}
        onToggleFollow={() => setFollowSelected((value) => !value)}
        onFocusSelection={() => cameraApiRef.current?.focusSelection()}
        onResetCamera={() => {
          setFollowSelected(false);
          cameraApiRef.current?.resetCamera();
        }}
        onExitPlacement={() => simulationStore.setPlacementType(null)}
      />

      <div className="scene-minimap-panel">
        <MiniMap world={world} selected={selected} hovered={hovered} />
      </div>

      <div ref={cursorTipRef} className="scene-cursor-tip" aria-hidden="true">
        <span className="scene-cursor-tip__label">放置预览</span>
        <span ref={cursorCoordRef} className="scene-cursor-tip__coord">
          网格 — , —
        </span>
      </div>
    </div>
  );
}

interface SceneContentsProps {
  world: WorldState;
  selected: Selection;
  hovered: Selection;
  paused: boolean;
  placementType: BuildingType | null;
  revision: number;
  follow: boolean;
  pointerTileRef: MutableRefObject<PointerTile | null>;
  cameraApiRef: MutableRefObject<SceneCameraApi | null>;
  onGroundClick: (tile: Cell) => void;
  onGroundPointerMove: (tile: Cell, event: ThreeEvent<PointerEvent>) => void;
  onGroundPointerOut: () => void;
}

function SceneContents({
  world,
  selected,
  hovered,
  paused,
  placementType,
  revision,
  follow,
  pointerTileRef,
  cameraApiRef,
  onGroundClick,
  onGroundPointerMove,
  onGroundPointerOut,
}: SceneContentsProps) {
  return (
    <>
      <color attach="background" args={[SCENE_BG]} />
      <fog attach="fog" args={[FOG_COLOR, 60, 185]} />
      <Atmosphere />
      <Ground
        onGroundClick={onGroundClick}
        onGroundPointerMove={onGroundPointerMove}
        onGroundPointerOut={onGroundPointerOut}
      />
      <Buildings buildings={world.buildings} />
      <Residents
        residents={world.residents}
        selected={selected}
        hovered={hovered}
        paused={paused}
      />
      <Highlights world={world} selected={selected} hovered={hovered} />
      <SceneLabels world={world} selected={selected} hovered={hovered} />
      <PlacementPreview
        world={world}
        type={placementType}
        pointerRef={pointerTileRef}
        revision={revision}
      />
      <CameraRig apiRef={cameraApiRef} world={world} selected={selected} follow={follow} />
    </>
  );
}
