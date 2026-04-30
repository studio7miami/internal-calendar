/** Single designated administrator (env must match server `PRIMARY_ADMIN_EMAIL`). */
const DEFAULT = "seven@studio7.miami";

export function primaryAdminEmail() {
  return (process.env.REACT_APP_PRIMARY_ADMIN_EMAIL || DEFAULT).trim().toLowerCase();
}

export function isPrimaryAdminEmail(email) {
  if (!email || typeof email !== "string") return false;
  return email.trim().toLowerCase() === primaryAdminEmail();
}
