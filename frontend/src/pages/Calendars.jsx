import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Trash2, Plus } from "lucide-react";

const COLOR_OPTIONS = [
  "#A78BFA", "#38BDF8", "#34D399", "#F472B6", "#FB7185",
  "#FBBF24", "#60A5FA", "#F97316", "#A3E635", "#E879F9",
];

export default function CalendarsAdmin() {
  const [cals, setCals] = useState([]);
  const [form, setForm] = useState({ name: "", color: COLOR_OPTIONS[0], google_calendar_id: "" });
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
      setForm({ name: "", color: COLOR_OPTIONS[0], google_calendar_id: "" });
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
        <h1 className="font-display text-3xl sm:text-4xl mt-1">Calendars</h1>
      </div>

      <form onSubmit={create} className="border border-neutral-900 bg-[#0F0F11] p-4 rounded-sm space-y-3" data-testid="new-calendar-form">
        <div className="label-tech">New calendar</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Input
            placeholder="Name"
            value={form.name}
            required
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="new-calendar-name"
            className="bg-[#121214] border-neutral-800 h-10"
          />
          <Input
            placeholder="Google Calendar ID (optional)"
            value={form.google_calendar_id}
            onChange={(e) => setForm({ ...form, google_calendar_id: e.target.value })}
            data-testid="new-calendar-gcal"
            className="bg-[#121214] border-neutral-800 h-10 font-mono"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_OPTIONS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                data-testid={`color-${c}`}
                className={`w-6 h-6 rounded-full border-2 ${form.color === c ? "border-white" : "border-transparent"}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        {err && <div className="text-sm text-red-400">{err}</div>}
        <Button type="submit" data-testid="new-calendar-submit" className="bg-white text-black hover:bg-neutral-200 rounded-sm">
          <Plus className="w-4 h-4 mr-1" strokeWidth={1.5} /> Add calendar
        </Button>
      </form>

      <div className="grid gap-3">
        {cals.map((c) =>
          editing === c.id ? (
            <div key={c.id} className="border border-neutral-800 bg-[#0F0F11] p-4 rounded-sm space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <Input
                  value={c.name}
                  onChange={(e) => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, name: e.target.value } : p)))}
                  className="bg-[#121214] border-neutral-800 h-10"
                />
                <Input
                  value={c.google_calendar_id || ""}
                  onChange={(e) => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, google_calendar_id: e.target.value } : p)))}
                  placeholder="Google Calendar ID"
                  className="bg-[#121214] border-neutral-800 h-10 font-mono"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  {COLOR_OPTIONS.map((co) => (
                    <button
                      type="button"
                      key={co}
                      onClick={() => setCals((prev) => prev.map((p) => (p.id === c.id ? { ...p, color: co } : p)))}
                      className={`w-6 h-6 rounded-full border-2 ${c.color === co ? "border-white" : "border-transparent"}`}
                      style={{ background: co }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => saveEdit(c)} className="bg-white text-black hover:bg-neutral-200 rounded-sm">Save</Button>
                <Button variant="ghost" onClick={() => { setEditing(null); refresh(); }} className="border border-neutral-800 rounded-sm">Cancel</Button>
              </div>
            </div>
          ) : (
            <div
              key={c.id}
              className="border border-neutral-900 bg-[#0F0F11] p-4 rounded-sm flex items-center justify-between gap-4"
              data-testid={`calendar-row-${c.id}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color }} />
                <div className="min-w-0">
                  <div className="font-display text-lg truncate">{c.name}</div>
                  <div className="label-tech truncate">
                    {c.google_calendar_id ? `gcal: ${c.google_calendar_id}` : "no gcal linked"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="label-tech">Active</span>
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
                  className="border border-neutral-800 rounded-sm"
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => remove(c.id)}
                  data-testid={`calendar-delete-${c.id}`}
                  className="border border-red-900/70 text-red-300 hover:bg-red-950/40 rounded-sm"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
