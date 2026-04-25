import React, { useState } from "react";
import { Link } from "react-router-dom";
import InviteRegistrationForm from "../components/invite/InviteRegistrationForm";
import InviteLinkCallout from "../components/invite/InviteLinkCallout";
import { invitePageShellClass } from "@/lib/inviteOnboardingTheme";
import { pageCardClass } from "@/lib/pageTheme";
import { cn } from "@/lib/utils";

const SAMPLE_LINK = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/sample-token-abc123`;

/**
 * Design preview for magic-link callout + invite / account creation UI.
 * Dev only: route is registered from App.js when NODE_ENV === "development".
 */
export default function OnboardingPreview() {
  const [inviteStatus, setInviteStatus] = useState("ok");
  const [name, setName] = useState("Preview Member");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");

  const fakeSubmit = (e) => {
    e.preventDefault();
    setFormError("Preview only — this does not create an account.");
  };

  return (
    <div className={invitePageShellClass}>
      <div className="w-full max-w-3xl space-y-10 px-2 py-8">
        <div className="flex flex-col gap-2 border-b border-gray-200/90 pb-6 text-sm text-slate-600 dark:border-white/10 dark:text-zinc-400">
          <div className="label-tech text-slate-900 dark:text-zinc-200">Design preview</div>
          <p>
            Tweak appearance in{" "}
            <code className="rounded-[7px] border border-gray-200/80 bg-white px-1.5 py-0.5 text-xs text-slate-800 dark:border-white/15 dark:bg-zinc-900/50 dark:text-zinc-200">
              frontend/src/lib/inviteOnboardingTheme.js
            </code>
            . Magic link box uses{" "}
            <code className="rounded-[7px] border border-gray-200/80 bg-white px-1.5 py-0.5 text-xs text-slate-800 dark:border-white/15 dark:bg-zinc-900/50 dark:text-zinc-200">
              InviteLinkCallout
            </code>
            .
          </p>
          <Link to="/login" className="w-fit text-slate-900 underline-offset-2 hover:underline dark:text-zinc-200">
            ← Back to sign in
          </Link>
        </div>

        <section className="space-y-3">
          <div className="label-tech text-slate-600 dark:text-zinc-400">Invite link (as on Members after Send invite)</div>
          <InviteLinkCallout link={SAMPLE_LINK} onCopy={() => navigator.clipboard?.writeText(SAMPLE_LINK)} copyTestId="preview-copy-invite" />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="label-tech text-slate-600 dark:text-zinc-400">Account creation (/invite/…)</div>
            <div className="flex flex-wrap gap-2">
              {["loading", "bad", "ok"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInviteStatus(s);
                    setFormError(s === "bad" ? "This invite link is invalid or has expired." : "");
                  }}
                  className={cn(
                    "rounded-[7px] border px-2 py-1 text-xs capitalize transition-colors",
                    inviteStatus === s
                      ? "border-gray-200/95 bg-white text-slate-900 shadow-sm dark:border-white/15 dark:bg-white/[0.08] dark:text-zinc-100"
                      : "border-gray-200/60 text-slate-500 hover:border-gray-200/95 hover:bg-white/80 dark:border-white/10 dark:text-zinc-500 dark:hover:border-white/20"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className={cn("p-6 sm:p-8", pageCardClass)}>
            <InviteRegistrationForm
              inviteStatus={inviteStatus}
              email="preview.member@studio7.miami"
              name={name}
              onNameChange={setName}
              password={password}
              onPasswordChange={setPassword}
              confirm={confirm}
              onConfirmChange={setConfirm}
              error={formError}
              onSubmit={fakeSubmit}
              submitTestId="preview-invite-submit"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
