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
  Sun,
  Moon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "../../components/ui/dropdown-menu";
import ChatBot from "./ChatBot";

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
          className="relative p-2 border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-[16px]"
        >
          <Bell className="w-4 h-4" strokeWidth={1.5} />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 bg-black text-white dark:bg-white dark:text-black text-[10px] font-mono font-bold min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-[16px]"
              data-testid="notification-unread-count"
            >
              {unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 bg-white dark:bg-[#121214] border-neutral-300 dark:border-neutral-800 text-black dark:text-white"
        data-testid="notification-dropdown"
      >
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="label-tech">Notifications</span>
          {unread > 0 && (
            <button
              className="text-xs text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white"
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
              className={`px-3 py-2 border-b border-neutral-200 dark:border-neutral-900 last:border-0 ${
                !n.is_read ? "bg-neutral-100/50 dark:bg-neutral-900/50" : ""
              }`}
              data-testid={`notification-item-${n.id}`}
            >
              <div className="text-sm font-medium">{n.title}</div>
              <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">{n.message}</div>
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
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <div className="min-h-screen bg-white dark:bg-[#09090B] text-black dark:text-white">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed top-0 left-0 bottom-0 w-60 border-r border-neutral-200 dark:border-neutral-900 flex-col p-6 z-30 bg-white dark:bg-[#09090B]">
        <div className="mb-8">
          <img src="/brand/favicon.png" alt="Studio 7" className="brand-logo h-8 w-8" />
        </div>
        <nav className="space-y-1 flex-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              data-testid={it.testid}
              className={({ isActive }) =>
                `flex min-h-8 items-center gap-3 border px-3 py-1.5 text-sm transition-colors rounded-[7px] ${
                  isActive
                    ? "border-gray-200/95 bg-[#FCFCFC] text-slate-900 dark:border-white/70 dark:bg-white/10 dark:text-white"
                    : "border-gray-200/50 text-neutral-400 dark:border-white/20 dark:text-neutral-500 hover:border-gray-200/80 hover:text-slate-600 dark:hover:border-white/30 dark:hover:text-neutral-300"
                }`
              }
            >
              <it.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
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
            className="w-full flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white px-3 py-2 border border-neutral-300 dark:border-neutral-800 rounded-[16px]"
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} /> Sign out
          </button>
        </div>
      </aside>

      {/* Top bar (mobile + desktop right-side actions) */}
      <header className="fixed top-0 right-0 left-0 md:left-60 z-20 bg-white/80 dark:bg-[#09090B]/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-900 px-4 md:px-8 h-14 flex items-center justify-between">
        <div className="md:hidden">
          <img src="/brand/favicon.png" alt="Studio 7" className="brand-logo h-6 w-6" />
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:block label-tech">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-[16px]"
            data-testid="theme-toggle"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <NotificationBell />
        </div>
      </header>

      {/* Main */}
      <main className="pt-14 md:pl-60 pb-24 md:pb-8">
        <div className="p-4 md:p-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0F0F11] border-t border-neutral-200 dark:border-neutral-900 z-30">
        <div className="flex justify-around items-center h-16 px-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              data-testid={`${it.testid}-mobile`}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-center text-[10px] uppercase leading-tight tracking-wider transition-colors rounded-[7px] ${
                  isActive
                    ? "border border-gray-200/95 bg-[#FCFCFC] text-slate-900 dark:border-white/70 dark:bg-white/10 dark:text-white"
                    : "border border-transparent text-neutral-400 dark:text-neutral-500"
                }`
              }
            >
              <it.icon className="h-5 w-5 shrink-0" strokeWidth={1.5} />
              {it.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <ChatBot />
    </div>
  );
}
