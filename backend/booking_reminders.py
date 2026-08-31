"""
Poll approved bookings and send 24h / 2h reminder emails (same transport as invite_email).

Uses GOOGLE_CALENDAR_TIMEZONE (see google_calendar_client.calendar_timezone) for slot boundaries.
Configure poll interval with BOOKING_REMINDER_POLL_SEC (default 300); set 0 to disable the loop.

Requires invite email delivery configured (RESEND_API_KEY or SMTP + INVITE_FROM_EMAIL).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict
from zoneinfo import ZoneInfo

from supabase import Client

import invite_email
from google_calendar_client import calendar_timezone

logger = logging.getLogger(__name__)


def poll_interval_sec() -> int:
    try:
        v = int((os.environ.get("BOOKING_REMINDER_POLL_SEC") or "300").strip() or "300")
    except ValueError:
        v = 300
    return max(0, v)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _booking_start_local(booking: Dict[str, Any], tz_name: str) -> datetime:
    tz = ZoneInfo(tz_name)
    d = date.fromisoformat(str(booking["date"]))
    st = str(booking.get("start_time") or "0:0")
    parts = st.replace(".", ":").split(":")
    h = int(parts[0]) if parts and parts[0] else 0
    m = 0
    if len(parts) > 1 and parts[1][:2].isdigit():
        m = int(parts[1][:2])
    return datetime(d.year, d.month, d.day, h, m, 0, tzinfo=tz)


def _in_reminder_window(now: datetime, start: datetime, hours_before: int, grace_minutes: int) -> bool:
    if now.tzinfo != start.tzinfo:
        start = start.astimezone(now.tzinfo)
    if now >= start:
        return False
    t0 = start - timedelta(hours=hours_before)
    t1 = t0 + timedelta(minutes=grace_minutes)
    return t0 <= now <= t1


async def run_booking_reminder_tick(supabase: Client) -> Dict[str, int]:
    stats = {"candidates": 0, "sent_24h": 0, "sent_2h": 0, "errors": 0}
    if not invite_email.invite_email_delivery_configured():
        return stats

    tz_name = calendar_timezone()
    now_local = datetime.now(ZoneInfo(tz_name))
    d_min = (now_local.date() - timedelta(days=1)).isoformat()
    d_max = (now_local.date() + timedelta(days=5)).isoformat()

    try:
        res = (
            supabase.table("bookings")
            .select(
                "id,date,start_time,end_time,member_id,calendar_id,"
                "reminder_24h_sent_at,reminder_2h_sent_at,status"
            )
            .eq("status", "approved")
            .gte("date", d_min)
            .lte("date", d_max)
            .execute()
        )
    except Exception:
        logger.exception("booking reminders: list bookings failed")
        stats["errors"] += 1
        return stats

    rows = [r for r in (res.data or []) if r.get("member_id")]
    if not rows:
        return stats

    cal_ids = list({str(r["calendar_id"]) for r in rows if r.get("calendar_id")})
    cal_names: Dict[str, str] = {}
    if cal_ids:
        try:
            cal_res = supabase.table("calendars").select("id,name").in_("id", cal_ids).execute()
            cal_names = {str(c["id"]): str(c.get("name") or "Calendar") for c in (cal_res.data or [])}
        except Exception:
            logger.exception("booking reminders: load calendars failed")
            stats["errors"] += 1
            return stats

    for b in rows:
        stats["candidates"] += 1
        try:
            start = _booking_start_local(b, tz_name)
        except Exception:
            logger.warning("booking reminders: bad start for booking %s", b.get("id"))
            stats["errors"] += 1
            continue

        bid = str(b["id"])
        mem_id = str(b["member_id"])
        try:
            ures = supabase.table("users").select("email,name").eq("id", mem_id).limit(1).execute()
        except Exception:
            logger.exception("booking reminders: load user %s", mem_id)
            stats["errors"] += 1
            continue
        if not ures.data:
            continue
        to_em = (ures.data[0].get("email") or "").strip()
        if not to_em:
            continue
        mem_name = ures.data[0].get("name")
        cal_name = cal_names.get(str(b.get("calendar_id")), "Calendar")

        if not b.get("reminder_24h_sent_at") and _in_reminder_window(now_local, start, 24, 20):
            ok, err, _ = await invite_email.send_booking_reminder_email(
                to_email=to_em,
                kind="24h",
                calendar_name=cal_name,
                date_str=str(b["date"]),
                start_time=str(b["start_time"]),
                end_time=str(b["end_time"]),
                member_name=str(mem_name) if mem_name else None,
            )
            if ok:
                try:
                    supabase.table("bookings").update({"reminder_24h_sent_at": _utc_now_iso()}).eq("id", bid).execute()
                except Exception:
                    logger.exception("booking reminders: persist 24h flag %s", bid)
                    stats["errors"] += 1
                    continue
                stats["sent_24h"] += 1
                logger.info("booking reminder 24h sent booking=%s to=%s", bid, to_em)
            else:
                logger.warning("booking reminder 24h not sent booking=%s: %s", bid, err)
                stats["errors"] += 1
            continue

        if not b.get("reminder_2h_sent_at") and _in_reminder_window(now_local, start, 2, 15):
            ok, err, _ = await invite_email.send_booking_reminder_email(
                to_email=to_em,
                kind="2h",
                calendar_name=cal_name,
                date_str=str(b["date"]),
                start_time=str(b["start_time"]),
                end_time=str(b["end_time"]),
                member_name=str(mem_name) if mem_name else None,
            )
            if ok:
                try:
                    supabase.table("bookings").update({"reminder_2h_sent_at": _utc_now_iso()}).eq("id", bid).execute()
                except Exception:
                    logger.exception("booking reminders: persist 2h flag %s", bid)
                    stats["errors"] += 1
                    continue
                stats["sent_2h"] += 1
                logger.info("booking reminder 2h sent booking=%s to=%s", bid, to_em)
            else:
                logger.warning("booking reminder 2h not sent booking=%s: %s", bid, err)
                stats["errors"] += 1

    return stats


async def booking_reminder_background_loop(supabase: Client) -> None:
    interval = poll_interval_sec()
    if interval <= 0:
        logger.info("Booking reminder loop disabled (BOOKING_REMINDER_POLL_SEC=0)")
        return
    await asyncio.sleep(min(45, interval))
    while True:
        try:
            st = await run_booking_reminder_tick(supabase)
            if st.get("sent_24h") or st.get("sent_2h"):
                logger.info(
                    "Booking reminder tick: 24h=%s 2h=%s errors=%s",
                    st.get("sent_24h"),
                    st.get("sent_2h"),
                    st.get("errors"),
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Booking reminder iteration failed")
        await asyncio.sleep(interval)
