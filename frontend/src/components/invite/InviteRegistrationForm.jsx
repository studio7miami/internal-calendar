import React, { useEffect, useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  inviteCardClass,
  inviteEyebrowClass,
  inviteTitleClass,
  inviteLoadingTextClass,
  inviteErrorPanelClass,
  inviteFormErrorClass,
  inviteInputClass,
  inviteInputDisabledClass,
  inviteSubmitButtonClass,
  inviteBackButtonClass,
} from "@/lib/inviteOnboardingTheme";
import { SAUCE_OPTIONS } from "@/lib/memberSauce";
import { cn } from "@/lib/utils";

const STEPS_META = [
  { n: 1, label: "Sauce", desc: "What's your sauce" },
  { n: 2, label: "Profile", desc: "Name & phone" },
  { n: 3, label: "Account", desc: "Email & password" },
];

function InviteStepIndicator({ step }) {
  return (
    <nav
      className="mb-8 w-full"
      aria-label="Sign-up steps"
      data-testid="invite-step-indicator"
    >
      <ol className="m-0 flex w-full list-none flex-row items-start justify-between gap-0 p-0">
        {STEPS_META.map(({ n, label, desc }, idx) => {
          const done = step > n;
          const active = step === n;
          return (
            <li key={n} className="flex min-w-0 flex-1 flex-col items-center first:items-start last:items-end">
              <div className="flex w-full items-center gap-1">
                {idx > 0 ? (
                  <span
                    className={cn(
                      "my-[17px] h-[2px] min-w-[8px] flex-1 shrink rounded-full bg-gray-200/95 dark:bg-white/15",
                      step >= n && "bg-slate-900 dark:bg-zinc-200"
                    )}
                    aria-hidden
                  />
                ) : (
                  <span className="w-0 shrink-0" aria-hidden />
                )}
                <div
                  data-testid={`invite-step-marker-${n}`}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                    active &&
                      "bg-[#161616]/[0.07] text-[#161616] shadow-none dark:bg-[#161616]/[0.07] dark:text-[#161616]",
                    done &&
                      !active &&
                      "bg-[#161616] text-[#F7F7F7] shadow-none dark:bg-[#161616] dark:text-[#F7F7F7]",
                    !active &&
                      !done &&
                      "border border-gray-200/95 bg-white text-slate-400 shadow-sm dark:border-white/15 dark:bg-zinc-900/40 dark:text-zinc-500 dark:shadow-none"
                  )}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${done ? "Completed: " : active ? "Current step: " : "Not completed: "}${desc}`}
                >
                  {n}
                </div>
                {idx < STEPS_META.length - 1 ? (
                  <span
                    className={cn(
                      "my-[17px] h-[2px] min-w-[8px] flex-1 shrink rounded-full bg-gray-200/95 dark:bg-white/15",
                      step > n && "bg-slate-900 dark:bg-zinc-200"
                    )}
                    aria-hidden
                  />
                ) : (
                  <span className="w-0 shrink-0" aria-hidden />
                )}
              </div>
              <span
                className={cn(
                  "label-tech mt-2 max-w-full truncate px-1 text-center text-[10px] uppercase tracking-[0.12em]",
                  active ? "text-slate-900 dark:text-zinc-200" : "text-slate-500 dark:text-zinc-500"
                )}
                title={desc}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Account creation fields (used on /invite/:token and the design preview).
 */
export default function InviteRegistrationForm({
  eyebrow = "Studio 7 Miami · Invite",
  title = "Create your account",
  inviteStatus,
  email,
  name,
  onNameChange,
  phone,
  onPhoneChange,
  sauce,
  onSauceChange,
  password,
  onPasswordChange,
  confirm,
  onConfirmChange,
  error,
  onSubmit,
  submitTestId = "invite-submit-button",
  /** Optional: e.g. clear server-side message when navigating away from the final step */
  onStepChange,
}) {
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState("");

  const goToStep = (next) => {
    setStep(next);
    onStepChange?.(next);
  };

  useEffect(() => {
    if (inviteStatus !== "ok") return;
    setStep(1);
    setStepError("");
  }, [inviteStatus]);

  const handleNext = () => {
    setStepError("");
    if (step === 1) {
      if (!sauce) {
        setStepError("Choose what's your sauce.");
        return;
      }
      goToStep(2);
      return;
    }
    if (step === 2) {
      if (!name.trim()) {
        setStepError("Enter your full name.");
        return;
      }
      if (!phone.trim()) {
        setStepError("Enter your phone number.");
        return;
      }
      goToStep(3);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (step < 3) {
      handleNext();
      return;
    }
    onSubmit(e);
  };

  const showFormError =
    step < 3 ? Boolean(stepError) : Boolean(error || stepError);
  const displayFormError =
    step < 3 ? stepError : [error, stepError].filter(Boolean).join(" ");

  return (
    <div className={inviteCardClass} data-testid="invite-form">
      {eyebrow ? <div className={inviteEyebrowClass}>{eyebrow}</div> : null}
      <h1 className={inviteTitleClass}>{title}</h1>

      {inviteStatus === "loading" && <p className={inviteLoadingTextClass}>Verifying invite…</p>}

      {inviteStatus === "bad" && (
        <div className={inviteErrorPanelClass} data-testid="invite-error">
          {error}
        </div>
      )}

      {inviteStatus === "ok" && (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <InviteStepIndicator step={step} />

          {step === 1 && (
            <div>
              <label className="label-tech block mb-1">What&apos;s your sauce</label>
              <select
                value={sauce}
                onChange={(e) => onSauceChange(e.target.value)}
                required
                data-testid="invite-sauce-select"
                className={inviteInputClass}
              >
                <option value="" disabled>
                  Choose one…
                </option>
                {SAUCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="label-tech block mb-1">Full name</label>
                <Input
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  required
                  data-testid="invite-name-input"
                  className={inviteInputClass}
                />
              </div>
              <div>
                <label className="label-tech block mb-1">Phone number</label>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 305 555 0100"
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  required
                  data-testid="invite-phone-input"
                  className={inviteInputClass}
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="label-tech block mb-1">Email</label>
                <Input value={email} disabled className={inviteInputDisabledClass} data-testid="invite-email-input" />
              </div>
              <div>
                <label className="label-tech block mb-1">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  required
                  data-testid="invite-password-input"
                  className={inviteInputClass}
                />
              </div>
              <div>
                <label className="label-tech block mb-1">Confirm password</label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => onConfirmChange(e.target.value)}
                  required
                  data-testid="invite-confirm-input"
                  className={inviteInputClass}
                />
              </div>
            </>
          )}

          {showFormError ? <div className={inviteFormErrorClass}>{displayFormError}</div> : null}

          <div className={cn("flex gap-3 pt-1", step > 1 && "flex-row")}>
            {step > 1 ? (
              <button
                type="button"
                className={cn(
                  inviteBackButtonClass,
                  "inline-flex flex-1 items-center justify-center rounded-[7px] px-4 text-sm font-medium transition-colors md:text-sm"
                )}
                onClick={() => {
                  setStepError("");
                  goToStep(step - 1);
                }}
                data-testid="invite-step-back"
              >
                ← Back
              </button>
            ) : null}
            <Button
              type="submit"
              data-testid={step < 3 ? "invite-step-continue" : submitTestId}
              className={cn(inviteSubmitButtonClass, step > 1 ? "flex-1" : "w-full")}
            >
              {step < 3 ? "Continue →" : "Create account →"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
