import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import {
  CalendarDays,
  Inbox,
  Layers,
  Users,
  User,
  Bell,
  LogOut,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "../../components/ui/dropdown-menu";

function NotificationBell() {
  const [notifs, setNotifs] = useState([]);
  const [open, setOpen] = useState(false);
  const unread = notifs.filter((n) => !n.is_read).length;

  const refresh = async () => {
    try {
      const { data } = await api.get("/notifications");
      setNotifs(data);
    } catch {}
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, []);

  const markAll = async () => {
    await api.post("/notifications/read-all");
    refresh();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="notification-bell-button"
          className="relative p-2 border border-neutral-800 hover:bg-neutral-900 rounded-sm"
        >
          <Bell className="w-4 h-4" strokeWidth={1.5} />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 bg-white text-black text-[10px] font-mono font-bold min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-sm"
              data-testid="notification-unread-count"
            >
              {unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 bg-[#121214] border-neutral-800 text-white"
        data-testid="notification-dropdown"
      >
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="label-tech">Notifications</span>
          {unread > 0 && (
            <button
              className="text-xs text-neutral-400 hover:text-white"
              onClick={markAll}
              data-testid="mark-all-read-button"
            >
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-neutral-800" />
        {notifs.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-neutral-500">
            No notifications
          </div>
        )}
        <div className="max-h-96 overflow-y-auto scrollbar-thin">
          {notifs.map((n) => (
            <div
              key={n.id}
              className={`px-3 py-2 border-b border-neutral-900 last:border-0 ${
                !n.is_read ? "bg-neutral-900/50" : ""
              }`}
              data-testid={`notification-item-${n.id}`}
            >
              <div className="text-sm font-medium">{n.title}</div>
              <div className="text-xs text-neutral-400 mt-0.5">{n.message}</div>
              <div className="label-tech text-[9px] mt-1">
                {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const navItems = (role) => {
  const items = [
    { to: "/", label: "Calendar", icon: CalendarDays, testid: "nav-calendar", end: true },
    { to: "/requests", label: "Requests", icon: Inbox, testid: "nav-requests" },
  ];
  if (role === "admin") {
    items.push({ to: "/calendars", label: "Calendars", icon: Layers, testid: "nav-calendars" });
    items.push({ to: "/members", label: "Members", icon: Users, testid: "nav-members" });
  }
  items.push({ to: "/profile", label: "Profile", icon: User, testid: "nav-profile" });
  return items;
};

export default function Layout() {
  const { user, logout } = useAuth();
  const items = navItems(user?.role);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed top-0 left-0 bottom-0 w-60 border-r border-neutral-900 flex-col p-6 z-30">
        <div className="mb-8">
          <div className="font-display text-xl leading-tight">Studio 7</div>
          <div className="label-tech">Miami · Console</div>
        </div>
        <nav className="space-y-1 flex-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              data-testid={it.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-sm rounded-sm transition-colors ${
                  isActive
                    ? "bg-white text-black"
                    : "text-neutral-300 hover:bg-neutral-900 hover:text-white"
                }`
              }
            >
              <it.icon className="w-4 h-4" strokeWidth={1.5} />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="pt-4 border-t border-neutral-900 space-y-2">
          <div className="text-sm">
            <div className="truncate">{user?.name}</div>
            <div className="label-tech truncate">{user?.role}</div>
          </div>
          <button
            data-testid="logout-button"
            onClick={logout}
            className="w-full flex items-center gap-2 text-xs text-neutral-400 hover:text-white px-3 py-2 border border-neutral-800 rounded-sm"
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} /> Sign out
          </button>
        </div>
      </aside>

      {/* Top bar (mobile + desktop right-side actions) */}
      <header className="fixed top-0 right-0 left-0 md:left-60 z-20 bg-[#09090B]/80 backdrop-blur-xl border-b border-neutral-900 px-4 md:px-8 h-14 flex items-center justify-between">
        <div className="md:hidden font-display text-lg">Studio 7</div>
        <div className="hidden md:block label-tech">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </div>
        <NotificationBell />
      </header>

      {/* Main */}
      <main className="pt-14 md:pl-60 pb-24 md:pb-8">
        <div className="p-4 md:p-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0F0F11] border-t border-neutral-900 z-30">
        <div className="flex justify-around items-center h-16">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              data-testid={`${it.testid}-mobile`}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 text-[10px] uppercase tracking-wider ${
                  isActive ? "text-white" : "text-neutral-500"
                }`
              }
            >
              <it.icon className="w-5 h-5" strokeWidth={1.5} />
              {it.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
