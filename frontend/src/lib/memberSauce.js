/** Values stored on `users.sauce` (signup + directory). */

export const SAUCE_OPTIONS = [
  { value: "model", label: "Model" },
  { value: "artist", label: "Artist" },
  { value: "filmmaker", label: "Filmmaker" },
  { value: "photography", label: "Photography" },
  { value: "videography", label: "Videography" },
  { value: "content_creator", label: "Content Creator" },
];

const SAUCE_LABEL = Object.fromEntries(SAUCE_OPTIONS.map((o) => [o.value, o.label]));

export function formatSauceLabel(sauce) {
  if (!sauce) return "—";
  return SAUCE_LABEL[sauce] || sauce;
}
