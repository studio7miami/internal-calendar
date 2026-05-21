"""Public client booking API (book.studio7.miami) — writes to Supabase bookings table."""

from __future__ import annotations

import calendar as cal_mod
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, EmailStr, Field

logger = logging.getLogger(__name__)

SOURCE = "public_booking"

# Catalog mirrored from Studio7Miami-Booking.html
SERVICE_CATALOG: Dict[str, Dict[str, Any]] = {
    "portraits": {
        "name": "Portraits",
        "duration_minutes": 90,
        "price_cents": 35000,
        "addon_mua_available": True,
    },
    "beauty-headshots": {
        "name": "Beauty Headshots",
        "duration_minutes": 30,
        "price_cents": 30000,
        "addon_mua_available": True,
    },
    "theatrical-headshots": {
        "name": "Theatrical Headshots",
        "duration_minutes": 30,
        "price_cents": 25500,
        "addon_mua_available": True,
    },
    "standard-headshots": {
        "name": "Standard Headshots",
        "duration_minutes": 30,
        "price_cents": 22500,
        "addon_mua_available": True,
    },
    "passport-photos": {
        "name": "Passport Photos",
        "duration_minutes": 15,
        "price_cents": 5000,
        "addon_mua_available": False,
    },
}

DEFAULT_ADDON_MUA_CENTS = 20000


class PublicBookingRequestIn(BaseModel):
    service_slug: str = Field(..., min_length=1, max_length=64)
    date: str = Field(..., description="YYYY-MM-DD")
    start_time: str = Field(..., description="12-hour label e.g. 2:00 PM or 24h HH:MM")
    shooter_id: str
    client_name: str = Field(..., min_length=1, max_length=200)
    client_email: EmailStr
    addon_mua: bool = False


def _norm_hm(t: str) -> str:
    s = str(t or "").strip()
    if not s:
        return "00:00"
    m = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)?$", s, re.I)
    if m:
        hh, mm, ampm = int(m.group(1)), int(m.group(2)), (m.group(3) or "").upper()
        if ampm in ("AM", "PM"):
            if ampm == "PM" and hh != 12:
                hh += 12
            if ampm == "AM" and hh == 12:
                hh = 0
        return f"{hh:02d}:{mm:02d}"
    return s[:5] if len(s) >= 5 else s


def _hm_to_minutes(t: str) -> int:
    h, m = _norm_hm(t).split(":")
    return int(h) * 60 + int(m)


def _minutes_to_hm(total: int) -> str:
    total = max(0, min(total, 23 * 60 + 59))
    return f"{total // 60:02d}:{total % 60:02d}"


def _format_time_12h(hhmm: str) -> str:
    h, m = _norm_hm(hhmm).split(":")
    hh, mm = int(h), int(m)
    ampm = "PM" if hh >= 12 else "AM"
    h12 = ((hh + 11) % 12) + 1
    return f"{h12}:{mm:02d} {ampm}"


def _js_weekday_from_iso_date(date_str: str) -> int:
    y, mo, d = [int(x) for x in date_str.split("-")]
    return date(y, mo, d).weekday()  # Mon=0 — convert to JS Sun=0
    # Python: Monday=0, JS Sunday=0
    # JS: (py_weekday + 1) % 7


def _js_weekday(iso_date: str) -> int:
    y, mo, d = [int(x) for x in iso_date.split("-")]
    py_wd = date(y, mo, d).weekday()
    return (py_wd + 1) % 7


def _parse_availability_weekly(cal: dict) -> List[dict]:
    raw = cal.get("availability_weekly")
    if raw is None:
        return [{"weekday": i, "start": "09:00", "end": "18:00"} for i in range(1, 6)]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    return raw if isinstance(raw, list) else []


def _read_public_booking_config(supabase) -> dict:
    try:
        res = supabase.table("app_config").select("public_booking").eq("id", 1).limit(1).execute()
        row = (res.data or [{}])[0]
        pb = row.get("public_booking")
        return pb if isinstance(pb, dict) else {}
    except Exception:
        return {}


