import React from "react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { LogOut } from "lucide-react";

export default function Profile() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="max-w-lg space-y-6" data-testid="profile-page">
      <div>
        <div className="label-tech">Profile</div>
        <h1 className="font-display text-3xl sm:text-4xl mt-1">{user.name}</h1>
      </div>
      <div className="border border-neutral-900 bg-[#0F0F11] p-6 rounded-sm space-y-4">
        <div>
          <div className="label-tech">Email</div>
          <div className="font-mono">{user.email}</div>
        </div>
        <div>
          <div className="label-tech">Role</div>
          <div className="font-mono capitalize">{user.role}</div>
        </div>
        <div>
          <div className="label-tech">Member since</div>
          <div className="font-mono">{new Date(user.created_at).toLocaleDateString()}</div>
        </div>
      </div>
      <Button
        onClick={logout}
        data-testid="profile-logout-button"
        className="bg-white text-black hover:bg-neutral-200 rounded-sm"
      >
        <LogOut className="w-4 h-4 mr-1" strokeWidth={1.5} /> Sign out
      </Button>
    </div>
  );
}
