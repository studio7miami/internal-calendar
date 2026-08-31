import React, { useState } from "react";
import { Check, Copy, MessageSquare, X } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { pageBtnOutlineClass, pageBtnPrimaryClass, pageCardClass } from "../../lib/pageTheme";

export function withAgreementStep(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set("step", "agreement");
    return parsed.toString();
  } catch {
    return url.includes("?") ? `${url}&step=agreement` : `${url}?step=agreement`;
  }
}

export function signPayTextMessage(clientName, link) {
  const firstName = String(clientName || "there").split(" ")[0];
  return `Perfect ${firstName} — next is sign the agreement and pay the deposit to lock your date:\n\n${link}`;
}

export function smsUrl(phone, body) {
  const number = String(phone || "").replace(/[^\d+]/g, "");
  if (!number) return "";
  const apple = /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(navigator.userAgent || "");
  const separator = apple ? "&body=" : "?body=";
  return `sms:${number}${separator}${encodeURIComponent(body)}`;
}

export function openMessages(phone, body) {
  const href = smsUrl(phone, body);
  if (!href) return false;
  try {
    navigator.clipboard?.writeText(body);
  } catch {}
  window.location.href = href;
  return true;
}

/**
 * Modal shown after marking a proposal accepted — copy/share the sign + pay link.
 */
export default function SignPayLinkModal({
  open,
  link,
  clientName = "",
  clientPhone = "",
  onClose,
  variant = "page", // "page" | "builder"
}) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const shareLink = withAgreementStep(link);
  const phone = String(clientPhone || "").replace(/[^\d+]/g, "");

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", shareLink);
    }
  };

  const textHref = phone && shareLink ? smsUrl(phone, signPayTextMessage(clientName, shareLink)) : "";

  const textClient = (event) => {
    if (textHref) return;
    event?.preventDefault?.();
    if (!phone || !shareLink) return;
    openMessages(phone, signPayTextMessage(clientName, shareLink));
  };

  if (variant === "builder") {
    return (
      <div className="pb-send-dialog-backdrop" role="presentation" onClick={onClose}>
        <div
          className="pb-send-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pb-sign-pay-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="pb-send-dialog__head">
            <div>
              <p className="pb-send-dialog__kicker">Marked accepted</p>
              <h2 id="pb-sign-pay-title">Send sign + pay link</h2>
            </div>
            <button type="button" className="pb-send-dialog__close" onClick={onClose} aria-label="Close">
              <X aria-hidden="true" />
            </button>
          </header>
          <p className="pb-send-dialog__copy">
            Share this link so {clientName?.trim() || "the client"} can sign the agreement and pay the deposit.
          </p>
          <div className="pb-sign-pay-link-box">
            <input
              readOnly
              value={shareLink || "No client link yet — send the proposal first."}
              aria-label="Sign and pay link"
              onFocus={(event) => event.target.select()}
            />
          </div>
          <div className="pb-send-dialog__options">
            <button type="button" className="pb-send-dialog__option" disabled={!shareLink} onClick={copyLink}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              <span>{copied ? "Copied" : "Copy link"}</span>
              <small>Paste into iMessage, WhatsApp, or email</small>
            </button>
            <a
              className="pb-send-dialog__option"
              href={textHref || undefined}
              aria-disabled={!textHref ? "true" : undefined}
              onClick={textClient}
            >
              <MessageSquare aria-hidden="true" />
              <span>Text client</span>
              <small>{phone || "Add client phone on Client"}</small>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" />
      <div
        className={cn("relative z-10 w-full max-w-md space-y-4 p-5 shadow-lg", pageCardClass)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-pay-link-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label-tech">Marked accepted</p>
            <h2 id="sign-pay-link-title" className="mt-1 font-['Manrope',system-ui,sans-serif] text-lg font-semibold">
              Send sign + pay link
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[7px] p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-slate-500 dark:text-zinc-400">
          Share this link so {clientName?.trim() || "the client"} can sign the agreement and pay the deposit.
        </p>
        <div className="rounded-[7px] border border-gray-200/95 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-zinc-900/50">
          <input
            readOnly
            value={shareLink || "No client link yet — send the proposal first."}
            aria-label="Sign and pay link"
            className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-white"
            onFocus={(event) => event.target.select()}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" disabled={!shareLink} onClick={copyLink} className={cn(pageBtnPrimaryClass, "flex-1")}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <a
            href={textHref || undefined}
            aria-disabled={!textHref ? "true" : undefined}
            onClick={textClient}
            className={cn(pageBtnOutlineClass, "flex-1 inline-flex items-center justify-center")}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Text client
          </a>
        </div>
      </div>
    </div>
  );
}
