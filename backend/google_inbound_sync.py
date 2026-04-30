"""
Pull timed events from mapped Google calendars into `bookings` as approved blocks.

Skips events created by this app (description contains "Internal calendar booking id <uuid>").
Uses `source=google_external`, `google_event_id` for idempotency, optional `external_title`.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote

import httpx
from supabase import Client
from zoneinfo import ZoneInfo

from google_calendar_client import (
    calendar_timezone,
    get_access_token_for_owner,
    pick_google_token_owner_id,
)

logger = logging.getLogger(__name__)

INTERNAL_BOOKING_DESC_RE = re.compile(
    r"Internal\s+calendar\s+booking\s+id\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)


def _parse_internal_booking_id(description: Optional[str]) -> Optional[str]:
    if not description:
        return None
    m = INTERNAL_BOOKING_DESC_RE.search(description)
    return str(m.group(1)) if m else None


def resolve_sync_token_owner(supabase: Client) -> Optional[str]:
    try:
        res = supabase.table("users").select("id").eq("role", "admin").limit(1).execute()
        if not res.data:
            return None
        return pick_google_token_owner_id(supabase, str(res.data[0]["id"]))
    except Exception:
        logger.exception("resolve_sync_token_owner failed")
        return None


def _event_times_local(ev: Dict[str, Any], tz_name: str) -> Optional[Tuple[str, str, str]]:
    """Return (date YYYY-MM-DD, start HH:MM, end HH:MM) in tz_name, or None if unsupported."""
    start = ev.get("start") or {}
    end = ev.get("end") or {}
    if start.get("date") and end.get("date"):
        return None
    sd = start.get("dateTime")
    ed = end.get("dateTime")
    if not sd or not ed:
        return None
    try:
        ds = datetime.fromisoformat(str(sd).replace("Z", "+00:00"))
        de = datetime.fromisoformat(str(ed).replace("Z", "+00:00"))
    except Exception:
        return None
    tz = ZoneInfo(tz_name)
    loc_s = ds.astimezone(tz)
    loc_e = de.astimezone(tz)
    if loc_e.date() != loc_s.date():
        return None
    return loc_s.strftime("%Y-%m-%d"), loc_s.strftime("%H:%M"), loc_e.strftime("%H:%M")


async def _list_events_window(
    supabase: Client,
    token_owner_id: str,
    calendar_google_id: str,
    time_min_rfc: str,
    time_max_rfc: str,
) -> List[Dict[str, Any]]:
    token = await get_access_token_for_owner(supabase, token_owner_id)
    if not token:
        raise RuntimeError("no access token")
    cal_enc = quote(str(calendar_google_id), safe="")
    url = f"https://www.googleapis.com/calendar/v3/calendars/{cal_enc}/events"
    base_params: Dict[str, Any] = {
        "timeMin": time_min_rfc,
        "timeMax": time_max_rfc,
        "singleEvents": True,
        "orderBy": "startTime",
        "maxResults": 250,
    }
    out: List[Dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=45.0) as client:
        page_token: Optional[str] = None
        while True:
            params = {**base_params, **({"pageToken": page_token} if page_token else {})}
            r = await client.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
            if r.status_code != 200:
                raise RuntimeError(f"events.list {r.status_code}: {r.text[:300]}")
            body = r.json() or {}
            out.extend(body.get("items") or [])
            page_token = body.get("nextPageToken")
            if not page_token:
                break
    return out


def inbound_sync_interval_sec() -> int:
    raw = os.environ.get("GOOGLE_INBOUND_SYNC_INTERVAL_SEC", "120").strip()
    try:
        n = int(raw)
    except ValueError:
        return 120
    return max(0, min(n, 3600))


def inbound_sync_past_days() -> int:
    """How far back to pull Google events (and prune mirrored rows in that date band)."""
    raw = os.environ.get("GOOGLE_INBOUND_SYNC_PAST_DAYS", "365").strip()
    try:
        n = int(raw)
    except ValueError:
        return 365
    return max(1, min(n, 1095))


def inbound_sync_future_days() -> int:
    raw = os.environ.get("GOOGLE_INBOUND_SYNC_FUTURE_DAYS", "120").strip()
    try:
        n = int(raw)
    except ValueError:
        return 120
    return max(1, min(n, 730))


async def run_google_inbound_sync(supabase: Client) -> Dict[str, Any]:
    """
    Upsert approved `google_external` bookings from Google; prune mirrors removed in Google.
    """
    stats = {"calendars": 0, "fetched": 0, "upserted": 0, "removed": 0, "skipped": 0, "errors": 0}
    owner = resolve_sync_token_owner(supabase)
    if not owner:
        return {**stats, "detail": "no_google_tokens"}

    tz_name = calendar_timezone()
    now = datetime.now(timezone.utc)
    past_d = inbound_sync_past_days()
    future_d = inbound_sync_future_days()
    time_min = (now - timedelta(days=past_d)).isoformat().replace("+00:00", "Z")
    time_max = (now + timedelta(days=future_d)).isoformat().replace("+00:00", "Z")

    try:
        cals = (
            supabase.table("calendars")
            .select("id,google_calendar_id,name,is_active")
            .eq("is_active", True)
            .execute()
        )
    except Exception:
        logger.exception("inbound sync: list calendars failed")
        stats["errors"] += 1
        return stats

    for cal in cals.data or []:
        gid = str(cal.get("google_calendar_id") or "").strip()
        cid = str(cal.get("id") or "")
        if not gid or not cid:
            continue
        stats["calendars"] += 1
        try:
            events = await _list_events_window(supabase, owner, gid, time_min, time_max)
        except Exception:
            logger.exception("inbound sync: list events failed for calendar %s", cid)
            stats["errors"] += 1
            continue

        stats["fetched"] += len(events)
        seen_ids: Set[str] = set()

        for ev in events:
            eid = str(ev.get("id") or "")
            status = str(ev.get("status") or "").lower()
            if not eid or status == "cancelled":
                stats["skipped"] += 1
                continue

            desc = (ev.get("description") or "") or ""
            internal_bid = _parse_internal_booking_id(desc)
            if internal_bid:
                try:
                    ex = supabase.table("bookings").select("id").eq("id", internal_bid).limit(1).execute()
                    if ex.data:
                        stats["skipped"] += 1
                        seen_ids.add(eid)
                        continue
                except Exception:
                    pass

            times = _event_times_local(ev, tz_name)
            if not times:
                stats["skipped"] += 1
                continue
            date_s, st, et = times
            if st >= et:
                stats["skipped"] += 1
                continue

            try:
                dup = (
                    supabase.table("bookings")
                    .select("id,source")
                    .eq("calendar_id", cid)
                    .eq("google_event_id", eid)
                    .limit(1)
                    .execute()
                )
            except Exception:
                stats["errors"] += 1
                continue

            summary = (ev.get("summary") or "").strip() or "Booked"
            # Title is stored in external_title only; do not duplicate a "Google Calendar · …" line in notes.
            notes = ""

            row_base: Dict[str, Any] = {
                "calendar_id": cid,
                "date": date_s,
                "start_time": st,
                "end_time": et,
                "notes": notes,
                "status": "approved",
                "source": "google_external",
                "google_event_id": eid,
                "external_title": summary[:500] if summary else None,
                "member_id": None,
            }

            if dup.data:
                src = str(dup.data[0].get("source") or "")
                bid = str(dup.data[0]["id"])
                if src != "google_external":
                    stats["skipped"] += 1
                    seen_ids.add(eid)
                    continue
                upd = {k: v for k, v in row_base.items() if k not in ("member_id",)}
                try:
                    supabase.table("bookings").update(upd).eq("id", bid).execute()
                    stats["upserted"] += 1
                except Exception:
                    logger.exception("inbound sync: update booking %s", bid)
                    stats["errors"] += 1
            else:
                bid = str(uuid.uuid4())
                ins = {**row_base, "id": bid, "created_at": datetime.now(timezone.utc).isoformat()}
                try:
                    supabase.table("bookings").insert(ins).execute()
                    stats["upserted"] += 1
                except Exception:
                    logger.exception("inbound sync: insert booking for event %s", eid)
                    stats["errors"] += 1

            seen_ids.add(eid)

        try:
            min_d = (now - timedelta(days=past_d)).date().isoformat()
            max_d = (now + timedelta(days=future_d)).date().isoformat()
            existing = (
                supabase.table("bookings")
                .select("id,google_event_id")
                .eq("calendar_id", cid)
                .eq("source", "google_external")
                .gte("date", min_d)
                .lte("date", max_d)
                .execute()
            )
            for b in existing.data or []:
                ge = str(b.get("google_event_id") or "")
                if ge and ge not in seen_ids:
                    try:
                        supabase.table("bookings").delete().eq("id", str(b["id"])).execute()
                        stats["removed"] += 1
                    except Exception:
                        logger.exception("inbound sync: prune %s", b.get("id"))
                        stats["errors"] += 1
        except Exception:
            logger.exception("inbound sync: prune phase for calendar %s", cid)
            stats["errors"] += 1

    return stats


async def google_inbound_background_loop(supabase: Client) -> None:
    interval = inbound_sync_interval_sec()
    if interval <= 0:
        logger.info("Google inbound sync background loop disabled (GOOGLE_INBOUND_SYNC_INTERVAL_SEC=0)")
        return
    while True:
        try:
            await run_google_inbound_sync(supabase)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Google inbound sync iteration failed")
        await asyncio.sleep(interval)
