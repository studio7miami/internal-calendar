import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Eye,
  Mail,
  MessageSquare,
  Send,
  X,
} from "lucide-react";
import {
  CONTENT_CARD_COUNT,
  deriveSessionSchedule,
  isDefaultProposalTitle,
  PROPOSAL_SECTIONS,
  proposalShareSms,
  proposalSignPaySms,
  withResumeStep,
} from "../../lib/proposals";
import ProposalDeck from "./ProposalDeck";
import { ProposalDateField, ProposalTimeField } from "./ProposalScheduleField";
import { smsUrl } from "./SignPayLinkModal";
import { useAuth } from "../../context/AuthContext";
import "./ProposalBuilder.css";

const SECTION_LABELS = {
  client: "Client",
  vision: "Creative Direction",
  content: "Content Cards",
  pricing: "Package",
};

function readTeamTheme() {
  try {
    const saved = window.localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function useTeamTheme() {
  const [theme, setTheme] = useState(readTeamTheme);

  useEffect(() => {
    const sync = () => {
      const next = readTeamTheme();
      const isDark = document.documentElement.classList.contains("dark");
      if ((next === "dark") !== isDark) {
        document.documentElement.classList.toggle("dark", next === "dark");
      }
      setTheme((current) => (current === next ? current : next));
    };

    sync();

    const onStorage = (event) => {
      if (event.key === "theme") sync();
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      observer.disconnect();
    };
  }, []);

  return theme;
}

function clientTextMessage(proposal) {
  const name = proposal.client?.contact_name;
  const link = withResumeStep(proposal.share_url, proposal.status);
  if (["client_approved", "signed"].includes(proposal.status)) {
    return proposalSignPaySms(name, link);
  }
  return proposalShareSms(name, link);
}

function findStudio7Calendar(calendars = []) {
  return calendars.find((calendar) => /studio\s*7\s*miami/i.test(String(calendar.name || "")));
}

function useMobileLayout(breakpoint = 1024) {
  const [mobile, setMobile] = useState(() => (
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${breakpoint}px)`).matches : false
  ));

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [breakpoint]);

  return mobile;
}

function SaveIndicator({ state }) {
  if (state === "new") return <span className="pb-save-indicator">Not saved yet</span>;
  if (state === "saving") return <span className="pb-save-indicator">Saving…</span>;
  if (state === "error") return <span className="pb-save-indicator pb-save-indicator--error">Save failed</span>;
  return <span className="pb-save-indicator">Saved</span>;
}

export default function ProposalEditor({
  proposal,
  onChange,
  saveState,
  statusLabel: proposalStatus,
  onAction,
  actionState,
  calendars = [],
  onBack,
}) {
  const { user } = useAuth();
  const theme = useTeamTheme();
  const isMobile = useMobileLayout();
  const [mobileTab, setMobileTab] = useState("edit");
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendShareUrl, setSendShareUrl] = useState("");
  const canvasRef = useRef(null);
  const previewStageRef = useRef(null);
  const patch = (key, value) => onChange({ ...proposal, [key]: value });
  const patchSchedule = (updates) => patch("schedule", { ...(proposal.schedule || {}), ...updates });
  const patchGroup = (group, key, value) => patch(group, { ...(proposal[group] || {}), [key]: value });
  const can = (permission) => user?.role === "admin" || !!user?.permissions?.[permission];
  const sendAction = proposal.status === "sent" || proposal.status === "viewed" ? "resend" : "send";
  const canSend = can("send_proposals")
    && !!proposal.id
    && ["draft", "changes_requested", "approved", "sent", "viewed", "client_approved", "signed"].includes(proposal.status);
  const canDuplicate = can("edit_proposals") && !!proposal.id && saveState === "saved";

  useEffect(() => {
    const studioCalendar = findStudio7Calendar(calendars);
    if (!studioCalendar?.id) return;
    if (proposal.schedule?.calendar_id === studioCalendar.id) return;
    onChange({
      ...proposal,
      schedule: { ...(proposal.schedule || {}), calendar_id: studioCalendar.id },
    });
  }, [calendars, onChange, proposal]);

  useEffect(() => {
    canvasRef.current?.scrollTo(0, 0);
  }, [proposal.id]);

  useEffect(() => {
    if (!preview) return;
    window.scrollTo(0, 0);
    previewStageRef.current?.scrollTo(0, 0);
  }, [preview]);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 1800);
  };

  const duplicate = () => {
    if (!proposal.id || saveState !== "saved" || actionState) return;
    onAction("duplicate");
  };

  const share = async (channel) => {
    if (actionState) return;
    if (channel === "text") {
      if (!canSend) return;
      const latest = await onAction(sendAction, { channel: "text" });
      if (latest?.share_url) setSendShareUrl(latest.share_url);
      return;
    }
    if (!canSend) return;
    if (!proposal.client?.email) {
      showNotice("Add a client email first");
      return;
    }
    onAction(sendAction);
    setSendOpen(false);
  };

  const openSend = async () => {
    if (actionState) return;
    let shareUrl = proposal.share_url || "";
    if (!shareUrl && canSend) {
      const latest = await onAction(sendAction, { channel: "text" });
      shareUrl = latest?.share_url || "";
    }
    setSendShareUrl(shareUrl);
    setSendOpen(true);
  };

  const updateSessionStartTime = (startTime) => {
    patchSchedule({
      ...deriveSessionSchedule(startTime),
    });
  };

  if (preview) {
    return (
      <div className={`proposal-builder proposal-builder--preview${isMobile ? " proposal-builder--mobile" : ""}`} data-theme={theme} data-testid="proposal-editor">
        <button type="button" className="pb-preview-exit" onClick={() => setPreview(false)}>
          Return to editor
        </button>
        <main className={`pb-preview-stage${isMobile ? " s7-trial-frame" : ""}`} ref={previewStageRef}>
          <div className="pb-deck-wrap">
            <ProposalDeck proposal={proposal} presentationMode="stack" theme="atlas" finish="foil" clientFrame={isMobile} />
          </div>
        </main>
      </div>
    );
  }

  const showEditorPanel = !isMobile || mobileTab === "edit";
  const showMobilePreview = isMobile && mobileTab === "preview";

  return (
    <div
      className={`proposal-builder${isMobile ? " proposal-builder--mobile" : ""}`}
      data-theme={theme}
      data-testid="proposal-editor"
    >
      {isMobile ? (
        <MobileTabBar value={mobileTab} onChange={setMobileTab} />
      ) : null}

      {showEditorPanel ? (
      <aside className="pb-panel">
        <header className="pb-panel-head">
          <div className="pb-panel-head-row">
            {onBack ? (
              <button type="button" className="pb-builder-back pb-panel-back" onClick={onBack} aria-label="Back to proposals">
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
            ) : (
              <span className="pb-panel-head-spacer" aria-hidden="true" />
            )}
            <div className="pb-panel-head-meta">
              {proposalStatus ? <span className="pb-panel-status">{proposalStatus}</span> : null}
              <SaveIndicator state={saveState} />
            </div>
          </div>

          <div className="pb-panel-copy">
            <h1 className="pb-title pb-panel-title">Content Proposal Builder</h1>
            <div className="pb-sub">Fill in the fields — updates live</div>
          </div>
        </header>

        <div className="pb-panel-scroll">
          {PROPOSAL_SECTIONS.map((item) => (
            <section key={item.id} className="pb-group" data-section={item.id}>
              <div className="pb-group-label">{SECTION_LABELS[item.id] || item.label}</div>
              <div className="pb-group-body">
                <SectionFields
                  section={item.id}
                  proposal={proposal}
                  patch={patch}
                  patchGroup={patchGroup}
                  patchSchedule={patchSchedule}
                  onSessionStartTime={updateSessionStartTime}
                />
              </div>
            </section>
          ))}
        </div>

        <footer className="pb-panel-foot">
          <ActionsBar
            onPreview={() => (isMobile ? setMobileTab("preview") : setPreview(true))}
            onDuplicate={duplicate}
            onSend={openSend}
            canSend={canSend || (isPostAcceptStatus(proposal.status) && !!proposal.share_url)}
            canDuplicate={canDuplicate}
            postAccept={isPostAcceptStatus(proposal.status)}
            actionState={actionState}
            notice={notice}
          />
        </footer>
      </aside>
      ) : null}

      {showMobilePreview ? (
        <MobilePreviewPane proposal={proposal} />
      ) : null}

      {!isMobile ? (
        <main className="pb-canvas" ref={canvasRef}>
          <div className="pb-deck-wrap">
            <ProposalDeck proposal={proposal} presentationMode="stack" theme="atlas" finish="foil" />
          </div>
        </main>
      ) : null}

      {sendOpen && (
        <SendDialog
          client={proposal.client}
          canSend={canSend}
          actionState={actionState}
          postAccept={isPostAcceptStatus(proposal.status)}
          onClose={() => setSendOpen(false)}
          onSelect={share}
          copyBody={clientTextMessage({ ...proposal, share_url: sendShareUrl || proposal.share_url })}
          textHref={
            (sendShareUrl || proposal.share_url) && proposal.client?.phone
              ? smsUrl(
                String(proposal.client.phone).replace(/[^\d+]/g, ""),
                clientTextMessage({ ...proposal, share_url: sendShareUrl || proposal.share_url }),
              )
              : ""
          }
        />
      )}
    </div>
  );
}

function MobileTabBar({ value, onChange }) {
  return (
    <div className="pb-mobile-tab-bar" role="tablist" aria-label="Editor mode">
      <button
        type="button"
        role="tab"
        aria-selected={value === "edit"}
        className={value === "edit" ? "active" : ""}
        onClick={() => onChange("edit")}
      >
        Edit
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "preview"}
        className={value === "preview" ? "active" : ""}
        onClick={() => onChange("preview")}
      >
        Preview
      </button>
    </div>
  );
}

function MobilePreviewPane({ proposal }) {
  return (
    <main className="pb-canvas pb-canvas--mobile-preview pb-mobile-preview-pane s7-trial-frame">
      <div className="pb-deck-wrap pb-deck-wrap--mobile-deck">
        <ProposalDeck proposal={proposal} presentationMode="stack" theme="atlas" finish="foil" clientFrame />
      </div>
    </main>
  );
}

function SectionFields({ section, proposal, patch, patchGroup, patchSchedule, onSessionStartTime }) {
  return (
    <div className="pb-section-fields">
      {section === "client" && (
        <ClientFields
          value={proposal.client || {}}
          title={proposal.title || ""}
          sessionDate={proposal.schedule?.session_date || ""}
          startTime={proposal.schedule?.arrival_time || ""}
          patch={(key, value) => patchGroup("client", key, value)}
          onTitle={(value) => patch("title", value)}
          onSessionDate={(value) => patchSchedule({ session_date: value })}
          onStartTime={onSessionStartTime}
        />
      )}
      {section === "vision" && <VisionFields value={proposal.vision || {}} patch={(key, value) => patchGroup("vision", key, value)} />}
      {section === "content" && <ContentFields value={proposal.content_items || []} onChange={(value) => patch("content_items", value)} />}
      {section === "pricing" && <PricingFields value={proposal.pricing || {}} patch={(key, value) => patchGroup("pricing", key, value)} />}
    </div>
  );
}

function ActionsBar({
  onPreview,
  onDuplicate,
  onSend,
  canSend,
  canDuplicate,
  postAccept,
  actionState,
  notice,
}) {
  return (
    <div className="pb-actions pb-actions--send-only" aria-label="Proposal actions">
      <ActionButton icon={Eye} label="Preview" onClick={onPreview} />
      <ActionButton
        icon={Copy}
        label="Duplicate"
        disabled={!canDuplicate || !!actionState}
        onClick={onDuplicate}
      />
      <ActionButton
        icon={Send}
        label={postAccept ? "Sign + pay" : "Send"}
        primary
        disabled={!canSend || !!actionState}
        onClick={onSend}
      />
      <div className="pb-action-status" role="status" aria-live="polite">
        {notice
          || (actionState === "duplicate" ? "Duplicating…" : "")
          || (actionState ? "Working…" : "")}
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, primary = false, ...props }) {
  return <button type="button" className={`pb-action${primary ? " primary" : ""}`} {...props}><Icon /><span>{label}</span></button>;
}

function SendDialog({ client, canSend, actionState, onClose, onSelect, postAccept = false, textHref = "", copyBody = "" }) {
  const clientEmail = client?.email || "";
  const clientPhone = client?.phone || "";
  const copyThenOpen = () => {
    if (!copyBody) return;
    try {
      navigator.clipboard?.writeText(copyBody);
    } catch {}
  };

  return (
    <div className="pb-send-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pb-send-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pb-send-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pb-send-dialog__head">
          <div>
            <p className="pb-send-dialog__kicker">{postAccept ? "Lock the date" : "Share proposal"}</p>
            <h2 id="pb-send-dialog-title">{postAccept ? "Send sign + deposit link" : "Send to client"}</h2>
          </div>
          <button type="button" className="pb-send-dialog__close" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>
        {!canSend && (
          <p className="pb-send-dialog__note">Save the proposal before sending it to the client.</p>
        )}
        <div className="pb-send-dialog__options">
          <button
            type="button"
            className="pb-send-dialog__option"
            disabled={!canSend || !!actionState || !clientEmail}
            onClick={() => onSelect("email")}
          >
            <Mail aria-hidden="true" />
            <span>Email</span>
            <small>{clientEmail || "Add client email on Client"}</small>
          </button>
          {textHref ? (
            <a className="pb-send-dialog__option" href={textHref} onClick={copyThenOpen}>
              <MessageSquare aria-hidden="true" />
              <span>Text</span>
              <small>{clientPhone}</small>
            </a>
          ) : (
            <button
              type="button"
              className="pb-send-dialog__option"
              disabled={!!actionState || !clientPhone || !canSend}
              onClick={() => onSelect("text")}
            >
              <MessageSquare aria-hidden="true" />
              <span>Text</span>
              <small>{clientPhone || "Add client phone on Client"}</small>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="pb-field"><span>{label}</span>{children}</label>;
}

function ClientFields({ value, title, patch, sessionDate, startTime, onTitle, onSessionDate, onStartTime }) {
  return (
    <div>
      <Field label="Title">
        <input
          value={isDefaultProposalTitle(title) ? "" : (title || "")}
          onChange={(e) => onTitle(e.target.value)}
          placeholder=""
        />
      </Field>
      <Field label="Client Name"><input value={value.contact_name || ""} onChange={(e) => patch("contact_name", e.target.value)} /></Field>
      <ProposalDateField label="Session Date" value={sessionDate || ""} onChange={onSessionDate} />
      <ProposalTimeField label="Start Time" value={startTime || ""} onChange={onStartTime} />
      <Field label="Client Email"><input type="email" autoComplete="email" value={value.email || ""} onChange={(e) => patch("email", e.target.value)} placeholder="For sharing" /></Field>
      <Field label="Client Phone"><input type="tel" autoComplete="tel" value={value.phone || ""} onChange={(e) => patch("phone", e.target.value)} placeholder="For sharing" /></Field>
    </div>
  );
}

function VisionFields({ value, patch }) {
  return (
    <div>
      <Field label="Brand Description"><textarea value={value.brand_description || ""} onChange={(e) => patch("brand_description", e.target.value)} /></Field>
      <Field label="Content Goals"><textarea value={value.content_goals || ""} onChange={(e) => patch("content_goals", e.target.value)} /></Field>
      <Field label="Target Audience"><textarea value={value.target_audience || ""} onChange={(e) => patch("target_audience", e.target.value)} /></Field>
      <Field label="Desired Energy"><textarea value={value.desired_energy || ""} onChange={(e) => patch("desired_energy", e.target.value)} /></Field>
    </div>
  );
}

function ContentFields({ value, onChange }) {
  const cards = [...(value || [])].slice(0, CONTENT_CARD_COUNT);
  while (cards.length < CONTENT_CARD_COUNT) {
    cards.push({ type: "", quantity: "", energy: "", visual_style: "" });
  }

  const update = (index, key, next) => onChange(cards.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: next } : item)));

  return (
    <div>
      {cards.map((item, index) => (
        <article key={item.id || `card-${index}`} className="pb-card-block">
          <div className="pb-card-label">Card {String(index + 1).padStart(2, "0")}</div>
          <Field label="Type"><input value={item.type || ""} onChange={(e) => update(index, "type", e.target.value)} /></Field>
          <Field label="Quantity"><input value={item.quantity ?? ""} onChange={(e) => update(index, "quantity", e.target.value)} /></Field>
          <Field label="Energy"><textarea value={item.energy || ""} onChange={(e) => update(index, "energy", e.target.value)} /></Field>
          <Field label="Visual Style"><textarea value={item.visual_style || ""} onChange={(e) => update(index, "visual_style", e.target.value)} /></Field>
        </article>
      ))}
    </div>
  );
}

function PricingFields({ value, patch }) {
  return (
    <div>
      <Field label="Session Rate"><input type="number" min="0" step="0.01" value={value.session_rate ?? ""} onChange={(e) => patch("session_rate", e.target.value)} /></Field>
      <Field label="Deliverables">
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={value.deliverables ?? ""}
          onChange={(e) => patch("deliverables", e.target.value)}
          placeholder="15"
        />
      </Field>
      <Field label="Turnaround"><input value={value.turnaround || ""} onChange={(e) => patch("turnaround", e.target.value)} placeholder="7–10 business days" /></Field>
    </div>
  );
}
