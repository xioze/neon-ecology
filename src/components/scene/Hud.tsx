import { BUILDING_TYPE_META } from "../../shared/constants";
import type { BuildingType, InteractionMode, Selection, WorldState } from "../../shared/types";
import { typeLabel } from "./sceneLayout";

interface SceneHudProps {
  world: WorldState;
  selected: Selection;
  paused: boolean;
  mode: InteractionMode;
  placementType: BuildingType | null;
  follow: boolean;
  canFollow: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleFollow: () => void;
  onFocusSelection: () => void;
  onResetCamera: () => void;
  onExitPlacement: () => void;
}

export function SceneHud({
  world,
  selected,
  paused,
  mode,
  placementType,
  follow,
  canFollow,
  collapsed,
  onToggleCollapsed,
  onToggleFollow,
  onFocusSelection,
  onResetCamera,
  onExitPlacement,
}: SceneHudProps) {
  const selectedName = (() => {
    if (!selected) return "未选中 · 点击建筑或居民";
    if (selected.kind === "building") {
      const building = world.buildings.find((item) => item.id === selected.id);
      return building ? `${building.name} · ${typeLabel(building.type)}` : "选中目标已移除";
    }
    const resident = world.residents.find((item) => item.id === selected.id);
    return resident ? `${resident.name} · ${resident.jobTitle}` : "选中目标已移除";
  })();

  const placementHint = placementType
    ? "左键地面放置 · Esc 退出 · 绿色足迹可放置"
    : mode === "intervene"
      ? "在控制台选择建筑类型即可进入放置模式"
      : "切换到干预模式并在控制台选择建筑类型";

  return (
    <aside
      className={`scene-hud${collapsed ? " scene-hud--collapsed" : ""}`}
      aria-label="3D 场景控制"
    >
      <div className="scene-hud__head">
        <div className="scene-hud__brand">
          <span className="scene-hud__eyebrow">NEON//ECOLOGY</span>
          <strong className="scene-hud__title">城市视野</strong>
        </div>
        <button
          type="button"
          className="scene-hud__collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "展开场景控件" : "收起场景控件"}
        >
          {collapsed ? "展开" : "收起"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="scene-hud__status">
            <span className={`scene-dot ${paused ? "scene-dot--paused" : "scene-dot--live"}`} />
            <span className="scene-hud__status-text">
              {paused ? "已暂停 · 插值收敛中" : "模拟运行中"}
            </span>
            <span
              className={`scene-hud__mode${mode === "intervene" ? " scene-hud__mode--intervene" : ""}`}
            >
              {mode === "intervene" ? "干预" : "观察"}
            </span>
          </div>

          <div className="scene-hud__selection" title={selectedName}>
            <span className="scene-hud__selection-label">目标</span>
            <span className="scene-hud__selection-value">{selectedName}</span>
          </div>

          <div className="scene-hud__actions">
            <button
              type="button"
              className={`scene-btn${follow ? " scene-btn--active" : ""}`}
              onClick={onToggleFollow}
              disabled={!canFollow}
              title={canFollow ? "相机平滑跟随选中的居民" : "请先选择一名存活的居民"}
            >
              <span className="scene-btn__icon">◎</span>
              {follow ? "停止跟随" : "跟随选中"}
            </button>
            <button
              type="button"
              className="scene-btn"
              onClick={onFocusSelection}
              disabled={!selected}
              title="将相机平滑聚焦到当前选中目标"
            >
              <span className="scene-btn__icon">⌖</span>
              聚焦选中
            </button>
            <button
              type="button"
              className="scene-btn"
              onClick={onResetCamera}
              title="回到默认城市视角"
            >
              <span className="scene-btn__icon">⟲</span>
              重置相机
            </button>
          </div>

          <div
            className={`scene-placement${placementType ? " scene-placement--active" : ""}`}
            title={placementHint}
          >
            <div className="scene-placement__head">
              <span className="scene-placement__tag">放置</span>
              <span className="scene-placement__type">
                {placementType ? typeLabel(placementType) : "未激活"}
              </span>
              {placementType ? (
                <button
                  type="button"
                  className="scene-btn scene-btn--danger scene-btn--compact"
                  onClick={onExitPlacement}
                >
                  退出
                </button>
              ) : (
                <span className="scene-placement__hint-inline">
                  {mode === "intervene" ? "控制台选择类型" : "需干预模式"}
                </span>
              )}
            </div>
            {placementType && <p className="scene-placement__hint">{placementHint}</p>}
          </div>

          <p className="scene-hint">
            左键选择 · 拖拽旋转 · 滚轮缩放 · 右键平移 · Esc 取消
          </p>
        </>
      )}
    </aside>
  );
}
