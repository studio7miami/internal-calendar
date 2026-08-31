import React, { useState } from "react";
import { formatMoney, normalizeProposal, proposalTotals } from "../../lib/proposals";
import { luisLiveDraft } from "../../lib/liveLuisProposal";
import AgreementLetter, { agreementPdfFilename } from "./AgreementLetter";

const LOGO = "https://book.studio7.miami/images/studio7-logo.png";

export const EMAIL_TONES = {
  foil: { label: "Foil", subject: "You're booked — your agreement is attached" },
  seven: { label: "7 days", subject: "Your session is in 7 days" },
  three: { label: "3 days", subject: "Your session is in 3 days" },
  deposit: { label: "Deposit due", subject: "Your remaining balance is due today" },
};

export default function EmailConfirmPreview({ proposal }) {
  const [tone, setTone] = useState("seven");
  const model = emailModel(proposal);

  return (
    <div>
      <div className="s7-deck-theme-bar">
        {Object.entries(EMAIL_TONES).map(([id, item]) => (
          <button key={id} type="button" className={tone === id ? "active" : ""} onClick={() => setTone(id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="s7-email-stage">
        <div className="s7-email-chrome">
          <div><span>From</span><strong>Studio 7 Miami &lt;hello@studio7.miami&gt;</strong></div>
          <div><span>To</span><strong>{model.email}</strong></div>
          <div><span>Subject</span><strong>{EMAIL_TONES[tone].subject}</strong></div>
          {tone === "foil" ? <div><span>Attached</span><strong>{agreementPdfFilename(model.name)}</strong></div> : null}
        </div>
        {tone === "foil" ? <FoilEmail model={model} /> : null}
        {tone === "seven" ? <ReminderEmail model={model} when="7 days" /> : null}
        {tone === "three" ? <ReminderEmail model={model} when="3 days" /> : null}
        {tone === "deposit" ? <DepositDueEmail model={model} /> : null}
      </div>
    </div>
  );
}

function emailModel(proposal) {
  const totals = proposal ? proposalTotals(proposal) : { total: 2200, deposit: 1100 };
  const currency = proposal?.pricing?.currency || "USD";
  const name = proposal?.client?.contact_name || "Alex Rivera";
  const token = typeof window !== "undefined" ? window.location.pathname.split("/").pop() : "mock-proposal-client-trial";
  return {
    name,
    firstName: name.trim().split(/\s+/)[0],
    email: proposal?.client?.email || "alex@example.com",
    title: proposal?.title || "Portrait Session",
    date: formatSessionDate(proposal?.schedule?.session_date),
    total: formatMoney(totals.total, currency),
    deposit: formatMoney(totals.deposit, currency),
    remaining: formatMoney(Math.max(0, (totals.total || 0) - (totals.deposit || 0)), currency),
    depositDue: formatSessionDate(offsetDate(proposal?.schedule?.session_date, -14)),
    paymentType: proposal?.payment_type || "deposit",
    payUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/p/${token}?pay=remaining`,
  };
}

function offsetDate(value, days) {
  const base = value ? new Date(`${value}T12:00:00`) : new Date("2026-09-10T12:00:00");
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function formatSessionDate(value) {
  if (!value) return "September 10, 2026";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function PayBalance({ href, amount }) {
  return (
    <a className="s7-email__cta s7-email__cta--soft" href={href}>
      Pay balance{amount ? ` · ${amount}` : ""}
    </a>
  );
}

function FoilEmail({ model }) {
  const isDeposit = model.paymentType !== "full";
  const paymentLabel = isDeposit ? "Payment (1 out of 2)" : "Payment";
  const paymentValue = isDeposit ? model.deposit : model.total;
  return (
    <div className="s7-email s7-email--foil">
      <img src={LOGO} alt="Studio 7 Miami" />
      <span className="s7-email__foil">Confirmed</span>
      <h1>You&apos;re booked.</h1>
      <p>
        {model.firstName}, we have you on the calendar for {model.date}.
      </p>
      <div className="s7-email__facts">
        <div><small>Project</small><strong>{model.title}</strong></div>
        <div><small>Date</small><strong>{model.date}</strong></div>
        <div><small>{paymentLabel}</small><strong>{paymentValue}</strong></div>
      </div>
    </div>
  );
}

function ReminderEmail({ model, when }) {
  return (
    <div className="s7-email s7-email--foil">
      <img src={LOGO} alt="Studio 7 Miami" />
      <span className="s7-email__foil">Coming up</span>
      <h1>Your session is in {when}.</h1>
      <p>Hi {model.firstName},</p>
      <p>
        A quick note that {model.title} is coming up on {model.date}.
        We appreciate your attention to this.
      </p>
      <div className="s7-email__facts">
        <div><small>Project</small><strong>{model.title}</strong></div>
        <div><small>Date</small><strong>{model.date}</strong></div>
        <div><small>Balance</small><strong>{model.remaining}</strong></div>
      </div>
      <PayBalance href={model.payUrl} amount={model.remaining} />
      <p className="s7-email__sign">See you soon,<br />Studio 7 Miami</p>
    </div>
  );
}

function DepositDueEmail({ model }) {
  return (
    <div className="s7-email s7-email--foil">
      <img src={LOGO} alt="Studio 7 Miami" />
      <span className="s7-email__foil">Balance due</span>
      <h1>Your remaining balance is due today.</h1>
      <p>Hi {model.firstName},</p>
      <p>
        The second deposit for {model.title} is due today.
        We appreciate your attention to this.
      </p>
      <div className="s7-email__facts">
        <div><small>Project</small><strong>{model.title}</strong></div>
        <div><small>Due</small><strong>{model.depositDue}</strong></div>
        <div><small>Amount due</small><strong>{model.remaining}</strong></div>
      </div>
      <PayBalance href={model.payUrl} amount={model.remaining} />
      <p className="s7-email__sign">With love,<br />Studio 7 Miami</p>
    </div>
  );
}

const MOCK_CLIENT_SIGNATURE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 110" fill="none">
    <path d="M18 72c18-32 38-48 52-28 10 14-6 34 10 40 22 8 34-36 58-34 16 1 24 18 42 16 28-4 40-30 72-22 22 6 40 22 68 14" stroke="#111" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M44 78c36-8 86-10 140 4" stroke="#111" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M96 28c2 18 1 38-8 54" stroke="#111" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`);

export function SignedAgreementSendPreview() {
  const proposal = normalizeProposal(luisLiveDraft());
  const model = emailModel(proposal);
  const signature = {
    signer_name: "Luis Corrales",
    signer_email: "luis@corrales.co",
    signed_at: "2026-08-31T16:05:00-04:00",
    signature_data: MOCK_CLIENT_SIGNATURE,
  };
  return (
    <div className="s7-email-stage s7-email-stage--letter">
      <div className="s7-email-chrome">
        <div><span>From</span><strong>Studio 7 Miami &lt;hello@studio7.miami&gt;</strong></div>
        <div><span>To</span><strong>{model.email}</strong></div>
        <div><span>Subject</span><strong>You&apos;re booked — your agreement is attached</strong></div>
        <div><span>Attached</span><strong>{agreementPdfFilename("Luis Corrales")}</strong></div>
      </div>
      <FoilEmail model={model} />
      <p className="s7-email__note s7-letter-attach-label">Attached PDF · US Letter · 1-inch margins</p>
      <AgreementLetter proposal={proposal} agreement={proposal} signature={signature} />
    </div>
  );
}
