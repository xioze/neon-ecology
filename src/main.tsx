import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { simulationStore } from "./store/useSimulation";
import "./styles/base.css";
import "./styles/ui.css";

function Boot() {
  useEffect(() => {
    simulationStore.start();
    return () => simulationStore.stop();
  }, []);
  return <App />;
}

const container = document.getElementById("root");
if (!container) throw new Error("缺少 #root 挂载点");

createRoot(container).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
