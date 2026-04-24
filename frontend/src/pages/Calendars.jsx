import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Trash2, Plus } from "lucide-react";
import ColorWheel from "../components/app/ColorWheel";
import { pageTitleClass, pageCardClass, pageInputClass, pageBtnPrimaryClass, pageBtnOutlineClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";

const DEFAULT_COLOR = "#A78BFA";

export default function CalendarsAdmin() {
  const [cals, setCals] = useState([]);
  const [form, setForm] = useState({ name: "", color: DEFAULT_COLOR, google_calendar_id: "" });
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);

  const refresh = async () => {
    const { data } = await api.get("/calendars");
    setCals(data);
  };

  useEffect(() => {
    refresh();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/calendars", { ...form, is_active: true });
      setForm({ name: "", color: DEFAULT_COLOR, google_calendar_id: "" });
      refresh();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    }
  };

  const toggleActive = async (c) => {
    await api.patch(`/calendars/${c.id}`, {
      name: c.name,
      color: c.color,
      google_calendar_id: c.google_calendar_id || "",
      is_active: !c.is_active,
    });
    refresh();
  };

  const saveEdit = async (c) => {
    await api.patch(`/calendars/${c.id}`, {
      name: c.name,
      color: c.color,
      google_calendar_id: c.google_calendar_id || "",
      is_active: c.is_active,
    });
    setEditing(null);
    refresh();
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this calendar?")) return;
    await api.delete(`/calendars/${id}`);
    refresh();
  };

  return (
    <div className="space-y-6" data-testid="calendars-admin-page">
      <div>
        <div className="label-tech">Admin</div>
        <h1 className={pageTitleClass}>Calendars</h1>
      </div>

      <form onSubmit={create} className={cn("space-y-3 p-4", pageCardClass)} data-testid="new-calendar-form">
        <div className="label-tech">New calendar</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="Name"
            value={form.name}
            required
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="new-calendar-name"
            className={pageInputClass}
          />
          <Input
            placeholder="Google Calendar ID (optional)"
            value={form.google_calendar_id}
            onChange={(e) => setForm({ ...form, google_calendar_id: e.target.value })}
            data-testid="new-calendar-gcal"
            className={cn(pageInputClass, "font-mono")}
          />
          <ColorWheel
            value={form.color}
            onChange={(c) => setForm({ ...form, color: c })}
            testId="new-calendar-color"
          />
        </div>
        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}
        <Button type="submit" data-testid="new-calendar-submit" variant="ghost" className={pageBtnPrimaryClass}>
          <Plus className="mr-1 h-4 w-4" strokeWidth={1.5} /> Add calendar
        </Button>
      </form>

      <div className="grid gap-3">
        {cals.map((c) =>
          editing === c.id ? (
            <div key={c.id} className={cn("space-y-3 p-4", pageCardClass)}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  value={c.name}
                  onChange={(e) => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, name: e.target.value } : p)))}
                  className={pageInputClass}
                />
                <Input
                  value={c.google_calendar_id || ""}
                  onChange={(e) => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, google_calendar_id: e.target.value } : p)))}
                  placeholder="Google Calendar ID"
                  className={cn(pageInputClass, "font-mono")}
                />
                <ColorWheel
                  value={c.color}
                  onChange={(nc) => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, color: nc } : p)))}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => saveEdit(c)} variant="ghost" className={pageBtnPrimaryClass}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    refresh();
                  }}
                  className={pageBtnOutlineClass}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div
              key={c.id}
              className={cn("flex flex-wrap items-center justify-between gap-4 p-4", pageCardClass)}
              data-testid={`calendar-row-${c.id}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-slate-900 dark:text-white">{c.name}</div>
                  <div className="label-tech truncate text-slate-500 dark:text-neutral-400">
                    {c.google_calendar_id ? `gcal: ${c.google_calendar_id}` : "no gcal linked"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="label-tech text-slate-600 dark:text-neutral-400">Active</span>
                  <Switch
                    checked={c.is_active}
                    onCheckedChange={() => toggleActive(c)}
                    data-testid={`calendar-active-${c.id}`}
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setEditing(c.id)}
                  data-testid={`calendar-edit-${c.id}`}
                  className={pageBtnPrimaryClass}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => remove(c.id)}
                  data-testid={`calendar-delete-${c.id}`}
                  className={cn(
                    "h-10 border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/40",
                    "min-h-8 rounded-[7px] px-3"
                  )}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
