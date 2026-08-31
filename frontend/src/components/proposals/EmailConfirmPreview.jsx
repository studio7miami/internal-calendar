import React, { useState } from "react";
import { formatMoney, proposalTotals } from "../../lib/proposals";

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
          {tone === "foil" ? <div><span>Attached</span><strong>Agreement.pdf</strong></div> : null}
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
    firstName: name.trim().split(/\s+/)[0],
    email: proposal?.client?.email || "alex@example.com",
    title: proposal?.title || "Portrait Session",
    date: formatSessionDate(proposal?.schedule?.session_date),
    total: formatMoney(totals.total, currency),
    deposit: formatMoney(totals.deposit, currency),
    remaining: formatMoney(Math.max(0, (totals.total || 0) - (totals.deposit || 0)), currency),
    depositDue: formatSessionDate(offsetDate(proposal?.schedule?.session_date, -14)),
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
  return (
    <div className="s7-email s7-email--foil">
      <img src={LOGO} alt="Studio 7 Miami" />
      <span className="s7-email__foil">Confirmed</span>
      <h1>You&apos;re booked.</h1>
      <p>
        {model.firstName}, your {model.title} is on the calendar for {model.date}.
        The signed agreement is attached.
      </p>
      <div className="s7-email__facts">
        <div><small>Project</small><strong>{model.title}</strong></div>
        <div><small>Date</small><strong>{model.date}</strong></div>
        <div><small>Deposit</small><strong>{model.deposit}</strong></div>
      </div>
      <p className="s7-email__note">Agreement.pdf is attached to this email.</p>
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
