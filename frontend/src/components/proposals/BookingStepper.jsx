import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export default function BookingStepper({ step, steps, onSelect }) {
  const total = steps.length;
  const complete = step > total;
  const current = complete ? { label: "Confirmed" } : steps[Math.min(Math.max(step, 1), total) - 1];
  const pct = complete ? 100 : Math.round(((step - 1) / (total - 1)) * 100);

  return (
    <div
      className="min-w-0 flex-1"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step}
      aria-label={`${current.label}, step ${step} of ${total}`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-[8%] top-1/2 h-px -translate-y-1/2 bg-[var(--line)]" />
          <div
            className="absolute left-[8%] top-1/2 h-px -translate-y-1/2 bg-[var(--ink)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `calc(84% * ${pct} / 100)` }}
          />
          <ol className={cn("relative grid", total === 4 ? "grid-cols-4" : total === 3 ? "grid-cols-3" : "grid-cols-5")}>
            {steps.map((item) => {
              const done = complete || item.step < step;
              const active = !complete && item.step === step;
              const canSelect = Boolean(onSelect) && done;
              return (
                <li key={item.step} className="flex justify-center">
                  <span
                    className={cn(
                      "flex size-3.5 items-center justify-center rounded-full border transition-colors duration-300 ease-out motion-reduce:transition-none sm:size-4",
                      done || active
                        ? "border-[var(--ink)] bg-[var(--ink)]"
                        : "border-[var(--line)] bg-background",
                      canSelect && "cursor-pointer",
                    )}
                    role={canSelect ? "button" : undefined}
                    tabIndex={canSelect ? 0 : undefined}
                    onClick={canSelect ? () => onSelect(item.step) : undefined}
                    onKeyDown={canSelect ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(item.step);
                      }
                    } : undefined}
                  >
                    {done ? (
                      <Check className="size-2 text-background sm:size-2.5" aria-hidden="true" />
                    ) : active ? (
                      <span className="size-1 rounded-full bg-background" />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <span className="label-caps hidden shrink-0 text-[9px] text-muted-foreground sm:inline">
          {current.label}
        </span>
      </div>
    </div>
  );
}