def resolve_calendar_id(supabase, service_slug: str) -> Optional[str]:
    svc = SERVICE_CATALOG.get(service_slug)
    if not svc:
        return None
    pb = _read_public_booking_config(supabase)
    services = pb.get("services") if isinstance(pb.get("services"), dict) else {}
    svc_cfg = services.get(service_slug) if isinstance(services.get(service_slug), dict) else {}
    cid = (svc_cfg.get("calendar_id") or pb.get("calendar_id") or os.environ.get("PUBLIC_BOOKING_CALENDAR_ID") or "").strip()
    return cid or None


def addon_mua_cents(supabase) -> int:
    pb = _read_public_booking_config(supabase)
    try:
        return int(pb.get("addon_mua_cents", DEFAULT_ADDON_MUA_CENTS))
    except (TypeError, ValueError):
        return DEFAULT_ADDON_MUA_CENTS


def service_catalog_for_api(supabase) -> List[dict]:
    pb = _read_public_booking_config(supabase)
    out = []
    for slug, svc in SERVICE_CATALOG.items():
        out.append({
            "slug": slug,
            "name": svc["name"],
            "duration_minutes": svc["duration_minutes"],
            "price_cents": svc["price_cents"],
            "addon_mua_available": svc["addon_mua_available"],
            "addon_mua_cents": addon_mua_cents(supabase) if svc["addon_mua_available"] else 0,
            "calendar_configured": bool(resolve_calendar_id(supabase, slug)),
        })
    return out


def list_bookable_shooters(supabase) -> List[dict]:
    res = (
        supabase.table("users")
        .select("id,name,email,role,gallery_url,avatar_url")
        .eq("bookable", True)
        .eq("is_disabled", False)
        .order("name")
        .execute()
    )
    rows = res.data or []
    out = []
    for row in rows:
        name = (row.get("name") or "").strip() or (row.get("email") or "").split("@")[0]
        out.append({
            "id": str(row["id"]),
            "name": name,
            "role": row.get("role"),
            "gallery_url": row.get("gallery_url"),
            "avatar_url": row.get("avatar_url"),
        })
    return out


def _booking_fits_availability(cal: dict, date_str: str, start: str, end: str) -> bool:
    blocks = _parse_availability_weekly(cal)
    if not blocks:
        return False
    wd = _js_weekday(date_str)
    st, et = _norm_hm(start), _norm_hm(end)
    if st >= et:
        return False
    for block in blocks:
        try:
            if int(block.get("weekday", -1)) != wd:
                continue
            bs = _norm_hm(str(block.get("start", "")))
            be = _norm_hm(str(block.get("end", "")))
            if bs <= st and et <= be:
                return True
        except (TypeError, ValueError):
            continue
    return False


def _time_overlap(a0: str, a1: str, b0: str, b1: str) -> bool:
    try:
        if not b0 or not b1:
            return False
        return _norm_hm(a0) < _norm_hm(b1) and _norm_hm(a1) > _norm_hm(b0)
    except (TypeError, ValueError):
        return False


def _bookings_by_date_for_month(
    supabase,
    calendar_id: str,
    year: int,
    month: int,
) -> Dict[str, List[Tuple[str, str]]]:
    """One query for the whole month — avoids hundreds of per-slot round trips."""
    max_day = cal_mod.monthrange(year, month)[1]
    start_iso = f"{year:04d}-{month:02d}-01"
    end_iso = f"{year:04d}-{month:02d}-{max_day:02d}"
    res = (
        supabase.table("bookings")
        .select("date,start_time,end_time")
        .eq("calendar_id", calendar_id)
        .gte("date", start_iso)
        .lte("date", end_iso)
        .in_("status", ["approved", "pending"])
        .execute()
    )
    by_date: Dict[str, List[Tuple[str, str]]] = {}
    for row in res.data or []:
        raw_d = row.get("date")
        d = str(raw_d)[:10] if raw_d else ""
        st, et = row.get("start_time"), row.get("end_time")
        if not d or st is None or et is None:
            continue
        by_date.setdefault(d, []).append((str(st), str(et)))
    return by_date


