import React, { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { MessageSquare, X, Sparkles, Send } from "lucide-react";

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
          text: `${greetingForNow(user.name)}\n\nAsk me anything about the schedule — availability, who's booked when, today's slots, etc.`,
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
          className="fixed bottom-24 md:bottom-6 left-4 md:left-6 z-40 flex items-center gap-2 bg-white text-black hover:bg-neutral-200 h-11 px-4 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.4)] font-medium transition-transform hover:-translate-y-0.5"
        >
          <Sparkles className="w-4 h-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">Ask Studio 7</span>
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-24 md:bottom-6 left-4 md:left-6 z-40 w-[min(92vw,360px)] h-[min(70vh,520px)] bg-[#0F0F11] border border-neutral-800 rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
          data-testid="chatbot-panel"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-900">
            <div className="flex items-center gap-2">
              <span className="block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="label-tech">Studio 7 · Assistant</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                data-testid="chatbot-model-select"
                className="bg-[#121214] border border-neutral-800 rounded-sm text-[10px] font-mono uppercase px-1 py-0.5"
                title="Model"
              >
                <option value="claude">Claude</option>
                <option value="gpt">GPT</option>
              </select>
              <button
                type="button"
                onClick={() => setOpen(false)}
                data-testid="chatbot-close-button"
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap text-sm px-3 py-2 rounded-lg ${
                    m.role === "user"
                      ? "bg-white text-black rounded-br-sm"
                      : "bg-neutral-900 text-neutral-100 rounded-bl-sm"
                  }`}
                  data-testid={`chatbot-message-${m.role}-${i}`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-neutral-900 text-neutral-400 text-sm px-3 py-2 rounded-lg">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={send}
            className="flex items-center gap-2 border-t border-neutral-900 p-3"
          >
            <input
              type="text"
              placeholder="Ask about the schedule…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              data-testid="chatbot-input"
              className="flex-1 bg-[#121214] border border-neutral-800 h-9 px-3 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-white"
            />
            <button
              type="submit"
              disabled={sending}
              data-testid="chatbot-send-button"
              className="bg-white text-black hover:bg-neutral-200 h-9 w-9 flex items-center justify-center rounded-sm disabled:opacity-50"
            >
              <Send className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
