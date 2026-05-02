import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api, formatApiError } from "../lib/api";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Navigate } from "react-router-dom";
import { pageTitleClass, pageSubtextClass, pageInputClass, pageBtnPrimaryClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

const SLIDES = ["/brand/slide-2.jpg", "/brand/slide-3.jpg", "/brand/slide-4.jpg"];

export default function Login() {
  const { user, loginWithToken, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = React.useRef(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [slide, setSlide] = useState(0);

  const effectivePasswordValue = password || passwordRef.current?.value || "";
  const showPwToggle = effectivePasswordValue.length >= 3;

  useEffect(() => {
    // Some browsers autofill without triggering React onChange, so we also read from the ref.
    if (effectivePasswordValue.length < 3 && showPassword) setShowPassword(false);
  }, [effectivePasswordValue, showPassword]);

  useEffect(() => {
    // Autofill can land after mount; pull value into state once so submit + toggle work.
    const id = setTimeout(() => {
      const v = passwordRef.current?.value || "";
      if (v && v !== password) setPassword(v);
    }, 50);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => {
      setSlide((s) => (s + 1) % SLIDES.length);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.token && data.user) {
        loginWithToken(data.token, data.user);
        return;
      }
      setError("Unexpected response from the server");
    } catch (err) {
      setError(formatApiError(err?.response?.data?.detail) || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass = cn(pageInputClass, "h-11 min-h-11 text-base md:text-sm");

  return (
    <div className="grid min-h-screen bg-white text-slate-900 md:grid-cols-2">
      {/* Visual side */}
      <div className="relative hidden overflow-hidden bg-black md:block">
        {SLIDES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-in-out"
            style={{ opacity: i === slide ? 1 : 0 }}
          />
        ))}
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 flex flex-col justify-between p-12 text-white">
          <div>
            <a
              href="https://studio7.miami"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-[7px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              aria-label="Studio 7 Miami (opens studio7.miami)"
            >
              <img
                src="/brand/logo.png"
                alt="Studio 7 Miami"
                className="brand-logo brand-logo-white brand-logo-nav brand-logo-nav-sidebar"
              />
            </a>
          </div>
          <div>
            <h1 className="text-5xl font-['Manrope',system-ui,sans-serif] font-semibold leading-[1.05] tracking-[-0.02em] lg:text-6xl">
              The studio
              <br />
              calendar.
            </h1>
            <p className="mt-4 max-w-sm text-slate-200/90">An internal booking system for members only.</p>
          </div>
          <div />
        </div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div>
            <div className="mb-6 md:hidden">
              <a
                href="https://studio7.miami"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-[7px] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/25 dark:focus-visible:ring-slate-600/40"
                aria-label="Studio 7 Miami (opens studio7.miami)"
              >
                <img
                  src="/brand/logo.png"
                  alt="Studio 7 Miami"
                  className="brand-logo brand-logo-nav brand-logo-nav-header brand-logo-on-light-canvas"
                />
              </a>
            </div>
            <div className="label-tech">Authenticate</div>
            <h2 className={cn(pageTitleClass, "mt-2")}>Sign in</h2>
            <p className={pageSubtextClass}>Members only. Ask Seven for an invite link.</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="label-tech mb-1 block">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                data-testid="login-email-input"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="label-tech mb-1 block">Password</label>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onInput={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  data-testid="login-password-input"
                  className={cn(fieldClass, showPwToggle ? "pr-11" : "")}
                />
                {showPwToggle && (
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[7px] p-2 text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-white/20"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    data-testid="login-password-toggle"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div
              className="rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
              data-testid="login-error"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="ghost"
            disabled={submitting}
            data-testid="login-submit-button"
            className={cn("h-11 w-full font-medium", pageBtnPrimaryClass)}
          >
            {submitting ? "Signing in…" : "Sign in →"}
          </Button>

          <div className="label-tech border-t border-gray-200/90 pt-4 text-slate-500 dark:text-neutral-500">Invite only</div>
        </form>
      </div>
    </div>
  );
}
