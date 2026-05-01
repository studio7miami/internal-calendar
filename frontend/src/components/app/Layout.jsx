import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { pageEnterMotionProps } from "./PageEnterMotion";
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
  const { user } = useAuth();
  const navigate = useNavigate();
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

  const canOpenRequests = !!user?.permissions?.approve_deny_requests;

  const fmtSubmittedStamp = (iso) => {
    try {
      const d = new Date(iso);
      const date = d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
      const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const t = String(time).replace(/\s/g, "").toLowerCase();
      return `${date} ${t}`;
    } catch {
      return "";
    }
  };

  const onNotificationClick = async (n) => {
    try {
      if (!n?.is_read) await api.post(`/notifications/${n.id}/read`);
    } catch {}
    refresh();

    if (canOpenRequests && n?.type === "request_submitted" && n?.booking_id) {
      setOpen(false);
      navigate(`/requests?open=${encodeURIComponent(String(n.booking_id))}`);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="notification-bell-button"
            className="relative rounded-[16px] border border-neutral-300 p-1.5 dark:border-neutral-800 md:hover:bg-neutral-100 md:dark:hover:bg-neutral-900"
          >
          <Bell className="h-3.5 w-3.5" strokeWidth={1.5} />
          {unread > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-[16px] bg-black px-1 text-[10px] font-bold text-white dark:bg-white dark:text-black"
              data-testid="notification-unread-count"
            >
              {unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={18}
        className="w-80 bg-white dark:bg-[#121214] border-neutral-300 dark:border-neutral-800 text-black dark:text-white"
        data-testid="notification-dropdown"
      >
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="label-tech">Notifications</span>
          {unread > 0 && (
            <button
              className="text-xs text-neutral-600 dark:text-neutral-400 md:hover:text-black md:dark:hover:text-white"
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
            <button
              key={n.id}
              className={`px-3 py-2 border-b border-neutral-200 dark:border-neutral-900 last:border-0 ${
                !n.is_read ? "bg-neutral-100/50 dark:bg-neutral-900/50" : ""
              } w-full text-left`}
              data-testid={`notification-item-${n.id}`}
              type="button"
              onClick={() => onNotificationClick(n)}
            >
              <div className="text-sm font-medium">{n.title}</div>
              <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 whitespace-pre-line">{n.message}</div>
              <div className="mt-1 text-left text-[10px] leading-none tracking-[0.2em] uppercase text-neutral-400 dark:text-zinc-500">
                {fmtSubmittedStamp(n.created_at)}
              </div>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const navItems = (user) => {
  const role = user?.role;
  const items = [
    { to: "/", label: "Calendar", icon: CalendarDays, testid: "nav-calendar", end: true },
    { to: "/requests", label: "Requests", icon: Inbox, testid: "nav-requests" },
  ];
  if (role === "admin") {
    items.push({ to: "/members", label: "Members", icon: Users, testid: "nav-members" });
  } else if (role === "manager") {
    items.push({ to: "/members", label: "Members", icon: Users, testid: "nav-members" });
  }
  items.push({ to: "/profile", label: "Profile", icon: User, testid: "nav-profile" });
  return items;
};

export default function Layout() {
  const { user, logout } = useAuth();
  const items = navItems(user);
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
    try {
      window.__S7_SYNC_FAVICON__?.(theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white text-black dark:bg-[#0b0b0c] dark:text-zinc-200">
      {/* Desktop sidebar */}
      <aside className="z-30 hidden w-60 flex-col border-r border-neutral-200 bg-white p-6 dark:border-white/[0.06] dark:bg-[#0b0b0c] md:fixed md:bottom-0 md:left-0 md:top-0 md:flex">
        <div className="mb-8">
          <a
            href="https://studio7.miami"
            target="_blank"
            rel="noopener noreferrer"
            className="block shrink-0 rounded-[7px] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/80 dark:focus-visible:ring-zinc-500/60"
            aria-label="Studio 7 Miami (opens studio7.miami)"
          >
            <img src="/brand/logo.png" alt="Studio 7 Miami" className="brand-logo brand-logo-nav brand-logo-nav-sidebar" />
          </a>
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
                    ? "border-gray-200/95 bg-[#FCFCFC] text-slate-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-200"
                    : "border-gray-200/50 text-neutral-400 dark:border-white/[0.06] dark:text-zinc-500 md:hover:border-gray-200/80 md:hover:text-slate-600 md:dark:hover:border-white/10 md:dark:hover:text-zinc-300"
                }`
              }
            >
              <it.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-neutral-200 pt-4 dark:border-white/[0.06]">
          <div className="text-sm">
            <div className="truncate text-slate-900 dark:text-zinc-200">{user?.name}</div>
            <div className="label-tech truncate">{user?.role}</div>
          </div>
          <button
            data-testid="logout-button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-[7px] border border-neutral-300 px-3 py-2 text-xs text-neutral-600 transition-colors dark:border-white/10 dark:text-zinc-400 md:hover:bg-slate-50 md:dark:hover:border-white/15 md:dark:hover:bg-white/[0.04] md:dark:hover:text-zinc-200"
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} /> Sign out
          </button>
        </div>
      </aside>

      {/* Top bar (mobile + desktop right-side actions) */}
      <header className="fixed left-0 right-0 top-0 z-20 flex h-14 min-w-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white/80 px-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#0b0b0c]/80 md:left-60 md:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-0 md:hidden">
            <a
              href="https://studio7.miami"
              target="_blank"
              rel="noopener noreferrer"
              className="block max-w-[min(11rem,52vw)] shrink-0 rounded-[7px] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/80 dark:focus-visible:ring-zinc-500/60"
              aria-label="Studio 7 Miami (opens studio7.miami)"
            >
              <img src="/brand/logo.png" alt="Studio 7 Miami" className="brand-logo brand-logo-nav brand-logo-nav-header" />
            </a>
          </div>
          <div className="hidden min-w-0 truncate md:block label-tech">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={toggleTheme}
            className="rounded-[7px] border border-neutral-300 p-1.5 transition-colors dark:border-white/10 md:hover:bg-slate-50 md:dark:hover:bg-white/[0.05]"
            data-testid="theme-toggle"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <NotificationBell />
        </div>
      </header>

      {/* Main: flex-1 fills space below header; padding reserves bottom nav on small screens */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-14 pb-16 md:pl-60 md:pb-8">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth motion-reduce:scroll-auto p-4 md:p-8 [scrollbar-gutter:stable]">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              {...pageEnterMotionProps}
              className="flex min-h-0 flex-1 flex-col"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-neutral-200 bg-white dark:border-white/[0.06] dark:bg-[#0b0b0c] md:hidden">
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
                    ? "border border-gray-200/95 bg-[#FCFCFC] text-slate-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-200"
                    : "border border-transparent text-neutral-400 dark:text-zinc-500"
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
