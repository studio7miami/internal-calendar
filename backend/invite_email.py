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

import httpx

logger = logging.getLogger(__name__)

# Shared look for invite + booking transactional HTML (many clients ignore <style> blocks).
EMAIL_PAGE_BG = "#161616"
EMAIL_TEXT = "#F7F7F7"
EMAIL_CARD_BORDER = "#2a2a2a"


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
    logo_src = resolve_invite_logo_url().replace("&", "&amp;")
    logo_dark_src = logo_src.replace("/brand/logo.png", "/brand/logo-dark.png")
    bg = EMAIL_PAGE_BG
    fg = EMAIL_TEXT
    bdr = EMAIL_CARD_BORDER
    ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <style>
      .s7-logo-dark {{
        display: none !important;
        mso-hide: all !important;
      }}
      .s7-footer {{
        color: #161616 !important;
      }}
      @media (prefers-color-scheme: dark) {{
        .s7-logo-light {{
          display: none !important;
          mso-hide: all !important;
        }}
        .s7-logo-dark {{
          display: block !important;
        }}
        .s7-footer {{
          color: {fg} !important;
        }}
      }}
    </style>
    <title>{org_e}</title>
  </head>
  <body style="margin:0;padding:0;background:transparent;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:transparent;">
      <tr>
        <td align="center" style="padding:28px 12px;background:transparent;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:transparent;">
            <tr>
              <td align="center" style="padding:0 0 18px;background:transparent;">
                <img
                  src="{logo_src}"
                  alt="{org_e}"
                  width="150"
                  border="0"
                  class="s7-logo-light"
                  style="display:block;max-width:150px;height:auto;width:100%;"
                />
                <img
                  src="{logo_dark_src}"
                  alt="{org_e}"
                  width="150"
                  border="0"
                  class="s7-logo-dark"
                  style="display:block;max-width:150px;height:auto;width:100%;"
                />
              </td>
            </tr>
            <tr>
              <td
                style="background:{bg};border:1px solid {bdr};border-radius:12px;padding:28px 22px;color:{fg};font-family:{ff};"
              >
                <div style="font-size:22px;line-height:1.2;font-weight:700;margin:0 0 16px;color:{fg};">
                  Welcome.
                </div>
                <div style="font-size:14px;line-height:1.6;margin:0 0 14px;color:{fg};">
                  You&apos;ve been added to the {org_e} team calendar.
                </div>
                <div style="font-size:14px;line-height:1.6;margin:0 0 20px;color:{fg};">
                  This is where you&apos;ll see availability, request time in<br />the space, and stay connected with your bookings here.
                </div>
                <div style="font-size:14px;line-height:1.6;margin:0 0 22px;color:{fg};">
                  Tap below to set up your account.
                </div>

                <div style="text-align:left;margin:0 0 12px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" style="margin:0;">
                    <tr>
                      <td
                        align="left"
                        style="border:1px solid {fg};border-radius:7px;background:{bg};"
                      >
                        <a
                          href="{href}"
                          style="display:inline-block;padding:12px 18px;background:{bg};color:{fg};text-decoration:none;border-radius:7px;font-size:14px;font-weight:700;letter-spacing:0.2px;"
                        >
                          Accept invite →
                        </a>
                      </td>
                    </tr>
                  </table>
                <br></div>

                <div style="font-size:12px;line-height:1.5;color:{fg};margin:0;text-align:center;">
                  This link is valid for 7 days and can only be used once.
                </div></br>
              </td>
            </tr>
            <tr>
              <td align="center" class="s7-footer" style="padding:14px 6px 0;color:#161616;font-family:{ff};font-size:11px;line-height:1.4;background:transparent;">
                {org_e}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _text_body(invite_link: str, org_name: str) -> str:
    return (
        "Welcome.\n\n"
        f"You've been added to the {org_name} team calendar.\n"
        "This is where you'll see availability, request time in\n"
        "the space, and stay connected with your bookings here.\n\n"
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
) -> Tuple[bool, Optional[str]]:
    """Send arbitrary HTML + plain text via Resend or SMTP (same config as invites)."""
    from_addr = _from_addr()
    if not from_addr:
        return False, "INVITE_FROM_EMAIL is not set"
    subj = (subject or "Notification").strip()[:200]
    resend = _resend_key()
    if resend:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {resend}", "Content-Type": "application/json"},
                    json={
                        "from": from_addr,
                        "to": [to_email],
                        "subject": subj,
                        "html": html_body,
                        "text": text_body,
                    },
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
                return False, f"Resend ({r.status_code}): {detail}"[:500]
            return True, None
        except Exception as e:
            logger.exception("Resend transactional email error: %s", e)
            return False, f"Could not reach Resend: {type(e).__name__}"

    smtp = _smtp_config()
    if smtp:

        def _send_sync() -> None:
            msg = EmailMessage()
            msg["Subject"] = subj
            msg["From"] = from_addr
            msg["To"] = to_email
            msg.set_content(text_body)
            msg.add_alternative(html_body, subtype="html")
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
            return True, None
        except Exception as e:
            logger.exception("SMTP transactional email error: %s", e)
            return False, "SMTP send failed"

    return False, "No email transport configured (set RESEND_API_KEY or SMTP_*)"


