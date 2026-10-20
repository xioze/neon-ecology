import { simulationStore, useSimulation } from "../store/useSimulation";
import { cx } from "./ui";

const TOAST_ICONS: Record<string, string> = {
  success: "✓",
  error: "✕",
  info: "◇",
};

const TOAST_LABELS: Record<string, string> = {
  success: "已生效",
  error: "操作被拒绝",
  info: "系统提示",
};

export function Toast() {
  const { toast } = useSimulation();
  if (!toast) return null;
  return (
    <div className={cx("toast", `toast-${toast.kind}`)} role="status" key={toast.id}>
      <span className="toast-icon" aria-hidden="true">
        {TOAST_ICONS[toast.kind] ?? "◇"}
      </span>
      <span className="toast-body">
        <span className="toast-kind">{TOAST_LABELS[toast.kind] ?? "系统提示"}</span>
        <span className="toast-text">{toast.text}</span>
      </span>
      <button
        type="button"
        className="toast-close"
        aria-label="关闭提示"
        onClick={() => simulationStore.dismissToast()}
      >
        ×
      </button>
    </div>
  );
}
