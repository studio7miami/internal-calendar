import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api, formatApiError } from "../lib/api";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Navigate } from "react-router-dom";

export default function Login() {
  const { user, loginWithToken, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      loginWithToken(data.token, data.user);
    } catch (err) {
      setError(formatApiError(err?.response?.data?.detail) || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-[#09090B] text-white">
      {/* Visual side */}
      <div
        className="relative hidden md:block"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1642723965458-112cdb37c1c2?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-black/70" />
        <div className="absolute inset-0 p-12 flex flex-col justify-between">
          <div className="label-tech text-neutral-300">Studio 7 Miami · Internal</div>
          <div>
            <h1 className="font-display text-5xl lg:text-6xl leading-[1.05] text-white">
              The house<br />calendar.
            </h1>
            <p className="mt-4 text-neutral-300 max-w-sm">
              A private booking console for the founder and the team. Members only.
            </p>
          </div>
          <div className="label-tech text-neutral-400">v1.0 · invite-only</div>
        </div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div>
            <div className="label-tech">Authenticate</div>
            <h2 className="font-display text-3xl mt-2">Sign in</h2>
            <p className="text-sm text-neutral-400 mt-2">
              Members only. Ask Seven for an invite link.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="label-tech block mb-1">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                data-testid="login-email-input"
                className="bg-[#121214] border-neutral-800 focus-visible:ring-white h-11"
              />
            </div>
            <div>
              <label className="label-tech block mb-1">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password-input"
                className="bg-[#121214] border-neutral-800 focus-visible:ring-white h-11"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-400 border border-red-900 bg-red-950/30 px-3 py-2" data-testid="login-error">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            data-testid="login-submit-button"
            className="w-full bg-white text-black hover:bg-neutral-200 h-11 rounded-sm font-medium"
          >
            {submitting ? "Signing in…" : "Sign in →"}
          </Button>

          <div className="label-tech pt-4 border-t border-neutral-900">
            Studio 7 Miami · Private
          </div>
        </form>
      </div>
    </div>
  );
}
