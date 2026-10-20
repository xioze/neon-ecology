import { useEffect } from "react";
import { CityScene } from "./components/CityScene";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { CreatorConsole } from "./components/CreatorConsole";
import { Inspector } from "./components/Inspector";
import { Toast } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { WorldSidebar } from "./components/WorldSidebar";
import { cx } from "./components/ui";
import { simulationStore, useSimulation } from "./store/useSimulation";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export default function App() {
  const state = useSimulation();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        simulationStore.togglePause();
        return;
      }
      if (event.key === "Escape") {
        if (document.querySelector(".modal-backdrop")) return;
        simulationStore.closeInspector();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ConfirmProvider>
      <div
        className={cx(
          "app-shell",
          state.consoleOpen ? "console-open" : "console-collapsed",
          state.selected && state.inspectorOpen ? "inspector-open" : "inspector-closed",
        )}
      >
        <TopBar />
        <WorldSidebar />
        <main className="viewport" aria-label="3D 城市视口">
          <CityScene />
        </main>
        <Inspector />
        <CreatorConsole />
        <Toast />
      </div>
    </ConfirmProvider>
  );
}
