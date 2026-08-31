import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDeliverablesCount, formatMoney, proposalTotals } from "../../lib/proposals";
import logo from "./ProposalDeckLogo.png";
import palm from "./ProposalDeckPalm.png";
import "./ProposalDeck.css";

export const DECK_PRESENTATION_MODES = {
  stack: { label: "Card Stack", description: "Separate slides in a vertical stack" },
  reel: { label: "Slide Reel", description: "Horizontal snap-scroll filmstrip" },
  presenter: { label: "Presenter", description: "One slide at a time with controls" },
};

export const DECK_THEMES = {
  atlas: { label: "Atlas", note: "Light bento, pills, yellow numbers" },
  ink: { label: "Ink", note: "Dark sections, high contrast" },
  frame: { label: "Frame", note: "Split cover, stacked tiles" },
};

export const ATLAS_FINISHES = {
  line: { label: "Line" },
  seal: { label: "Seal" },
  foil: { label: "Foil" },
};

export default function ProposalDeck({
  proposal,
  compact = false,
  presentationMode = "stack",
  onPresentationModeChange,
  showPresentationPicker = false,
  theme = "classic",
  finish,
  clientFrame = false,
}) {
  const [activeSlide, setActiveSlide] = useState(0);
  const { total, deposit } = proposalTotals(proposal);
  const pricing = proposal.pricing || {};
  const vision = proposal.vision || {};
  const schedule = proposal.schedule || {};
  const client = proposal.client?.contact_name || "Your Brand";
  const title = proposal.title || "Content proposal";
  const sessionDate = formatDate(schedule.session_date);
  const contentItems = (proposal.content_items || []).slice(0, 3);

  const steps = SESSION_FLOW;
  const slides = [
    {
      id: "01",
      tag: `01 ${client}`,
      label: "Cover",
      body: (
        <div className="s7-cover">
          <div>
            <h1>{client}</h1>
            <p className="s7-cover__project">{title}</p>
          </div>
          <div>
            <p className="s7-cover__tagline">Where the environment meets the moment.</p>
            <p className="s7-cover__meta">Content Proposal <span>·</span> {sessionDate}</p>
          </div>
        </div>
      ),
    },
    {
      id: "02",
      tag: "02 Vision",
      ghost: "01",
      label: "Vision",
      body: (
        <>
          <Eyebrow>Your Vision</Eyebrow>
          <h2 className="s7-title">What you're<br />here to create.</h2>
          <p className="s7-subline">Every session at Studio 7 begins with intention — yours.</p>
          <div className="s7-vision-grid">
            <Fact label="Brand Description" value={vision.brand_description} />
            <Fact label="Content Goals" value={vision.content_goals} />
            <Fact label="Target Audience" value={vision.target_audience} />
            <Fact label="Desired Energy" value={vision.desired_energy} />
          </div>
        </>
      ),
    },
    {
      id: "03",
      tag: "03 Content",
      ghost: "02",
      label: "Content",
      body: (
        <>
          <Eyebrow>Content Direction</Eyebrow>
          <h2 className="s7-title">What we're shooting.</h2>
          <div className="s7-content-grid">
            {[0, 1, 2].map((index) => <ContentCard key={contentItems[index]?.id || index} item={contentItems[index]} index={index} />)}
          </div>
        </>
      ),
    },
    {
      id: "04",
      tag: "04 Experience",
      ghost: "03",
      label: "Experience",
      body: (
        <>
          <Eyebrow>The Experience</Eyebrow>
          <h2 className="s7-title">How your<br />session flows.</h2>
          <p className="s7-subline">Studio 7 is built for the moment — every detail of your session is designed to move with you.</p>
          <div className="s7-steps">
            {steps.map((step, index) => (
              <React.Fragment key={step.label}>
                <div className="s7-step">
                  <div className="s7-step__number">{String(index + 1).padStart(2, "0")}</div>
                  <div className="s7-step__label">{step.label}</div>
                  <div className="s7-step__rule" />
                  <div className="s7-step__time">{step.detail}</div>
                </div>
                {index < steps.length - 1 && <span className="s7-step__arrow" aria-hidden="true">→</span>}
              </React.Fragment>
            ))}
          </div>
        </>
      ),
    },
    {
      id: "05",
      tag: "05 Details",
      ghost: "04",
      label: "Details",
      body: (
        <>
          <Eyebrow>Investment</Eyebrow>
          <h2 className="s7-title">Your session<br />details.</h2>
          <div className="s7-stats">
            <Stat value={formatMoney(total, pricing.currency)} label="Session Rate" />
            <Stat value={formatDeliverablesCount(pricing.deliverables)} label="Deliverables" />
            <Stat value={pricing.turnaround || "To be confirmed"} label="Turnaround" />
          </div>
          <div className="s7-next">
            <h3>Next Steps</h3>
            <div className="s7-next__row">
              <div>
                {NEXT_STEPS.map(([number, title, body]) => (
                  <NextStep key={number} number={number}>{title}. {body}</NextStep>
                ))}
              </div>
            </div>
          </div>
        </>
      ),
    },
  ];

  useEffect(() => {
    setActiveSlide((current) => Math.min(current, slides.length - 1));
  }, [slides.length]);

  const deckClass = [
    "s7-deck",
    compact ? "s7-deck--compact" : "",
    `s7-deck--${presentationMode}`,
  ].filter(Boolean).join(" ");

  const goSlide = (delta) => {
    setActiveSlide((current) => Math.min(slides.length - 1, Math.max(0, current + delta)));
  };

  if (theme !== "classic") {
    return (
      <BentoDeck
        theme={theme}
        finish={finish}
        clientFrame={clientFrame}
        client={client}
        title={title}
        sessionDate={sessionDate}
        vision={vision}
        contentItems={contentItems}
        schedule={schedule}
        pricing={pricing}
        total={total}
        deposit={deposit}
      />
    );
  }

  return (
    <article className={deckClass} data-presentation={presentationMode}>
      {showPresentationPicker && onPresentationModeChange && (
        <div className="s7-deck-picker" role="tablist" aria-label="Presentation style">
          {Object.entries(DECK_PRESENTATION_MODES).map(([id, mode]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={presentationMode === id}
              className={presentationMode === id ? "active" : ""}
              onClick={() => onPresentationModeChange(id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}

      {presentationMode === "presenter" && (
        <div className="s7-deck-presenter-bar">
          <button type="button" onClick={() => goSlide(-1)} disabled={activeSlide <= 0} aria-label="Previous slide">
            <ChevronLeft />
          </button>
          <span>{slides[activeSlide].id} · {slides[activeSlide].label}</span>
          <button type="button" onClick={() => goSlide(1)} disabled={activeSlide >= slides.length - 1} aria-label="Next slide">
            <ChevronRight />
          </button>
        </div>
      )}

      <div className={presentationMode === "reel" ? "s7-deck-reel-track" : "s7-deck-track"}>
        {slides.map((slide, index) => (
          <Slide
            key={slide.id}
            index={index}
            tag={slide.tag}
            ghost={slide.ghost}
            label={slide.label}
            active={presentationMode !== "presenter" || index === activeSlide}
          >
            {slide.body}
          </Slide>
        ))}
      </div>

      {presentationMode === "reel" && (
        <div className="s7-deck-reel-meta" aria-hidden="true">
          {slides.map((slide) => (
            <span key={slide.id}>{slide.id}</span>
          ))}
        </div>
      )}

      {presentationMode === "presenter" && (
        <div className="s7-deck-presenter-thumbs" role="tablist" aria-label="Slides">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={index === activeSlide}
              className={index === activeSlide ? "active" : ""}
              onClick={() => setActiveSlide(index)}
            >
              <span>{slide.id}</span>
              <small>{slide.label}</small>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function Slide({ tag, ghost, label, index, active = true, children }) {
  return (
    <section className={`s7-slide${active ? " is-active" : ""}`} data-slide={String(index + 1).padStart(2, "0")} aria-label={label}>
      <div className="s7-slide__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
      {ghost && <div className="s7-ghost" aria-hidden="true">{ghost}</div>}
      <div className="s7-slide__body">
        <header className="s7-slide__head">
          <img src={logo} alt="Studio 7 Miami" />
          <span>{tag}</span>
        </header>
        {children}
      </div>
      <footer className="s7-slide__foot"><img src={palm} alt="" /></footer>
    </section>
  );
}

function Eyebrow({ children }) {
  return <p className="s7-eyebrow">{children}</p>;
}

function Fact({ label, value }) {
  return (
    <div className="s7-fact">
      <p className="s7-fact__label">{label}</p>
      <p className="s7-fact__value">{value || "To be defined together"}</p>
    </div>
  );
}

function ContentCard({ item = {}, index }) {
  const type = item.type || item.title || "Content direction";
  const quantity = item.quantity != null && item.quantity !== ""
    ? (typeof item.quantity === "string" && /\D/.test(String(item.quantity))
      ? String(item.quantity)
      : `${item.quantity} ${Number(item.quantity) === 1 ? "deliverable" : "deliverables"}`)
    : "Quantity to be confirmed";
  return (
    <div className="s7-content-card">
      <p className="s7-content-card__index">{String(index + 1).padStart(2, "0")}</p>
      <h3>{type}</h3>
      <p className="s7-content-card__quantity">{quantity}</p>
      <div className="s7-content-card__rule" />
      <p className="s7-content-card__label">Energy</p>
      <p className="s7-content-card__value">{item.energy || item.description || "Intentional, elevated, and true to your brand"}</p>
      <p className="s7-content-card__label">Visual Style</p>
      <p className="s7-content-card__value">{item.visual_style || item.deliverables || "Built together during creative direction"}</p>
    </div>
  );
}

function Stat({ value, label }) {
  return <div className="s7-stat"><p>{value}</p><span>{label}</span></div>;
}

function NextStep({ number, children }) {
  return <p className="s7-next__item"><span>{number}</span>{children}</p>;
}

function BentoMark() {
  const dragRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const mark = event.currentTarget;
    const slide = mark.closest(".s7-bento-slide");
    if (!slide) return;
    const markBox = mark.getBoundingClientRect();
    const slideBox = slide.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      minX: slideBox.left - markBox.left + offset.x,
      maxX: slideBox.right - markBox.right + offset.x,
      minY: slideBox.top - markBox.top + offset.y,
      maxY: slideBox.bottom - markBox.bottom + offset.y,
    };
    mark.setPointerCapture(event.pointerId);
    setSnapping(false);
    setDragging(true);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: Math.min(drag.maxX, Math.max(drag.minX, drag.originX + event.clientX - drag.startX)),
      y: Math.min(drag.maxY, Math.max(drag.minY, drag.originY + event.clientY - drag.startY)),
    });
  };

  const endDrag = (event) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    setSnapping(true);
    setOffset({ x: 0, y: 0 });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <span
      className={`s7-bento-mark${dragging ? " is-dragging" : ""}${snapping ? " is-snapping" : ""}`}
      aria-hidden="true"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onTransitionEnd={() => setSnapping(false)}
    >
      <span
        className="s7-bento-mark__icon"
        style={{
          WebkitMaskImage: `url(${palm})`,
          maskImage: `url(${palm})`,
        }}
      />
    </span>
  );
}

const SESSION_FLOW = [
  {
    label: "Arrival",
    detail: "We arrive, we walk the space, and the day begins.",
  },
  {
    label: "Setup",
    detail: "Lighting, wardrobe, and staging are set before we shoot.",
  },
  {
    label: "Shoot",
    detail: "We capture the month’s content, intentionally directed.",
  },
  {
    label: "Wrap",
    detail: "We review selects, close the session, and look ahead to the next.",
  },
];

const NEXT_STEPS = [
  ["01", "Review and sign", "Read it through. Sign when you’re ready."],
  ["02", "Submit payment", "Confirm the retainer and hold your dates."],
  ["03", "Shape each session", "We set each shoot’s plan together."],
];

const BENTO_SLIDES = ["Cover", "Vision", "Content", "Experience", "Details"];

function stackScroller(track) {
  const overflow = getComputedStyle(track).overflowY;
  if (overflow === "auto" || overflow === "scroll") return track;
  return track.closest(".s7-trial-frame, .s7-public") || window;
}

function BentoDeck({ theme, finish, clientFrame = false, client, title, sessionDate, vision, contentItems, schedule, pricing, total, deposit }) {
  const trackRef = useRef(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const facts = [
    ["Mission", vision.brand_description],
    ["Goals", vision.content_goals],
    ["Audience", vision.target_audience],
    ["Energy", vision.desired_energy],
  ];

  const syncActiveSlide = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const slides = [...track.children];
    if (!slides.length) return;
    const column = getComputedStyle(track).flexDirection.startsWith("column");
    let best = 0;
    let bestDist = Infinity;
    if (column) {
      const scroller = stackScroller(track);
      const view = scroller === window || !scroller.getBoundingClientRect
        ? { top: 0, height: window.innerHeight }
        : scroller.getBoundingClientRect();
      const mid = view.top + view.height * 0.42;
      slides.forEach((slide, index) => {
        const box = slide.getBoundingClientRect();
        const dist = Math.abs(box.top + box.height / 2 - mid);
        if (dist < bestDist) {
          best = index;
          bestDist = dist;
        }
      });
    } else {
      const mid = track.scrollLeft + track.clientWidth / 2;
      slides.forEach((slide, index) => {
        const dist = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - mid);
        if (dist < bestDist) {
          best = index;
          bestDist = dist;
        }
      });
    }
    setActiveSlide(best);
  }, []);

  const goToSlide = (index) => {
    const track = trackRef.current;
    const slide = track?.children[index];
    if (!slide) return;
    const column = getComputedStyle(track).flexDirection.startsWith("column");
    if (column) {
      const scroller = stackScroller(track);
      if (scroller && scroller !== window && scroller.scrollTo) {
        const top = slide.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
        scroller.scrollTo({ top, behavior: "smooth" });
        return;
      }
    }
    slide.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const scroller = stackScroller(track);
    const target = scroller === window ? window : scroller;
    target.addEventListener("scroll", syncActiveSlide, { passive: true });
    syncActiveSlide();
    return () => target.removeEventListener("scroll", syncActiveSlide);
  }, [syncActiveSlide]);

  return (
    <article className={`s7-deck s7-deck--bento s7-deck--${theme}${finish ? ` s7-deck--finish-${finish}` : ""}${clientFrame ? " s7-deck--client-frame" : ""} s7-deck--surface-glass s7-deck--flow-lane s7-deck--invest-board`}>
      <div className="s7-bento-stage">
      <div className="s7-bento-track" ref={trackRef} onScroll={syncActiveSlide}>
      <section className="s7-bento-slide s7-bento-cover" aria-label="Cover">
        <div className="s7-bento-cover__top">
          <div className="s7-pills">
            <span>Proposal</span>
            <span>Studio 7 Miami</span>
          </div>
        </div>
        <BentoMark />
        <div className="s7-bento-cover__hero">
          <h1>{client}</h1>
          <p>{title}</p>
        </div>
        <div className="s7-bento-cover__meta">
          <div><small>Client</small><strong>{client}</strong></div>
          <div><small>Date</small><strong>{sessionDate}</strong></div>
          <div><small>Studio</small><strong>Studio 7 Miami</strong></div>
        </div>
      </section>

      <section className="s7-bento-slide s7-bento-vision" aria-label="Vision">
        <div className="s7-bento-slide__head">
          <span className="s7-pill">Vision</span>
          <BentoMark />
        </div>
        <h2>What you&apos;re here to create.</h2>
        <div className="s7-bento-grid s7-bento-grid--facts">
          {facts.map(([label, value]) => (
            <div key={label} className="s7-bento-tile">
              <span className="s7-pill">{label}</span>
              <p>{value || "To be defined together"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="s7-bento-slide s7-bento-content" aria-label="Content">
        <div className="s7-bento-slide__head">
          <span className="s7-pill">Content</span>
          <BentoMark />
        </div>
        <h2>What we&apos;re shooting.</h2>
        <div className="s7-bento-grid s7-bento-grid--cards">
          {[0, 1, 2].map((index) => {
            const item = contentItems[index] || {};
            return (
              <div key={item.id || index} className="s7-bento-card">
                <div className="s7-bento-card__top">
                  <span className="s7-bento-card__n">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3>{item.type || item.title || "Content direction"}</h3>
                <p>{item.energy || item.description || "Intentional, elevated, and true to your brand"}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="s7-bento-slide s7-bento-flow s7-bento-flow--frame s7-bento-flow--text" aria-label="Experience">
        <div className="s7-bento-slide__head">
          <span className="s7-pill">Experience</span>
          <BentoMark />
        </div>
        <h2>How your session flows.</h2>
        <div className="s7-bento-grid s7-bento-grid--steps">
          {SESSION_FLOW.map((step, index) => (
            <div key={step.label} className="s7-bento-tile s7-bento-flow-card">
              <div className="s7-bento-flow__copy">
                <span className="s7-bento-card__n">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.label}</h3>
                <p>{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="s7-bento-slide s7-bento-details" aria-label="Details">
        <div className="s7-bento-slide__head">
          <span className="s7-pill">Investment</span>
          <BentoMark />
        </div>
        <h2>Your session details.</h2>
        <div className="s7-bento-grid s7-bento-grid--stats">
          <div className="s7-bento-stat">
            <small>Session rate</small>
            <strong>{formatMoney(total, pricing.currency)}</strong>
          </div>
          <div className="s7-bento-stat">
            <small>Deliverables</small>
            <strong>{formatDeliverablesCount(pricing.deliverables)}</strong>
          </div>
          <div className="s7-bento-stat">
            <small>Turnaround</small>
            <strong>{pricing.turnaround || "To be confirmed"}</strong>
          </div>
        </div>
        <span className="s7-pill">Next steps</span>
        <div className="s7-bento-tile s7-bento-next-line">
          {NEXT_STEPS.map(([number, title, body]) => (
            <div key={number} className="s7-bento-next-line__item">
              <span className="s7-bento-card__n">{number}</span>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>
      </div>
      </div>
      <nav className="s7-bento-pager" aria-label="Proposal slides">
        <span className="s7-bento-pager__count">
          {String(activeSlide + 1).padStart(2, "0")} / {String(BENTO_SLIDES.length).padStart(2, "0")}
        </span>
        {BENTO_SLIDES.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-current={activeSlide === index ? "true" : undefined}
            className={activeSlide === index ? "is-active" : ""}
            onClick={() => goToSlide(index)}
          />
        ))}
      </nav>
    </article>
  );
}

function formatDate(value) {
  if (!value) return "Date to be confirmed";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
