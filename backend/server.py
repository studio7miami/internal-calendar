from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import permissions
import bcrypt
import jwt
from fastapi import Body, FastAPI, APIRouter, HTTPException, Depends, Request
from starlette.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from pydantic import BaseModel, EmailStr

# ---------- Setup ----------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

app = FastAPI(title="Studio 7 Miami Calendar API")
api = APIRouter(prefix="/api")

# Only these two production calendars; extras are deactivated on startup.
CANONICAL_CALENDAR_NAMES = frozenset({"Studio 7 Miami", "Studio 7 Photobooth"})
DEFAULT_CALENDARS = [
    {"name": "Studio 7 Miami", "color": "#38BDF8"},
    {"name": "Studio 7 Photobooth", "color": "#A78BFA"},
]


def _calendar_enriched(row: dict) -> dict:
    if not row:
        return row
    r = {**row}
    r["is_fixed"] = r.get("name") in CANONICAL_CALENDAR_NAMES
    return r


def normalize_canonical_calendars() -> None:
    """Ensure exactly two active calendars: rename legacy Photobooth, seed missing, deactivate others."""
    all_res = supabase.table("calendars").select("*").execute()
    rows = all_res.data or []
    by_name = {r["name"]: r for r in rows}

    if "Photobooth" in by_name and "Studio 7 Photobooth" not in by_name:
        pid = by_name["Photobooth"]["id"]
        supabase.table("calendars").update({"name": "Studio 7 Photobooth"}).eq("id", pid).execute()
    elif "Photobooth" in by_name and "Studio 7 Photobooth" in by_name:
        supabase.table("calendars").update({"is_active": False}).eq("id", by_name["Photobooth"]["id"]).execute()

    all_res = supabase.table("calendars").select("*").execute()
    for r in all_res.data or []:
        n = r.get("name", "")
        if n not in CANONICAL_CALENDAR_NAMES:
            supabase.table("calendars").update({"is_active": False}).eq("id", r["id"]).execute()
        else:
            supabase.table("calendars").update({"is_active": True}).eq("id", r["id"]).execute()

    for cal in DEFAULT_CALENDARS:
        existing = supabase.table("calendars").select("id").eq("name", cal["name"]).execute()
        if not existing.data:
            supabase.table("calendars").insert({
                "id": str(uuid.uuid4()),
                "name": cal["name"],
                "color": cal["color"],
                "google_calendar_id": "",
                "is_active": True,
                "created_at": now_iso(),
            }).execute()


# ---------- Helpers ----------
def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    res = supabase.table("users").select("id,email,name,role,is_disabled,created_at").eq("id", payload["sub"]).single().execute()
    if not res.data:
        raise HTTPException(status_code=401, detail="User not found")
    return res.data


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def get_stored_role_permissions() -> dict:
    try:
        res = supabase.table("app_config").select("role_permissions").eq("id", "default").limit(1).execute()
        if res.data and len(res.data) > 0:
            raw = res.data[0].get("role_permissions")
            if isinstance(raw, dict):
                return raw
    except Exception as e:
        logger.warning("app_config read failed (add table via supabase/001_app_config.sql if using permissions): %s", e)
    return {}


def user_permissions_for(user: dict) -> dict:
    return permissions.resolve_effective(user.get("role", "member"), get_stored_role_permissions())


def _auth_user_out(user: dict) -> dict:
    return {**user, "permissions": user_permissions_for(user)}


# ---------- Google Calendar STUB ----------
def gcal_push_event(calendar_google_id: Optional[str], booking: dict) -> Optional[str]:
    logger.info(f"[GCAL STUB] push event -> gcal={calendar_google_id} booking={booking.get('id')}")
    return f"gcal_mock_{uuid.uuid4().hex[:12]}"


def gcal_delete_event(calendar_google_id: Optional[str], google_event_id: Optional[str]) -> None:
    logger.info(f"[GCAL STUB] delete event {google_event_id} from {calendar_google_id}")


# ---------- Models ----------
class RegisterIn(BaseModel):
    invite_token: str
    name: str
    password: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class InviteIn(BaseModel):
    email: EmailStr


