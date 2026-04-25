import axios from "axios";

const API_BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API_BASE,
});

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

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
