"""
Transactional email: team invites (magic link) and booking request outcomes (same transport).

Configure one of:
  - Resend: RESEND_API_KEY + INVITE_FROM_EMAIL (e.g. "Studio 7 <bookings@yourdomain.com>")
  - SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, INVITE_FROM_EMAIL

If neither is configured, the API still creates the invite and logs the link (dev/stub behavior).

Edit copy: optional env INVITE_EMAIL_SUBJECT — use placeholders {org}, {inviter}, {inviter_or_team}.
Default invite subject: You're in — {org}.
Logo: INVITE_EMAIL_LOGO_URL, else FRONTEND_URL/brand/logo.png when FRONTEND_URL is not localhost,
else API_PUBLIC_ORIGIN + /api/public/brand-logo.png (serves frontend build/public brand/logo.png).
Header logo links to TRANSACTIONAL_EMAIL_SITE_URL, else FRONTEND_URL (non-local), else https://team.studio7.miami.
Invite magic-link card matches booking emails: off-white panel #FCFCFC, border #212121 @ 7%, CTA pill #F7F7F7 with same border.
Inbox list previews: hidden preheader + short HTML <title>; logo imgs use empty alt (link has aria-label) so snippets lead with real greeting/body, not repeated org names.

Booking outcome copy (accepted / denied) — preview without sending:
  - Swagger: /docs → Authorize (admin JWT) → GET /api/admin/email-preview/booking-decision (fmt=html; decision=approved is the accept path)
  - GET /api/admin/email-preview/new-booking-request?fmt=html for the staff new-request email
  - CLI: cd backend && python3 scripts/preview_booking_emails.py → open email_previews/booking_approved.html / booking_new_request.html
Placeholders {date} use MM-DD-YYYY; {date_pretty} stays a long weekday form.
Default approved subject: You're on the calendar — {calendar}. Default denied: Booking update — {org}.
Accepted and denied HTML use the same card colors and typography; neither includes a CTA button.

New booking request (staff / Seven): sent when a member submits POST /bookings/request if transactional email is configured.
  - Preview: email_previews/booking_new_request.html or GET /api/admin/email-preview/new-booking-request?fmt=html
  - Recipients: NEW_BOOKING_REQUEST_NOTIFY_EMAIL (comma-separated), else PRIMARY_ADMIN_EMAIL / SUPER_ADMIN_EMAIL / seven@studio7.miami
  - Optional: NEW_BOOKING_REQUEST_EMAIL_SUBJECT (placeholders like booking decision), NEW_BOOKING_REQUEST_GREETING_NAME (default Seven)

Booking reminders (~24h and ~2h before start): sent by a background loop when email is configured.
Optional subjects: BOOKING_REMINDER_24H_SUBJECT, BOOKING_REMINDER_2H_SUBJECT (placeholders like booking decision).
Poll interval: BOOKING_REMINDER_POLL_SEC (default 300; 0 disables).
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from typing import Literal, Optional, Tuple


logger = logging.getLogger(__name__)

# Shared look for transactional HTML (many clients ignore <style> blocks).
EMAIL_TEXT = "#161616"
# Booking, invite, reminders: card panel
BOOKING_DECISION_CARD_BG = "#FCFCFC"
BOOKING_DECISION_CARD_BORDER = "rgba(33, 33, 33, 0.07)"  # #212121 @ 7%

_INVITE_EMAIL_MANROPE_HEAD = """    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500&display=swap" rel="stylesheet" />
"""
_INVITE_CTA_FONT_FAMILY = (
    "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

# Bump this when changing invite HTML significantly.
INVITE_EMAIL_TEMPLATE_VERSION = "invite-email-2026-05-09-v5"


def _from_addr() -> str:
    return (os.environ.get("INVITE_FROM_EMAIL") or "").strip().strip('"').strip("'")


def _resend_key() -> str:
    # Strip whitespace/newlines often introduced when pasting keys into .env
    return (os.environ.get("RESEND_API_KEY") or "").strip().strip('"').strip("'")


def _smtp_config() -> Optional[dict]:
    host = (os.environ.get("SMTP_HOST") or "").strip()
    if not host:
        return None
    port_raw = (os.environ.get("SMTP_PORT") or "587").strip()
    try:
        port = int(port_raw)
    except ValueError:
        port = 587
    user = (os.environ.get("SMTP_USER") or "").strip()
    password = (os.environ.get("SMTP_PASSWORD") or "").strip()
    use_tls = (os.environ.get("SMTP_USE_TLS") or "true").lower() in ("1", "true", "yes")
    return {"host": host, "port": port, "user": user, "password": password, "use_tls": use_tls}


def invite_email_delivery_configured() -> bool:
    if not _from_addr():
        return False
    if _resend_key():
        return True
    if _smtp_config():
        return True
    return False


def _frontend_base() -> str:
    return (os.environ.get("FRONTEND_URL") or "http://localhost:3000").rstrip("/")


def _transactional_email_site_url() -> str:
    """HTTPS origin for logo link. Override with TRANSACTIONAL_EMAIL_SITE_URL if needed."""
    raw = (os.environ.get("TRANSACTIONAL_EMAIL_SITE_URL") or "").strip().rstrip("/")
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    fe = _frontend_base().rstrip("/")
    if fe and "localhost" not in fe.lower() and "127.0.0.1" not in fe.lower():
        return fe
    return "https://team.studio7.miami"


def _api_public_origin() -> str:
    for key in ("API_PUBLIC_ORIGIN", "PUBLIC_API_ORIGIN", "RENDER_EXTERNAL_URL"):
        v = (os.environ.get(key) or "").strip().rstrip("/")
        if v:
            return v
    return ""


def resolve_invite_logo_url() -> str:
    raw = (os.environ.get("INVITE_EMAIL_LOGO_URL") or "").strip()
    if raw:
        return raw
    fe = _frontend_base().rstrip("/")
    fe_l = fe.lower()
    # Same asset as production build: /brand/logo.png on the deployed app (Vercel, etc.)
    if fe and "localhost" not in fe_l and "127.0.0.1" not in fe_l:
        return f"{fe}/brand/logo.png"
    origin = _api_public_origin()
    if origin:
        return f"{origin}/api/public/brand-logo.png"
    return f"{fe}/brand/logo.png"


def _logo_dark_variant_url(light_url: str) -> str:
    """Derive dark logo URL from light (https paths, file://, or INVITE_EMAIL_LOGO_URL)."""
    u = light_url or ""
    if "/brand/logo.png" in u:
        return u.replace("/brand/logo.png", "/brand/logo-dark.png")
    if u.endswith("logo.png"):
        return u[: -len("logo.png")] + "logo-dark.png"
    return u


def _format_time_12h(hhmm: str) -> str:
    """Display HH:MM or HH:MM:SS as 12-hour, e.g. 13:00 -> 1:00 PM."""
    s = (hhmm or "").strip()
    if not s:
        return ""
    parts = s.split(":")
    try:
        h = int(parts[0])
        m = int(parts[1][:2]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return hhmm
    ampm = "PM" if h >= 12 else "AM"
    h12 = h % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{m:02d} {ampm}"


def _transactional_email_head(*, page_title_e: str, extra_head: str = "") -> str:
    """Shared <head> for invite + booking outcome emails (logo dark-mode swap). `page_title_e` must be escaped."""
    extra = extra_head.rstrip() + ("\n" if extra_head.strip() else "")
    return f"""  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
{extra}    <style>
      .s7-logo-light {{
        display: block !important;
      }}
      .s7-logo-dark {{
        display: none !important;
        mso-hide: all !important;
      }}
      @media (prefers-color-scheme: dark) {{
        .s7-logo-light {{
          display: none !important;
          mso-hide: all !important;
        }}
        .s7-logo-dark {{
          display: block !important;
        }}
      }}
      [data-ogsc] .s7-logo-light {{
        display: none !important;
        mso-hide: all !important;
      }}
      [data-ogsc] .s7-logo-dark {{
        display: block !important;
      }}
      [data-ogsb] .s7-logo-light {{
        display: none !important;
        mso-hide: all !important;
      }}
      [data-ogsb] .s7-logo-dark {{
        display: block !important;
      }}
    </style>
    <title>{page_title_e}</title>
  </head>"""


def _transactional_email_outer_open() -> str:
    return """  <body style="margin:0;padding:0;background:transparent;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:transparent;">
      <tr>
        <td align="center" style="padding:28px 12px;background:transparent;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:transparent;">
"""


def _transactional_email_outer_close() -> str:
    return """          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _transactional_email_preheader_row(*, text_e: str) -> str:
    """Hidden first row so inbox previews start with real copy (not title + duplicate logo alts). `text_e` must be HTML-escaped."""
    return f"""            <tr>
              <td style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;" aria-hidden="true">
                {text_e}
              </td>
            </tr>
"""


def _transactional_email_logo_row(*, org_name: str) -> str:
    """Logo block; both images use empty alt so inbox previews are not prefixed with duplicate org names. Link keeps aria-label for accessibility."""
    org_raw = (org_name or "").strip() or "Studio 7 Miami"
    aria_label = html.escape(org_raw, quote=True)
    raw_light = resolve_invite_logo_url()
    raw_dark = _logo_dark_variant_url(raw_light)
    logo_src = raw_light.replace("&", "&amp;")
    logo_dark_src = raw_dark.replace("&", "&amp;")
    site = _transactional_email_site_url().replace('"', "%22")
    return f"""            <tr>
              <td align="center" style="padding:0 0 18px;background:transparent;">
                <a href="{site}" aria-label="{aria_label}" style="display:inline-block;text-decoration:none;border:0;" target="_blank" rel="noopener noreferrer">
                  <img
                    src="{logo_src}"
                    alt=""
                    width="150"
                    border="0"
                    class="s7-logo-light"
                    role="presentation"
                    style="display:block;max-width:150px;height:auto;width:100%;"
                  />
                  <img
                    src="{logo_dark_src}"
                    alt=""
                    width="150"
                    border="0"
                    class="s7-logo-dark"
                    aria-hidden="true"
                    role="presentation"
                    style="display:block;max-width:150px;height:auto;width:100%;"
                  />
                </a>
              </td>
            </tr>
"""


def build_invite_email_subject(*, org_name: str, inviter_name: Optional[str] = None) -> str:
    org = (org_name or "Studio 7 Miami").strip() or "Studio 7 Miami"
    inviter_clean = (inviter_name or "").replace("\n", " ").replace("\r", "")[:80]
    subj_tpl = (os.environ.get("INVITE_EMAIL_SUBJECT") or "").strip()
    if subj_tpl:
        return (
            subj_tpl.replace("{org}", org)
            .replace("{inviter}", inviter_clean or "Your team")
            .replace("{inviter_or_team}", inviter_clean or org)
        )[:200]
    return f"You're in — {org}"[:200]


def build_invite_email_html(*, invite_link: str, org_name: str) -> str:
    org_e = html.escape(org_name)
    href = invite_link.replace('"', "%22")
    card_bg = BOOKING_DECISION_CARD_BG
    card_bdr = BOOKING_DECISION_CARD_BORDER
    cta_bg = "#F7F7F7"
    cta_bdr = BOOKING_DECISION_CARD_BORDER
    cta_ff = _INVITE_CTA_FONT_FAMILY
    fg = EMAIL_TEXT
    ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    head = _transactional_email_head(page_title_e=html.escape("Welcome"), extra_head=_INVITE_EMAIL_MANROPE_HEAD)
    preheader_row = _transactional_email_preheader_row(
        text_e=html.escape("Welcome — you've been added to the team calendar. Tap below to set up your account.")
    )
    logo = _transactional_email_logo_row(org_name=org_name)
    return f"""<!DOCTYPE html>
<html lang="en">
{head}
{_transactional_email_outer_open()}{preheader_row}{logo}
            <tr>
              <td
                style="background:{card_bg};border:1px solid {card_bdr};border-radius:12px;padding:28px 22px;color:{fg};font-family:{ff};"
              >
                <p style="margin:0;font-size:22px;line-height:1.2;font-weight:700;color:{fg};">
                  Welcome.
                </p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">
                  You&apos;ve been added to the {org_e} team calendar.
                </p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">
                  This is where you&apos;ll see availability, request time in<br />the space, and stay connected with your bookings.
                </p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">
                  Tap below to set up your account.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0 0;">
                  <tr>
                    <td align="left" style="padding:0 0 14px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" style="margin:0;">
                        <tr>
                          <td
                            style="border:1px solid {cta_bdr};border-radius:7px;background:{cta_bg};"
                          >
                            <a
                              href="{href}"
                              style="display:inline-block;padding:12px 18px;background:{cta_bg};color:{fg};text-decoration:none;border-radius:7px;font-family:{cta_ff};font-size:14px;font-weight:500;letter-spacing:0.2px;"
                            >
                              Accept invite →
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0;">
                      <div style="font-size:12px;line-height:1.5;color:{fg};margin:0;text-align:center;">
                        This link is valid for 7 days and can only be used once.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
{_transactional_email_outer_close()}"""


def _text_body(invite_link: str, org_name: str) -> str:
    return (
        "Welcome.\n\n"
        f"You've been added to the {org_name} team calendar.\n"
        "This is where you'll see availability, request time in\n"
        "the space, and stay connected with your bookings.\n\n"
        "Tap below to set up your account (open this link):\n"
        f"{invite_link}\n\n"
        "This link is valid for 7 days and can only be used once.\n"
    )


async def deliver_html_email(
    *,
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
    bcc: Optional[list[str]] = None,
    attachments: Optional[list[dict]] = None,
) -> Tuple[bool, Optional[str], Optional[str]]:
    """Send arbitrary HTML + plain text via Resend or SMTP (same config as invites)."""
    from_addr = _from_addr()
    if not from_addr:
        return False, "INVITE_FROM_EMAIL is not set", None
    subj = (subject or "Notification").strip()[:200]
    copies = [addr.strip() for addr in (bcc or []) if addr and addr.strip()]
    copies = [addr for addr in copies if addr.lower() != str(to_email or "").strip().lower()]
    files = [item for item in (attachments or []) if item and item.get("content") and item.get("filename")]
    resend = _resend_key()
    if resend:
        try:
            import base64
            import httpx

            payload: dict = {
                "from": from_addr,
                "to": [to_email],
                "subject": subj,
                "html": html_body,
                "text": text_body,
            }
            if copies:
                payload["bcc"] = copies
            if files:
                payload["attachments"] = [
                    {
                        "filename": item["filename"],
                        "content": base64.b64encode(item["content"]).decode("ascii"),
                    }
                    for item in files
                ]
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {resend}", "Content-Type": "application/json"},
                    json=payload,
                )
            if r.status_code not in (200, 201):
                detail = (r.text or "")[:800]
                try:
                    body = r.json()
                    if isinstance(body, dict):
                        if isinstance(body.get("message"), str):
                            detail = body["message"]
                        elif isinstance(body.get("error"), str):
                            detail = body["error"]
                        elif isinstance(body.get("errors"), list) and body["errors"]:
                            detail = str(body["errors"][0])
                except Exception:
                    pass
                logger.warning("Resend transactional email failed: %s %s", r.status_code, detail)
                return False, f"Resend ({r.status_code}): {detail}"[:500], None
            provider_id: Optional[str] = None
            try:
                body = r.json()
                if isinstance(body, dict) and isinstance(body.get("id"), str):
                    provider_id = body["id"]
            except Exception:
                provider_id = None
            return True, None, provider_id
        except Exception as e:
            logger.exception("Resend transactional email error: %s", e)
            return False, f"Could not reach Resend: {type(e).__name__}", None

    smtp = _smtp_config()
    if smtp:

        def _send_sync() -> None:
            msg = EmailMessage()
            msg["Subject"] = subj
            msg["From"] = from_addr
            msg["To"] = to_email
            if copies:
                msg["Bcc"] = ", ".join(copies)
            msg.set_content(text_body)
            msg.add_alternative(html_body, subtype="html")
            for item in files:
                msg.add_attachment(
                    item["content"],
                    maintype="application",
                    subtype="pdf",
                    filename=item["filename"],
                )
            if smtp["port"] == 465:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(smtp["host"], smtp["port"], context=context) as server:
                    if smtp["user"]:
                        server.login(smtp["user"], smtp["password"])
                    server.send_message(msg)
            else:
                with smtplib.SMTP(smtp["host"], smtp["port"]) as server:
                    if smtp["use_tls"]:
                        server.starttls(context=ssl.create_default_context())
                    if smtp["user"]:
                        server.login(smtp["user"], smtp["password"])
                    server.send_message(msg)

        try:
            await asyncio.to_thread(_send_sync)
            return True, None, None
        except Exception as e:
            logger.exception("SMTP transactional email error: %s", e)
            return False, "SMTP send failed", None

    return False, "No email transport configured (set RESEND_API_KEY or SMTP_*)", None


def _booking_pretty_date(date_str: str) -> str:
    s = (date_str or "").strip()
    if not s:
        return ""
    try:
        from datetime import date

        parts = s.split("-")
        if len(parts) >= 3:
            y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
            dt = date(y, m, d)
            return dt.strftime("%a, %b %d, %Y")
    except Exception:
        pass
    return s


def _booking_date_mmddyyyy(date_str: str) -> str:
    """YYYY-MM-DD -> MM-DD-YYYY for email display."""
    s = (date_str or "").strip()
    if not s:
        return ""
    try:
        parts = s.split("-")
        if len(parts) >= 3:
            y, mo, d = int(parts[0]), int(parts[1]), int(parts[2])
            return f"{mo:02d}-{d:02d}-{y}"
    except (ValueError, IndexError):
        pass
    return s


def _booking_email_detail_date(date_iso: str) -> str:
    """YYYY-MM-DD -> 'Tue, May 12' (weekday, month, day; no year)."""
    s = (date_iso or "").strip()
    if not s:
        return ""
    try:
        from datetime import date

        parts = s.split("-")
        if len(parts) >= 3:
            y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
            dt = date(y, m, d)
            return dt.strftime("%a, %b ") + str(d)
    except Exception:
        pass
    return s


def _booking_member_first_name(raw: Optional[str]) -> str:
    s = (raw or "").strip()
    if not s:
        return "there"
    return s.split()[0]


def _apply_booking_decision_template(
    template: str,
    *,
    calendar_name: str,
    org: str,
    date_iso: str,
    start_time: str,
    end_time: str,
    member_display: str = "",
    max_len: Optional[int] = None,
) -> str:
    raw = (template or "").replace("\r\n", "\n")
    date_us = _booking_date_mmddyyyy(date_iso)
    out = (
        raw.replace("{calendar}", calendar_name)
        .replace("{org}", org)
        .replace("{date}", date_us)
        .replace("{date_pretty}", _booking_pretty_date(date_iso))
        .replace("{start_time}", start_time)
        .replace("{end_time}", end_time)
        .replace("{member}", member_display)
    )
    if max_len is not None and len(out) > max_len:
        return out[:max_len]
    return out


def build_booking_decision_bodies(
    *,
    decision: Literal["approved", "denied"],
    calendar_name: str,
    date_str: str,
    start_time: str,
    end_time: str,
    optional_message: str,
    calendar_app_url: str,
    member_name: Optional[str] = None,
) -> Tuple[str, str, str]:
    org = (os.environ.get("INVITE_EMAIL_ORG_NAME") or "Studio 7 Miami").strip()
    member_display = _booking_member_first_name(member_name)
    start_12 = _format_time_12h(start_time)
    end_12 = _format_time_12h(end_time)
    subj_tpl_ap = (os.environ.get("BOOKING_APPROVED_EMAIL_SUBJECT") or "").strip()
    subj_tpl_dn = (os.environ.get("BOOKING_DENIED_EMAIL_SUBJECT") or "").strip()
    lead_tpl_ap = (os.environ.get("BOOKING_APPROVED_EMAIL_LEAD") or "").strip()
    lead_tpl_dn = (os.environ.get("BOOKING_DENIED_EMAIL_LEAD") or "").strip()

    cn = html.escape(calendar_name)
    st = html.escape(start_12)
    et = html.escape(end_12)
    msg = (optional_message or "").strip().replace("\r", "")
    msg_e = html.escape(msg) if msg else ""

    if decision == "approved":
        subject = (
            _apply_booking_decision_template(
                subj_tpl_ap,
                calendar_name=calendar_name,
                org=org,
                date_iso=date_str,
                start_time=start_12,
                end_time=end_12,
                member_display=member_display,
                max_len=200,
            )
            if subj_tpl_ap
            else f"You're on the calendar — {calendar_name}"[:200]
        )
        lead_plain = (
            _apply_booking_decision_template(
                lead_tpl_ap,
                calendar_name=calendar_name,
                org=org,
                date_iso=date_str,
                start_time=start_12,
                end_time=end_12,
                member_display=member_display,
            )
            if lead_tpl_ap
            else ""
        )
    else:
        subject = (
            _apply_booking_decision_template(
                subj_tpl_dn,
                calendar_name=calendar_name,
                org=org,
                date_iso=date_str,
                start_time=start_12,
                end_time=end_12,
                member_display=member_display,
                max_len=200,
            )
            if subj_tpl_dn
            else f"Booking update — {org}"[:200]
        )
        lead_plain = (
            _apply_booking_decision_template(
                lead_tpl_dn,
                calendar_name=calendar_name,
                org=org,
                date_iso=date_str,
                start_time=start_12,
                end_time=end_12,
                member_display=member_display,
            )
            if lead_tpl_dn
            else ""
        )

    lead_html = "<br />".join(html.escape(p) for p in (lead_plain or "").split("\n"))
    card_bg = BOOKING_DECISION_CARD_BG
    card_bdr = BOOKING_DECISION_CARD_BORDER
    fg = EMAIL_TEXT
    ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

    if decision == "approved":
        detail_dt = _booking_email_detail_date(date_str)
        detail_dt_e = html.escape(detail_dt)
        lead_extra = ""
        if lead_html:
            lead_extra = f'                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{lead_html}</p>\n'
        msg_p = (
            f'                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{msg_e}</p>\n'
            if msg_e
            else ""
        )
        card_main = f"""                <p style="margin:0;font-size:15px;line-height:1.5;color:{fg};">{html.escape(f"Hey {member_display}")} —</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">Your booking has been confirmed.</p>
{lead_extra}                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{cn} · {detail_dt_e} · {st}–{et}</p>
{msg_p}                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">See you in the space.</p>
"""
    else:
        detail_dt = _booking_email_detail_date(date_str)
        detail_dt_e = html.escape(detail_dt)
        lead_extra = ""
        if lead_html:
            lead_extra = f'                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{lead_html}</p>\n'
        msg_p = (
            f'                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{msg_e}</p>\n'
            if msg_e
            else ""
        )
        card_main = f"""                <p style="margin:0;font-size:15px;line-height:1.5;color:{fg};">{html.escape(f"Hey {member_display}")} —</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{html.escape("This one couldn't be locked in this time.")}</p>
{lead_extra}                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{cn} · {detail_dt_e} · {st}–{et}</p>
{msg_p}                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">Feel free to check the calendar for another time that works.</p>
"""

    if decision == "approved":
        head_title = html.escape("Booking confirmed")
        preheader_plain = f"Hey {member_display} — Your booking has been confirmed."
    else:
        head_title = html.escape("Booking update")
        preheader_plain = f"Hey {member_display} — This one couldn't be locked in this time."
    head = _transactional_email_head(page_title_e=head_title)
    preheader_row = _transactional_email_preheader_row(text_e=html.escape(preheader_plain))
    logo = _transactional_email_logo_row(org_name=org)
    html_body = f"""<!DOCTYPE html>
<html lang="en">
{head}
{_transactional_email_outer_open()}{preheader_row}{logo}
            <tr>
              <td style="background:{card_bg};border:1px solid {card_bdr};border-radius:12px;padding:28px 22px;color:{fg};font-family:{ff};">
                {card_main}
              </td>
            </tr>
{_transactional_email_outer_close()}"""
    if decision == "approved":
        detail_dt = _booking_email_detail_date(date_str)
        lines = [
            f"Hey {member_display} —",
            "",
            "Your booking has been confirmed.",
            "",
        ]
        if lead_plain.strip():
            lines.append(lead_plain)
            lines.append("")
        lines.append(f"{calendar_name} · {detail_dt} · {start_12}–{end_12}")
        lines.append("")
        if msg:
            lines.append(msg)
            lines.append("")
        lines.append("See you in the space.")
        lines.append("")
    else:
        lines = [
            f"Hey {member_display} —",
            "",
            "This one couldn't be locked in this time.",
            "",
        ]
        if lead_plain.strip():
            lines.append(lead_plain)
            lines.append("")
        detail_dt = _booking_email_detail_date(date_str)
        lines.append(f"{calendar_name} · {detail_dt} · {start_12}–{end_12}")
        lines.append("")
        if msg:
            lines.append(msg)
            lines.append("")
        lines.append("Feel free to check the calendar for another time that works.")
        lines.append("")
    lines.append(calendar_app_url)
    text_body = "\n".join(lines)
    return subject, html_body, text_body


def build_new_booking_request_staff_bodies(
    *,
    member_name: str,
    calendar_name: str,
    date_str: str,
    start_time: str,
    end_time: str,
    notes: str,
    review_url: str,
) -> Tuple[str, str, str]:
    """HTML/text for notifying staff (e.g. Seven) that a member submitted a booking request."""
    org = (os.environ.get("INVITE_EMAIL_ORG_NAME") or "Studio 7 Miami").strip()
    greet_raw = (os.environ.get("NEW_BOOKING_REQUEST_GREETING_NAME") or "Seven").strip() or "Seven"
    subj_tpl = (os.environ.get("NEW_BOOKING_REQUEST_EMAIL_SUBJECT") or "").strip()
    member_full = (member_name or "").strip() or "Member"
    start_12 = _format_time_12h(start_time)
    end_12 = _format_time_12h(end_time)
    detail_dt = _booking_email_detail_date(date_str)
    detail_line_plain = f"{member_full} · {calendar_name} · {detail_dt} · {start_12}–{end_12}"

    if subj_tpl:
        subject = _apply_booking_decision_template(
            subj_tpl,
            calendar_name=calendar_name,
            org=org,
            date_iso=date_str,
            start_time=start_12,
            end_time=end_12,
            member_display=member_full,
            max_len=200,
        )
    else:
        subject = f"New booking request — {org}"[:200]

    notes_plain = (notes or "").strip().replace("\r", "")
    notes_e = html.escape(notes_plain) if notes_plain else ""
    greet_e = html.escape(greet_raw)
    line_e = html.escape(detail_line_plain)
    href = (review_url or "").strip().replace('"', "%22")

    card_bg = BOOKING_DECISION_CARD_BG
    card_bdr = BOOKING_DECISION_CARD_BORDER
    cta_bg = "#F7F7F7"
    cta_bdr = BOOKING_DECISION_CARD_BORDER
    cta_ff = _INVITE_CTA_FONT_FAMILY
    fg = EMAIL_TEXT
    ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

    notes_html = ""
    if notes_e:
        notes_html = f'                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">&ldquo;{notes_e}&rdquo;</p>\n'

    card_main = f"""                <p style="margin:0;font-size:15px;line-height:1.5;color:{fg};">Hey {greet_e} —</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">You have a new booking request.</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{line_e}</p>
{notes_html}                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">Open the app to approve or deny.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0 0;">
                  <tr>
                    <td align="left" style="padding:0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" style="margin:0;">
                        <tr>
                          <td style="border:1px solid {cta_bdr};border-radius:7px;background:{cta_bg};">
                            <a
                              href="{href}"
                              style="display:inline-block;padding:12px 18px;background:{cta_bg};color:{fg};text-decoration:none;border-radius:7px;font-family:{cta_ff};font-size:14px;font-weight:500;letter-spacing:0.2px;"
                            >
                              Review request →
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
"""

    head_title = html.escape("New booking request")
    head = _transactional_email_head(page_title_e=head_title)
    preheader_plain = f"Hey {greet_raw} — You have a new booking request."
    preheader_row = _transactional_email_preheader_row(text_e=html.escape(preheader_plain))
    logo = _transactional_email_logo_row(org_name=org)
    html_body = f"""<!DOCTYPE html>
<html lang="en">
{head}
{_transactional_email_outer_open()}{preheader_row}{logo}
            <tr>
              <td style="background:{card_bg};border:1px solid {card_bdr};border-radius:12px;padding:28px 22px;color:{fg};font-family:{ff};">
                {card_main}
              </td>
            </tr>
{_transactional_email_outer_close()}"""

    text_lines = [
        f"Hey {greet_raw} —",
        "",
        "You have a new booking request.",
        "",
        detail_line_plain,
        "",
    ]
    if notes_plain:
        text_lines.append(f'"{notes_plain}"')
        text_lines.append("")
    text_lines.append("Open the app to approve or deny.")
    text_lines.append("")
    text_lines.append(review_url.strip())
    text_body = "\n".join(text_lines)
    return subject, html_body, text_body


def build_booking_reminder_bodies(
    *,
    kind: Literal["24h", "2h"],
    calendar_name: str,
    date_str: str,
    start_time: str,
    end_time: str,
    member_name: Optional[str] = None,
) -> Tuple[str, str, str]:
    """HTML/text for ~24h or ~2h pre-booking reminders; same card chrome as booking decision emails."""
    org = (os.environ.get("INVITE_EMAIL_ORG_NAME") or "Studio 7 Miami").strip()
    member_display = _booking_member_first_name(member_name)
    start_12 = _format_time_12h(start_time)
    end_12 = _format_time_12h(end_time)
    subj_24 = (os.environ.get("BOOKING_REMINDER_24H_SUBJECT") or "").strip()
    subj_2 = (os.environ.get("BOOKING_REMINDER_2H_SUBJECT") or "").strip()

    cn = html.escape(calendar_name)
    detail_dt = _booking_email_detail_date(date_str)
    detail_dt_e = html.escape(detail_dt)
    st = html.escape(start_12)
    et = html.escape(end_12)
    card_bg = BOOKING_DECISION_CARD_BG
    card_bdr = BOOKING_DECISION_CARD_BORDER
    fg = EMAIL_TEXT
    ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

    if kind == "24h":
        subject = (
            _apply_booking_decision_template(
                subj_24,
                calendar_name=calendar_name,
                org=org,
                date_iso=date_str,
                start_time=start_12,
                end_time=end_12,
                member_display=member_display,
                max_len=200,
            )
            if subj_24
            else f"Tomorrow @ {org}"[:200]
        )
        card_main = f"""                <p style="margin:0;font-size:15px;line-height:1.5;color:{fg};">{html.escape(f"Hey {member_display}")} —</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{html.escape("You're booked for tomorrow.")}</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{cn} · {detail_dt_e} · {st}–{et}</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">See you then.</p>
"""
        lines = [
            f"Hey {member_display} —",
            "",
            "You're booked for tomorrow.",
            "",
            f"{calendar_name} · {detail_dt} · {start_12}–{end_12}",
            "",
            "See you then.",
            "",
        ]
        preheader_plain = f"Hey {member_display} — You're booked for tomorrow."
    else:
        subject = (
            _apply_booking_decision_template(
                subj_2,
                calendar_name=calendar_name,
                org=org,
                date_iso=date_str,
                start_time=start_12,
                end_time=end_12,
                member_display=member_display,
                max_len=200,
            )
            if subj_2
            else f"You're up in 2 hours — {org}"[:200]
        )
        line2_plain = "Your time at the studio starts in 2 hours."
        card_main = f"""                <p style="margin:0;font-size:15px;line-height:1.5;color:{fg};">{html.escape(f"Hey {member_display}")} —</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{html.escape(line2_plain)}</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">{cn} · {st}–{et}</p>
                <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:{fg};">See you soon.</p>
"""
        lines = [
            f"Hey {member_display} —",
            "",
            line2_plain,
            "",
            f"{calendar_name} · {start_12}–{end_12}",
            "",
            "See you soon.",
            "",
        ]
        preheader_plain = f"Hey {member_display} — Your time at the studio starts in 2 hours."

    head = _transactional_email_head(page_title_e=html.escape("Booking reminder"))
    preheader_row = _transactional_email_preheader_row(text_e=html.escape(preheader_plain))
    logo = _transactional_email_logo_row(org_name=org)
    html_body = f"""<!DOCTYPE html>
<html lang="en">
{head}
{_transactional_email_outer_open()}{preheader_row}{logo}
            <tr>
              <td style="background:{card_bg};border:1px solid {card_bdr};border-radius:12px;padding:28px 22px;color:{fg};font-family:{ff};">
                {card_main}
              </td>
            </tr>
{_transactional_email_outer_close()}"""
    text_body = "\n".join(lines)
    return subject, html_body, text_body


async def send_booking_reminder_email(
    *,
    to_email: str,
    kind: Literal["24h", "2h"],
    calendar_name: str,
    date_str: str,
    start_time: str,
    end_time: str,
    member_name: Optional[str] = None,
) -> Tuple[bool, Optional[str], Optional[str]]:
    subject, html_body, text_body = build_booking_reminder_bodies(
        kind=kind,
        calendar_name=calendar_name,
        date_str=date_str,
        start_time=start_time,
        end_time=end_time,
        member_name=member_name,
    )
    return await deliver_html_email(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )


async def send_booking_decision_email(
    *,
    to_email: str,
    decision: Literal["approved", "denied"],
    calendar_name: str,
    date_str: str,
    start_time: str,
    end_time: str,
    optional_message: str,
    calendar_app_url: str,
    member_name: Optional[str] = None,
) -> Tuple[bool, Optional[str], Optional[str]]:
    subject, html_body, text_body = build_booking_decision_bodies(
        decision=decision,
        calendar_name=calendar_name,
        date_str=date_str,
        start_time=start_time,
        end_time=end_time,
        optional_message=optional_message,
        calendar_app_url=calendar_app_url,
        member_name=member_name,
    )
    return await deliver_html_email(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )


async def send_new_booking_request_staff_email(
    *,
    to_email: str,
    member_name: str,
    calendar_name: str,
    date_str: str,
    start_time: str,
    end_time: str,
    notes: str,
    review_url: str,
) -> Tuple[bool, Optional[str], Optional[str]]:
    subject, html_body, text_body = build_new_booking_request_staff_bodies(
        member_name=member_name,
        calendar_name=calendar_name,
        date_str=date_str,
        start_time=start_time,
        end_time=end_time,
        notes=notes,
        review_url=review_url,
    )
    return await deliver_html_email(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )


async def send_invite_magic_link(
    *,
    to_email: str,
    invite_link: str,
    inviter_name: Optional[str] = None,
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Returns (delivered, error_message, provider_message_id). On failure the caller should still keep the invite;
    error_message is safe to log or return to the client as a non-secret hint.
    """
    org = (os.environ.get("INVITE_EMAIL_ORG_NAME") or "Studio 7 Miami").strip()
    subject = build_invite_email_subject(org_name=org, inviter_name=inviter_name)
    logo_u = resolve_invite_logo_url()
    if "localhost" in logo_u.lower() or "127.0.0.1" in logo_u:
        logger.warning(
            "Invite email logo may not load in real inboxes (%s). Set API_PUBLIC_ORIGIN, RENDER_EXTERNAL_URL, or INVITE_EMAIL_LOGO_URL.",
            logo_u,
        )
    html_body = build_invite_email_html(invite_link=invite_link, org_name=org)
    text_body = _text_body(invite_link, org)
    return await deliver_html_email(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )
