import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Dev-only: silence known benign ResizeObserver loop error overlay (Chrome/WebKit quirk).
if (process.env.NODE_ENV === "development") {
  const IGNORE = "ResizeObserver loop completed with undelivered notifications";

  window.addEventListener("error", (e) => {
    if (String(e?.message || "").includes(IGNORE)) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
    }
  });

  const origConsoleError = console.error;
  console.error = (...args) => {
    if (args?.some((a) => String(a || "").includes(IGNORE))) return;
    origConsoleError(...args);
  };
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
