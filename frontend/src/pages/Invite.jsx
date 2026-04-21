import React, { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";

export default function Invite() {
  const { token } = useParams();
  const { loginWithToken, user } = useAuth();
  const [email, setEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState("loading");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .get(`/auth/invite/${token}`)
      .then((r) => {
        setEmail(r.data.email);
        setInviteStatus("ok");
      })
      .catch((e) => {
        setError(formatApiError(e?.response?.data?.detail) || "Invalid invite");
        setInviteStatus("bad");
      });
  }, [token]);

  if (done && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) return setError("Passwords do not match");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    try {
      const { data } = await api.post("/auth/register", {
        invite_token: token,
        name,
        password,
      });
      loginWithToken(data.token, data.user);
      setDone(true);
    } catch (err) {
      setError(formatApiError(err?.response?.data?.detail) || "Register failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#09090B] text-white">
      <div className="w-full max-w-md" data-testid="invite-form">
        <div className="label-tech">Studio 7 Miami · Invite</div>
        <h1 className="font-display text-3xl mt-2">Create your account</h1>

        {inviteStatus === "loading" && (
          <p className="mt-6 text-neutral-400">Verifying invite…</p>
        )}

        {inviteStatus === "bad" && (
          <div className="mt-6 border border-red-900 bg-red-950/30 p-4 text-red-300" data-testid="invite-error">
            {error}
          </div>
        )}

        {inviteStatus === "ok" && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label-tech block mb-1">Email</label>
              <Input
                value={email}
                disabled
                className="bg-[#121214] border-neutral-800 h-11 opacity-70"
                data-testid="invite-email-input"
              />
            </div>
            <div>
              <label className="label-tech block mb-1">Full name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="invite-name-input"
                className="bg-[#121214] border-neutral-800 h-11 focus-visible:ring-white"
              />
            </div>
            <div>
              <label className="label-tech block mb-1">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="invite-password-input"
                className="bg-[#121214] border-neutral-800 h-11 focus-visible:ring-white"
              />
            </div>
            <div>
              <label className="label-tech block mb-1">Confirm password</label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                data-testid="invite-confirm-input"
                className="bg-[#121214] border-neutral-800 h-11 focus-visible:ring-white"
              />
            </div>
            {error && (
              <div className="text-sm text-red-400 border border-red-900 bg-red-950/30 px-3 py-2">
                {error}
              </div>
            )}
            <Button
              type="submit"
              data-testid="invite-submit-button"
              className="w-full bg-white text-black hover:bg-neutral-200 h-11 rounded-sm"
            >
              Create account →
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
