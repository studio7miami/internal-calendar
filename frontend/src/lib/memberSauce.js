/** Values stored on `users.sauce` (signup + directory). Must match backend `ALLOWED_SAUCES`. */

export const SAUCE_OPTIONS = [
  { value: "photography", label: "Photography" },
  { value: "videography", label: "Videography" },
  { value: "artist", label: "Artist" },
  { value: "filmmaker", label: "Filmmaker" },
  { value: "model", label: "Model" },
];

const SAUCE_LABEL = Object.fromEntries(SAUCE_OPTIONS.map((o) => [o.value, o.label]));

export function formatSauceLabel(sauce) {
  const raw = sauce == null ? "" : String(sauce).trim();
  if (!raw) return "—";
  const key = raw.toLowerCase();
  return SAUCE_LABEL[key] || raw;
}