class CalendarIn(BaseModel):
    name: str
    color: str
    google_calendar_id: Optional[str] = ""
    is_active: bool = True


class BookingRequestIn(BaseModel):
    calendar_id: str
    date: str
    start_time: str
    end_time: str
    notes: Optional[str] = ""


class ManualBookingIn(BaseModel):
    calendar_id: str
    member_id: Optional[str] = None
    date: str
    start_time: str
    end_time: str
    notes: Optional[str] = ""


class ApproveDenyIn(BaseModel):
    message: Optional[str] = ""


class DisableIn(BaseModel):
    disabled: bool


class RolePatchIn(BaseModel):
    role: str


# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    # Seed admin
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = supabase.table("users").select("id,password_hash").eq("email", admin_email).execute()
    if not existing.data:
        supabase.table("users").insert({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Seven",
            "role": "admin",
            "password_hash": hash_pw(admin_password),
            "created_at": now_iso(),
        }).execute()
        logger.info(f"Seeded admin {admin_email}")
    else:
        existing_user = existing.data[0]
        if not verify_pw(admin_password, existing_user.get("password_hash", "")):
            supabase.table("users").update({"password_hash": hash_pw(admin_password)}).eq("email", admin_email).execute()
            logger.info(f"Admin password updated for {admin_email}")

    normalize_canonical_calendars()


