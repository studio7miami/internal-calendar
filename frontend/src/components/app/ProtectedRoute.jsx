import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

function hasMembersPageAccess(user) {
  if (user?.role === "admin" || user?.role === "manager") return true;
  if (user?.permissions?.assign_member_calendars) return true;
  if (user?.permissions?.view_members_directory) return true;
  return false;
}

export default function ProtectedRoute({ children, adminOnly = false, membersPage = false, permission }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-slate-500 dark:bg-[#0b0b0c] dark:text-zinc-500">
        <div className="label-tech">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (membersPage) {
    if (hasMembersPageAccess(user)) return children;
    return <Navigate to="/" replace />;
  }
  if (adminOnly && user.role !== "admin") return <Navigate to="/" replace />;
  if (permission && user.role !== "admin" && !user.permissions?.[permission]) {
    return <Navigate to="/" replace />;
  }
  return children;
}
