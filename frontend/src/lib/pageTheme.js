/** Visual tokens aligned with the booking flow (warm stone, ink, 7px radius) */

/** Same hover as Calendar toolbar (Today / New / chevrons). */
export const glassBarHoverClass =
  "md:hover:bg-black/[0.06] md:hover:text-[#111] md:dark:hover:bg-white/[0.08] md:dark:hover:text-[#f4f4f1]";

export const pageTitleClass =
  "mt-1 text-3xl sm:text-4xl font-['Manrope',system-ui,sans-serif] font-semibold tracking-[-0.02em] text-[#111] dark:text-[#f4f4f1]";

export const pageSubtextClass =
  "text-sm text-[#6F6F6B] dark:text-[#a8a8a3] mt-2 pt-0.5";

export const pageCardClass =
  "border border-black/[0.08] bg-[#FCFCFA] text-[#111] dark:border-white/12 dark:bg-white/[0.04] dark:text-[#f4f4f1] rounded-[7px]";

export const pageInputClass =
  "h-10 w-full rounded-[7px] border border-black/[0.12] bg-[#FCFCFA] px-3 text-sm text-[#111] shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/25 " +
  "dark:border-white/20 dark:bg-white/[0.04] dark:text-[#f4f4f1] dark:focus-visible:ring-white/20";

export const pageTextareaClass =
  "min-h-[2.5rem] w-full rounded-[7px] border border-black/[0.12] bg-[#FCFCFA] px-3 py-2 text-sm text-[#111] " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/25 " +
  "dark:border-white/20 dark:bg-white/[0.04] dark:text-[#f4f4f1] dark:focus-visible:ring-white/20";

export const pageBtnPrimaryClass =
  "h-10 min-h-8 box-border border border-black/[0.08] bg-[#FCFCFA] text-[#111] rounded-[7px] transition-colors " +
  glassBarHoverClass +
  " dark:border-white/20 dark:bg-white/[0.04] dark:text-[#f4f4f1]";

export const pageBtnOutlineClass =
  "h-10 min-h-8 box-border border border-black/[0.08] bg-transparent text-[#6F6F6B] rounded-[7px] transition-colors " +
  "md:hover:border-black/20 dark:border-white/20 dark:text-[#a8a8a3] md:dark:hover:border-white/30 " +
  glassBarHoverClass;

/** Same shell as Calendar Month / Week / Day. */
export const segmentedBarClass =
  "min-h-8 box-border inline-flex max-w-full select-none items-center gap-2.5 overflow-x-auto rounded-[7px] border border-gray-200/95 bg-[#FCFCFC] px-2.5 py-1.5 text-xs leading-none dark:border-white/10 dark:bg-white/[0.04] sm:gap-3 sm:px-3";

export function segmentedTabClass(on) {
  return `-m-0.5 inline-flex shrink-0 items-center rounded-sm border-0 bg-transparent p-0.5 px-1.5 text-xs font-normal leading-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FCFCFC] focus-visible:dark:ring-zinc-600/40 focus-visible:dark:ring-offset-[#0b0b0c] sm:px-2 ${
    on
      ? "text-black dark:text-zinc-200"
      : "text-neutral-400 dark:text-zinc-500 md:hover:text-neutral-500 md:dark:hover:text-zinc-400"
  }`;
}
