import axios from "axios";
import { createMockApi } from "./mockApi";

function normalizeApiBase() {
  const raw = String(process.env.REACT_APP_BACKEND_URL || "").trim();
  // If not set, default to same-origin. This prevents production from ever trying localhost.
  if (!raw) return "/api";

  // Remove trailing slashes for consistent joining.
  const origin = raw.replace(/\/+$/, "");

  // Allow passing full base including /api.
  if (origin.endsWith("/api")) return origin;

  return `${origin}/api`;
}

const API_BASE = normalizeApiBase();

const MOCK_MODE = String(process.env.REACT_APP_MOCK_API || "") === "1";

export const api = MOCK_MODE
  ? createMockApi()
  : axios.create({
      baseURL: API_BASE,
      // Prevents infinite “Loading…” when the API or proxy hangs (default axios has no timeout).
      timeout: 30000,
    });

if (!MOCK_MODE) {
  api.interceptors.request.use((config) => {
    const token = localStorage.getItem("s7_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  api.interceptors.response.use(
    (r) => r,
    (err) => {
      if (err?.response?.status === 401) {
        // If an older in-flight request got 401 after a new login set a new token, do not
        // wipe the session (would look like "can't sign in" even when login returned 200).
        const sent = (err?.config?.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
        const now = localStorage.getItem("s7_token");
        if (now && sent && sent !== now) {
          err._staleAuthFailure = true;
          return Promise.reject(err);
        }
        const path = window.location.pathname;
        if (!path.startsWith("/login") && !path.startsWith("/invite")) {
          localStorage.removeItem("s7_token");
          localStorage.removeItem("s7_user");
          window.location.href = "/login";
        }
      }
      return Promise.reject(err);
    }
  );
}

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

/** Prefer this in catch blocks: surfaces PostgREST `message`, HTTP errors, and network failures. */
export function formatApiErrorFromAxios(err) {
  if (!err) return "Something went wrong.";
  if (err._staleAuthFailure) return "Your session was refreshed. Please try again.";
  const res = err.response;
  const data = res?.data;
  const fromDetail = formatApiError(typeof data === "object" ? data?.detail : undefined);
  if (fromDetail && fromDetail !== "Something went wrong.") return fromDetail;
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) return data.message;
    if (typeof data.error_description === "string" && data.error_description.trim()) return data.error_description;
    if (typeof data.hint === "string" && data.hint.trim()) return data.hint;
  }
  if (typeof data === "string" && data.trim() && data.length < 600) return data;
  if (!res)
    return err.code === "ECONNABORTED" || /timeout/i.test(String(err.message || ""))
      ? "Request timed out. The server may be busy — try again in a moment."
      : err.message?.includes("Network Error")
        ? "Network error — check your connection and try again."
        : err.message || "Request failed — no response from server.";
  return `Request failed (${res.status}).`;
}
