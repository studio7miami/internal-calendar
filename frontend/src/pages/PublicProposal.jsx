import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CreditCard, Loader2, MessageSquareText, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { formatMoney, normalizeProposal, proposalTotals } from "../lib/proposals";
import { formatApiError, publicProposalApi } from "../lib/api";
import ProposalDeck, { ATLAS_FINISHES } from "../components/proposals/ProposalDeck";
import EmailConfirmPreview from "../components/proposals/EmailConfirmPreview";
import BookingStepper from "../components/proposals/BookingStepper";
import SignaturePad from "../components/proposals/SignaturePad";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

export default function PublicProposal() {
  const { token } = useParams();
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [changesOpen, setChangesOpen] = useState(false);
  const [changes, setChanges] = useState("");
  const [clientName, setClientName] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState("deposit");
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const restarting = searchParams.get("restart") === "1";
  const checkoutSuccess = !restarting && searchParams.get("checkout") === "success";
  const [confirmHold, setConfirmHold] = useState(checkoutSuccess);
  const [reviewProposal, setReviewProposal] = useState(searchParams.get("step") === "proposal");
  const signatureRef = useRef(null);

  const setFlowStep = (step) => {
    try {
      const url = new URL(window.location.href);
      if (step) url.searchParams.set("step", step);
      else url.searchParams.delete("step");
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  const load = useCallback(async ({ welcome = false } = {}) => {
    setError("");
    const started = Date.now();
    try {
      const { data } = await publicProposalApi.get(`/${token}`);
      if (welcome && !checkoutSuccess) {
        const elapsed = Date.now() - started;
        if (elapsed < 1200) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200 - elapsed));
        }
      }
      const normalized = normalizeProposal(data);
      setProposal(normalized);
      setClientName((current) => current || normalized.client?.contact_name || "");
      setSignerName((current) => current || normalized.client?.contact_name || "");
      setSignerEmail((current) => current || normalized.client?.email || "");
      return normalized;
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "This proposal could not be opened.");
    }
  }, [token, checkoutSuccess]);

  useEffect(() => { load({ welcome: true }); }, [load]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Studio 7 Miami · Proposal";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    if (!proposal?.status) return;
    const accepted = ["client_approved", "approved"].includes(proposal.status);
    const alreadyPast = ["signed", "deposit_paid", "paid"].includes(proposal.status);
    if (!accepted || alreadyPast) return;
    const step = new URLSearchParams(window.location.search).get("step");
    if (step === "proposal") return;
    setReviewProposal(false);
    if (step !== "agreement") setFlowStep("agreement");
  }, [proposal?.id, proposal?.status]);

  useEffect(() => {
    if (!restarting) return;
    try {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, "", url.toString());
    } catch {}
  }, [restarting]);

  useEffect(() => {
    if (!checkoutSuccess) return undefined;
    const hold = window.setTimeout(() => setConfirmHold(false), 1600);
    return () => window.clearTimeout(hold);
  }, [checkoutSuccess]);

  useEffect(() => {
    if (!checkoutSuccess) return undefined;
    let attempts = 0;
    const poll = window.setInterval(async () => {
      attempts += 1;
      const latest = await load();
      if (["deposit_paid", "paid"].includes(latest?.status) || attempts >= 12) window.clearInterval(poll);
    }, 2000);
    return () => window.clearInterval(poll);
  }, [checkoutSuccess, load]);

  const post = async (action, payload) => {
    setWorking(action);
    setError("");
    try {
      const { data } = await publicProposalApi.post(`/${token}/${action}`, payload);
      return data;
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "We could not complete that action.");
      return null;
    } finally {
      setWorking("");
    }
  };

  const requestChanges = async () => {
    const data = await post("change-request", { message: changes, client_name: clientName || proposal.client?.contact_name });
    if (data) { setChanges(""); setChangesOpen(false); await load(); }
  };

  const approve = async () => {
    const data = await post("approve", { client_name: clientName || proposal.client?.contact_name });
    if (data) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("step", "agreement");
        window.history.replaceState({}, "", url.toString());
      } catch {}
      await load();
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
    }
  };

  const sign = async () => {
    const data = await post("sign", { signer_name: signerName, signer_email: signerEmail, signature_data: signature, consent });
    if (data) await load();
  };

  const checkout = async (paymentType) => {
    const data = await post("checkout", { payment_type: paymentType });
    const url = data?.checkout_url || data?.url;
    if (url) window.location.assign(url);
  };

  const isMockTrial = String(token || "") === "mock-proposal-client-trial";

  const clearFlowParams = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      url.searchParams.delete("restart");
      url.searchParams.delete("step");
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  const rewindTo = async (to) => {
    const data = await post("rewind", { to });
    if (!data) return;
    setConfirmHold(false);
    setSignature("");
    setConsent(false);
    clearFlowParams();
    await load();
  };

  useEffect(() => {
    if (!proposal?.status) return;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [proposal?.status]);

  if (new URLSearchParams(window.location.search).get("preview") === "allset") {
    return <PublicShell><AllSetGallery /></PublicShell>;
  }

  if (!proposal && !error) {
    if (checkoutSuccess) {
      return <PublicShell><AllSet variant="lift" /></PublicShell>;
    }
    return (
      <PublicShell>
        <div className="s7-public-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          Thank you for being here.
        </div>
      </PublicShell>
    );
  }
  if (!proposal) return <PublicShell><div className="s7-public-unavailable"><h1>Proposal unavailable</h1><p>{error}</p></div></PublicShell>;

  const fullyPaid = proposal.status === "paid";
  const depositPaid = proposal.status === "deposit_paid";
  const collectRemaining = !fullyPaid && searchParams.get("pay") === "remaining";
  const lockedIn = fullyPaid || (depositPaid && !collectRemaining);
  const signed = fullyPaid || depositPaid || proposal.status === "signed" || !!proposal.signature_summary;
  const approved = signed || ["client_approved", "approved"].includes(proposal.status);
  const reviewingAccepted = approved && !signed && !lockedIn && !collectRemaining && reviewProposal;
  const currentStep = lockedIn ? 4 : collectRemaining || proposal.status === "signed" ? 3 : reviewingAccepted ? 1 : approved ? 2 : 1;
  const totals = proposalTotals(proposal);
  const stage = lockedIn ? "thanks" : collectRemaining || proposal.status === "signed" ? "payment" : reviewingAccepted ? "proposal" : approved ? "agreement" : "proposal";
  const browseAccepted = approved && !signed && !lockedIn && !collectRemaining;

  const showAcceptedProposal = () => {
    setReviewProposal(true);
    setFlowStep("proposal");
    window.scrollTo(0, 0);
  };

  const showAgreement = () => {
    setReviewProposal(false);
    setFlowStep("agreement");
    window.scrollTo(0, 0);
  };

  const onSelectStep = (next) => {
    if (browseAccepted && next === 1) {
      showAcceptedProposal();
      return;
    }
    if (browseAccepted && next === 2) {
      showAgreement();
      return;
    }
    if (isMockTrial) rewindTo(next === 1 ? "proposal" : next === 2 ? "agreement" : "payment");
  };
  const showAllSet = checkoutSuccess && signed && (confirmHold || !fullyPaid);

  if (showAllSet) {
    return <PublicShell><AllSet variant="lift" /></PublicShell>;
  }

  if (new URLSearchParams(window.location.search).get("preview") === "deck") {
    return <PublicShell><DeckThemePreview proposal={proposal} /></PublicShell>;
  }

  if (new URLSearchParams(window.location.search).get("preview") === "email") {
    return <PublicShell><EmailConfirmPreview proposal={proposal} /></PublicShell>;
  }

  return (
    <PublicShell>
      <FlowHeader
        step={currentStep}
        onSelect={browseAccepted || isMockTrial ? onSelectStep : undefined}
      />

      {error && <div className="s7-public-error s7-public-error--fixed">{error}</div>}

      {stage === "proposal" ? (
        <div className="s7-public-content">
          <ProposalDeck proposal={proposal} theme="atlas" finish="foil" clientFrame />
          <div className="s7-deck-actions">
            <Button variant="ghost" className="s7-btn s7-btn--outline" onClick={() => setChangesOpen(true)}><MessageSquareText /> Request changes</Button>
            {reviewingAccepted ? (
              <Button className="s7-btn s7-btn--soft" onClick={showAgreement}><CheckCircle2 /> Continue to agreement</Button>
            ) : (
              <Button className="s7-btn s7-btn--soft" disabled={!!working} onClick={approve}><CheckCircle2 /> Approve proposal</Button>
            )}
          </div>
        </div>
      ) : (
        <section className="s7-client-flow s7-client-flow--stage">
          {stage === "thanks" ? (
            <Completion
              proposal={proposal}
              title="Your date is locked in."
              body="We'll take care of the rest."
              onBack={isMockTrial ? () => rewindTo("payment") : undefined}
            />
          ) : stage === "payment" ? (
            <PaymentPanel
              proposal={proposal}
              totals={totals}
              choice={paymentChoice}
              setChoice={setPaymentChoice}
              remaining={collectRemaining}
              working={working}
              onCheckout={checkout}
              onBack={isMockTrial && !collectRemaining ? () => rewindTo("agreement") : undefined}
            />
          ) : (
            <Agreement
              agreement={proposal.agreement}
              proposal={proposal}
              totals={totals}
              signerName={signerName}
              setSignerName={setSignerName}
              signerEmail={signerEmail}
              setSignerEmail={setSignerEmail}
              signature={signature}
              setSignature={setSignature}
              consent={consent}
              setConsent={setConsent}
              signatureRef={signatureRef}
              onSign={sign}
              working={working}
              onBack={browseAccepted ? showAcceptedProposal : isMockTrial ? () => rewindTo("proposal") : undefined}
            />
          )}
        </section>
      )}

      {changesOpen && (
        <ChangesModal
          clientName={clientName}
          setClientName={setClientName}
          changes={changes}
          setChanges={setChanges}
          working={working}
          onClose={() => setChangesOpen(false)}
          onSend={requestChanges}
        />
      )}
    </PublicShell>
  );
}

