/**
 * Page enter animation — same feel as team app PageEnterMotion (framer-motion).
 * Uses Motion (vanilla) from the Framer team via CDN.
 */
const PAGE_EASE = [0.4, 0, 0.2, 1];
const PAGE_DURATION = 0.22;
const STAGGER = 0.04;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function enterTargets() {
  const container = document.querySelector(".booking-enter");
  const footer = document.querySelector(".booking-enter-footer");
  const blocks = container ? [...container.children] : [];
  if (footer) blocks.push(footer);
  return blocks;
}

function revealInstant() {
  document.documentElement.classList.remove("booking-preload");
  enterTargets().forEach((el) => {
    el.style.opacity = "";
    el.style.transform = "";
  });
}

async function runPageEnter() {
  if (prefersReducedMotion()) {
    revealInstant();
    return;
  }

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_) {}
  }

  const { animate, stagger } = await import(
    "https://cdn.jsdelivr.net/npm/motion@11.18.2/+esm"
  );

  const targets = enterTargets();
  if (!targets.length) {
    revealInstant();
    return;
  }

  document.documentElement.classList.remove("booking-preload");

  await animate(
    targets,
    { opacity: [0, 1], y: [16, 0] },
    { duration: PAGE_DURATION, ease: PAGE_EASE, delay: stagger(STAGGER) }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    runPageEnter().catch(revealInstant);
  });
} else {
  runPageEnter().catch(revealInstant);
}
