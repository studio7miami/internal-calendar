import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
import { buildPreviewMe } from "../lib/memberPreviewFixtures";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=unauth, object=auth
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (String(process.env.REACT_APP_MOCK_API || "") === "1") {
      const me = buildPreviewMe("admin");
      setUser(me);
      setLoading(false);
      return;
    }

    const token = localStorage.getItem("s7_token");
    const publicClient = typeof window !== "undefined" && window.location.pathname.startsWith("/p/");

    if (!token) {
      setUser(false);
      setLoading(false);
      return;
    }

    if (publicClient) {
      try {
        const cached = localStorage.getItem("s7_user");
        setUser(cached ? JSON.parse(cached) : false);
      } catch {
        setUser(false);
      }
      setLoading(false);
      return;
    }

    api
      .get("/auth/me")
      .then((r) => {
        setUser(r.data);
        localStorage.setItem("s7_user", JSON.stringify(r.data));
      })
      .catch((err) => {
        if (err?._staleAuthFailure || err?._mockAuthFailure) return;
        localStorage.removeItem("s7_token");
        localStorage.removeItem("s7_user");
        setUser(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const loginWithToken = (token, userObj) => {
    localStorage.setItem("s7_token", token);
    localStorage.setItem("s7_user", JSON.stringify(userObj));
    setUser(userObj);
  };

  const logout = () => {
    localStorage.removeItem("s7_token");
    localStorage.removeItem("s7_user");
    setUser(false);
    if (String(process.env.REACT_APP_MOCK_API || "") === "1") return;
    window.location.href = "/login";
  };

  const refreshUser = () => {
    if (String(process.env.REACT_APP_MOCK_API || "") === "1") {
      const me = buildPreviewMe("admin");
      setUser(me);
      return Promise.resolve(me);
    }
    return api
      .get("/auth/me")
      .then((r) => {
        setUser(r.data);
        localStorage.setItem("s7_user", JSON.stringify(r.data));
        return r.data;
      })
      .catch(() => null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginWithToken, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