# ---------- Auth ----------
@api.post("/auth/login")
async def login(data: LoginIn):
    email = data.email.lower()
    res = supabase.table("users").select("*").eq("email", email).execute()
    if not res.data:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = res.data[0]
    if not verify_pw(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("is_disabled"):
        raise HTTPException(status_code=403, detail="This account has been disabled. Please contact the admin.")
    token = create_token(user["id"], user["email"], user["role"])
    uout = {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "created_at": user.get("created_at"),
        "is_disabled": bool(user.get("is_disabled")),
    }
    return {
        "token": token,
        "user": _auth_user_out(uout),
    }


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _auth_user_out(user)


@api.post("/auth/register")
async def register(data: RegisterIn):
    res = supabase.table("invites").select("*").eq("invite_token", data.invite_token).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite = res.data[0]
    if invite.get("used"):
        raise HTTPException(status_code=400, detail="Invite already used")
    if datetime.fromisoformat(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")
    email = invite["email"].lower()
    existing = supabase.table("users").select("id").eq("email", email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="User already exists")
    user_id = str(uuid.uuid4())
    supabase.table("users").insert({
        "id": user_id,
        "email": email,
        "name": data.name,
        "role": "member",
        "password_hash": hash_pw(data.password),
        "created_at": now_iso(),
    }).execute()
    supabase.table("invites").update({"used": True, "used_at": now_iso()}).eq("invite_token", data.invite_token).execute()
    token = create_token(user_id, email, "member")
    uout = {"id": user_id, "email": email, "name": data.name, "role": "member", "created_at": now_iso(), "is_disabled": False}
    return {
        "token": token,
        "user": _auth_user_out(uout),
    }


@api.get("/auth/invite/{token}")
async def get_invite(token: str):
    res = supabase.table("invites").select("*").eq("invite_token", token).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite = res.data[0]
    if invite.get("used"):
        raise HTTPException(status_code=400, detail="Invite already used")
    if datetime.fromisoformat(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")
    return {"email": invite["email"]}


# ---------- Invites (admin) ----------
@api.post("/invites")
async def create_invite(data: InviteIn, admin: dict = Depends(require_admin)):
    email = data.email.lower()
    existing = supabase.table("users").select("id").eq("email", email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="User already exists")
    supabase.table("invites").update({"used": True, "used_at": now_iso()}).eq("email", email).eq("used", False).execute()
    token = secrets.token_urlsafe(32)
    doc = {
        "id": str(uuid.uuid4()),
        "invite_token": token,
        "email": email,
        "used": False,
        "created_by": admin["id"],
        "created_at": now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }
    supabase.table("invites").insert(doc).execute()
    link = f"{FRONTEND_URL}/invite/{token}"
    logger.info(f"[EMAIL STUB] Magic link for {email}: {link}")
    return {"id": doc["id"], "email": email, "invite_link": link, "expires_at": doc["expires_at"]}


@api.get("/invites")
async def list_invites(admin: dict = Depends(require_admin)):
    res = supabase.table("invites").select("*").order("created_at", desc=True).execute()
    items = res.data or []
    for it in items:
        it["invite_link"] = f"{FRONTEND_URL}/invite/{it['invite_token']}"
    return items


# ---------- App config: role permissions (admin) & users directory ----------
@api.get("/app-config/permissions")
async def get_perms_config(_: dict = Depends(require_admin)):
    stored = get_stored_role_permissions()
    return {
        "definitions": permissions.definitions_for_api(),
        "effective": {
            "member": permissions.merge_with_defaults("member", stored.get("member")),
            "manager": permissions.merge_with_defaults("manager", stored.get("manager")),
        },
        "stored": stored,
    }


@api.patch("/app-config/permissions")
async def patch_perms_config(data: dict = Body(...), _: dict = Depends(require_admin)):
    clean = permissions.sanitize_stored(data)
    if clean is None:
        raise HTTPException(status_code=400, detail="Invalid body: expected member/manager permission keys")
    current = get_stored_role_permissions() or {}
    new_rp: dict = {
        "member": {**(current.get("member") or {}), **(clean.get("member") or {})},
        "manager": {**(current.get("manager") or {}), **(clean.get("manager") or {})},
    }
    try:
        ex = supabase.table("app_config").select("id").eq("id", "default").limit(1).execute()
        if ex.data and len(ex.data) > 0:
            supabase.table("app_config").update({"role_permissions": new_rp}).eq("id", "default").execute()
        else:
            supabase.table("app_config").insert({"id": "default", "role_permissions": new_rp}).execute()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Save failed. Run supabase/001_app_config.sql in Supabase SQL editor: {e}",
        )
    stored = get_stored_role_permissions()
    return {
        "definitions": permissions.definitions_for_api(),
        "effective": {
            "member": permissions.merge_with_defaults("member", (stored or {}).get("member")),
            "manager": permissions.merge_with_defaults("manager", (stored or {}).get("manager")),
        },
        "stored": stored,
    }


@api.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "view_members_directory"):
        raise HTTPException(status_code=403, detail="Not allowed")
    res = supabase.table("users").select("id,email,name,role,is_disabled,created_at").order("created_at", desc=True).execute()
    return res.data or []


@api.patch("/users/{user_id}/role")
async def set_user_role(user_id: str, data: RolePatchIn, admin: dict = Depends(require_admin)):
    if data.role not in ("member", "manager", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot change your own role here.")
    res = supabase.table("users").select("id,role").eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    supabase.table("users").update({"role": data.role}).eq("id", user_id).execute()
    return {"ok": True, "id": user_id, "role": data.role}


@api.patch("/users/{user_id}/disable")
async def set_user_disabled(user_id: str, data: DisableIn, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot disable your own account.")
    res = supabase.table("users").select("id,role").eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    target = res.data[0]
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admin accounts cannot be disabled.")
    supabase.table("users").update({"is_disabled": bool(data.disabled)}).eq("id", user_id).execute()
    return {"ok": True, "id": user_id, "is_disabled": bool(data.disabled)}


# ---------- Calendars ----------
@api.get("/calendars")
async def list_calendars(user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "view_schedule"):
        raise HTTPException(status_code=403, detail="Calendar is not available for this account")
    res = supabase.table("calendars").select("*").eq("is_active", True).order("created_at").execute()
    return [_calendar_enriched(c) for c in (res.data or [])]


@api.post("/calendars")
async def create_calendar(_data: CalendarIn, _admin: dict = Depends(require_admin)):
    raise HTTPException(
        status_code=400,
        detail="This app uses only Studio 7 Miami and Studio 7 Photobooth. New calendars are not available.",
    )


@api.patch("/calendars/{cal_id}")
async def update_calendar(cal_id: str, data: CalendarIn, admin: dict = Depends(require_admin)):
    pre = supabase.table("calendars").select("name").eq("id", cal_id).execute()
    if not pre.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    name = pre.data[0].get("name", "")
    if name in CANONICAL_CALENDAR_NAMES:
        if data.name != name:
            raise HTTPException(
                status_code=400,
                detail="The name of a fixed calendar cannot be changed.",
            )
        if not data.is_active:
            raise HTTPException(status_code=400, detail="Fixed calendars must stay active.")
    upd = {"name": data.name, "color": data.color, "google_calendar_id": data.google_calendar_id or "", "is_active": data.is_active}
    res = supabase.table("calendars").update(upd).eq("id", cal_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return _calendar_enriched(res.data[0])


@api.delete("/calendars/{cal_id}")
async def delete_calendar(cal_id: str, admin: dict = Depends(require_admin)):
    pre = supabase.table("calendars").select("name").eq("id", cal_id).execute()
    if not pre.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    if pre.data[0].get("name") in CANONICAL_CALENDAR_NAMES:
        raise HTTPException(status_code=400, detail="Cannot delete a fixed calendar.")
    res = supabase.table("calendars").delete().eq("id", cal_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return {"ok": True}


# ---------- Bookings ----------
def _serialize_booking(b: dict, viewer: dict, users_by_id: dict, viewer_perms: Optional[dict] = None) -> dict:
    perms = viewer_perms if viewer_perms is not None else user_permissions_for(viewer)
    is_owner = str(b.get("member_id")) == str(viewer["id"])
    can_see_detail = is_owner or permissions.has(perms, "see_all_booking_details")
    base = {
        "id": b["id"],
        "calendar_id": b["calendar_id"],
        "date": str(b["date"]),
        "start_time": b["start_time"],
        "end_time": b["end_time"],
        "status": b.get("status", "approved"),
        "source": b.get("source", "manual"),
        "is_own": is_owner,
    }
    if can_see_detail:
        owner = users_by_id.get(str(b.get("member_id")))
        base.update({
            "notes": b.get("notes", ""),
            "member_id": b.get("member_id"),
            "member_name": owner["name"] if owner else None,
            "member_email": owner["email"] if owner else None,
            "google_event_id": b.get("google_event_id"),
            "created_at": b.get("created_at"),
            "approval_message": b.get("approval_message", ""),
        })
    return base


@api.get("/bookings")
async def list_bookings(user: dict = Depends(get_current_user), status: Optional[str] = None):
    p = user_permissions_for(user)
    if not permissions.has(p, "view_schedule"):
        raise HTTPException(status_code=403, detail="Calendar is not available for this account")
    query = supabase.table("bookings").select("*")
    if status:
        query = query.eq("status", status)
    else:
        query = query.in_("status", ["approved", "pending"])
    res = query.order("date").execute()
    raw = res.data or []
    users_res = supabase.table("users").select("id,name,email").execute()
    users_by_id = {u["id"]: u for u in (users_res.data or [])}
    return [_serialize_booking(b, user, users_by_id, p) for b in raw]


@api.get("/bookings/requests")
async def list_requests(user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "view_schedule"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if permissions.has(p, "approve_deny_requests"):
        res = supabase.table("bookings").select("*").eq("status", "pending").order("created_at", desc=True).execute()
    else:
        res = supabase.table("bookings").select("*").eq("member_id", user["id"]).order("created_at", desc=True).execute()
    raw = res.data or []
    users_res = supabase.table("users").select("id,name,email").execute()
    users_by_id = {u["id"]: u for u in (users_res.data or [])}
    return [_serialize_booking(b, user, users_by_id, p) for b in raw]


@api.post("/bookings/request")
async def create_request(data: BookingRequestIn, user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "create_request"):
        raise HTTPException(status_code=403, detail="Requesting bookings is not allowed for this account")
    cal_res = supabase.table("calendars").select("*").eq("id", data.calendar_id).execute()
    if not cal_res.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    cal = cal_res.data[0]
    booking = {
        "id": str(uuid.uuid4()),
        "calendar_id": data.calendar_id,
        "member_id": user["id"],
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "notes": data.notes or "",
        "status": "pending",
        "source": "member_request",
        "created_at": now_iso(),
    }
    supabase.table("bookings").insert(booking).execute()
    stored = get_stored_role_permissions()
    mgr_may_approve = permissions.has(permissions.resolve_effective("manager", stored), "approve_deny_requests")
    target_ids: set = set()
    for row in (supabase.table("users").select("id,role").eq("is_disabled", False).in_("role", ["admin", "manager"]).execute().data or []):
        uid = row["id"]
        if row.get("role") == "admin":
            target_ids.add(uid)
        elif row.get("role") == "manager" and mgr_may_approve:
            target_ids.add(uid)
    for a_id in target_ids:
        supabase.table("notifications").insert({
            "id": str(uuid.uuid4()),
            "user_id": a_id,
            "booking_id": booking["id"],
            "type": "request_submitted",
            "title": "New booking request",
            "message": f"{user['name']} requested {cal['name']} on {data.date} {data.start_time}-{data.end_time}",
            "is_read": False,
            "created_at": now_iso(),
        }).execute()
    supabase.table("notifications").insert({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "booking_id": booking["id"],
        "type": "request_confirmed",
        "title": "Request submitted",
        "message": f"Your {cal['name']} request for {data.date} is awaiting approval.",
        "is_read": False,
        "created_at": now_iso(),
    }).execute()
    return booking


@api.post("/bookings/manual")
async def create_manual(data: ManualBookingIn, user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "create_manual_booking"):
        raise HTTPException(status_code=403, detail="Manual bookings are not allowed for this account")
    cal_res = supabase.table("calendars").select("*").eq("id", data.calendar_id).execute()
    if not cal_res.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    cal = cal_res.data[0]
    member_id = data.member_id or user["id"]
    booking = {
        "id": str(uuid.uuid4()),
        "calendar_id": data.calendar_id,
        "member_id": member_id,
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "notes": data.notes or "",
        "status": "approved",
        "source": "manual",
        "created_at": now_iso(),
    }
    gid = gcal_push_event(cal.get("google_calendar_id"), booking)
    booking["google_event_id"] = gid
    supabase.table("bookings").insert(booking).execute()
    return booking


@api.post("/bookings/{booking_id}/approve")
async def approve_booking(booking_id: str, data: ApproveDenyIn, admin: dict = Depends(get_current_user)):
    p = user_permissions_for(admin)
    if not permissions.has(p, "approve_deny_requests"):
        raise HTTPException(status_code=403, detail="Not allowed to approve requests")
    res = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    b = res.data[0]
    if b["status"] != "pending":
        raise HTTPException(status_code=400, detail="Booking not pending")
    cal_res = supabase.table("calendars").select("*").eq("id", b["calendar_id"]).execute()
    cal = cal_res.data[0] if cal_res.data else {}
    gid = gcal_push_event(cal.get("google_calendar_id"), b)
    supabase.table("bookings").update({
        "status": "approved",
        "google_event_id": gid,
        "approval_message": data.message or "",
        "approved_at": now_iso(),
        "approved_by": admin["id"],
    }).eq("id", booking_id).execute()
    supabase.table("notifications").insert({
        "id": str(uuid.uuid4()),
        "user_id": b["member_id"],
        "booking_id": booking_id,
        "type": "request_approved",
        "title": "Booking approved",
        "message": data.message or f"Your booking on {b['date']} has been approved.",
        "is_read": False,
        "created_at": now_iso(),
    }).execute()
    return {"ok": True}


@api.post("/bookings/{booking_id}/deny")
async def deny_booking(booking_id: str, data: ApproveDenyIn, mod: dict = Depends(get_current_user)):
    p = user_permissions_for(mod)
    if not permissions.has(p, "approve_deny_requests"):
        raise HTTPException(status_code=403, detail="Not allowed to deny requests")
    res = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    b = res.data[0]
    if b["status"] != "pending":
        raise HTTPException(status_code=400, detail="Booking not pending")
    supabase.table("bookings").update({
        "status": "denied",
        "approval_message": data.message or "",
        "denied_at": now_iso(),
        "denied_by": mod["id"],
    }).eq("id", booking_id).execute()
    supabase.table("notifications").insert({
        "id": str(uuid.uuid4()),
        "user_id": b["member_id"],
        "booking_id": booking_id,
        "type": "request_denied",
        "title": "Booking denied",
        "message": data.message or f"Your booking on {b['date']} was denied.",
        "is_read": False,
        "created_at": now_iso(),
    }).execute()
    return {"ok": True}


@api.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "delete_any_booking"):
        raise HTTPException(status_code=403, detail="Not allowed to delete this booking")
    res = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    b = res.data[0]
    cal_res = supabase.table("calendars").select("*").eq("id", b["calendar_id"]).execute()
    cal = cal_res.data[0] if cal_res.data else {}
    gcal_delete_event(cal.get("google_calendar_id"), b.get("google_event_id"))
    supabase.table("bookings").delete().eq("id", booking_id).execute()
    return {"ok": True}


# ---------- Notifications ----------
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    res = supabase.table("notifications").select("*").eq("user_id", user["id"]).order("created_at", desc=True).limit(50).execute()
    return res.data or []


@api.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: str, user: dict = Depends(get_current_user)):
    supabase.table("notifications").update({"is_read": True}).eq("id", notif_id).eq("user_id", user["id"]).execute()
    return {"ok": True}


@api.post("/notifications/read-all")
async def mark_all_read(user: dict = Depends(get_current_user)):
    supabase.table("notifications").update({"is_read": True}).eq("user_id", user["id"]).eq("is_read", False).execute()
    return {"ok": True}


# ---------- Chat (Anthropic direct) ----------
class ChatIn(BaseModel):
    message: str
    model: Optional[str] = "claude"


@api.post("/chat")
async def chat(data: ChatIn, user: dict = Depends(get_current_user)):
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    # Build calendar context
    cals_res = supabase.table("calendars").select("*").execute()
    cals = cals_res.data or []
    cal_by_id = {c["id"]: c for c in cals}
    today = datetime.now(timezone.utc).date().isoformat()
    lookback = (datetime.now(timezone.utc).date() - timedelta(days=30)).isoformat()
    horizon = (datetime.now(timezone.utc).date() + timedelta(days=180)).isoformat()
    bookings_res = supabase.table("bookings").select("*").in_("status", ["approved", "pending"]).gte("date", lookback).lte("date", horizon).order("date").execute()
    raw = bookings_res.data or []
    users_res = supabase.table("users").select("id,name,email").execute()
    users_by_id = {u["id"]: u for u in (users_res.data or [])}
    up = user_permissions_for(user)
    lines = []
    for b in raw:
        cal = cal_by_id.get(b["calendar_id"], {})
        cal_name = cal.get("name", "Unknown")
        is_owner = str(b.get("member_id")) == str(user["id"])
        if is_owner or permissions.has(up, "see_all_booking_details"):
            owner = users_by_id.get(str(b.get("member_id")), {})
            who = owner.get("name", "—")
            note = (b.get("notes") or "").replace("\n", " ")[:120]
            lines.append(f"- {b['date']} {b['start_time']}-{b['end_time']} | {cal_name} | {b['status']} | {who}" + (f" | notes: {note}" if note else ""))
        else:
            lines.append(f"- {b['date']} {b['start_time']}-{b['end_time']} | {cal_name} | booked")

    cal_list = ", ".join(f"{c['name']} ({c.get('color','')})" for c in cals) or "(none)"
    context = (
        f"Calendars: {cal_list}\nToday (UTC): {today}\nUpcoming bookings:\n"
        + ("\n".join(lines) if lines else "(none)")
    )
    system_prompt = (
        f"You are the Studio 7 Miami internal calendar assistant.\n"
        f"The current user is {user.get('name')} (role: {user.get('role')}, email: {user.get('email')}).\n"
        "Answer scheduling questions concisely. Use bullet points for lists.\n"
        "All times are America/New_York (Miami). Format times in 12-hour format.\n"
        "Respect visibility: members only see detail for their own bookings.\n"
        f"=== Calendar context ===\n{context}"
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": data.message}]
        )
        reply = message.content[0].text
        return {"reply": reply, "model": "anthropic/claude-sonnet-4-6"}
    except Exception as e:
        logger.exception("chat error")
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)[:200]}")


@api.get("/")
async def root():
    return {"service": "Studio 7 Miami Calendar API", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
