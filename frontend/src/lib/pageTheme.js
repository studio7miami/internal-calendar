/** Visual tokens aligned with the main Calendar page (chips, #FCFCFC, 7px radius) */

/** Same hover as Calendar toolbar (Today / New / chevrons). */
export const glassBarHoverClass =
  "md:hover:bg-slate-900/10 md:hover:text-black md:dark:hover:bg-white/[0.08] md:dark:hover:text-zinc-100";

export const pageTitleClass =
  "mt-1 text-3xl sm:text-4xl font-['Manrope',system-ui,sans-serif] font-semibold tracking-[-0.02em] text-slate-900 dark:text-zinc-200";

export const pageSubtextClass =
  "text-sm text-slate-900 dark:text-zinc-500 mt-2 pt-0.5";

export const pageCardClass =
  "border border-gray-200/95 bg-[#FCFCFC] text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-200 rounded-[7px]";

export const pageInputClass =
  "h-10 w-full rounded-[7px] border border-gray-200/95 bg-white px-3 text-sm text-slate-900 shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/30 " +
  "dark:border-white/20 dark:bg-zinc-900/50 dark:text-white dark:focus-visible:ring-white/20";

export const pageTextareaClass =
  "min-h-[2.5rem] w-full rounded-[7px] border border-gray-200/95 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/30 " +
  "dark:border-white/20 dark:bg-zinc-900/50 dark:text-white dark:focus-visible:ring-white/20";

export const pageBtnPrimaryClass =
  "h-10 min-h-8 box-border border border-gray-200/95 bg-white/90 text-slate-900 rounded-[7px] transition-colors " +
  glassBarHoverClass +
  " dark:border-white/20 dark:bg-zinc-900/30 dark:text-white";

export const pageBtnOutlineClass =
  "h-10 min-h-8 box-border border border-gray-200/50 bg-transparent text-neutral-400 rounded-[7px] transition-colors " +
  "md:hover:border-gray-200/80 dark:border-white/20 dark:text-neutral-500 md:dark:hover:border-white/30 " +
  glassBarHoverClass;
