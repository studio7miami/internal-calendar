import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Check, X, Clock } from "lucide-react";
import { fmtTimeShort } from "../lib/time";
import { pageTitleClass, pageSubtextClass, pageCardClass, pageTextareaClass, pageBtnPrimaryClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";

function StatusBadge({ status }) {
  const map = {
    pending:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/40",
    approved:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950/40",
    denied: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:text-red-300 dark:bg-red-950/40",
  };
  return (
    <span className={cn("label-tech border px-2 py-0.5 rounded-[7px]", map[status] || map.pending)}>
      {status}
    </span>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [msg, setMsg] = useState({});

  const refresh = async () => {
    const [r, c] = await Promise.all([
      api.get("/bookings/requests"),
      api.get("/calendars"),
    ]);
    setItems(r.data);
    setCalendars(c.data);
  };

  useEffect(() => {
    refresh();
  }, []);

  const calName = (id) => calendars.find((c) => c.id === id)?.name || id;

  const act = async (id, verb) => {
    try {
      await api.post(`/bookings/${id}/${verb}`, { message: msg[id] || "" });
      setMsg((m) => ({ ...m, [id]: "" }));
      refresh();
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Action failed");
    }
  };

  const canModerate = !!user?.permissions?.approve_deny_requests;

  return (
    <div className="space-y-6" data-testid="requests-page">
      <div>
        <div className="label-tech">Queue</div>
        <h1 className={pageTitleClass}>{canModerate ? "Booking requests" : "My requests"}</h1>
        <p className={pageSubtextClass}>
          {canModerate
            ? "Approve or deny pending requests from the team."
            : "Your recent booking requests and their status."}
        </p>
      </div>

      {items.length === 0 && (
        <div
          className={cn("border border-dashed border-gray-200/90 bg-white/50 p-12 text-center text-slate-500 dark:border-white/20 dark:bg-zinc-900/30 dark:text-neutral-400", "rounded-[7px]")}
          data-testid="requests-empty"
        >
          <Clock className="mx-auto mb-2 h-6 w-6 opacity-50" strokeWidth={1.5} />
          Nothing here yet.
        </div>
      )}

      <div className="grid gap-4">
        {items.map((b) => (
          <div key={b.id} className={cn("p-4", pageCardClass)} data-testid={`request-card-${b.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={b.status} />
                  <span className="label-tech text-slate-600 dark:text-neutral-400">{calName(b.calendar_id)}</span>
                </div>
                <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                  {b.date} · {fmtTimeShort(b.start_time)}–{fmtTimeShort(b.end_time)}
                </div>
                {canModerate && b.member_name && (
                  <div className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                    {b.member_name} · <span className="text-slate-700 tabular-nums dark:text-zinc-400">{b.member_email}</span>
                  </div>
                )}
                {b.notes && (
                  <div className="mt-2 border-l-2 border-slate-200 pl-3 text-sm text-slate-700 dark:border-white/20 dark:text-neutral-300">
                    {b.notes}
                  </div>
                )}
                {b.approval_message && (
                  <div className="mt-2 text-xs text-slate-500 dark:text-neutral-500">Message: {b.approval_message}</div>
                )}
              </div>

              {canModerate && b.status === "pending" && (
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[240px]">
                  <Textarea
                    placeholder="Optional message to member…"
                    value={msg[b.id] || ""}
                    onChange={(e) => setMsg((m) => ({ ...m, [b.id]: e.target.value }))}
                    rows={2}
                    data-testid={`request-message-${b.id}`}
                    className={pageTextareaClass}
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => act(b.id, "deny")}
                      data-testid={`deny-${b.id}`}
                      variant="ghost"
                      className={cn(
                        "border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/40",
                        "h-10 flex-1 rounded-[7px]"
                      )}
                    >
                      <X className="mr-1 h-4 w-4" strokeWidth={1.5} /> Deny
                    </Button>
                    <Button
                      onClick={() => act(b.id, "approve")}
                      data-testid={`approve-${b.id}`}
                      variant="ghost"
                      className={cn("flex-1", pageBtnPrimaryClass)}
                    >
                      <Check className="mr-1 h-4 w-4" strokeWidth={1.5} /> Approve
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
