import { useSyncExternalStore } from "react";
import { simulationStore, type SimulationUiState } from "./simulationStore";

export function useSimulation(): SimulationUiState {
  return useSyncExternalStore(
    simulationStore.subscribe,
    simulationStore.getSnapshot,
    simulationStore.getSnapshot,
  );
}

export { simulationStore };
export type { SimulationUiState };