const FLOW_STEPS = [
  { step: 1, label: "Proposal" },
  { step: 2, label: "Agreement" },
  { step: 3, label: "Pay" },
];

function FlowHeader({ step, onSelect }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-2.5 sm:gap-6 sm:px-5 sm:py-3">
        <img
          src="https://book.studio7.miami/images/studio7-logo.png"
          alt="Studio 7 Miami"
          className="h-11 w-auto shrink-0 object-contain sm:h-12 lg:h-14"
        />
        <BookingStepper step={step} steps={FLOW_STEPS} onSelect={onSelect} />
      </div>
    </header>
  );
}

function Agreement({ agreement, proposal, totals, signerName, setSignerName, signerEmail, setSignerEmail, signature, setSignature, consent, setConsent, signatureRef, onSign, working, onBack }) {
  return (
    <div className="s7-flow-page">
      {onBack ? (
        <button type="button" className="s7-flow-back" onClick={onBack}><ArrowLeft /> Back to proposal</button>
      ) : null}
      <div className="s7-flow-layout">
        <div>
          <h1>Review &amp; sign</h1>
          <p className="s7-flow-page__sub">We're grateful to create with you. Read it through, then sign below to continue.</p>
          <div className="s7-flow-card">
            <p className="s7-flow-kicker">Service agreement</p>
            <AgreementSnapshot agreement={agreement} proposal={proposal} totals={totals} />
          </div>
          <div className="s7-flow-card s7-sign-card">
            <label><span>Full legal name</span><Input value={signerName} onChange={(e) => setSignerName(e.target.value)} className="s7-flow-input" /></label>
            <label><span>Email</span><Input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} className="s7-flow-input" /></label>
            <div className="s7-signature"><span>Sign here</span><SignaturePad ref={signatureRef} onChange={setSignature} /></div>
            <label className="s7-check-row">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I agree to sign electronically and accept the exact proposal and agreement shown above. <em>(required)</em></span>
            </label>
          </div>
        </div>
        <SessionGlance proposal={proposal} totals={totals}>
          <Button className="s7-btn s7-btn--dark s7-btn--wide" disabled={!signerName.trim() || !signerEmail.trim() || !signature || !consent || !!working} onClick={onSign}>{working === "sign" ? "Signing…" : "Sign & continue"}</Button>
        </SessionGlance>
      </div>
    </div>
  );
}

