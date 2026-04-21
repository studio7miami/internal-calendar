import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=unauth, object=auth
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("s7_token");
    if (!token) {
      setUser(false);
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => {
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
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
