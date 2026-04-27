import React from "react";
import { Copy } from "lucide-react";
import {
  inviteLinkCalloutClass,
  inviteLinkCalloutLabelClass,
  inviteLinkCodeClass,
  inviteLinkCopyButtonClass,
} from "@/lib/inviteOnboardingTheme";

/**
 * Shown when an admin has a fresh invite URL to copy.
 * When `emailSent` is true, transactional email was delivered; link remains for backup / sharing.
 */
export default function InviteLinkCallout({
  link,
  onCopy,
  copyTestId = "copy-invite-link",
  label,
  emailSent,
}) {
  const resolvedLabel =
    label ||
    (emailSent === true
      ? "Invite link (also sent to their email)"
      : emailSent === false
      ? "Invite link (copy to share — email not configured or send failed)"
      : "Invite link (copy to share)");
  return (
    <div className={inviteLinkCalloutClass} data-testid="invite-link-display">
      <div className={inviteLinkCalloutLabelClass}>{resolvedLabel}</div>
      <div className="flex items-center gap-2">
        <code className={inviteLinkCodeClass}>{link}</code>
        <button
          onClick={() => onCopy?.(link)}
          className={inviteLinkCopyButtonClass}
          data-testid={copyTestId}
          type="button"
        >
          <Copy className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
