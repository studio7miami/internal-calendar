import React from "react";
import { formatMoney, proposalTotals } from "../../lib/proposals";
import "./AgreementLetter.css";

export function clientPartyNames(proposal, agreement) {
  const named = String(
    agreement?.client?.name || proposal?.client?.contact_name || proposal?.client_name || "",
  ).trim();
  return {
    displayName: named || "The Client",
    midName: named || "the Client",
  };
}

export function agreementPdfFilename(clientName) {
  const name = String(clientName || "").trim() || "Client";
  return `${name} \u2013 Studio 7 Miami Proposal.pdf`;
}

export function agreementLetterModel(proposal, agreement, signature) {
  const totals = proposalTotals(proposal);
  const { displayName, midName } = clientPartyNames(proposal, agreement);
  const title = agreement?.title || proposal?.title || "Content proposal";
  const schedule = agreement?.schedule || proposal?.schedule || {};
  const pricing = agreement?.pricing || proposal?.pricing || {};
  const depositPercent = agreement?.deposit_percent ?? pricing.deposit_percent ?? 50;
  const deliverables = agreement?.deliverables || pricing.deliverables || "As outlined in the proposal";
  const turnaround = agreement?.turnaround || pricing.turnaround || "As outlined in the proposal";
  const paymentTerms = pricing.payment_terms
    || `A ${depositPercent}% deposit confirms the booking. The remaining balance is due before final delivery.`;
  const terms = agreement?.terms
    || "By signing, you confirm this proposal, the session schedule, and the deposit terms. A deposit locks your date; the balance is due under the payment terms.";
  const currency = pricing.currency || "USD";
  const sessionDate = formatLetterDate(schedule.session_date);
  const signedAt = formatLetterDateTime(signature?.signed_at || proposal?.signed_at);
  return {
    clientName: displayName,
    clientMid: midName,
    title,
    sessionDate,
    arrival: formatLetterTime(schedule.arrival_time),
    shoot: formatLetterTime(schedule.shoot_time),
    wrap: formatLetterTime(schedule.wrap_time),
    total: formatMoney(totals.total, currency),
    deposit: formatMoney(totals.deposit, currency),
    depositPercent,
    deliverables,
    turnaround,
    paymentTerms,
    terms,
    signerName: signature?.signer_name || "",
    signerEmail: signature?.signer_email || "",
    signatureImage: signature?.signature_data || "",
    signedAt,
  };
}

export default function AgreementLetter({ proposal, agreement, signature }) {
  const model = agreementLetterModel(proposal, agreement, signature);
  const sessionBits = [
    model.sessionDate && `on ${model.sessionDate}`,
    model.arrival && `with arrival at ${model.arrival}`,
    model.shoot && `shoot beginning at ${model.shoot}`,
    model.wrap && `wrapping by ${model.wrap}`,
  ].filter(Boolean);

  return (
    <div className="s7-letter-page">
      <article className="s7-letter">
        <header className="s7-letter__head">
          <img
            src="/brand/logo.png"
            alt="Studio 7 Miami"
            className="brand-logo brand-logo-nav brand-logo-nav-sidebar brand-logo-on-light-canvas s7-letter__logo"
          />
          <div>
            <p className="s7-letter__kicker">Service agreement</p>
            <h1 className="s7-letter__title">{model.title}</h1>
          </div>
        </header>

        <div className="s7-letter__meta">
          <div><small>Client</small><strong>{model.clientName}</strong></div>
          <div><small>Session</small><strong>{model.sessionDate}</strong></div>
          <div><small>Studio</small><strong>Studio 7 Miami</strong></div>
        </div>

        <section>
          <h2>Parties</h2>
          <p>
            This Service Agreement is entered into between Studio 7 Miami (“Studio 7”) and {model.clientMid} (“The Client”)
            for the creative services described in the proposal titled “{model.title}.”
          </p>
        </section>
        <section>
          <h2>Session</h2>
          <p>
            Studio 7 will provide production services for {model.clientMid}
            {sessionBits.length ? ` ${sessionBits.join(", ")}` : ""}.
          </p>
        </section>
        <section>
          <h2>Investment</h2>
          <p>
            The total investment for this engagement is {model.total}. A deposit of {model.depositPercent}% ({model.deposit})
            is due to confirm the booking. The remaining balance is due under the payment terms below.
          </p>
        </section>
        <section>
          <h2>Deliverables &amp; turnaround</h2>
          <p>Deliverables: {model.deliverables}.</p>
          <p>Estimated turnaround: {model.turnaround}.</p>
        </section>
        <section>
          <h2>Payment terms</h2>
          <p>{model.paymentTerms}</p>
        </section>
        <section>
          <h2>Acceptance</h2>
          <p>
            {model.terms} By signing below, {model.clientMid} acknowledges they have reviewed the proposal and agree
            to these terms as presented.
          </p>
        </section>

        <div className="s7-letter__sign">
          {model.signatureImage ? (
            <img src={model.signatureImage} alt="Signature" />
          ) : (
            <div className="s7-letter__line" />
          )}
          {model.signerName ? <p>{model.signerName}</p> : null}
          {model.signedAt ? <p>{model.signedAt}</p> : null}
          {model.signerEmail ? <p>{model.signerEmail}</p> : null}
        </div>

        <footer className="s7-letter__foot">
          <span>638 NW 62nd St, Miami, FL 33150</span>
          <span>Studio 7 Miami</span>
          <span>hello@studio7.miami</span>
        </footer>
      </article>
    </div>
  );
}

function formatLetterDate(value) {
  if (!value) return "Date to be confirmed";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatLetterDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} at ${timePart}`;
}

function formatLetterTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const [hours, minutes] = raw.split(":");
  const hour = Number(hours);
  if (Number.isNaN(hour)) return raw;
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 || 12;
  return `${twelve}:${String(minutes || "00").slice(0, 2)} ${suffix}`;
}
