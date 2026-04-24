import React from "react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { LogOut } from "lucide-react";
import { pageTitleClass, pageCardClass, pageBtnPrimaryClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";

export default function Profile() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="max-w-lg space-y-6" data-testid="profile-page">
      <div>
        <div className="label-tech">Profile</div>
        <h1 className={pageTitleClass}>{user.name}</h1>
      </div>
      <div className={cn("space-y-4 p-6", pageCardClass)}>
        <div>
          <div className="label-tech">Email</div>
          <div className="font-mono text-slate-900 dark:text-white">{user.email}</div>
        </div>
        <div>
          <div className="label-tech">Role</div>
          <div className="font-mono capitalize text-slate-900 dark:text-white">{user.role}</div>
        </div>
        <div>
          <div className="label-tech">Member since</div>
          <div className="font-mono text-slate-900 dark:text-white">
            {new Date(user.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>
      <Button
        onClick={logout}
        data-testid="profile-logout-button"
        variant="ghost"
        className={pageBtnPrimaryClass}
      >
        <LogOut className="mr-1 h-4 w-4" strokeWidth={1.5} /> Sign out
      </Button>
    </div>
  );
}
