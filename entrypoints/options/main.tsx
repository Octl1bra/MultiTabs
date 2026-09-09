import React from "react";
import ReactDOM from "react-dom/client";
import "@/assets/tailwind.css";
import { applySystemTheme } from "@/src/ui/theme";
import App from "./App";

applySystemTheme();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
