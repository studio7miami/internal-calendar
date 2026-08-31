export const PILL_VARIANTS = [
  { value: "dot", label: "Dot" },
  { value: "wash", label: "Wash" },
  { value: "line", label: "Line" },
];

const STAGE_DOT = {
  draft: "bg-[#9a9a96]",
  shared: "bg-[#e2af1d]",
  won: "bg-emerald-500",
  changes_requested: "bg-orange-500",
  archived: "bg-[#c4c4c0]",
};

const STAGE_WASH = {
  draft: "bg-[#F1F1EE] text-[#6F6F6B] dark:bg-white/[0.06] dark:text-[#c8c8c3]",
  shared: "bg-[rgba(226,175,29,0.12)] text-[#9c7810] dark:bg-[#e2af1d]/15 dark:text-[#e2af1d]",
  won: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  changes_requested: "bg-orange-50 text-orange-800 dark:bg-orange-950/35 dark:text-orange-300",
  archived: "bg-[#F1F1EE] text-[#9a9a96] dark:bg-white/[0.04] dark:text-[#a8a8a3]",
};

const STAGE_LINE = {
  draft: "border-black/15 text-[#6F6F6B] dark:border-white/20 dark:text-[#c8c8c3]",
  shared: "border-[#e2af1d]/55 text-[#9c7810] dark:border-[#e2af1d]/50 dark:text-[#e2af1d]",
  won: "border-emerald-300 text-emerald-800 dark:border-emerald-800/70 dark:text-emerald-300",
  changes_requested: "border-orange-300 text-orange-800 dark:border-orange-800/60 dark:text-orange-300",
  archived: "border-black/10 text-[#9a9a96] dark:border-white/15 dark:text-[#a8a8a3]",
};

const DEFAULT_CHIP = STAGE_WASH.draft;
const ALL_ACTIVE_CHIP =
  "border-[#111] bg-[#111] text-[#FCFCFA] dark:border-white dark:bg-white dark:text-[#111]";

export const STAGE_CHIP_CLASSES = STAGE_WASH;

const STATUS_TO_STAGE = {
  draft: "draft",
  pending_approval: "draft",
  approved: "draft",
  sent: "shared",
  viewed: "shared",
  client_approved: "shared",
  signed: "shared",
  deposit_paid: "won",
  paid: "won",
  changes_requested: "changes_requested",
  archived: "archived",
};

export const proposalStatusChipBaseClass =
  "label-tech inline-flex items-center border rounded-[7px] px-1.5 py-px text-[9px] uppercase tracking-wide leading-none";

export const proposalFilterChipBaseClass =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-3 py-2 text-xs font-medium transition-colors";

const PILL_TYPE =
  "inline-flex shrink-0 items-center font-['Manrope',system-ui,sans-serif] text-[9px] font-medium uppercase tracking-[0.2em] leading-none";

export function getProposalStatusChipBaseClass(variant = "wash") {
  if (variant === "dot") {
    return `${PILL_TYPE} gap-1.5 border-0 bg-transparent px-0 py-0 text-[#6F6F6B] dark:text-[#c8c8c3]`;
  }
  if (variant === "line") {
    return `${PILL_TYPE} rounded-full border bg-transparent px-2 py-1`;
  }
  return `${PILL_TYPE} rounded-full border-0 px-2 py-1`;
}

export function getProposalStage(status) {
  return STATUS_TO_STAGE[status] || "draft";
}

export function getProposalStatusChipClass(status, variant = "wash") {
  const stage = getProposalStage(status);
  if (variant === "line") return STAGE_LINE[stage] || STAGE_LINE.draft;
  if (variant === "dot") return "";
  return STAGE_WASH[stage] || STAGE_WASH.draft;
}

export function getProposalStatusDotClass(status) {
  return STAGE_DOT[getProposalStage(status)] || STAGE_DOT.draft;
}

export function getProposalFilterChipClass(filter, active) {
  if (filter === "all") {
    return active ? ALL_ACTIVE_CHIP : DEFAULT_CHIP;
  }
  const stageClass = STAGE_CHIP_CLASSES[filter] || DEFAULT_CHIP;
  if (!active) return stageClass;
  return `${stageClass} ring-2 ring-black/15 ring-offset-1 dark:ring-white/25 dark:ring-offset-[#1c1c1c]`;
}

export function getProposalFilterCountClass(filter, active) {
  if (filter === "all" && active) {
    return "bg-white/15 text-white dark:bg-black/10 dark:text-black";
  }
  return "bg-black/[0.06] text-current dark:bg-white/10";
}
