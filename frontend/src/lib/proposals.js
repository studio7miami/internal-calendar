export const PROPOSAL_FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "shared", label: "Shared" },
  { value: "won", label: "Won" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "archived", label: "Archived" },
];

/** Backend statuses that belong to each founder-facing filter stage. */
const PROPOSAL_FILTER_STATUSES = {
  draft: ["draft", "pending_approval", "approved"],
  shared: ["sent", "viewed", "client_approved", "signed"],
  won: ["deposit_paid", "paid"],
  changes_requested: ["changes_requested"],
  archived: ["archived"],
};

const STATUS_LABELS = {
  draft: "Draft",
  pending_approval: "Draft",
  approved: "Draft",
  sent: "Shared",
  viewed: "Shared",
  client_approved: "Shared",
  signed: "Shared",
  deposit_paid: "Won",
  paid: "Won",
  changes_requested: "Changes requested",
  archived: "Archived",
  declined: "Closed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function proposalMatchesFilter(filter, status) {
  if (!filter || filter === "all") return status !== "archived";
  const statuses = PROPOSAL_FILTER_STATUSES[filter];
  return statuses ? statuses.includes(status) : status === filter;
}

export function proposalFilterLabel(filter) {
  return PROPOSAL_FILTERS.find((item) => item.value === filter)?.label?.toLowerCase() || "matching";
}

export function isBlankProposal(proposal) {
  const title = String(proposal?.title || "").trim().toLowerCase();
  const client = String(proposal?.client?.contact_name || proposal?.client_name || "").trim();
  if (client) return false;
  if (title && title !== "untitled proposal" && title !== "untitled") return false;
  if (proposal?.schedule?.session_date || proposal?.session_date) return false;
  const rate = Number(proposal?.pricing?.session_rate ?? ((proposal?.rate_cents || 0) / 100)) || 0;
  if (rate > 0) return false;
  const vision = proposal?.vision || proposal?.creative_brief || {};
  if (Object.values(vision).some((value) => String(value || "").trim())) return false;
  const status = String(proposal?.status || "draft");
  return status === "draft";
}

export const PROPOSAL_SECTIONS = [
  { id: "client", label: "Client" },
  { id: "vision", label: "Vision" },
  { id: "content", label: "Content" },
  { id: "pricing", label: "Pricing" },
];

export const DEFAULT_CONTENT_ITEMS = [
  { type: "Brand Reels", quantity: "3 videos", energy: "", visual_style: "" },
  { type: "BTS Reels", quantity: "2 videos", energy: "", visual_style: "" },
  { type: "Brand Stills", quantity: "10 photos", energy: "", visual_style: "" },
];

export const CONTENT_CARD_COUNT = DEFAULT_CONTENT_ITEMS.length;

export function normalizeDeliverablesCount(value) {
  if (value == null || value === "") return "";
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/\d+/);
  return match ? match[0] : "";
}

export function formatDeliverablesCount(value) {
  const normalized = normalizeDeliverablesCount(value);
  if (!normalized) return "To be confirmed";
  const num = Number(normalized);
  return `${num} ${num === 1 ? "file" : "files"}`;
}

function normalizeContentItems(items) {
  return DEFAULT_CONTENT_ITEMS.map((defaults, index) => {
    const item = (items || [])[index] || {};
    const quantity = item.quantity ?? defaults.quantity;
    return {
      ...defaults,
      ...item,
      type: item.type ?? defaults.type,
      quantity: quantity == null ? defaults.quantity : String(quantity),
      energy: item.energy ?? "",
      visual_style: item.visual_style ?? "",
    };
  });
}