function AgreementSnapshot({ agreement, proposal, totals }) {
  const clientName = agreement?.client?.name || proposal?.client?.contact_name || "the Client";
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
  const total = formatMoney(totals?.total ?? 0, currency);
  const deposit = formatMoney(totals?.deposit ?? 0, currency);
  const sessionDate = formatSessionDate(schedule.session_date);

  return (
    <div className="s7-agreement-scroll">
      <section>
        <h3>Parties</h3>
        <p>
          This Service Agreement is entered into between Studio 7 Miami (“Studio 7”) and {clientName} (“Client”)
          for the creative services described in the proposal titled “{title}.”
        </p>
      </section>
      <section>
        <h3>Session</h3>
        <p>
          Studio 7 will provide production services for {clientName} on {sessionDate}
          {schedule.arrival_time ? `, with arrival at ${schedule.arrival_time}` : ""}
          {schedule.shoot_time ? ` and shoot beginning at ${schedule.shoot_time}` : ""}
          {schedule.wrap_time ? `, wrapping by ${schedule.wrap_time}` : ""}.
        </p>
      </section>
      <section>
        <h3>Investment</h3>
        <p>
          The total investment for this engagement is {total}. A deposit of {depositPercent}% ({deposit})
          is due to confirm the booking. The remaining balance is due under the payment terms below.
        </p>
      </section>
      <section>
        <h3>Deliverables &amp; turnaround</h3>
        <p>
          Deliverables: {deliverables}.{"\n"}
          Estimated turnaround: {turnaround}.
        </p>
      </section>
      <section>
        <h3>Payment terms</h3>
        <p>{paymentTerms}</p>
      </section>
      <section>
        <h3>Acceptance</h3>
        <p>
          {terms} By signing below, {clientName} acknowledges they have reviewed the proposal and agree
          to these terms as presented.
        </p>
      </section>
    </div>
  );
}

