import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { installSaveOnExit } from "./editor/store";
import { startKeepAlive } from "./app/keepAlive";

installSaveOnExit();
startKeepAlive();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary onReset={() => location.reload()}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