function addMinutesToTime(time, minutes) {
  const normalized = normalizeClock(time);
  if (!normalized) return "";
  const [hours, mins] = normalized.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return normalized;
  const total = hours * 60 + mins + minutes;
  const nextHours = Math.floor(total / 60) % 24;
  const nextMins = ((total % 60) + 60) % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMins).padStart(2, "0")}`;
}

export function normalizeClock(value) {
  if (value == null || value === "") return "";
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value).trim();
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function deriveSessionSchedule(startTime) {
  if (!startTime) {
    return {
      arrival_time: "",
      setup_time: "",
      shoot_time: "",
      wrap_time: "",
    };
  }
  return {
    arrival_time: startTime,
    setup_time: addMinutesToTime(startTime, 30),
    shoot_time: addMinutesToTime(startTime, 60),
    wrap_time: addMinutesToTime(startTime, 240),
  };
}

export const EMPTY_PROPOSAL = {
  title: "",
  status: "draft",
  client: {
    contact_name: "",
    email: "",
    phone: "",
  },
  vision: {
    brand_description: "",
    content_goals: "",
    target_audience: "",
    desired_energy: "",
  },
  content_items: normalizeContentItems(DEFAULT_CONTENT_ITEMS),
  schedule: {
    calendar_id: "",
    session_date: "",
    arrival_time: "",
    setup_time: "",
    shoot_time: "",
    wrap_time: "",
  },
  pricing: {
    currency: "USD",
    session_rate: 0,
    line_items: [],
    deposit_percent: 50,
    deliverables: "",
    turnaround: "",
    payment_terms: "",
  },
  share: {
    channel: "email",
    expires_days: 30,
  },
  assigned_to: "",
};

const arrayFrom = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.proposals)) return value.proposals;
  return [];
};

export function normalizeProposalList(value) {
  return arrayFrom(value).map((proposal) => normalizeProposal(proposal));
}

export function normalizeProposal(value = {}) {
  const source = value?.proposal || value;
  const creative = source.creative_brief || source.vision || {};
  const pricing = source.pricing || {};
  const share = source.share_settings || source.share || {};
  return {
    ...EMPTY_PROPOSAL,
    ...source,
    client: {
      ...EMPTY_PROPOSAL.client,
      ...(source.client || {}),
      contact_name: source.client_name ?? source.client?.contact_name ?? source.client?.name ?? "",
      email: source.client_email ?? source.client?.email ?? "",
      phone: source.client_phone ?? source.client?.phone ?? "",
    },
    vision: {
      ...EMPTY_PROPOSAL.vision,
      ...creative,
      brand_description: creative.brand_description ?? "",
      content_goals: creative.content_goals ?? "",
      target_audience: creative.target_audience ?? "",
      desired_energy: creative.desired_energy ?? "",
    },
    content_items: normalizeContentItems(arrayFrom(source.content_items || source.content || [])),
    schedule: {
      ...EMPTY_PROPOSAL.schedule,
      ...(source.schedule || {}),
      calendar_id: source.calendar_id ?? source.schedule?.calendar_id ?? "",
      session_date: source.session_date ?? source.schedule?.session_date ?? source.schedule?.event_date ?? "",
      arrival_time: normalizeClock(source.arrival_time ?? source.schedule?.arrival_time ?? ""),
      setup_time: normalizeClock(source.setup_time ?? source.schedule?.setup_time ?? ""),
      shoot_time: normalizeClock(source.shoot_time ?? source.schedule?.shoot_time ?? ""),
      wrap_time: normalizeClock(source.wrap_time ?? source.schedule?.wrap_time ?? ""),
    },
    pricing: {
      ...EMPTY_PROPOSAL.pricing,
      ...pricing,
      session_rate: source.rate_cents != null ? Number(source.rate_cents) / 100 : Number(pricing.session_rate) || 0,
      deposit_percent: source.deposit_percent ?? pricing.deposit_percent ?? 50,
      deliverables: normalizeDeliverablesCount(source.deliverables ?? pricing.deliverables ?? ""),
      turnaround: source.turnaround ?? pricing.turnaround ?? "",
      line_items: arrayFrom(pricing.line_items || source.line_items || []),
    },
    share: { ...EMPTY_PROPOSAL.share, ...share },
    agreement: value?.agreement ?? source.agreement,
    payment_summary: value?.payment_summary ?? source.payment_summary,
    signature_summary: value?.signature_summary ?? source.signature_summary,
    revision: value?.revision ?? source.revision,
  };
}

export function serializeProposal(proposal, { includeVersion = true } = {}) {
  const payload = {
    title: proposal.title || "",
    client_name: proposal.client?.contact_name || "",
    client_email: proposal.client?.email || "",
    client_phone: proposal.client?.phone || "",
    calendar_id: proposal.schedule?.calendar_id || null,
    session_date: proposal.schedule?.session_date || null,
    arrival_time: normalizeClock(proposal.schedule?.arrival_time) || null,
    setup_time: normalizeClock(proposal.schedule?.setup_time) || null,
    shoot_time: normalizeClock(proposal.schedule?.shoot_time) || null,
    wrap_time: normalizeClock(proposal.schedule?.wrap_time) || null,
    creative_brief: { ...(proposal.vision || {}) },
    content_items: proposal.content_items || [],
    pricing: {
      ...(proposal.pricing || {}),
      session_rate: Number(proposal.pricing?.session_rate) || 0,
      deposit_percent: Number(proposal.pricing?.deposit_percent) || 0,
      deliverables: proposal.pricing?.deliverables || "",
      turnaround: proposal.pricing?.turnaround || "",
    },
    share_settings: { ...(proposal.share || {}) },
    rate_cents: Math.max(0, Math.round((Number(proposal.pricing?.session_rate) || 0) * 100)),
    deposit_percent: Math.max(0, Math.min(100, Math.round(Number(proposal.pricing?.deposit_percent) || 0))),
    deliverables: proposal.pricing?.deliverables || "",
    turnaround: proposal.pricing?.turnaround || "",
    assigned_to: proposal.assigned_to || null,
  };
  if (includeVersion && proposal.version != null) payload.version = Number(proposal.version);
  return payload;
}

export function proposalFirstName(name) {
  return String(name || "there").trim().split(/\s+/)[0] || "there";
}

export function proposalShareSms(name, link) {
  return `${proposalFirstName(name)} — here’s what we put together for you.\n\n${link}`;
}

export function proposalSignPaySms(name, link) {
  return `You’re in, ${proposalFirstName(name)}. Sign and pay and we'll lock it in.\n\n${link}`;
}

