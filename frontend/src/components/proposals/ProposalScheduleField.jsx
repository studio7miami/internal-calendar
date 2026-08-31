import React from "react";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Calendar } from "../ui/calendar";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "@/lib/utils";

const calendarClassNames = {
  day_selected:
    "bg-slate-900 text-white hover:bg-slate-900 hover:text-white focus:bg-slate-900 focus:text-white dark:bg-white dark:text-zinc-900 dark:hover:bg-white dark:hover:text-zinc-900 dark:focus:bg-white dark:focus:text-zinc-900",
  day_today: "bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white",
};

const popoverSurfaceClass =
  "z-[100] w-auto rounded-[7px] border border-gray-200/95 bg-white p-3 text-slate-900 shadow-md dark:border-white/20 dark:bg-zinc-900 dark:text-white";

function parseDateValue(value) {
  const iso = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDisplayDate(value) {
  const date = parseDateValue(value);
  if (!date) return null;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDisplayTime(value) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function ProposalDateField({ label, value = "", onChange, disabled = false }) {
  const selected = parseDateValue(value);
  return (
    <label className="pb-field">
      <span>{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn("pb-date-trigger", !value && "pb-date-trigger--empty")}
            aria-label={value ? `Session date: ${formatDisplayDate(value)}` : "Select session date"}
          >
            <span>{formatDisplayDate(value) || "Select a date"}</span>
            <CalendarIcon aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {disabled ? null : (
        <PopoverContent className={cn(popoverSurfaceClass, "p-0")} sideOffset={6} align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (!date) return;
              onChange(toIsoDate(date));
            }}
            initialFocus
            classNames={calendarClassNames}
          />
        </PopoverContent>
        )}
      </Popover>
    </label>
  );
}

export function ProposalTimeField({ label, value = "", onChange, disabled = false }) {
  return (
    <label className="pb-field">
      <span>{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn("pb-date-trigger pb-time-trigger", !value && "pb-date-trigger--empty")}
            aria-label={value ? `Start time: ${formatDisplayTime(value)}` : "Select start time"}
          >
            <span>{formatDisplayTime(value) || "Select a time"}</span>
            <Clock aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {disabled ? null : (
        <PopoverContent className={popoverSurfaceClass} sideOffset={6} align="start">
          <Input
            type="time"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
            className={cn(
              "h-10 w-full min-w-[220px] rounded-[7px] border border-gray-200/95 bg-white px-3 text-sm text-slate-900 shadow-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/30",
              "dark:border-white/20 dark:bg-zinc-900/50 dark:text-white dark:focus-visible:ring-white/20"
            )}
          />
        </PopoverContent>
        )}
      </Popover>
    </label>
  );
}
