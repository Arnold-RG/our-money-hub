import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { isConfigured, settleAuth } from "./supabaseClient.js";
import "./styles.css";

async function start() {
  if (isConfigured) {
    try {
      await settleAuth();
    } catch {
      // The sign-in screen reports a failed return from email.
    }
  }
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
}

start();
