/**
 * Custom confirmation dialog used for every irreversible creator action.
 * Exposes an imperative `useConfirm()` that resolves to a boolean.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "./ui";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  details?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "normal";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const settle = useCallback((value: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false);
      const next: PendingConfirm = { options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) settle(false);
          }}
        >
          <div
            className={cx("modal", pending.options.tone === "danger" && "modal-danger")}
            role="dialog"
            aria-modal="true"
            aria-label={pending.options.title}
          >
            <header className="modal-head">
              <span className="modal-kicker">造物主确认</span>
              <h3>{pending.options.title}</h3>
            </header>
            <div className="modal-body">
              {pending.options.message ? <p className="modal-message">{pending.options.message}</p> : null}
              {pending.options.details ? <div className="modal-details">{pending.options.details}</div> : null}
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn" onClick={() => settle(false)}>
                {pending.options.cancelText ?? "取消"}
              </button>
              <button
                type="button"
                className={cx("btn", pending.options.tone === "danger" ? "btn-danger" : "btn-primary")}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.options.confirmText ?? "确认执行"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm 必须在 ConfirmProvider 内使用");
  return context;
}
