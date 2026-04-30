import React, { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { X, Sparkles, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const r7 = "rounded-[7px]";

/** Match BookingForm `calSurface` + fields */
const chatPanelSurface =
  "border border-gray-200/95 bg-[#FAFAFA] text-slate-900 shadow-lg dark:border-white/70 dark:bg-zinc-950 dark:text-white";

const chatFieldClass =
  "h-10 min-h-0 w-full min-w-0 flex-1 px-3 text-sm text-slate-900 placeholder:text-slate-400 " +
  "border border-gray-200/95 bg-white dark:border-white/20 dark:bg-zinc-900/50 dark:text-white dark:placeholder:text-neutral-500 " +
  `${r7} focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:focus:ring-white/20`;

const PALM_IMG_SRC = ["/brand/concierge-palm.png", "/brand/concierge-palm.svg"];

/** Palm mark: prefers your transparent PNG if present, else bundled SVG (transparent). */
function ConciergePalmMark({ className }) {
  const [tier, setTier] = useState(0);
  if (tier >= PALM_IMG_SRC.length) {
    return (
      <span className={cn("inline-flex h-9 w-9 items-center justify-center text-slate-900 dark:text-zinc-100", className)} aria-hidden>
        <Sparkles className="h-5 w-5 opacity-70" strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <img
      src={PALM_IMG_SRC[tier]}
      alt=""
      width={36}
      height={42}
      onError={() => setTier((t) => t + 1)}
      className={cn(
        "h-9 w-auto max-h-9 max-w-[2.25rem] shrink-0 object-contain opacity-90 dark:brightness-0 dark:invert",
        className
      )}
    />
  );
}

function greetingForNow(name) {
  const h = new Date().getHours();
  let g;
  if (h < 5) g = "Peace"; // very late / early morning
  else if (h < 12) g = "Greetings";
  else if (h < 17) g = "Afternoon";
  else if (h < 21) g = "Evening";
  else g = "Peace";
  return `${g}, ${name?.split(" ")[0] || "friend"}.`;
}

export default function ChatBot() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState("claude"); // claude | gpt
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open && msgs.length === 0 && user) {
      setMsgs([
        {
          role: "assistant",
          text: greetingForNow(user.name),
        },
      ]);
    }
  }, [open, user, msgs.length]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open]);

  const send = async (e) => {
    e?.preventDefault?.();
    const text = input.trim();
    if (!text || sending) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const { data } = await api.post("/chat", { message: text, model });
      setMsgs((m) => [...m, { role: "assistant", text: data.reply || "(empty reply)" }]);
    } catch (err) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: `Error: ${formatApiError(err?.response?.data?.detail) || err.message}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="chatbot-open-button"
          aria-label="Open Concierge"
          className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-[0_12px_40px_rgba(0,0,0,0.12)] transition-transform hover:scale-110 hover:bg-neutral-100 chat-float dark:shadow-[0_12px_40px_rgba(255,255,255,0.12)]"
        >
          <span className="absolute inset-0 rounded-full chat-pulse-ring pointer-events-none" />
          <Sparkles className="w-5 h-5 relative z-10" strokeWidth={1.8} />
        </button>
      )}

      {open && (
        <div
          className={cn(
            "fixed bottom-24 md:bottom-20 right-4 md:right-6 z-40 flex h-[min(70vh,520px)] w-[min(92vw,360px)] flex-col overflow-hidden",
            r7,
            chatPanelSurface
          )}
          data-testid="chatbot-panel"
        >
          <div className="flex items-center justify-between gap-3 border-b border-gray-200/95 px-4 py-3 dark:border-white/10">
            <div className="min-w-0 flex-1 pr-2">
              <p className="label-tech tracking-[0.2em] text-slate-500 dark:text-zinc-500">Concierge</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ConciergePalmMark />
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                data-testid="chatbot-model-select"
                className={cn(
                  "h-8 border border-gray-200/95 bg-white px-1.5 text-[10px] font-medium uppercase text-slate-600",
                  "dark:border-white/20 dark:bg-zinc-900/50 dark:text-zinc-300",
                  r7
                )}
                title="Model"
              >
                <option value="claude">Claude</option>
                <option value="gpt">GPT</option>
              </select>
              <button
                type="button"
                onClick={() => setOpen(false)}
                data-testid="chatbot-close-button"
                className="flex h-8 w-8 items-center justify-center rounded-[7px] text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto bg-[#FAFAFA] px-3 py-3 dark:bg-zinc-950">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap px-3 py-2 text-sm",
                    r7,
                    m.role === "user"
                      ? "border border-gray-200/95 bg-white/90 text-slate-900 dark:border-white/20 dark:bg-zinc-900/30 dark:text-white"
                      : "border border-gray-200/80 bg-white text-slate-800 dark:border-white/10 dark:bg-zinc-900/50 dark:text-zinc-200"
                  )}
                  data-testid={`chatbot-message-${m.role}-${i}`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div
                  className={cn(
                    "border border-gray-200/80 bg-white px-3 py-2 text-sm text-slate-500",
                    "dark:border-white/10 dark:bg-zinc-900/50 dark:text-zinc-400",
                    r7
                  )}
                >
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={send}
            className="flex items-center gap-2 border-t border-gray-200/95 bg-[#FAFAFA] p-3 dark:border-white/10 dark:bg-zinc-950"
          >
            <input
              type="text"
              placeholder="Ask about the schedule…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              data-testid="chatbot-input"
              className={cn(chatFieldClass, "h-9")}
            />
            <button
              type="submit"
              disabled={sending}
              data-testid="chatbot-send-button"
              className={cn(
                "box-border flex h-9 w-9 flex-shrink-0 items-center justify-center border",
                "border-gray-200/95 bg-white/90 text-slate-900 hover:bg-slate-100",
                "dark:border-white/20 dark:bg-zinc-900/30 dark:text-white dark:hover:bg-zinc-800",
                "disabled:opacity-50",
                r7
              )}
            >
              <Send className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </form>
          <div className="border-t border-gray-200/95 bg-[#FAFAFA] px-3 py-2 text-center dark:border-white/10 dark:bg-zinc-950">
            <p className="label-tech tracking-[0.2em] text-slate-500 dark:text-zinc-500">STUDIO 7 MIAMI</p>
          </div>
        </div>
      )}
    </>
  );
}