function PaymentPanel({ proposal, totals, choice, setChoice, remaining = false, working, onCheckout, onBack }) {
  const pricing = proposal.pricing || {};
  const balance = Math.max(0, totals.total - totals.deposit);
  const amount = remaining ? balance : choice === "full" ? totals.total : totals.deposit;
  return (
    <div className="s7-flow-page">
      {onBack ? (
        <button type="button" className="s7-flow-back" onClick={onBack}><ArrowLeft /> Back to agreement</button>
      ) : null}
      <div className="s7-flow-layout">
        <div>
          <h1>{remaining ? "Pay your remaining balance" : "Secure your date"}</h1>
          <p className="s7-flow-page__sub">{remaining ? "We appreciate your attention to this. Submit the remaining balance to complete your booking." : "Thank you for getting this far with us. Submit your payment to lock in your session."}</p>
          <div className="s7-flow-card">
            <div className="s7-order">
              <span><CreditCard /></span>
              <div><h2>{proposal.title || "Content proposal"}</h2><p>{formatSessionDate(proposal.schedule?.session_date)}</p></div>
              <strong>{formatMoney(remaining ? balance : totals.total, pricing.currency)}</strong>
            </div>
            <p className="s7-flow-kicker s7-payment-kicker">{remaining ? "Amount due" : "Payment summary"}</p>
            {remaining ? (
              <Spec label="Remaining balance" value={formatMoney(balance, pricing.currency)} />
            ) : (
              <>
                <Spec label="Deposit" value={`${pricing.deposit_percent || 0}% · ${formatMoney(totals.deposit, pricing.currency)}`} />
                <Spec label="Balance" value={formatMoney(totals.total - totals.deposit, pricing.currency)} />
                <div className="s7-payment-options" role="radiogroup" aria-label="Payment option">
                  <PaymentOption active={choice === "deposit"} title="Pay deposit" detail={`${formatMoney(totals.deposit, pricing.currency)} due today`} onClick={() => setChoice("deposit")} />
                  <PaymentOption active={choice === "full"} title="Pay in full" detail={`${formatMoney(totals.total, pricing.currency)} due today`} onClick={() => setChoice("full")} />
                </div>
              </>
            )}
            <Button className="s7-btn s7-btn--dark s7-btn--wide s7-payment-cta" disabled={!!working} onClick={() => onCheckout(remaining ? "remaining" : choice)}>{working === "checkout" ? "Opening checkout…" : remaining ? `Pay balance · ${formatMoney(amount, pricing.currency)}` : `Pay ${choice === "full" ? "in full" : "deposit"} · ${formatMoney(amount, pricing.currency)}`}</Button>
            <p className="s7-checkout-caption">Secure checkout · your card is never stored</p>
          </div>
        </div>
        <SessionGlance proposal={proposal} totals={totals} />
      </div>
    </div>
  );
}

function PaymentOption({ active, title, detail, onClick }) {
  return (
    <button type="button" role="radio" aria-checked={active} className={active ? "active" : ""} onClick={onClick}>
      <span>{title}<b>{active && "✓"}</b></span>
      <small>{detail}</small>
    </button>
  );
}

