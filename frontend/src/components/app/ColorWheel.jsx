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

export default function ColorWheel({ value, onChange, testId }) {
  const [hsl, setHsl] = useState(() => hexToHsl(value));
  const wheelRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    setHsl(hexToHsl(value));
  }, [value]);

  const commit = (next) => {
    setHsl(next);
    onChange?.(hslToHex(next.h, next.s, next.l));
  };

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
    // angle: 0 = right, grow counterclockwise; convert to CSS hue (0 red at right when using hsl)
    let angle = Math.atan2(y, x) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    const h = Math.round(angle);
    const s = Math.round((dist / r) * 100);
    commit({ ...hsl, h, s });
  };

  const onPointerDown = (e) => {
    draggingRef.current = true;
    updateFromEvent(e);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };
  const onPointerMove = (e) => {
    if (draggingRef.current) updateFromEvent(e);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  // Cursor position on wheel
  const sizePct = 100;
  const angleRad = (hsl.h * Math.PI) / 180;
  const radius = (hsl.s / 100) * (sizePct / 2);
  const cursorX = sizePct / 2 + Math.cos(angleRad) * radius;
  const cursorY = sizePct / 2 + Math.sin(angleRad) * radius;

  const currentHex = hslToHex(hsl.h, hsl.s, hsl.l);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className="flex items-center gap-3 group"
        >
          <span
            className="block w-10 h-10 rounded-full border-2 border-neutral-800 transition-transform group-hover:scale-105"
            style={{ background: value }}
          />
          <span className="text-left">
            <span className="label-tech block">Color</span>
            <span className="font-mono text-xs text-neutral-400 uppercase">{value}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="bg-[#0F0F11] border-neutral-800 text-white p-4 w-[260px]"
      >
        {/* Wheel */}
        <div
          ref={wheelRef}
          onPointerDown={onPointerDown}
          className="relative w-[228px] h-[228px] mx-auto rounded-full cursor-crosshair touch-none select-none"
          style={{
            background:
              "conic-gradient(from 0deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
          }}
        >
          {/* saturation falloff */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
          />
          {/* lightness overlay (darkens or lightens wheel preview) */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: hsl.l < 50 ? `rgba(0,0,0,${(50 - hsl.l) / 50 * 0.6})` : `rgba(255,255,255,${(hsl.l - 50) / 50 * 0.4})`,
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

        {/* Hex display + presets */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="block w-6 h-6 rounded-sm border border-neutral-700" style={{ background: currentHex }} />
            <span className="font-mono text-xs uppercase">{currentHex}</span>
          </div>
          <input
            type="text"
            value={currentHex}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#?[0-9a-f]{6}$/i.test(v)) {
                const next = hexToHsl(v.startsWith("#") ? v : `#${v}`);
                commit(next);
              }
            }}
            className="w-24 bg-[#121214] border border-neutral-800 h-7 px-2 font-mono text-xs uppercase focus:outline-none focus:ring-1 focus:ring-white rounded-sm"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
