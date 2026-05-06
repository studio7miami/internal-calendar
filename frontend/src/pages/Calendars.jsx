import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import ColorWheel from "../components/app/ColorWheel";
import { pageTitleClass, pageCardClass, pageInputClass, pageBtnPrimaryClass, pageBtnOutlineClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";
import { normHm, weekRowsFromSlots, slotsFromWeekRows } from "../lib/availability";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function hmToMinutes(hm) {
  const s = normHm(hm);
  const [h, m] = s.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(24 * 60 - 1, h * 60 + m));
}

function minutesToHm(totalMinutes) {
  const t = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(t / 60);
  const mm = t % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function hmAddMinutes(hm, delta) {
  return minutesToHm(hmToMinutes(hm) + delta);
}

function formatHm12(hm) {
  const t = hmToMinutes(hm);
  if (t === 0) return "12:00 am";
  const h24 = Math.floor(t / 60);
  const m = t % 60;
  const isAm = h24 < 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const mm = String(m).padStart(2, "0");
  return `${h12}:${mm} ${isAm ? "am" : "pm"}`;
}

function ScheduleTimeStepper({ value, disabled, onChange, label }) {
  const step = 15;
  return (
    <div
      className={cn(
        "flex h-9 items-stretch overflow-hidden rounded-[7px] border border-gray-200/95 bg-white text-slate-900 shadow-sm dark:border-white/20 dark:bg-zinc-900/50 dark:text-white",
        disabled && "opacity-50"
      )}
      aria-label={label}
    >
      <div className="flex min-w-[6.25rem] flex-1 items-center px-2">
        <div className="text-[11px] font-medium tabular-nums leading-none">{formatHm12(value)}</div>
      </div>
      <div className="flex w-7 flex-col border-l border-gray-200/95 dark:border-white/15">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(hmAddMinutes(value, step))}
          className="flex flex-1 items-center justify-center hover:bg-slate-900/5 disabled:cursor-not-allowed dark:hover:bg-white/[0.06]"
          aria-label="Increase time"
        >
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <div className="h-px bg-gray-200/95 dark:bg-white/10" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(hmAddMinutes(value, -step))}
          className="flex flex-1 items-center justify-center hover:bg-slate-900/5 disabled:cursor-not-allowed dark:hover:bg-white/[0.06]"
          aria-label="Decrease time"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

export default function CalendarsAdmin({ embedded = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cals, setCals] = useState([]);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [gStatus, setGStatus] = useState(null); // null = loading
  const [newCalName, setNewCalName] = useState("");
  const [newCalColor, setNewCalColor] = useState("#222222");
  const [creatingCal, setCreatingCal] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [gList, setGList] = useState([]);
  const [mapDraft, setMapDraft] = useState({});
  const [mapLoading, setMapLoading] = useState(false);
  /** Google calendar id → selected for import (only used when there are no resources yet). */
  const [importSelection, setImportSelection] = useState({});
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [weekRowsState, setWeekRowsState] = useState(null);
  /** Avoid duplicate OAuth→dialog work (e.g. React Strict Mode) while `google=connected` is in the URL. */
  const googleConnectedFlowRef = useRef(false);

  const refresh = useCallback(async () => {
    const { data } = await api.get("/calendars");
    setCals(data);
  }, []);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const { data } = await api.get("/integrations/google/status");
      setGStatus(data);
    } catch {
      setGStatus({ client_configured: false, connected: false, email: null, needs_calendar_mapping: false });
    }
  }, []);

  useEffect(() => {
    refresh();
    loadGoogleStatus();
  }, [refresh, loadGoogleStatus]);

  const loadMapDialog = useCallback(async () => {
    setErr("");
    setMapLoading(true);
    setMapOpen(true);
    setImportSelection({});
    try {
      const [calRes, listRes] = await Promise.all([api.get("/calendars"), api.get("/integrations/google/calendar-list")]);
      const list = calRes.data || [];
      const gArr = Array.isArray(listRes.data) ? listRes.data : [];
      setCals(list);
      setGList(gArr);
      const draft = {};
      list.forEach((c) => {
        draft[c.id] = c.google_calendar_id || "";
      });
      setMapDraft(draft);
      const writable = gArr.filter((g) => g.writable);
      if (list.length === 0 && writable.length > 0) {
        setImportSelection(Object.fromEntries(writable.map((g) => [g.id, false])));
      }
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Could not load your Google calendars.");
      setMapOpen(false);
    } finally {
      setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    const g = searchParams.get("google");
    if (!g) return;

    if (g === "error") {
      const reason = searchParams.get("reason") || "unknown";
      setErr(`Google sign-in: ${reason.replace(/\+/g, " ")}`);
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete("google");
          n.delete("reason");
          return n;
        },
        { replace: true }
      );
      return;
    }

    if (g === "connected") {
      if (googleConnectedFlowRef.current) return;
      googleConnectedFlowRef.current = true;
      void (async () => {
        try {
          await loadGoogleStatus();
          await loadMapDialog();
        } finally {
          googleConnectedFlowRef.current = false;
          setSearchParams(
            (prev) => {
              const n = new URLSearchParams(prev);
              n.delete("google");
              n.delete("reason");
              return n;
            },
            { replace: true }
          );
        }
      })();
    }
  }, [searchParams, setSearchParams, loadGoogleStatus, loadMapDialog]);

  const importFromGoogle = async () => {
    const items = Object.entries(importSelection)
      .filter(([, on]) => on)
      .map(([google_calendar_id]) => ({ google_calendar_id }));
    if (!items.length) return;
    setErr("");
    setImportSubmitting(true);
    try {
      const { data } = await api.post("/integrations/google/import-calendars", { items });
      const n = (data?.imported || []).length;
      setMapOpen(false);
      await refresh();
      await loadGoogleStatus();
      setImportSelection({});
      if (n > 0) {
        setInfo(`Imported ${n} calendar(s).`);
      } else {
        setInfo("");
      }
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Import failed");
    } finally {
      setImportSubmitting(false);
    }
  };

  const saveMap = async () => {
    setErr("");
    try {
      for (const c of cals) {
        const gid = mapDraft[c.id] ?? "";
        await api.patch(`/calendars/${c.id}`, {
          name: c.name,
          color: c.color,
          google_calendar_id: gid,
          is_active: c.is_active,
          availability_weekly: Array.isArray(c.availability_weekly) ? c.availability_weekly : undefined,
        });
      }
      setMapOpen(false);
      setInfo("Calendar mapping saved.");
      await refresh();
      await loadGoogleStatus();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Save failed");
    }
  };

  const startGoogleOAuth = async (reconnect = false) => {
    setErr("");
    try {
      const { data } = await api.post("/integrations/google/start", { reconnect });
      if (data?.authorization_url) {
        window.location.href = data.authorization_url;
      }
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Could not start Google sign-in.");
    }
  };

  const reconnectGoogle = async () => {
    if (!window.confirm("Sign in with Google again? This replaces the current link.")) {
      return;
    }
    await startGoogleOAuth(true);
  };

  const disconnectGoogle = async () => {
    if (!window.confirm("Disconnect Google? Bookings will stop syncing until you connect again.")) return;
    setErr("");
    try {
      await api.post("/integrations/google/disconnect");
      setInfo("");
      await loadGoogleStatus();
      await refresh();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Disconnect failed");
    }
  };

  const createCalendar = async () => {
    const name = newCalName.trim();
    if (!name) return;
    setErr("");
    setCreatingCal(true);
    try {
      await api.post("/calendars", {
        name,
        color: newCalColor,
        google_calendar_id: "",
        is_active: true,
      });
      setNewCalName("");
      setNewCalColor("#222222");
      await refresh();
      await loadGoogleStatus();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Could not create calendar.");
    } finally {
      setCreatingCal(false);
    }
  };

  const toggleActive = async (c) => {
    setErr("");
    try {
      await api.patch(`/calendars/${c.id}`, {
        name: c.name,
        color: c.color,
        google_calendar_id: c.google_calendar_id || "",
        is_active: !c.is_active,
      });
      await refresh();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    }
  };

  const saveEdit = async (c) => {
    setErr("");
    const slots = slotsFromWeekRows(weekRowsState || weekRowsFromSlots(c.availability_weekly));
    if (slots.length === 0) {
      setErr("Turn on at least one day with open hours so members can request times.");
      return;
    }
    try {
      await api.patch(`/calendars/${c.id}`, {
        name: c.name,
        color: c.color,
        google_calendar_id: c.google_calendar_id || "",
        is_active: c.is_active,
        availability_weekly: slots,
      });
      setEditing(null);
      setWeekRowsState(null);
      await refresh();
      await loadGoogleStatus();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    }
  };

  const remove = async (c) => {
    if (!window.confirm("Delete this calendar?")) return;
    setErr("");
    try {
      await api.delete(`/calendars/${c.id}`);
      refresh();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    }
  };

  return (
    <div className="space-y-4" data-testid="calendars-admin-page">
      {!embedded && (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="label-tech">Accounts</div>
            <h1 className={pageTitleClass}>Calendars</h1>
          </div>
          {(info || err) && (
            <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
              {info && (
                <div className="max-w-full truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">{info}</div>
              )}
              {err && <div className="max-w-full text-right text-xs text-red-600 dark:text-red-400">{err}</div>}
            </div>
          )}
        </div>
      )}
      {embedded && (info || err) && (
        <div className="flex flex-col gap-1">
          {info && <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{info}</div>}
          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
        </div>
      )}

      <div className={cn("p-3 sm:p-4", pageCardClass)}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex shrink-0 items-center">
            <span className="label-tech">Sync</span>
          </div>
          <div className="min-w-0 flex-1">
            {gStatus == null ? (
              <p className="text-xs text-slate-500 dark:text-zinc-500">Loading…</p>
            ) : null}
            {gStatus != null && !gStatus?.client_configured ? (
              <p className="text-xs text-slate-600 dark:text-zinc-400">
                OAuth off — server <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-zinc-800">GOOGLE_OAUTH_*</code> (
                <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-zinc-800">.env.example</code>).
              </p>
            ) : gStatus?.connected ? (
              <p className="text-xs text-slate-600 dark:text-zinc-400">
                <span className="font-medium text-slate-800 dark:text-zinc-200">{gStatus.email || "Linked"}</span>
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {gStatus != null && gStatus.client_configured && gStatus.connected ? (
              <>
                <button
                  type="button"
                  onClick={() => loadMapDialog()}
                  className="px-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-zinc-500 dark:hover:text-zinc-300"
                  data-testid="google-map-calendars"
                >
                  Map calendars
                </button>
                <button
                  type="button"
                  onClick={reconnectGoogle}
                  className="px-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-zinc-500 dark:hover:text-zinc-300"
                  data-testid="google-reconnect"
                >
                  Different account
                </button>
                <button
                  type="button"
                  onClick={() => disconnectGoogle()}
                  className="px-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-zinc-500 dark:hover:text-zinc-300"
                  data-testid="google-disconnect"
                >
                  Disconnect
                </button>
              </>
            ) : gStatus != null && gStatus.client_configured ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => startGoogleOAuth(false)}
                className={cn("h-9", pageBtnPrimaryClass)}
                data-testid="google-connect-open"
              >
                Connect Google
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-md gap-0 border border-gray-200/95 bg-[#FAFAFA] p-5 text-slate-900 dark:border-white/20 dark:bg-zinc-950 dark:text-white sm:rounded-[7px]">
          <DialogHeader className="space-y-1 pb-3">
            <DialogTitle className="font-['Manrope',system-ui,sans-serif] text-lg font-semibold">
              {cals.length > 0 ? "Map to Google" : "Import from Google"}
            </DialogTitle>
            {cals.length > 0 ? (
              <DialogDescription className="text-left text-xs text-slate-600 dark:text-zinc-400">
                One Google calendar per resource row — bookings sync to the mapped calendar.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {mapLoading ? (
            <p className="py-4 text-xs text-slate-500">Loading…</p>
          ) : cals.length > 0 ? (
            <div className="space-y-3">
              {cals.map((c) => (
                <div key={c.id} className="space-y-1">
                  <label className="label-tech text-slate-700 dark:text-zinc-300">{c.name}</label>
                  <select
                    className={cn(pageInputClass, "h-9 w-full text-sm")}
                    value={mapDraft[c.id] ?? ""}
                    onChange={(e) => setMapDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                    data-testid={`google-map-select-${c.id}`}
                  >
                    <option value="">— Select —</option>
                    {gList
                      .filter((g) => g.writable !== false)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.summary}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setMapOpen(false)} className={cn("h-9", pageBtnOutlineClass)}>
                  Cancel
                </Button>
                <Button type="button" variant="ghost" onClick={saveMap} className={cn("h-9", pageBtnPrimaryClass)} data-testid="google-map-save">
                  Save
                </Button>
              </div>
            </div>
          ) : (gList || []).filter((g) => g.writable).length > 0 ? (
            <div className="space-y-3">
              {(gList || [])
                .filter((g) => g.writable)
                .map((g) => (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-3 rounded-[7px] border border-slate-200/90 bg-white/80 px-3 py-2.5 dark:border-white/10 dark:bg-zinc-900/40"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-slate-300"
                      checked={!!importSelection[g.id]}
                      onChange={(e) => setImportSelection((prev) => ({ ...prev, [g.id]: e.target.checked }))}
                      data-testid={`google-import-check-${g.id}`}
                    />
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-black/10 dark:border-white/10"
                      style={{ background: g.backgroundColor || "#94a3b8" }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-zinc-100">{g.summary}</div>
                      <div className="truncate text-[10px] uppercase tracking-wide text-slate-500 dark:text-zinc-500">
                        {g.accessRole || "calendar"}
                      </div>
                    </div>
                  </label>
                ))}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setMapOpen(false)} className={cn("h-9", pageBtnOutlineClass)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={importFromGoogle}
                  disabled={importSubmitting || !Object.values(importSelection).some(Boolean)}
                  className={cn("h-9", pageBtnPrimaryClass)}
                  data-testid="google-import-submit"
                >
                  {importSubmitting ? "Importing…" : "Import selected"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="py-2 text-xs text-slate-600 dark:text-zinc-400">
              No editable Google calendars were returned. Add a resource manually under Resources, or try{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => reconnectGoogle()}>
                a different Google account
              </button>
              .
            </p>
          )}
        </DialogContent>
      </Dialog>

      <div className="grid gap-2">
        {cals.map((c) =>
          editing === c.id ? (
            <div key={c.id} className={cn("space-y-3 p-3 sm:p-4", pageCardClass)}>
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                <Input
                  value={c.name}
                  onChange={(e) => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, name: e.target.value } : p)))}
                  className={pageInputClass}
                />
                <ColorWheel
                  value={c.color}
                  onChange={(nc) => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, color: nc } : p)))}
                />
              </div>
              <div className="rounded-[7px] border border-slate-200/80 bg-white/60 p-3 dark:border-white/10 dark:bg-zinc-900/30">
                <div className="label-tech mb-2 text-slate-700 dark:text-zinc-300">STUDIO SCHEDULE</div>
                <div className="grid max-h-[220px] gap-2 overflow-y-auto sm:max-h-none">
                  {(weekRowsState || weekRowsFromSlots(c.availability_weekly)).map((row) => (
                    <div
                      key={row.weekday}
                      className="flex flex-col gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0 dark:border-white/5 sm:flex-row sm:items-center sm:gap-2"
                    >
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-800 dark:text-zinc-200 sm:min-w-[7rem]">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(e) =>
                            setWeekRowsState((prev) => {
                              const base = prev || weekRowsFromSlots(c.availability_weekly);
                              return base.map((r) => (r.weekday === row.weekday ? { ...r, enabled: e.target.checked } : r));
                            })
                          }
                          className="rounded border-slate-300"
                        />
                        {row.label}
                      </label>
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <ScheduleTimeStepper
                          disabled={!row.enabled}
                          value={row.start}
                          label={`${row.label} start time`}
                          onChange={(next) =>
                            setWeekRowsState((prev) => {
                              const base = prev || weekRowsFromSlots(c.availability_weekly);
                              return base.map((r) => (r.weekday === row.weekday ? { ...r, start: next } : r));
                            })
                          }
                        />
                        <span className="text-[10px] text-slate-400">to</span>
                        <ScheduleTimeStepper
                          disabled={!row.enabled}
                          value={row.end}
                          label={`${row.label} end time`}
                          onChange={(next) =>
                            setWeekRowsState((prev) => {
                              const base = prev || weekRowsFromSlots(c.availability_weekly);
                              return base.map((r) => (r.weekday === row.weekday ? { ...r, end: next } : r));
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => saveEdit(c)} variant="ghost" className={pageBtnPrimaryClass}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setWeekRowsState(null);
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
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 p-3 sm:gap-4 sm:p-4",
                pageCardClass,
                !c.is_active && "opacity-80 saturate-[0.65]"
              )}
              data-testid={`calendar-row-${c.id}`}
            >
              <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full sm:h-3 sm:w-3" style={{ background: c.color }} />
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-900 dark:text-white sm:text-lg">{c.name}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
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
                  onClick={() => {
                    setWeekRowsState(weekRowsFromSlots(c.availability_weekly));
                    setEditing(c.id);
                  }}
                  data-testid={`calendar-edit-${c.id}`}
                  className={pageBtnPrimaryClass}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => remove(c)}
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

      <div className={cn("mt-3 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4", pageCardClass)}>
        <Input
          value={newCalName}
          onChange={(e) => setNewCalName(e.target.value)}
          placeholder="New calendar name"
          className={cn(pageInputClass, "sm:max-w-xs")}
          data-testid="new-calendar-name"
        />
        <div className="flex shrink-0 items-center justify-end gap-3 sm:ml-auto">
          <ColorWheel value={newCalColor} onChange={setNewCalColor} />
          <Button
            type="button"
            variant="ghost"
            onClick={createCalendar}
            disabled={creatingCal || !newCalName.trim()}
            className={cn("h-10 shrink-0", pageBtnPrimaryClass)}
            data-testid="new-calendar-add"
          >
            {creatingCal ? "Adding…" : "Add calendar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