function SessionGlance({ proposal, totals, children }) {
  const pricing = proposal.pricing || {};
  return (
    <div className="s7-glance-slot">
      <aside className="s7-glance">
        <p className="s7-flow-kicker">Your session at a glance</p>
        <Spec label="Client" value={proposal.client?.contact_name || "To be confirmed"} />
        <Spec label="Date" value={formatSessionDate(proposal.schedule?.session_date)} />
        <Spec label="Deliverables" value={pricing.deliverables || "As outlined"} />
        <div className="s7-glance__total"><span>Your total</span><strong>{formatMoney(totals.total, pricing.currency)}</strong></div>
        {children}
      </aside>
    </div>
  );
}

function Spec({ label, value }) {
  return <div className="s7-spec"><span>{label}</span><strong>{value}</strong></div>;
}

function Completion({ title, body, proposal, onBack }) {
  const totals = proposalTotals(proposal);
  return (
    <div className="s7-flow-page s7-completion">
      {onBack ? (
        <button type="button" className="s7-flow-back" onClick={onBack}><ArrowLeft /> Back to payment</button>
      ) : null}
      <h1>{title}</h1>
      <p>{body}</p>
      <div className="s7-flow-card">
        <div className="s7-completion__check"><Check /></div>
        <p className="s7-flow-kicker">Confirmed with love</p>
        <Spec label="Client" value={proposal.client?.contact_name || "Confirmed"} />
        <Spec label="Session date" value={formatSessionDate(proposal.schedule?.session_date)} />
        <Spec label="Proposal total" value={formatMoney(totals.total, proposal.pricing?.currency)} />
      </div>
    </div>
  );
}

function formatSessionDate(value) {
  if (!value) return "Date to be confirmed";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function AllSet({ variant = "draw" }) {
  return (
    <div className={`s7-all-set s7-all-set--${variant}`} role="status" aria-live="polite">
      <span className="s7-all-set__mark" aria-hidden="true">
        <i className="s7-all-set__ring" />
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M6.6 12.4 10.2 16 17.4 8.2" />
        </svg>
      </span>
      <p>All set.</p>
    </div>
  );
}

function AllSetGallery() {
  return (
    <div className="s7-all-set-gallery">
      <AllSetLoop label="Draw" variant="draw" />
      <AllSetLoop label="Lift" variant="lift" />
      <AllSetLoop label="Ring" variant="ring" />
    </div>
  );
}

function AllSetLoop({ label, variant }) {
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setReplay((value) => value + 1), 2800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <button type="button" className="s7-all-set-gallery__item" onClick={() => setReplay((value) => value + 1)}>
      <AllSet key={`${variant}-${replay}`} variant={variant} />
      <span>{label}</span>
    </button>
  );
}

function ChangesModal({ clientName, setClientName, changes, setChanges, working, onClose, onSend }) {
  return (
    <div className="s7-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && onClose) onClose(); }}>
      <div className="s7-modal s7-modal--foil" role="dialog" aria-modal="true" aria-labelledby="changes-heading">
        <button className="s7-modal__close" type="button" onClick={onClose} aria-label="Close"><X /></button>
        <h2 id="changes-heading">Request changes</h2>
        <p>Tell us what to update. Your notes go directly to our team.</p>
        <label>
          <span>Your name</span>
          <Input value={clientName} onChange={(event) => setClientName(event.target.value)} className="s7-flow-input" />
        </label>
        <label>
          <span>Your notes</span>
          <Textarea value={changes} onChange={(event) => setChanges(event.target.value)} className="s7-flow-textarea" placeholder="Timing, deliverables, energy, anything else…" />
        </label>
        <Button disabled={!changes.trim() || !!working} className="s7-btn s7-btn--soft s7-btn--wide" onClick={onSend}>{working === "change-request" ? "Sending…" : "Send feedback"}</Button>
      </div>
    </div>
  );
}

function DeckThemePreview({ proposal }) {
  const [finish, setFinish] = useState("foil");
  return (
    <div>
      <div className="s7-deck-theme-bar">
        {Object.entries(ATLAS_FINISHES).map(([id, item]) => (
          <button key={id} type="button" className={finish === id ? "active" : ""} onClick={() => setFinish(id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="s7-public-content">
        <ProposalDeck proposal={proposal} theme="atlas" finish={finish} />
      </div>
    </div>
  );
}

function PublicShell({ children }) {
  return <main className="s7-public">{children}</main>;
}