def _has_conflict_cached(
    by_date: Dict[str, List[Tuple[str, str]]],
    date_str: str,
    start: str,
    end: str,
) -> bool:
    for b0, b1 in by_date.get(date_str, []):
        if _time_overlap(start, end, b0, b1):
            return True
    return False


def _calendar_has_conflict(
    supabase,
    calendar_id: str,
    date_str: str,
    start: str,
    end: str,
) -> bool:
    res = (
        supabase.table("bookings")
        .select("id,start_time,end_time")
        .eq("calendar_id", calendar_id)
        .eq("date", date_str)
        .in_("status", ["approved", "pending"])
        .execute()
    )
    for row in res.data or []:
        st, et = row.get("start_time"), row.get("end_time")
        if st is None or et is None:
            continue
        if _time_overlap(start, end, str(st), str(et)):
            return True
    return False


def _slot_starts_for_day(cal: dict, date_str: str, duration_min: int, step_min: int = 30) -> List[str]:
    blocks = _parse_availability_weekly(cal)
    wd = _js_weekday(date_str)
    starts: List[int] = []
    dur = duration_min
    for block in blocks:
        try:
            if int(block.get("weekday", -1)) != wd:
                continue
            bs = _hm_to_minutes(_norm_hm(str(block.get("start", ""))))
            be = _hm_to_minutes(_norm_hm(str(block.get("end", ""))))
            t = bs
            while t + dur <= be:
                starts.append(t)
                t += step_min
        except (TypeError, ValueError):
            continue
    return sorted(set(starts))


def month_availability(
    supabase,
    service_slug: str,
    year: int,
    month: int,
) -> Dict[str, Any]:
    """Return { year, month, days: { \"16\": [\"12:00 PM\", ...] } } for booking UI."""
    svc = SERVICE_CATALOG.get(service_slug)
    if not svc:
        raise ValueError("Unknown service")
    calendar_id = resolve_calendar_id(supabase, service_slug)
    if not calendar_id:
        raise ValueError("Public booking calendar is not configured")

    cal_res = supabase.table("calendars").select("*").eq("id", calendar_id).limit(1).execute()
    if not cal_res.data:
        raise ValueError("Calendar not found")
    cal = cal_res.data[0]
    duration = int(svc["duration_minutes"])

    today = date.today()
    max_day = cal_mod.monthrange(year, month)[1]
    days_out: Dict[str, List[str]] = {}
    month_bookings = _bookings_by_date_for_month(supabase, calendar_id, year, month)

    for day in range(1, max_day + 1):
        iso = f"{year:04d}-{month:02d}-{day:02d}"
        d = date(year, month, day)
        if d < today:
            continue
        starts = _slot_starts_for_day(cal, iso, duration)
        if not starts:
            continue
        labels: List[str] = []
        for smin in starts:
            start = _minutes_to_hm(smin)
            end = _minutes_to_hm(smin + duration)
            if not _booking_fits_availability(cal, iso, start, end):
                continue
            if _has_conflict_cached(month_bookings, iso, start, end):
                continue
            if d == today:
                now = datetime.now()
                cutoff = now.hour * 60 + now.minute
                if smin < cutoff:
                    continue
            labels.append(_format_time_12h(start))
        if labels:
            days_out[str(day)] = labels

    return {"year": year, "month": month, "days": days_out}


def build_booking_notes(
    service_name: str,
    shooter_name: str,
    addon_mua: bool,
    total_cents: int,
) -> str:
    lines = [
        f"Public booking · {service_name}",
        f"Photographer: {shooter_name}",
    ]
    if addon_mua:
        lines.append("Add-on: Makeup artist")
    lines.append(f"Quoted total: ${total_cents / 100:.0f}")
    return "\n".join(lines)


