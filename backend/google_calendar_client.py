"""
Google Calendar OAuth + REST (Calendar v3).

- App credentials: GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI in server .env only.
- User tokens: stored in Supabase `google_tokens` per `user_id` (admin who completed OAuth).
- Sync uses the acting user's tokens if present; otherwise the most recently updated admin's tokens.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode

import httpx
from supabase import Client

logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar"

def oauth_client_configured() -> bool:
    cid = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    sec = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    return bool(cid and sec)


def oauth_redirect_uri() -> str:
    return os.environ.get(
        "GOOGLE_OAUTH_REDIRECT_URI",
        "http://127.0.0.1:8000/api/integrations/google/callback",
    ).strip()


def calendar_timezone() -> str:
    return os.environ.get("GOOGLE_CALENDAR_TIMEZONE", "America/New_York").strip() or "America/New_York"


def build_google_authorization_url(state: str, login_hint: Optional[str] = None) -> str:
    cid = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    params: Dict[str, str] = {
        "client_id": cid,
        "redirect_uri": oauth_redirect_uri(),
        "response_type": "code",
        "scope": CALENDAR_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    if login_hint and str(login_hint).strip():
        params["login_hint"] = str(login_hint).strip()
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def read_google_tokens_row(supabase: Client, user_id: str) -> Optional[Dict[str, Any]]:
    try:
        res = supabase.table("google_tokens").select("*").eq("user_id", str(user_id)).limit(1).execute()
        if not res.data:
            return None
        return res.data[0]
    except Exception as e:
        logger.warning("read google_tokens: %s", e)
        return None


def delete_google_tokens(supabase: Client, user_id: str) -> None:
    supabase.table("google_tokens").delete().eq("user_id", str(user_id)).execute()


def upsert_google_tokens(
    supabase: Client,
    user_id: str,
    *,
    access_token: str,
    refresh_token: Optional[str],
    access_token_expires_at: str,
    email: str,
) -> None:
    uid = str(user_id)
    existing = read_google_tokens_row(supabase, uid)
    rt = refresh_token or (existing or {}).get("refresh_token")
    if not rt:
        raise ValueError("refresh_token required")
    doc = {
        "user_id": uid,
        "access_token": access_token,
        "refresh_token": rt,
        "access_token_expires_at": access_token_expires_at,
        "email": email or (existing or {}).get("email") or "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("google_tokens").upsert(doc).execute()


def pick_google_token_owner_id(supabase: Client, acting_user_id: str) -> Optional[str]:
    """Whose stored tokens to use for Calendar API (sync): acting user first, else latest admin with tokens."""
    row = read_google_tokens_row(supabase, str(acting_user_id))
    if row and (row.get("refresh_token") or "").strip():
        return str(acting_user_id)
    try:
        res = supabase.table("google_tokens").select("user_id,refresh_token,updated_at").execute()
    except Exception:
        return None
    candidates: List[Dict[str, Any]] = []
    for trow in res.data or []:
        if not (trow.get("refresh_token") or "").strip():
            continue
        uid = str(trow["user_id"])
        ur = supabase.table("users").select("role").eq("id", uid).limit(1).execute()
        if ur.data and ur.data[0].get("role") == "admin":
            candidates.append(trow)
    if not candidates:
        return None
    candidates.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
    return str(candidates[0]["user_id"])


async def exchange_authorization_code(code: str) -> Dict[str, Any]:
    cid = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    sec = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    data = {
        "code": code,
        "client_id": cid,
        "client_secret": sec,
        "redirect_uri": oauth_redirect_uri(),
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(GOOGLE_TOKEN_URL, data=data)
    if r.status_code != 200:
        logger.warning("Google token exchange failed: %s %s", r.status_code, r.text[:500])
        raise ValueError(r.text or "token exchange failed")
    return r.json()


async def fetch_google_account_email(access_token: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    if r.status_code != 200:
        return ""
    return (r.json() or {}).get("email") or ""


async def _refresh_access_token_for_owner(supabase: Client, token_owner_id: str, row: Dict[str, Any]) -> Optional[str]:
    rt = row.get("refresh_token")
    if not rt:
        return None
    cid = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    sec = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    data = {
        "refresh_token": rt,
        "client_id": cid,
        "client_secret": sec,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(GOOGLE_TOKEN_URL, data=data)
    if r.status_code != 200:
        logger.warning("Google refresh failed: %s %s", r.status_code, r.text[:300])
        return None
    body = r.json()
    at = body.get("access_token")
    if not at:
        return None
    exp_sec = int(body.get("expires_in", 3600))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=max(120, exp_sec - 120))).isoformat()
    new_rt = body.get("refresh_token") or rt
    upsert_google_tokens(
        supabase,
        token_owner_id,
        access_token=at,
        refresh_token=new_rt,
        access_token_expires_at=expires_at,
        email=str(row.get("email") or ""),
    )
    return at


async def get_access_token_for_owner(supabase: Client, token_owner_id: str) -> Optional[str]:
    row = read_google_tokens_row(supabase, str(token_owner_id))
    if not row or not (row.get("refresh_token") or "").strip():
        return None
    exp_s = row.get("access_token_expires_at")
    at = row.get("access_token")
    if at and exp_s:
        try:
            exp = datetime.fromisoformat(str(exp_s).replace("Z", "+00:00"))
            if exp > datetime.now(timezone.utc):
                return str(at)
        except Exception:
            pass
    return await _refresh_access_token_for_owner(supabase, str(token_owner_id), row)


async def list_calendars_for_viewer(supabase: Client, viewer_user_id: str) -> List[Dict[str, str]]:
    token = await get_access_token_for_owner(supabase, str(viewer_user_id))
    if not token:
        return []
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            headers={"Authorization": f"Bearer {token}"},
            params={"maxResults": 250},
        )
    if r.status_code != 200:
        logger.warning("calendarList failed: %s %s", r.status_code, r.text[:400])
        return []
    items = (r.json() or {}).get("items") or []
    out: List[Dict[str, str]] = []
    for it in items:
        cid = it.get("id")
        if not cid:
            continue
        summary = it.get("summary") or it.get("summaryOverride") or cid
        out.append({"id": cid, "summary": summary})
    return sorted(out, key=lambda x: (x["summary"] or "").lower())


def _calendar_mapping_incomplete(supabase: Client) -> bool:
    """True when Google is connected but an active calendar has no google_calendar_id (or there are none)."""
    try:
        res = supabase.table("calendars").select("google_calendar_id").eq("is_active", True).execute()
        rows = res.data or []
        if not rows:
            return True
        for row in rows:
            if not str(row.get("google_calendar_id") or "").strip():
                return True
        return False
    except Exception:
        return True


def user_google_connection_summary(supabase: Client, viewer_user_id: str) -> Dict[str, Any]:
    row = read_google_tokens_row(supabase, str(viewer_user_id))
    connected = bool(row and (row.get("refresh_token") or "").strip())
    needs_calendar_mapping = bool(connected and _calendar_mapping_incomplete(supabase))
    return {
        "client_configured": oauth_client_configured(),
        "connected": connected,
        "email": (row or {}).get("email") if connected else None,
        "needs_calendar_mapping": needs_calendar_mapping,
    }


def _local_datetime_for_booking(booking: dict) -> Tuple[str, str]:
    d = str(booking.get("date", ""))
    st = str(booking.get("start_time", ""))[:5]
    et = str(booking.get("end_time", ""))[:5]
    tz = calendar_timezone()
    return f"{d}T{st}:00", f"{d}T{et}:00"


async def insert_calendar_event(
    supabase: Client,
    token_owner_id: str,
    calendar_google_id: str,
    booking: dict,
) -> Optional[str]:
    token = await get_access_token_for_owner(supabase, token_owner_id)
    if not token or not calendar_google_id:
        return None
    start_dt, end_dt = _local_datetime_for_booking(booking)
    tz = calendar_timezone()
    body = {
        "summary": f"Booking · {booking.get('date')} {str(booking.get('start_time', ''))[:5]}-{str(booking.get('end_time', ''))[:5]}",
        "description": (booking.get("notes") or "").strip() or f"Internal calendar booking id {booking.get('id')}",
        "start": {"dateTime": start_dt, "timeZone": tz},
        "end": {"dateTime": end_dt, "timeZone": tz},
    }
    cal_enc = quote(str(calendar_google_id), safe="")
    url = f"https://www.googleapis.com/calendar/v3/calendars/{cal_enc}/events"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=body)
    if r.status_code not in (200, 201):
        logger.warning("insert event failed: %s %s", r.status_code, r.text[:500])
        return None
    return (r.json() or {}).get("id")


async def delete_calendar_event(
    supabase: Client,
    token_owner_id: str,
    calendar_google_id: Optional[str],
    google_event_id: Optional[str],
) -> None:
    if not calendar_google_id or not google_event_id or str(google_event_id).startswith("gcal_mock_"):
        return
    token = await get_access_token_for_owner(supabase, token_owner_id)
    if not token:
        return
    cal_enc = quote(str(calendar_google_id), safe="")
    eid_enc = quote(str(google_event_id), safe="")
    url = f"https://www.googleapis.com/calendar/v3/calendars/{cal_enc}/events/{eid_enc}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.delete(url, headers={"Authorization": f"Bearer {token}"})
    if r.status_code not in (200, 204):
        logger.warning("delete event failed: %s %s", r.status_code, r.text[:400])


async def push_booking_to_google(
    supabase: Client,
    calendar_google_id: Optional[str],
    booking: dict,
    acting_user_id: str,
) -> Optional[str]:
    if not calendar_google_id:
        return f"gcal_mock_{booking.get('id', '')[:8]}"
    owner = pick_google_token_owner_id(supabase, str(acting_user_id))
    if not owner:
        logger.info("[GCAL] no Google tokens; mock event id for booking %s", booking.get("id"))
        return f"gcal_mock_{booking.get('id', '')[:12]}"
    try:
        eid = await insert_calendar_event(supabase, owner, calendar_google_id, booking)
        if eid:
            return eid
    except Exception:
        logger.exception("Google Calendar insert failed")
    return f"gcal_mock_{booking.get('id', '')[:12]}"


async def remove_booking_from_google(
    supabase: Client,
    calendar_google_id: Optional[str],
    google_event_id: Optional[str],
    acting_user_id: str,
) -> None:
    owner = pick_google_token_owner_id(supabase, str(acting_user_id))
    if not owner:
        logger.info("[GCAL] delete skipped (no tokens): %s", google_event_id)
        return
    try:
        await delete_calendar_event(supabase, owner, calendar_google_id, google_event_id)
    except Exception:
        logger.exception("Google Calendar delete failed")