export function proposalActionPayload(action, proposal, extra = {}) {
  const payload = { version: Number(proposal.version) };
  if (action === "send" || action === "resend") {
    payload.expires_days = Math.max(1, Math.min(90, Number(proposal.share?.expires_days) || 30));
    if (extra.channel) payload.channel = extra.channel;
  }
  return payload;
}

export function proposalTotals(proposal) {
  const pricing = proposal?.pricing || {};
  const lineSubtotal = (pricing.line_items || []).reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  );
  const subtotal = pricing.session_rate != null ? Number(pricing.session_rate) || 0 : lineSubtotal;
  const discount = 0;
  const tax = 0;
  const total = subtotal;
  const deposit = total * ((Number(pricing.deposit_percent) || 0) / 100);
  return { subtotal, discount, tax, total, deposit };
}

export function formatMoney(value, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
  } catch {
    return `$${(Number(value) || 0).toFixed(2)}`;
  }
}

export function sectionIsComplete(section, proposal) {
  if (section === "client") {
    return !!(
      proposal.client?.contact_name
      && proposal.client?.email
      && proposal.schedule?.session_date
      && proposal.schedule?.arrival_time
    );
  }
  if (section === "vision") return !!(proposal.vision?.brand_description && proposal.vision?.content_goals);
  if (section === "content") return proposal.content_items?.some((item) => item.type);
  if (section === "pricing") return Number(proposal.pricing?.session_rate) > 0;
  return false;
}

export function statusLabel(status) {
  const key = String(status || "draft");
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
