import { formatMoney, proposalTotals, statusLabel } from "./proposals";

export function proposalNextStep(status) {
  switch (status) {
    case "draft":
    case "pending_approval":
    case "approved":
      return "Finish details and send";
    case "sent":
      return "Waiting on client approval";
    case "viewed":
      return "Client opened — waiting on approval";
    case "client_approved":
      return "Waiting on signature";
    case "signed":
      return "Waiting on deposit";
    case "deposit_paid":
    case "paid":
    case "won":
      return "Booked — confirm production";
    case "changes_requested":
      return "Revise and resend to client";
    case "declined":
      return "Closed — no action needed";
    case "archived":
      return "Archived";
    default:
      return "Review proposal";
  }
}

export function formatSessionDate(value) {
  if (!value) return "No session date";
  try {
    const date = new Date(`${value}T12:00:00`);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
}

export function proposalGlance(proposal) {
  const totals = proposalTotals(proposal);
  const currency = proposal.pricing?.currency || "USD";
  const rate = proposal.pricing?.session_rate;
  const value = rate != null && Number(rate) > 0
    ? formatMoney(rate, currency)
    : formatMoney(totals.total, currency);
  const deliverableCount = (proposal.content_items || []).filter((item) => item.type).length;
  const status = proposal.status || "draft";

  return {
    client: proposal.client?.contact_name?.trim() || "No client yet",
    title: proposal.title?.trim() || "Untitled proposal",
    value,
    sessionLabel: formatSessionDate(proposal.schedule?.session_date),
    deliverablesLabel: deliverableCount
      ? `${deliverableCount} card${deliverableCount === 1 ? "" : "s"}`
      : "No cards yet",
    nextStep: proposalNextStep(status),
    statusText: statusLabel(status),
  };
}
