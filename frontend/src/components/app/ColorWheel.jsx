import React, { useEffect, useRef, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";

// --- color math ---
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}

function hexToHsl(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return { h: 0, s: 80, l: 60 };
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4);
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const normalizeHex = (v) => {
  if (!v) return null;
  const t = v.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(t))
    return `#${t.split("").map((c) => c + c).join("").toUpperCase()}`;
  return null;
};

export default function ColorWheel({ value, onChange, testId }) {
  const [hsl, setHsl] = useState(() => hexToHsl(value));
  const [hexDraft, setHexDraft] = useState(value?.toUpperCase() || "");
  const wheelRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    setHsl(hexToHsl(value));
    setHexDraft((value || "").toUpperCase());
  }, [value]);

  const commit = (next) => {
    setHsl(next);
    const hex = hslToHex(next.h, next.s, next.l);
    setHexDraft(hex);
    onChange?.(hex);
  };

  // Pointer → hue/sat. Align 0° = TOP (12 o'clock), clockwise, matching conic-gradient from 0deg.
  const updateFromEvent = (e) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const r = Math.min(cx, cy);
    const pt = e.touches ? e.touches[0] : e;
    const x = pt.clientX - rect.left - cx;
    const y = pt.clientY - rect.top - cy;
    const dist = Math.min(Math.sqrt(x * x + y * y), r);
    // atan2(x, -y): 0° at top (x=0, y<0), grows clockwise
    let angle = Math.atan2(x, -y) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    const h = Math.round(angle);
    const s = Math.round((dist / r) * 100);
    commit({ ...hsl, h, s });
  };

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    updateFromEvent(e);
  };
  const onPointerMove = (e) => {
    if (draggingRef.current) updateFromEvent(e);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // Cursor position (0° = top, clockwise)
  const sizePct = 100;
  const angleRad = (hsl.h * Math.PI) / 180;
  const radius = (hsl.s / 100) * (sizePct / 2);
  const cursorX = sizePct / 2 + Math.sin(angleRad) * radius;
  const cursorY = sizePct / 2 - Math.cos(angleRad) * radius;

  const currentHex = hslToHex(hsl.h, hsl.s, hsl.l);
  const grayAtL = `hsl(0, 0%, ${hsl.l}%)`;

  const applyHexDraft = () => {
    const normalized = normalizeHex(hexDraft);
    if (normalized) {
      commit(hexToHsl(normalized));
    } else {
      setHexDraft(currentHex);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className="flex items-center gap-3 group"
        >
          <span
            className="block h-10 w-10 rounded-full border-2 border-gray-200/90 transition-transform group-hover:scale-105 dark:border-neutral-800"
            style={{ background: value }}
          />
          <span className="text-left">
            <span className="label-tech block">Color</span>
            <span className="font-mono text-xs uppercase text-slate-500 dark:text-neutral-400">{value}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[260px] border border-gray-200/95 bg-white p-4 text-slate-900 shadow-md dark:border-white/20 dark:bg-zinc-900 dark:text-white"
        style={{ borderRadius: 7 }}
      >
        {/* Wheel */}
        <div
          ref={wheelRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative w-[228px] h-[228px] mx-auto rounded-full cursor-crosshair touch-none select-none"
          style={{
            background:
              "conic-gradient(from 0deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
          }}
        >
          {/* saturation falloff toward the gray at current lightness */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle at center, ${grayAtL} 0%, transparent 70%)`,
            }}
          />
          {/* lightness shade/tint for the saturated ring edge */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none mix-blend-normal"
            style={{
              background:
                hsl.l < 50
                  ? `rgba(0,0,0,${((50 - hsl.l) / 50) * 0.55})`
                  : `rgba(255,255,255,${((hsl.l - 50) / 50) * 0.35})`,
            }}
          />
          {/* cursor */}
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] pointer-events-none"
            style={{
              left: `calc(${cursorX}% - 8px)`,
              top: `calc(${cursorY}% - 8px)`,
              background: currentHex,
            }}
          />
        </div>

        {/* Lightness slider */}
        <div className="mt-4">
          <div className="label-tech mb-2">Lightness</div>
          <input
            type="range"
            min="5"
            max="95"
            value={hsl.l}
            onChange={(e) => commit({ ...hsl, l: Number(e.target.value) })}
            className="w-full h-3 appearance-none rounded-full cursor-pointer"
            style={{
              background: `linear-gradient(to right, hsl(${hsl.h},${hsl.s}%,5%), hsl(${hsl.h},${hsl.s}%,50%), hsl(${hsl.h},${hsl.s}%,95%))`,
            }}
          />
        </div>

        {/* Hex input */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="block h-6 w-6 rounded-[4px] border border-gray-200/90 dark:border-neutral-700"
              style={{ background: currentHex }}
            />
          </div>
          <input
            type="text"
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const normalized = normalizeHex(e.target.value);
              if (normalized) commit(hexToHsl(normalized));
            }}
            onBlur={applyHexDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyHexDraft();
              }
            }}
            placeholder="#RRGGBB"
            spellCheck={false}
            className="h-8 min-h-8 flex-1 rounded-[7px] border border-gray-200/95 bg-white px-2 font-mono text-xs uppercase text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:border-white/20 dark:bg-zinc-900/50 dark:text-white dark:focus:ring-white/20"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