async def create_public_booking(
    supabase,
    data: PublicBookingRequestIn,
    *,
    now_iso_fn,
    stripe_module,
    stripe_connect_account_id: Optional[str],
    booking_public_url: str,
) -> dict:
    slug = data.service_slug.strip().lower()
    svc = SERVICE_CATALOG.get(slug)
    if not svc:
        raise ValueError("Unknown service")

    calendar_id = resolve_calendar_id(supabase, slug)
    if not calendar_id:
        raise ValueError("Public booking is not configured (set PUBLIC_BOOKING_CALENDAR_ID or app_config.public_booking)")

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", data.date.strip()):
        raise ValueError("Invalid date")

    cal_res = supabase.table("calendars").select("*").eq("id", calendar_id).limit(1).execute()
    if not cal_res.data:
        raise ValueError("Calendar not found")
    cal = cal_res.data[0]

    shooter_res = (
        supabase.table("users")
        .select("id,name,email,bookable,is_disabled")
        .eq("id", data.shooter_id)
        .limit(1)
        .execute()
    )
    if not shooter_res.data:
        raise ValueError("Photographer not found")
    shooter = shooter_res.data[0]
    if shooter.get("is_disabled") or not shooter.get("bookable"):
        raise ValueError("Photographer is not available for booking")

    start = _norm_hm(data.start_time)
    duration = int(svc["duration_minutes"])
    end = _minutes_to_hm(_hm_to_minutes(start) + duration)
    if _hm_to_minutes(start) >= _hm_to_minutes(end):
        raise ValueError("Invalid time range")

    if not _booking_fits_availability(cal, data.date, start, end):
        raise ValueError("That time is outside available hours")

    if _calendar_has_conflict(supabase, calendar_id, data.date, start, end):
        raise ValueError("That time is no longer available")

    addon = bool(data.addon_mua) and svc.get("addon_mua_available")
    total_cents = int(svc["price_cents"]) + (addon_mua_cents(supabase) if addon else 0)
    shooter_name = (shooter.get("name") or "").strip() or "Team member"
    client_name = data.client_name.strip()
    client_email = str(data.client_email).strip().lower()

    if not stripe_module or not stripe_connect_account_id:
        raise ValueError("Online payments are not configured. Please contact the studio.")

    booking_id = str(uuid.uuid4())
    cal_name = str(cal.get("name") or "Studio 7 Miami")
    booking = {
        "id": booking_id,
        "calendar_id": calendar_id,
        "member_id": None,
        "date": data.date,
        "start_time": start,
        "end_time": end,
        "notes": build_booking_notes(svc["name"], shooter_name, addon, total_cents),
        "status": "pending",
        "source": SOURCE,
        "created_at": now_iso_fn(),
        "client_name": client_name,
        "client_email": client_email,
        "shooter_id": str(data.shooter_id),
        "service_slug": slug,
        "addon_mua": addon,
        "payment_required": True,
        "payment_amount_cents": total_cents,
        "payment_currency": "usd",
        "payment_status": "checkout_created",
    }
    supabase.table("bookings").insert(booking).execute()

    base_pub = booking_public_url.rstrip("/")
    success_url = f"{base_pub}/?booking=confirmed&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{base_pub}/?booking=cancelled&booking_id={booking_id}"
    desc = f"{svc['name']} · {data.date} {_format_time_12h(start)}–{_format_time_12h(end)}"
    try:
        session = stripe_module.checkout.Session.create(
            mode="payment",
            client_reference_id=booking_id,
            customer_email=client_email,
            success_url=success_url,
            cancel_url=cancel_url,
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": total_cents,
                        "product_data": {
                            "name": svc["name"],
                            "description": desc,
                        },
                    },
                }
            ],
            metadata={
                "booking_id": booking_id,
                "source": SOURCE,
                "client_name": client_name,
                "calendar": cal_name,
            },
        )
    except Exception:
        supabase.table("bookings").delete().eq("id", booking_id).execute()
        logger.exception("Public booking Stripe session create failed")
        raise ValueError("Could not start payment. Please try again.")

    url = session.get("url")
    sid = session.get("id")
    if not url or not sid:
        supabase.table("bookings").delete().eq("id", booking_id).execute()
        raise ValueError("Could not start payment. Please try again.")

    supabase.table("bookings").update({
        "stripe_checkout_session_id": str(sid),
        "stripe_checkout_url": str(url),
    }).eq("id", booking_id).execute()

    return {
        "id": booking_id,
        "checkout_url": str(url),
        "total_cents": total_cents,
        "service": svc["name"],
    }
