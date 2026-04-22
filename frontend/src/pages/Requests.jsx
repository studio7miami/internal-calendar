import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Check, X, Clock } from "lucide-react";
import { fmtTimeShort } from "../lib/time";

function StatusBadge({ status }) {
  const map = {
    pending: "border-amber-800 text-amber-300 bg-amber-950/40",
    approved: "border-emerald-800 text-emerald-300 bg-emerald-950/40",
    denied: "border-red-900 text-red-300 bg-red-950/40",
  };
  return (
    <span className={`label-tech px-2 py-0.5 border rounded-[16px] ${map[status]}`}>
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

  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-6" data-testid="requests-page">
      <div>
        <div className="label-tech">Queue</div>
        <h1 className="font-display text-3xl sm:text-4xl mt-1">
          {isAdmin ? "Booking requests" : "My requests"}
        </h1>
        <p className="text-sm text-neutral-400 mt-2">
          {isAdmin
            ? "Approve or deny incoming member requests."
            : "Your recent booking requests and their status."}
        </p>
      </div>

      {items.length === 0 && (
        <div className="border border-neutral-900 p-12 rounded-[16px] text-center text-neutral-500" data-testid="requests-empty">
          <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
          Nothing here yet.
        </div>
      )}

      <div className="grid gap-4">
        {items.map((b) => (
          <div
            key={b.id}
            className="border border-neutral-900 bg-[#0F0F11] rounded-[16px] p-4"
            data-testid={`request-card-${b.id}`}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={b.status} />
                  <span className="label-tech">{calName(b.calendar_id)}</span>
                </div>
                <div className="font-display text-xl mt-2">
                  {b.date} · {fmtTimeShort(b.start_time)}–{fmtTimeShort(b.end_time)}
                </div>
                {isAdmin && b.member_name && (
                  <div className="text-sm text-neutral-400 mt-1">
                    {b.member_name} · <span className="font-mono">{b.member_email}</span>
                  </div>
                )}
                {b.notes && (
                  <div className="text-sm text-neutral-300 mt-2 border-l-2 border-neutral-800 pl-3">
                    {b.notes}
                  </div>
                )}
                {b.approval_message && (
                  <div className="text-xs text-neutral-500 mt-2">
                    Message: {b.approval_message}
                  </div>
                )}
              </div>

              {isAdmin && b.status === "pending" && (
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="flex flex-col gap-2 w-full">
                    <Textarea
                      placeholder="Optional message to member…"
                      value={msg[b.id] || ""}
                      onChange={(e) => setMsg((m) => ({ ...m, [b.id]: e.target.value }))}
                      rows={2}
                      data-testid={`request-message-${b.id}`}
                      className="bg-[#121214] border-neutral-800 focus-visible:ring-white min-w-[240px]"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => act(b.id, "deny")}
                        data-testid={`deny-${b.id}`}
                        variant="ghost"
                        className="border border-red-900/70 text-red-300 hover:bg-red-950/40 rounded-[16px]6px]"
                      >
                        <X className="w-4 h-4 mr-1" strokeWidth={1.5} /> Deny
                      </Button>
                      <Button
                        onClick={() => act(b.id, "approve")}
                        data-testid={`approve-${b.id}`}
                        className="bg-white text-black hover:bg-neutral-200 rounded-[16px]"
                      >
                        <Check className="w-4 h-4 mr-1" strokeWidth={1.5} /> Approve
                      </Button>
                    </div>
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
