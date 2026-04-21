import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Copy, Mail } from "lucide-react";

export default function Members() {
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [latestLink, setLatestLink] = useState("");

  const refresh = async () => {
    const [u, i] = await Promise.all([api.get("/users"), api.get("/invites")]);
    setUsers(u.data);
    setInvites(i.data);
  };

  useEffect(() => {
    refresh();
  }, []);

  const invite = async (e) => {
    e.preventDefault();
    setErr("");
    setLatestLink("");
    try {
      const { data } = await api.post("/invites", { email });
      setLatestLink(data.invite_link);
      setEmail("");
      refresh();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    }
  };

  const copy = (txt) => {
    navigator.clipboard.writeText(txt);
  };

  return (
    <div className="space-y-8" data-testid="members-page">
      <div>
        <div className="label-tech">Admin</div>
        <h1 className="font-display text-3xl sm:text-4xl mt-1">Members</h1>
        <p className="text-sm text-neutral-400 mt-2">
          Invite photographers, videographers, and the rest of the team. Invites are single-use and expire in 7 days.
        </p>
      </div>

      <form onSubmit={invite} className="border border-neutral-900 bg-[#0F0F11] p-4 rounded-sm space-y-3">
        <div className="label-tech">Send invite</div>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="person@studio7miami.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="invite-email-input"
            className="bg-[#121214] border-neutral-800 h-10"
          />
          <Button type="submit" data-testid="send-invite-button" className="bg-white text-black hover:bg-neutral-200 rounded-sm">
            <Mail className="w-4 h-4 mr-1" strokeWidth={1.5} /> Send invite
          </Button>
        </div>
        {err && <div className="text-sm text-red-400">{err}</div>}
        {latestLink && (
          <div className="border border-emerald-900 bg-emerald-950/30 p-3 rounded-sm text-xs" data-testid="invite-link-display">
            <div className="label-tech text-emerald-300 mb-1">Invite link (stubbed email)</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-emerald-200 truncate">{latestLink}</code>
              <button onClick={() => copy(latestLink)} className="ml-auto text-emerald-300 hover:text-white" data-testid="copy-invite-link">
                <Copy className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="space-y-4">
        <div>
          <div className="label-tech mb-3">Team</div>
          <div className="grid gap-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="border border-neutral-900 bg-[#0F0F11] px-4 py-3 rounded-sm flex items-center justify-between gap-3"
                data-testid={`user-row-${u.id}`}
              >
                <div>
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="label-tech">{u.email}</div>
                </div>
                <span className={`label-tech px-2 py-0.5 border rounded-sm ${u.role === "admin" ? "border-white text-white" : "border-neutral-700 text-neutral-400"}`}>
                  {u.role}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="label-tech mb-3">Invites</div>
          <div className="grid gap-2">
            {invites.length === 0 && (
              <div className="text-sm text-neutral-500">No invites yet.</div>
            )}
            {invites.map((i) => (
              <div
                key={i.id}
                className="border border-neutral-900 bg-[#0F0F11] px-4 py-3 rounded-sm flex items-center justify-between gap-3 text-sm"
                data-testid={`invite-row-${i.id}`}
              >
                <div className="min-w-0">
                  <div className="truncate">{i.email}</div>
                  <div className="label-tech truncate">
                    {i.used ? "used" : "pending"} · exp {new Date(i.expires_at).toLocaleDateString()}
                  </div>
                </div>
                {!i.used && (
                  <button onClick={() => copy(i.invite_link)} className="text-neutral-300 hover:text-white text-xs border border-neutral-800 px-2 py-1 rounded-sm" data-testid={`copy-invite-${i.id}`}>
                    <Copy className="w-3 h-3 inline mr-1" strokeWidth={1.5} /> Copy link
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
