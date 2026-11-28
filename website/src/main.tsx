import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { pageFromPath } from "./i18n/meta";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <App page={pageFromPath(window.location.pathname)} />
  </StrictMode>,
);
