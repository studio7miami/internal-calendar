/**
 * Invite link (Members) + account creation (/invite/:token) appearance.
 * Light theme aligned with Calendar / Members (`pageTheme` cards, #FCFCFC, slate text).
 */

import { pageBtnOutlineClass, pageBtnPrimaryClass, pageInputClass } from "./pageTheme";

/** Full-page shell — same family as main app content (Calendar area) */
export const invitePageShellClass =
  "h-dvh min-h-dvh overflow-hidden flex items-center justify-center p-4 sm:p-6 bg-[#FCFCFC] text-slate-900 dark:bg-[#0b0b0c] dark:text-zinc-200";

/** Constrains width of invite form + headings */
export const inviteCardClass = "w-full max-w-md";

export const inviteEyebrowClass = "label-tech";
/** Same visual as form field labels (Email, Full name, …). */
export const inviteTitleClass = "label-tech block mb-1";

export const inviteLoadingTextClass = "mt-6 text-sm text-slate-500 dark:text-zinc-500";

export const inviteErrorPanelClass =
  "mt-6 rounded-[7px] border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";

export const inviteFormErrorClass =
  "rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";

/** Same inputs as the rest of the app (Calendar / Profile) */
export const inviteInputClass = `${pageInputClass} h-11 min-h-11 text-base md:text-sm`;
export const inviteInputDisabledClass = `${pageInputClass} h-11 min-h-11 text-base md:text-sm opacity-70`;

/** Primary CTA — same as Calendar / Members actions */
export const inviteSubmitButtonClass = `w-full h-11 min-h-11 box-border ${pageBtnPrimaryClass}`;

/** Secondary actions (step back); matches card borders + toolbar outline affordance */
export const inviteBackButtonClass = `h-11 min-h-11 box-border ${pageBtnOutlineClass}`;

/**
 * Magic link callout (Members + preview). Card-like, light — matches `pageCardClass` feel.
 */
export const inviteLinkCalloutClass =
  "rounded-[7px] border border-gray-200/95 bg-white p-3 text-xs text-slate-800 shadow-sm dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-200";

export const inviteLinkCalloutLabelClass =
  "label-tech mb-1 text-slate-600 dark:text-zinc-400";

export const inviteLinkCodeClass =
  "truncate font-sans text-xs tabular-nums text-slate-900 dark:text-zinc-200";

export const inviteLinkCopyButtonClass =
  "ml-auto shrink-0 rounded-[7px] border border-gray-200/90 px-2 py-1 text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[0.06]";
