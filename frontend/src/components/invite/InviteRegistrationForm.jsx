import React from "react";
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
} from "@/lib/inviteOnboardingTheme";

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
  password,
  onPasswordChange,
  confirm,
  onConfirmChange,
  error,
  onSubmit,
  submitTestId = "invite-submit-button",
}) {
  return (
    <div className={inviteCardClass} data-testid="invite-form">
      <div className={inviteEyebrowClass}>{eyebrow}</div>
      <h1 className={inviteTitleClass}>{title}</h1>

      {inviteStatus === "loading" && <p className={inviteLoadingTextClass}>Verifying invite…</p>}

      {inviteStatus === "bad" && (
        <div className={inviteErrorPanelClass} data-testid="invite-error">
          {error}
        </div>
      )}

      {inviteStatus === "ok" && (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label-tech block mb-1">Email</label>
            <Input value={email} disabled className={inviteInputDisabledClass} data-testid="invite-email-input" />
          </div>
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
          {error && <div className={inviteFormErrorClass}>{error}</div>}
          <Button type="submit" data-testid={submitTestId} className={inviteSubmitButtonClass}>
            Create account →
          </Button>
        </form>
      )}
    </div>
  );
}
