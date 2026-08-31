import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import ProposalLoader from "../proposals/ProposalLoader";

function hasMembersPageAccess(user) {
  if (user?.role === "admin" || user?.role === "manager") return true;
  if (user?.permissions?.assign_member_calendars) return true;
  if (user?.permissions?.view_members_directory) return true;
  return false;
}

export default function ProtectedRoute({ children, adminOnly = false, membersPage = false, permission }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <ProposalLoader />;
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