def build_booking_decision_bodies(
    *,
    decision: Literal["approved", "denied"],
    calendar_name: str,
    date_str: str,
    start_time: str,
    end_time: str,
    optional_message: str,
    calendar_app_url: str,
) -> Tuple[str, str, str]:
    org = (os.environ.get("INVITE_EMAIL_ORG_NAME") or "Studio 7 Miami").strip()
    cn = html.escape(calendar_name)
    dn = html.escape(date_str)
    st = html.escape(start_time)
    et = html.escape(end_time)
    msg = (optional_message or "").strip().replace("\r", "")
    msg_e = html.escape(msg) if msg else ""
    href = calendar_app_url.replace('"', "%22")
    if decision == "approved":
        subject = f"Booking approved — {calendar_name}"[:200]
        lead = "Your booking request was approved."
        lead_plain = "Your booking request was approved."
    else:
        subject = f"Booking request declined — {calendar_name}"[:200]
        lead = "Your booking request was not approved."
        lead_plain = "Your booking request was not approved."
    org_e = html.escape(org)
    bg = EMAIL_PAGE_BG
    fg = EMAIL_TEXT
    bdr = EMAIL_CARD_BORDER
    ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    msg_block = (
        f'<p style="font-size:14px;line-height:1.55;color:{fg};margin:16px 0 0;">{msg_e}</p>' if msg_e else ""
    )
    html_body = f"""<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;background:{bg};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:{bg};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">
            <tr>
              <td style="background:{bg};border:1px solid {bdr};border-radius:12px;padding:28px 22px;color:{fg};font-family:{ff};">
                <p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:{fg};">{lead}</p>
                <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:{fg};"><strong>{cn}</strong><br /><span style="color:{fg};">{dn}</span> · {st}–{et}</p>
                {msg_block}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 0;">
                  <tr>
                    <td align="center" style="padding:0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="border:1px solid {fg};border-radius:8px;background:{bg};">
                            <a href="{href}" style="display:inline-block;padding:12px 20px;background:{bg};color:{fg};text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">Open requests</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <p style="font-size:12px;line-height:1.45;color:{fg};margin:22px 0 0;">{org_e}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""
    lines = [lead_plain, "", f"{calendar_name}", f"{date_str} · {start_time}–{end_time}", ""]
    if msg:
        lines.append(msg)
        lines.append("")
    lines.append(calendar_app_url)
    text_body = "\n".join(lines)
    return subject, html_body, text_body


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
) -> Tuple[bool, Optional[str]]:
    subject, html_body, text_body = build_booking_decision_bodies(
        decision=decision,
        calendar_name=calendar_name,
        date_str=date_str,
        start_time=start_time,
        end_time=end_time,
        optional_message=optional_message,
        calendar_app_url=calendar_app_url,
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
) -> Tuple[bool, Optional[str]]:
    """
    Returns (delivered, error_message). On failure the caller should still keep the invite;
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
