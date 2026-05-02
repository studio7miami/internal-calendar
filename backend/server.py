from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import asyncio
import os
import re
import uuid
import hmac
import hashlib
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, List, Optional, Set

import permissions
import invite_email
import bcrypt
import jwt
import google_calendar_client
import google_inbound_sync
try:
    import stripe  # type: ignore
except Exception:  # pragma: no cover
    stripe = None
from fastapi import Body, FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import FileResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import RedirectResponse
from urllib.parse import quote_plus, urlencode
from supabase import create_client, Client
from pydantic import BaseModel, EmailStr, field_validator, model_validator

# ---------- Setup ----------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"


def _clean_http_origin(raw: Optional[str], *, default: str) -> str:
    """
    Normalize env-provided URLs so redirects never contain illegal whitespace/newlines.

    Common failure mode: pasting `https://a.com https://b.com` or a leading space into Railway.
    """
    s = str(raw or "").strip()
    if not s:
        return default
    # If multiple tokens were pasted, take the first URL-like token.
    for tok in s.replace("\n", " ").split():
        t = tok.strip()
        if t.startswith("http://") or t.startswith("https://"):
            return t.rstrip("/")
    return str(default).rstrip("/")


FRONTEND_URL = _clean_http_origin(os.environ.get("FRONTEND_URL"), default="http://localhost:3000")


def _resolve_brand_logo_path() -> Path:
    """Prefer CRA build output, then public source (same asset as /brand/logo.png on the site)."""
    repo = ROOT_DIR.parent
    candidates = (
        repo / "frontend" / "build" / "brand" / "logo.png",
        repo / "frontend" / "public" / "brand" / "logo.png",
    )
    for p in candidates:
        if p.is_file():
            return p
    return candidates[1]


BRAND_LOGO_PATH = _resolve_brand_logo_path()

# Stripe configuration (optional; used when enabling payment processing)
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_CONNECT_CLIENT_ID = os.environ.get("STRIPE_CONNECT_CLIENT_ID")
STRIPE_CONNECT_REDIRECT_URI = os.environ.get("STRIPE_CONNECT_REDIRECT_URI")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
if STRIPE_SECRET_KEY and stripe is not None:
    stripe.api_key = STRIPE_SECRET_KEY

app = FastAPI(title="Studio 7 Miami Calendar API")
api = APIRouter(prefix="/api")


def _frontend_profile_url() -> str:
    return FRONTEND_URL.rstrip("/") + "/profile"


def _read_app_config_row() -> dict:
    try:
        res = supabase.table("app_config").select("*").eq("id", "default").limit(1).execute()
        if res.data and len(res.data) > 0 and isinstance(res.data[0], dict):
            return dict(res.data[0])
    except Exception:
        pass
    return {}


def _upsert_app_config_updates(updates: dict) -> None:
    ex = supabase.table("app_config").select("id").eq("id", "default").limit(1).execute()
    if ex.data:
        supabase.table("app_config").update(updates).eq("id", "default").execute()
    else:
        supabase.table("app_config").insert({"id": "default", **updates}).execute()


def stripe_connect_configured() -> bool:
    return bool(STRIPE_SECRET_KEY and STRIPE_CONNECT_CLIENT_ID and STRIPE_CONNECT_REDIRECT_URI and stripe is not None)


def read_stripe_connect_status() -> dict:
    row = _read_app_config_row()
    raw = row.get("stripe_connect")
    if isinstance(raw, dict):
        connected = bool(raw.get("connected"))
        account_id = raw.get("account_id") if isinstance(raw.get("account_id"), str) else None
        connected_at = raw.get("connected_at") if isinstance(raw.get("connected_at"), str) else None
        return {
            "configured": stripe_connect_configured(),
            "connected": connected and bool(account_id),
            "account_id": account_id,
            "connected_at": connected_at,
        }
    return {"configured": stripe_connect_configured(), "connected": False, "account_id": None, "connected_at": None}


def write_stripe_connect_status(connected: bool, account_id: Optional[str] = None) -> None:
    payload = {
        "connected": bool(connected and account_id),
        "account_id": account_id if connected else None,
        "connected_at": now_iso() if connected and account_id else None,
    }
    _upsert_app_config_updates({"stripe_connect": payload})

def _calendar_enriched(row: dict) -> dict:
    if not row:
        return row
    r = {**row}
    r["is_fixed"] = False
    return r


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


def _ordinal_suffix(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _format_request_pretty_date(date_str: str) -> str:
    """
    Format YYYY-MM-DD -> 'Tuesday, April 28th'
    """
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    return f"{d.strftime('%A')}, {d.strftime('%B')} {d.day}{_ordinal_suffix(d.day)}"


def _parse_hhmm_time(t: str) -> tuple[int, int]:
    s = str(t or "").strip()
    if not s:
        raise ValueError("empty time")
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            x = datetime.strptime(s, fmt)
            return x.hour, x.minute
        except Exception:
            pass
    raise ValueError(f"unsupported time format: {s}")


def _format_time_12h(h: int, m: int) -> tuple[str, str]:
    ampm = "am" if h < 12 else "pm"
    hh = h % 12
    if hh == 0:
        hh = 12
    return f"{hh}:{m:02d}", ampm


def _format_request_time_range(start_time: str, end_time: str) -> str:
    sh, sm = _parse_hhmm_time(start_time)
    eh, em = _parse_hhmm_time(end_time)
    s_hm, s_ampm = _format_time_12h(sh, sm)
    e_hm, e_ampm = _format_time_12h(eh, em)
    if s_ampm == e_ampm:
        return f"{s_hm}-{e_hm}{e_ampm}"
    return f"{s_hm}{s_ampm}-{e_hm}{e_ampm}"


def _format_request_time_point(t: str) -> str:
    h, m = _parse_hhmm_time(t)
    hm, ampm = _format_time_12h(h, m)
    return f"{hm}{ampm}"


PRIMARY_ADMIN_EMAIL = (
    os.environ.get("PRIMARY_ADMIN_EMAIL") or os.environ.get("SUPER_ADMIN_EMAIL") or "seven@studio7.miami"
).strip().lower()


def _is_primary_admin(user: Optional[dict]) -> bool:
    if not user:
        return False
    return str(user.get("email") or "").strip().lower() == PRIMARY_ADMIN_EMAIL


def _is_integration_test_account_email(email: Optional[str]) -> bool:
    """Emails used by backend/tests/test_api.py — omit from directory-style APIs."""
    if not email or not isinstance(email, str):
        return False
    return email.lower().endswith("@studio7test.com")


def _parse_utc(ts: Any) -> Optional[datetime]:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    if isinstance(ts, str):
        try:
            x = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return x if x.tzinfo else x.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _normalize_phone_e164(raw: Optional[str]) -> str:
    if not raw or not str(raw).strip():
        raise ValueError("Phone number is required")
    s = re.sub(r"[^\d+]", "", str(raw).strip())
    if s.startswith("+"):
        digits = re.sub(r"\D", "", s[1:])
        if len(digits) < 10:
            raise ValueError("Phone number is too short")
        return "+" + digits
    digits = re.sub(r"\D", "", s)
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    if len(digits) >= 10:
        return "+" + digits
    raise ValueError("Enter a valid phone number including area code")


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
    # Use * so auth works even if optional columns weren't added.
    res = supabase.table("users").select("*").eq("id", payload["sub"]).single().execute()
    if not res.data:
        raise HTTPException(status_code=401, detail="User not found")
    row = dict(res.data)
    row.pop("password_hash", None)
    return row


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


def calendar_id_scope_for_user(user: dict, perms: dict) -> Optional[Set[str]]:
    """If None, user may see all active calendars. If a set (possibly empty), only those calendar ids."""
    if user.get("role") == "admin":
        return None
    raw = user.get("visible_calendar_ids")
    if raw is None:
        return None
    if not isinstance(raw, list):
        return None
    if len(raw) == 0:
        return set()
    return {str(x) for x in raw}


def _assert_calendar_in_scope(user: dict, perms: dict, calendar_id: str) -> None:
    scope = calendar_id_scope_for_user(user, perms)
    if scope is not None and str(calendar_id) not in scope:
        raise HTTPException(
            status_code=403,
            detail="This calendar is not in your assigned scope. Ask an admin to update your calendar access.",
        )


def can_access_members_page(u: dict, p: dict) -> bool:
    if u.get("role") in ("admin", "manager"):
        return True
    return bool(
        permissions.has(p, "view_members_directory")
        or permissions.has(p, "assign_member_calendars")
    )


def _auth_user_out(user: dict) -> dict:
    out = {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user.get("role", "member"),
        "is_disabled": bool(user.get("is_disabled")),
        "created_at": user.get("created_at"),
        "phone_e164": user.get("phone_e164"),
        "sauce": user.get("sauce"),
    }
    out["permissions"] = user_permissions_for(out)
    raw_vc = user.get("visible_calendar_ids")
    if raw_vc is None:
        out["visible_calendar_ids"] = None
    elif isinstance(raw_vc, list):
        out["visible_calendar_ids"] = [str(x) for x in raw_vc]
    else:
        out["visible_calendar_ids"] = None
    return out


# ---------- Google Calendar (OAuth + REST; mock ids when OAuth / calendar id missing) ----------
async def gcal_push_event(
    calendar_google_id: Optional[str],
    booking: dict,
    acting_user_id: str,
) -> Optional[str]:
    return await google_calendar_client.push_booking_to_google(
        supabase, calendar_google_id, booking, str(acting_user_id)
    )


async def gcal_delete_event(
    calendar_google_id: Optional[str],
    google_event_id: Optional[str],
    acting_user_id: str,
) -> None:
    await google_calendar_client.remove_booking_from_google(
        supabase, calendar_google_id, google_event_id, str(acting_user_id)
    )


ALLOWED_SAUCES = frozenset(
    {"photography", "videography", "artist", "filmmaker", "model"}
)


# ---------- Models ----------
class RegisterIn(BaseModel):
    invite_token: str
    name: str
    password: str
    phone_e164: str
    sauce: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class InviteIn(BaseModel):
    email: EmailStr


class AvailabilitySlot(BaseModel):
    """weekday matches JS Date.getDay(): 0=Sunday … 6=Saturday."""

    weekday: int
    start: str
    end: str

    @field_validator("weekday")
    @classmethod
    def _weekday_range(cls, v: int) -> int:
        if v < 0 or v > 6:
            raise ValueError("weekday must be 0–6")
        return v

    @model_validator(mode="after")
    def _start_before_end(self):
        a = str(self.start or "")[:5]
        b = str(self.end or "")[:5]
        if not a or not b or a >= b:
            raise ValueError("each slot needs start < end (HH:MM)")
        return self


class CalendarIn(BaseModel):
    name: str
    color: str
    google_calendar_id: Optional[str] = ""
    is_active: bool = True
    availability_weekly: Optional[List[AvailabilitySlot]] = None


class GoogleCalendarImportItem(BaseModel):
    google_calendar_id: str
    name: Optional[str] = None
    color: Optional[str] = None


class GoogleCalendarImportIn(BaseModel):
    items: List[GoogleCalendarImportItem]


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


class BookingUpdateIn(BaseModel):
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    calendar_id: Optional[str] = None


class ApproveDenyIn(BaseModel):
    message: Optional[str] = ""


class StripeCheckoutCreateIn(BaseModel):
    amount_cents: int
    currency: Optional[str] = "usd"


class DisableIn(BaseModel):
    disabled: bool


class RolePatchIn(BaseModel):
    role: str


class AdminUserProfilePatchIn(BaseModel):
    phone_e164: Optional[str] = None
    sauce: Optional[str] = None


class MePhonePatchIn(BaseModel):
    phone_e164: str
    password: str


class VisibleCalendarsIn(BaseModel):
    # null = unrestricted (all active calendars). [] = no calendars.
    visible_calendar_ids: Optional[list[str]] = None


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


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

    try:
        app.state.google_inbound_task = asyncio.create_task(google_inbound_sync.google_inbound_background_loop(supabase))
    except Exception as e:
        logger.warning("Google inbound background sync task not started: %s", e)


# ---------- Public assets (no auth; invite fallback — file is frontend brand/logo.png, build preferred) ----------
@api.get("/public/brand-logo.png")
async def public_brand_logo_png():
    if not BRAND_LOGO_PATH.is_file():
        raise HTTPException(status_code=404, detail="Brand logo file missing on server")
    return FileResponse(
        BRAND_LOGO_PATH,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=604800"},
    )


@api.get("/public/version")
async def public_version():
    """
    Debug endpoint to verify which code is deployed on Railway.
    Safe: no secrets, just commit-ish + template version.
    """
    sha = (
        os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or os.environ.get("GIT_COMMIT_SHA")
        or os.environ.get("VERCEL_GIT_COMMIT_SHA")
        or os.environ.get("RENDER_GIT_COMMIT")
        or ""
    )
    return {
        "git_sha": sha[:12] if sha else "",
        "invite_email_template_version": getattr(invite_email, "INVITE_EMAIL_TEMPLATE_VERSION", ""),
        # True only if INVITE_FROM_EMAIL + (RESEND_API_KEY or SMTP_HOST) — no secrets exposed
        "invite_email_ready": invite_email.invite_email_delivery_configured(),
    }


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
    return {
        "token": token,
        "user": _auth_user_out(user),
    }


@api.post("/auth/password/change")
async def password_change(data: PasswordChangeIn, user: dict = Depends(get_current_user)):
    if data.new_password == data.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current one")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    res = supabase.table("users").select("password_hash").eq("id", user["id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_pw(data.current_password, res.data[0].get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    supabase.table("users").update({"password_hash": hash_pw(data.new_password)}).eq("id", user["id"]).execute()
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _auth_user_out(user)


@api.patch("/auth/me/phone")
async def me_phone_patch(data: MePhonePatchIn, user: dict = Depends(get_current_user)):
    try:
        phone_norm = _normalize_phone_e164(data.phone_e164)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    res = supabase.table("users").select("password_hash").eq("id", user["id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    row = res.data[0]
    uid = str(user["id"])
    if not verify_pw(data.password, row.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Incorrect password")
    supabase.table("users").update({"phone_e164": phone_norm}).eq("id", uid).execute()
    fr = supabase.table("users").select("*").eq("id", uid).limit(1).execute()
    rows = fr.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="User not found after update")
    return {"ok": True, "user": _auth_user_out(rows[0])}


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
    sauce_key = (data.sauce or "").strip().lower()
    if sauce_key not in ALLOWED_SAUCES:
        raise HTTPException(status_code=400, detail="Pick a valid option for what's your sauce")
    try:
        phone_norm = _normalize_phone_e164(data.phone_e164)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    user_id = str(uuid.uuid4())
    supabase.table("users").insert({
        "id": user_id,
        "email": email,
        "name": data.name,
        "role": "member",
        "password_hash": hash_pw(data.password),
        "created_at": now_iso(),
        "phone_e164": phone_norm,
        "sauce": sauce_key,
    }).execute()
    supabase.table("invites").update({"used": True, "used_at": now_iso()}).eq("invite_token", data.invite_token).execute()
    token = create_token(user_id, email, "member")
    uout = {
        "id": user_id,
        "email": email,
        "name": data.name,
        "role": "member",
        "created_at": now_iso(),
        "is_disabled": False,
        "phone_e164": phone_norm,
        "sauce": sauce_key,
    }
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
    email_sent = False
    email_error: Optional[str] = None
    email_provider: Optional[str] = None
    email_provider_id: Optional[str] = None
    if invite_email.invite_email_delivery_configured():
        inviter_name = (str(admin.get("name") or "").strip() or None)
        sent, err_detail, provider_id = await invite_email.send_invite_magic_link(
            to_email=email,
            invite_link=link,
            inviter_name=inviter_name,
        )
        email_sent = sent
        if sent:
            logger.info("Invite email sent to %s", email)
            email_provider = "resend" if (os.environ.get("RESEND_API_KEY") or "").strip() else "smtp"
            email_provider_id = provider_id
        else:
            email_error = err_detail
            logger.warning("Invite created but email not delivered to %s: %s", email, err_detail)
    else:
        email_error = (
            "Email not configured on the server: set RESEND_API_KEY + INVITE_FROM_EMAIL "
            "(or SMTP_*) in backend/.env, then restart the API."
        )
        logger.info("[INVITE] No email transport configured. Magic link for %s: %s", email, link)

    return {
        "id": doc["id"],
        "email": email,
        "invite_link": link,
        "expires_at": doc["expires_at"],
        "email_sent": email_sent,
        "email_error": email_error,
        "email_provider": email_provider,
        "email_provider_id": email_provider_id,
    }


@api.get("/invites")
async def list_invites(admin: dict = Depends(require_admin)):
    res = supabase.table("invites").select("*").order("created_at", desc=True).execute()
    items = [it for it in (res.data or []) if not _is_integration_test_account_email(it.get("email"))]
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
    if not can_access_members_page(user, p):
        raise HTTPException(status_code=403, detail="Not allowed")
    res = supabase.table("users").select(
        "id,email,name,role,is_disabled,created_at,visible_calendar_ids,phone_e164,sauce"
    ).order("created_at", desc=True).execute()
    rows = res.data or []
    return [u for u in rows if not _is_integration_test_account_email(u.get("email"))]


@api.get("/members/bootstrap")
async def members_bootstrap(user: dict = Depends(get_current_user)):
    """Single response for the Members page (replaces 3–4 sequential client calls)."""
    p = user_permissions_for(user)
    if not can_access_members_page(user, p):
        raise HTTPException(status_code=403, detail="Not allowed")
    res = supabase.table("users").select(
        "id,email,name,role,is_disabled,created_at,visible_calendar_ids,phone_e164,sauce"
    ).order("created_at", desc=True).execute()
    rows = res.data or []
    users_out = [u for u in rows if not _is_integration_test_account_email(u.get("email"))]

    is_admin = user.get("role") == "admin"
    can_cal_dir = is_admin or permissions.has(p, "assign_member_calendars")

    invites_out: List[dict] = []
    if is_admin:
        inv_res = supabase.table("invites").select("*").order("created_at", desc=True).execute()
        for it in inv_res.data or []:
            if _is_integration_test_account_email(it.get("email")):
                continue
            row = dict(it)
            row["invite_link"] = f"{FRONTEND_URL}/invite/{row['invite_token']}"
            invites_out.append(row)

    perm_out: Optional[dict] = None
    if is_admin:
        stored = get_stored_role_permissions()
        perm_out = {
            "definitions": permissions.definitions_for_api(),
            "effective": {
                "member": permissions.merge_with_defaults("member", stored.get("member")),
                "manager": permissions.merge_with_defaults("manager", stored.get("manager")),
            },
            "stored": stored,
        }

    calendars_out: Optional[List[dict]] = None
    if can_cal_dir:
        c_res = supabase.table("calendars").select("*").eq("is_active", True).order("created_at").execute()
        calendars_out = [_calendar_enriched(c) for c in (c_res.data or [])]

    return {
        "users": users_out,
        "invites": invites_out,
        "permissions": perm_out,
        "calendars": calendars_out,
    }


@api.patch("/users/{user_id}/visible-calendars")
async def set_user_visible_calendars(
    user_id: str, data: VisibleCalendarsIn, requester: dict = Depends(get_current_user)
):
    p = user_permissions_for(requester)
    if not (requester.get("role") == "admin" or permissions.has(p, "assign_member_calendars")):
        raise HTTPException(status_code=403, detail="Not allowed to assign calendar access")
    t_res = supabase.table("users").select("id,role").eq("id", user_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    if t_res.data[0].get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admins always have access to all calendars")
    act = supabase.table("calendars").select("id").eq("is_active", True).execute()
    active_ids = {c["id"] for c in (act.data or [])}
    raw = data.visible_calendar_ids
    to_store: Any
    if raw is None:
        to_store = None
    else:
        ids = [str(x) for x in raw]
        for cid in ids:
            if cid not in active_ids:
                raise HTTPException(status_code=400, detail=f"Unknown or inactive calendar: {cid}")
        to_store = list(dict.fromkeys(ids))
    supabase.table("users").update({"visible_calendar_ids": to_store}).eq("id", user_id).execute()
    row = supabase.table("users").select("*").eq("id", user_id).single().execute()
    u = dict(row.data)
    u.pop("password_hash", None)
    return {
        "ok": True,
        "id": user_id,
        "visible_calendar_ids": _auth_user_out(u).get("visible_calendar_ids"),
    }


@api.patch("/users/{user_id}/role")
async def set_user_role(user_id: str, data: RolePatchIn, admin: dict = Depends(require_admin)):
    if data.role not in ("member", "manager", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot change your own role here.")
    res = supabase.table("users").select("id,role,email").eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    target = res.data[0]
    target_email = str(target.get("email") or "").strip().lower()
    if data.role == "admin" and target_email != PRIMARY_ADMIN_EMAIL:
        raise HTTPException(
            status_code=400,
            detail="Only the designated administrator account can have the admin role.",
        )
    if target_email == PRIMARY_ADMIN_EMAIL and data.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="The administrator account cannot be assigned a different role.",
        )
    supabase.table("users").update({"role": data.role}).eq("id", user_id).execute()
    return {"ok": True, "id": user_id, "role": data.role}


@api.patch("/users/{user_id}/profile")
async def patch_user_profile(user_id: str, data: AdminUserProfilePatchIn, admin: dict = Depends(require_admin)):
    if data.phone_e164 is None and data.sauce is None:
        raise HTTPException(status_code=400, detail="Provide phone_e164 and/or sauce")
    res = supabase.table("users").select("id,email").eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    target = res.data[0]
    if _is_primary_admin(target) and not _is_primary_admin(admin):
        raise HTTPException(status_code=403, detail="Not allowed")
    upd: dict[str, Any] = {}
    if data.phone_e164 is not None:
        try:
            upd["phone_e164"] = _normalize_phone_e164(data.phone_e164)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if data.sauce is not None:
        sk = (data.sauce or "").strip().lower()
        if sk not in ALLOWED_SAUCES:
            raise HTTPException(status_code=400, detail="Pick a valid option for what's your sauce")
        upd["sauce"] = sk
    if not upd:
        raise HTTPException(status_code=400, detail="No changes")
    supabase.table("users").update(upd).eq("id", user_id).execute()
    row = supabase.table("users").select("*").eq("id", user_id).single().execute()
    u = dict(row.data)
    u.pop("password_hash", None)
    return {"ok": True, "user": _auth_user_out(u)}


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


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    t_res = supabase.table("users").select("id,role,email").eq("id", user_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    target = t_res.data[0]
    if _is_primary_admin(target):
        raise HTTPException(status_code=400, detail="The administrator account cannot be removed.")
    if target.get("role") == "admin" and not _is_primary_admin(admin):
        raise HTTPException(status_code=400, detail="Admin accounts cannot be deleted.")
    b_res = supabase.table("bookings").select("id").eq("member_id", user_id).execute()
    b_ids = [str(b["id"]) for b in (b_res.data or [])]
    if b_ids:
        supabase.table("notifications").delete().in_("booking_id", b_ids).execute()
    supabase.table("notifications").delete().eq("user_id", user_id).execute()
    supabase.table("bookings").delete().eq("member_id", user_id).execute()
    supabase.table("google_tokens").delete().eq("user_id", str(user_id)).execute()
    supabase.table("users").delete().eq("id", user_id).execute()
    return {"ok": True, "id": user_id}


@api.delete("/invites/{invite_id}")
async def delete_invite(invite_id: str, admin: dict = Depends(require_admin)):
    check = supabase.table("invites").select("id").eq("id", invite_id).limit(1).execute()
    if not check.data:
        raise HTTPException(status_code=404, detail="Invite not found")
    supabase.table("invites").delete().eq("id", invite_id).execute()
    return {"ok": True, "id": invite_id}


# ---------- Google Calendar OAuth (admin) ----------
@api.post("/integrations/google/start")
async def google_oauth_start(
    _admin: dict = Depends(require_admin),
    payload: Optional[dict] = Body(None),
):
    if not google_calendar_client.oauth_client_configured():
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to the server .env file.",
        )
    data = payload if isinstance(payload, dict) else {}
    reconnect = bool(data.get("reconnect"))
    login_hint: Optional[str] = None
    if reconnect:
        prev = google_calendar_client.read_google_tokens_row(supabase, str(_admin["id"])) or {}
        login_hint = prev.get("email") if isinstance(prev.get("email"), str) else None
    state = jwt.encode(
        {
            "purpose": "gcal_oauth",
            "sub": _admin["id"],
            "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        },
        JWT_SECRET,
        algorithm=JWT_ALG,
    )
    return {
        "authorization_url": google_calendar_client.build_google_authorization_url(state, login_hint=login_hint),
    }


@api.get("/integrations/google/callback")
async def google_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    base = _frontend_profile_url()
    if error:
        return RedirectResponse(f"{base}?google=error&reason={quote_plus(error)}")
    if not code or not state:
        return RedirectResponse(f"{base}?google=error&reason=missing_code")
    try:
        payload = jwt.decode(state, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("purpose") != "gcal_oauth":
            return RedirectResponse(f"{base}?google=error&reason=bad_state")
    except jwt.PyJWTError:
        return RedirectResponse(f"{base}?google=error&reason=invalid_or_expired_state")
    try:
        tokens = await google_calendar_client.exchange_authorization_code(code)
    except Exception:
        logger.exception("Google OAuth token exchange failed")
        return RedirectResponse(f"{base}?google=error&reason=token_exchange")
    uid = str(payload.get("sub", ""))
    if not uid:
        return RedirectResponse(f"{base}?google=error&reason=bad_state")
    new_rt = tokens.get("refresh_token")
    existing = google_calendar_client.read_google_tokens_row(supabase, uid) or {}
    rt = new_rt or existing.get("refresh_token")
    if not rt:
        return RedirectResponse(f"{base}?google=error&reason=no_refresh_token")
    access = tokens.get("access_token")
    if not access:
        return RedirectResponse(f"{base}?google=error&reason=no_access_token")
    email = await google_calendar_client.fetch_google_account_email(access)
    if not email:
        email = str(existing.get("email") or "")
    exp_sec = int(tokens.get("expires_in", 3600))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=max(120, exp_sec - 120))).isoformat()
    try:
        google_calendar_client.upsert_google_tokens(
            supabase,
            uid,
            access_token=access,
            refresh_token=new_rt,
            access_token_expires_at=expires_at,
            email=email,
        )
    except Exception:
        logger.exception("Saving Google OAuth to google_tokens failed (run supabase/006_google_tokens.sql)")
        return RedirectResponse(f"{base}?google=error&reason=config_db")
    return RedirectResponse(f"{base}?google=connected")


# Some hosting setups (custom domains / proxies) may rewrite paths (e.g. stripping "/api").
# Provide a no-prefix alias so OAuth callbacks still resolve.
@app.get("/integrations/google/callback")
async def google_oauth_callback_alias(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    return await google_oauth_callback(code=code, state=state, error=error)


# ---------- Stripe Connect OAuth + Checkout (admin) ----------
@api.post("/integrations/stripe/start")
async def stripe_oauth_start(_admin: dict = Depends(require_admin)):
    if not stripe_connect_configured():
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured. Add STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID, and STRIPE_CONNECT_REDIRECT_URI to the server environment.",
        )
    state = jwt.encode(
        {
            "purpose": "stripe_oauth",
            "sub": _admin["id"],
            "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        },
        JWT_SECRET,
        algorithm=JWT_ALG,
    )
    qs = {
        "response_type": "code",
        "client_id": STRIPE_CONNECT_CLIENT_ID,
        "scope": "read_write",
        "redirect_uri": STRIPE_CONNECT_REDIRECT_URI,
        "state": state,
    }
    return {"authorization_url": f"https://connect.stripe.com/oauth/authorize?{urlencode(qs)}"}


@api.get("/integrations/stripe/callback")
async def stripe_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    base = _frontend_profile_url()
    if error:
        reason = error_description or error
        return RedirectResponse(f"{base}?stripe=error&reason={quote_plus(reason)}")
    if not code or not state:
        return RedirectResponse(f"{base}?stripe=error&reason=missing_code")
    try:
        payload = jwt.decode(state, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("purpose") != "stripe_oauth":
            return RedirectResponse(f"{base}?stripe=error&reason=bad_state")
    except jwt.PyJWTError:
        return RedirectResponse(f"{base}?stripe=error&reason=invalid_or_expired_state")

    if not stripe_connect_configured():
        return RedirectResponse(f"{base}?stripe=error&reason=server_not_configured")

    try:
        # Uses Stripe secret key as bearer
        resp = stripe.OAuth.token(grant_type="authorization_code", code=code)
        account_id = resp.get("stripe_user_id")
        if not account_id:
            return RedirectResponse(f"{base}?stripe=error&reason=no_account_id")
        write_stripe_connect_status(True, str(account_id))
    except Exception:
        logger.exception("Stripe OAuth token exchange failed")
        return RedirectResponse(f"{base}?stripe=error&reason=token_exchange")

    return RedirectResponse(f"{base}?stripe=connected")


@app.get("/integrations/stripe/callback")
async def stripe_oauth_callback_alias(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    return await stripe_oauth_callback(
        code=code,
        state=state,
        error=error,
        error_description=error_description,
    )


@api.get("/integrations/stripe/status")
async def stripe_status(_admin: dict = Depends(require_admin)):
    return read_stripe_connect_status()


@api.post("/integrations/stripe/disconnect")
async def stripe_disconnect(_admin: dict = Depends(require_admin)):
    write_stripe_connect_status(False, None)
    return {"ok": True}


@api.post("/integrations/stripe/webhook")
async def stripe_webhook(req: Request):
    if not STRIPE_WEBHOOK_SECRET or not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe webhook is not configured.")
    payload = await req.body()
    sig = req.headers.get("stripe-signature")
    if not sig:
        raise HTTPException(status_code=400, detail="Missing Stripe signature header.")
    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=sig, secret=STRIPE_WEBHOOK_SECRET)
    except Exception:
        logger.exception("Stripe webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid signature.")

    etype = str(event.get("type") or "")
    obj = (event.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        session_id = str(obj.get("id") or "")
        payment_intent = obj.get("payment_intent")
        ref_booking_id = str(obj.get("client_reference_id") or "").strip()
        # Update by session id first; fall back to client_reference_id.
        updates = {
            "payment_status": "paid",
            "paid_at": now_iso(),
        }
        if payment_intent:
            updates["stripe_payment_intent_id"] = str(payment_intent)
        try:
            if session_id:
                res = supabase.table("bookings").update(updates).eq("stripe_checkout_session_id", session_id).execute()
                if res.data:
                    return {"ok": True}
            if ref_booking_id:
                supabase.table("bookings").update(updates).eq("id", ref_booking_id).execute()
        except Exception:
            logger.exception("Stripe webhook booking update failed")
            raise HTTPException(status_code=500, detail="Update failed.")
    return {"ok": True}


@api.get("/integrations/google/status")
async def google_oauth_status(_admin: dict = Depends(require_admin)):
    return google_calendar_client.user_google_connection_summary(supabase, str(_admin["id"]))


@api.get("/integrations/google/calendar-list")
async def google_calendar_list(_admin: dict = Depends(require_admin)):
    items = await google_calendar_client.list_calendars_for_viewer(supabase, str(_admin["id"]))
    if not items:
        summary = google_calendar_client.user_google_connection_summary(supabase, str(_admin["id"]))
        if not summary.get("connected"):
            raise HTTPException(status_code=400, detail="Connect Google first, then try again.")
    return items


@api.post("/integrations/google/disconnect")
async def google_oauth_disconnect(_admin: dict = Depends(require_admin)):
    google_calendar_client.delete_google_tokens(supabase, str(_admin["id"]))
    return {"ok": True}


@api.post("/integrations/google/sync-inbound")
async def google_sync_inbound_now(_admin: dict = Depends(require_admin)):
    """Pull timed events from mapped Google calendars into bookings (Acuity, Cal.com, etc.)."""
    stats = await google_inbound_sync.run_google_inbound_sync(supabase)
    return stats


def _normalize_hex_color(value: Optional[str], fallback: str) -> str:
    s = (value or "").strip()
    if re.match(r"^#[0-9A-Fa-f]{6}$", s):
        return s
    if re.match(r"^[0-9A-Fa-f]{6}$", s):
        return "#" + s
    fb = (fallback or "").strip()
    if re.match(r"^#[0-9A-Fa-f]{6}$", fb):
        return fb
    if re.match(r"^[0-9A-Fa-f]{6}$", fb):
        return "#" + fb
    return "#3788d8"


@api.post("/integrations/google/import-calendars")
async def google_import_calendars(data: GoogleCalendarImportIn, admin: dict = Depends(require_admin)):
    """Create Studio resources from Google calendars (writable only); uses DB default availability."""
    summ = google_calendar_client.user_google_connection_summary(supabase, str(admin["id"]))
    if not summ.get("connected"):
        raise HTTPException(status_code=400, detail="Connect Google first.")
    items_in = data.items or []
    if not items_in:
        raise HTTPException(status_code=400, detail="Select at least one Google calendar.")
    remote = await google_calendar_client.list_calendars_for_viewer(supabase, str(admin["id"]))
    by_id = {str(r["id"]): r for r in remote}
    created: List[dict] = []
    skipped = 0
    for it in items_in:
        gid = (it.google_calendar_id or "").strip()
        if not gid or gid not in by_id:
            raise HTTPException(status_code=400, detail=f"Unknown Google calendar: {gid}")
        meta = by_id[gid]
        role = str(meta.get("accessRole") or "").lower()
        if role not in ("owner", "writer"):
            raise HTTPException(
                status_code=400,
                detail=f"Calendar “{meta.get('summary', gid)}” is read-only in Google. Choose a calendar you can edit.",
            )
        dup = supabase.table("calendars").select("id").eq("google_calendar_id", gid).limit(1).execute()
        if dup.data:
            skipped += 1
            continue
        name = (it.name or "").strip() or str(meta.get("summary") or "Calendar")
        fb = str(meta.get("backgroundColor") or "").strip()
        color = _normalize_hex_color(it.color, fb)
        cid = str(uuid.uuid4())
        row: dict[str, Any] = {
            "id": cid,
            "name": name[:200],
            "color": color,
            "google_calendar_id": gid,
            "is_active": True,
            "created_at": now_iso(),
        }
        res = supabase.table("calendars").insert(row).execute()
        if res.data:
            created.append(_calendar_enriched(res.data[0]))
    return {"imported": created, "skipped_duplicates": skipped}


# ---------- Calendars ----------
@api.get("/calendars/directory")
async def list_calendars_directory(user: dict = Depends(get_current_user)):
    """All active calendars for admin / assignMember UI (ignores per-user schedule scope)."""
    p = user_permissions_for(user)
    if user.get("role") != "admin" and not permissions.has(p, "assign_member_calendars"):
        raise HTTPException(status_code=403, detail="Not allowed")
    res = supabase.table("calendars").select("*").eq("is_active", True).order("created_at").execute()
    return [_calendar_enriched(c) for c in (res.data or [])]


@api.get("/calendars")
async def list_calendars(user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "view_schedule"):
        raise HTTPException(status_code=403, detail="Calendar is not available for this account")
    q = supabase.table("calendars").select("*")
    if user.get("role") != "admin":
        q = q.eq("is_active", True)
    res = q.order("created_at").execute()
    cals = [_calendar_enriched(c) for c in (res.data or [])]
    scope = calendar_id_scope_for_user(user, p)
    if scope is not None:
        cals = [c for c in cals if c.get("id") in scope]
    return cals


@api.post("/calendars")
async def create_calendar(data: CalendarIn, _admin: dict = Depends(require_admin)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Calendar name is required.")
    if len(name) > 200:
        raise HTTPException(status_code=400, detail="Calendar name is too long.")
    cid = str(uuid.uuid4())
    row: dict[str, Any] = {
        "id": cid,
        "name": name,
        "color": (data.color or "#222222").strip() or "#222222",
        "google_calendar_id": (data.google_calendar_id or "").strip(),
        "is_active": bool(data.is_active),
        "created_at": now_iso(),
    }
    if data.availability_weekly is not None:
        row["availability_weekly"] = [s.model_dump() for s in data.availability_weekly]
    res = supabase.table("calendars").insert(row).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Could not create calendar.")
    return _calendar_enriched(res.data[0])


@api.patch("/calendars/{cal_id}")
async def update_calendar(cal_id: str, data: CalendarIn, admin: dict = Depends(require_admin)):
    pre = supabase.table("calendars").select("name").eq("id", cal_id).execute()
    if not pre.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    upd: dict[str, Any] = {
        "name": data.name,
        "color": data.color,
        "google_calendar_id": data.google_calendar_id or "",
        "is_active": data.is_active,
    }
    if data.availability_weekly is not None:
        upd["availability_weekly"] = [s.model_dump() for s in data.availability_weekly]
    res = supabase.table("calendars").update(upd).eq("id", cal_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return _calendar_enriched(res.data[0])


@api.delete("/calendars/{cal_id}")
async def delete_calendar(cal_id: str, admin: dict = Depends(require_admin)):
    pre = supabase.table("calendars").select("name").eq("id", cal_id).execute()
    if not pre.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    res = supabase.table("calendars").delete().eq("id", cal_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return {"ok": True}


# ---------- Bookings ----------
def _booking_times_valid(date: str, start_time: str, end_time: str) -> bool:
    if not date or not start_time or not end_time:
        return False
    return start_time < end_time


def _norm_hm(t: str) -> str:
    s = str(t or "")
    return s[:5] if len(s) >= 5 else s


def _js_weekday_from_iso_date(date_str: str) -> int:
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    return (d.weekday() + 1) % 7


def _booking_fits_calendar_availability(cal: dict, date_str: str, start: str, end: str) -> bool:
    raw = cal.get("availability_weekly")
    if raw is None:
        return True
    if isinstance(raw, str):
        try:
            import json

            raw = json.loads(raw)
        except Exception:
            return True
    if not isinstance(raw, list):
        return True
    if len(raw) == 0:
        return False
    wd = _js_weekday_from_iso_date(date_str)
    st = _norm_hm(start)
    et = _norm_hm(end)
    if st >= et:
        return False
    for block in raw:
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


def _bookings_time_overlap(a0: str, a1: str, b0: str, b1: str) -> bool:
    return _norm_hm(a0) < _norm_hm(b1) and _norm_hm(a1) > _norm_hm(b0)


def _calendar_has_booking_conflict(
    calendar_id: str,
    date_str: str,
    start: str,
    end: str,
    exclude_booking_id: Optional[str] = None,
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
        if exclude_booking_id and str(row.get("id")) == str(exclude_booking_id):
            continue
        if _bookings_time_overlap(start, end, str(row.get("start_time")), str(row.get("end_time"))):
            return True
    return False


def _can_user_modify_booking(user: dict, perms: dict, b: dict) -> bool:
    if b.get("status") not in ("pending", "approved"):
        return False
    if str(b.get("source") or "") == "google_external":
        return permissions.has(perms, "delete_any_booking") or permissions.has(perms, "create_manual_booking")
    if str(b.get("member_id")) == str(user["id"]):
        return True
    if permissions.has(perms, "delete_any_booking"):
        return True
    if permissions.has(perms, "create_manual_booking"):
        return True
    return False


def _strip_venue_from_text(s: Any) -> str:
    """Remove venue fragments like 'Studio 7 Miami' / 'Studio 7' from imported event text."""
    if not s:
        return ""
    t = str(s).strip()
    t = re.sub(r"\s*\n+\s*", " ", t).strip()
    t = re.sub(r"^Google Calendar ·\s*", "", t, flags=re.I).strip()
    t = re.sub(r"^studio\s+7\s+miami\s*[·\-–—@|:]\s*", "", t, flags=re.I).strip()
    # Remove any parenthetical containing "Studio 7" (supports full-width parentheses too).
    t = re.sub(r"\s*[（(]\s*[^）)]*studio\s*7[^）)]*[)）]\s*", " ", t, flags=re.I).strip()
    # Remove remaining bare venue mentions.
    t = re.sub(r"\bstudio\s*7\s*miami\b", " ", t, flags=re.I).strip()
    t = re.sub(r"\bstudio\s*7\b", " ", t, flags=re.I).strip()
    # Cleanup leftover empty parens / separators.
    t = re.sub(r"[（(]\s*[)）]", " ", t).strip()
    t = re.sub(r"^\s*(?:@|·|\||—|-|:|,|;)\s*", "", t).strip()
    t = re.sub(r"\s*[:·\-–—]\s*$", "", t).strip()
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t


def _serialize_booking(b: dict, viewer: dict, users_by_id: dict, viewer_perms: Optional[dict] = None) -> dict:
    perms = viewer_perms if viewer_perms is not None else user_permissions_for(viewer)
    mid = b.get("member_id")
    is_owner = mid is not None and str(mid) == str(viewer["id"])
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
    if str(b.get("source") or "") == "google_external":
        base["external_title"] = b.get("external_title")
    if can_see_detail:
        mid_raw = b.get("member_id")
        owner = users_by_id.get(str(mid_raw)) if mid_raw is not None else None
        disp_name = owner["name"] if owner else None
        if not disp_name and str(b.get("source") or "") == "google_external":
            disp_name = b.get("external_title") or "Booked (external)"
        base.update({
            "notes": _strip_venue_from_text(b.get("notes", "")),
            "member_id": b.get("member_id"),
            "member_name": disp_name,
            "member_email": owner["email"] if owner else None,
            "member_phone_e164": owner.get("phone_e164") if owner else None,
            "member_sauce": owner.get("sauce") if owner else None,
            "google_event_id": b.get("google_event_id"),
            "created_at": b.get("created_at"),
            "approval_message": b.get("approval_message", ""),
            "payment_required": bool(b.get("payment_required")),
            "payment_status": b.get("payment_status") or "unpaid",
            "payment_amount_cents": b.get("payment_amount_cents"),
            "payment_currency": b.get("payment_currency") or "usd",
            "stripe_checkout_url": b.get("stripe_checkout_url"),
            "paid_at": b.get("paid_at"),
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
    scope = calendar_id_scope_for_user(user, p)
    if scope is not None:
        raw = [b for b in raw if b.get("calendar_id") in scope]
    member_ids = list({str(b["member_id"]) for b in raw if b.get("member_id")})
    users_by_id: dict[str, Any] = {}
    if member_ids:
        users_res = supabase.table("users").select("id,name,email,phone_e164,sauce").in_("id", member_ids).execute()
        users_by_id = {str(u["id"]): u for u in (users_res.data or [])}
    return [_serialize_booking(b, user, users_by_id, p) for b in raw]


@api.get("/bookings/requests")
async def list_requests(user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "view_schedule"):
        raise HTTPException(status_code=403, detail="Not allowed")
    mod = permissions.has(p, "approve_deny_requests")
    q = supabase.table("bookings").select("*")
    if mod:
        q = q.in_("status", ["pending", "approved", "denied"]).order("created_at", desc=True)
    else:
        q = q.eq("member_id", user["id"]).in_("status", ["pending", "approved"]).order("created_at", desc=True)
    res = q.execute()
    raw = res.data or []
    if not mod:
        uid = str(user.get("id") or "")
        raw = [b for b in raw if str(b.get("member_id") or "") == uid]
    if mod:
        sc = calendar_id_scope_for_user(user, p)
        if sc is not None:
            raw = [b for b in raw if b.get("calendar_id") in sc]
    member_ids = list({str(b["member_id"]) for b in raw if b.get("member_id")})
    users_by_id: dict[str, Any] = {}
    if member_ids:
        users_res = supabase.table("users").select("id,name,email,phone_e164,sauce").in_("id", member_ids).execute()
        users_by_id = {str(u["id"]): u for u in (users_res.data or [])}
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
    _assert_calendar_in_scope(user, p, data.calendar_id)
    if not _booking_times_valid(data.date, data.start_time, data.end_time):
        raise HTTPException(status_code=400, detail="End time must be after start time")
    if not _booking_fits_calendar_availability(cal, data.date, data.start_time, data.end_time):
        raise HTTPException(
            status_code=400,
            detail="That time is outside this calendar's available hours. Pick another slot or ask an admin.",
        )
    if _calendar_has_booking_conflict(data.calendar_id, data.date, data.start_time, data.end_time):
        raise HTTPException(status_code=400, detail="This time overlaps another booking on that calendar.")
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
    for row in (
        supabase.table("users")
        .select("id,role,visible_calendar_ids")
        .eq("is_disabled", False)
        .in_("role", ["admin", "manager"])
        .execute()
        .data
        or []
    ):
        uid = row["id"]
        if row.get("role") == "admin":
            target_ids.add(uid)
        elif row.get("role") == "manager" and mgr_may_approve:
            mp = permissions.resolve_effective("manager", stored)
            if not permissions.has(mp, "approve_deny_requests"):
                continue
            mscope = calendar_id_scope_for_user(row, mp)
            if mscope is not None and data.calendar_id not in mscope:
                continue
            target_ids.add(uid)
    for a_id in target_ids:
        supabase.table("notifications").insert({
            "id": str(uuid.uuid4()),
            "user_id": a_id,
            "booking_id": booking["id"],
            "type": "request_submitted",
            "title": "New request",
            "message": (
                f"{user['name']} · {cal['name']}\n"
                f"{_format_request_pretty_date(data.date)} · {_format_request_time_range(data.start_time, data.end_time)}"
            ),
            "is_read": False,
            "created_at": now_iso(),
        }).execute()
    supabase.table("notifications").insert({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "booking_id": booking["id"],
        "type": "request_confirmed",
        "title": "Request received",
        "message": (
            f"Your request for {_format_request_pretty_date(data.date)} at "
            f"{_format_request_time_point(data.start_time)} is in. We'll get back to you soon."
        ),
        "is_read": False,
        "created_at": now_iso(),
    }).execute()
    return booking


@api.patch("/bookings/{booking_id}")
async def patch_booking(booking_id: str, data: BookingUpdateIn, user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    res = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    b = res.data[0]
    if not _can_user_modify_booking(user, p, b):
        raise HTTPException(status_code=403, detail="Not allowed to update this booking")
    _assert_calendar_in_scope(user, p, b.get("calendar_id", ""))
    if str(b.get("source") or "") == "google_external":
        raise HTTPException(
            status_code=400,
            detail="This slot is synced from Google Calendar (e.g. Acuity/Cal.com). Edit the event in Google, or ask an admin to remove the mirror in Studio 7.",
        )

    raw = data.model_dump(exclude_unset=True)
    updates: dict[str, Any] = {}
    if "date" in raw and raw["date"] is not None:
        updates["date"] = raw["date"]
    if "start_time" in raw and raw["start_time"] is not None:
        updates["start_time"] = raw["start_time"]
    if "end_time" in raw and raw["end_time"] is not None:
        updates["end_time"] = raw["end_time"]
    if "notes" in raw:
        updates["notes"] = raw["notes"] if raw["notes"] is not None else ""

    is_owner = str(b.get("member_id")) == str(user["id"])
    can_staff = permissions.has(p, "delete_any_booking") or permissions.has(p, "create_manual_booking")
    if "calendar_id" in raw and raw["calendar_id"] is not None and str(raw["calendar_id"]) != str(b.get("calendar_id")):
        if not can_staff:
            raise HTTPException(status_code=403, detail="Only staff can move a booking to another calendar")
        _assert_calendar_in_scope(user, p, str(raw["calendar_id"]))
        updates["calendar_id"] = str(raw["calendar_id"])

    if not updates:
        users_res = supabase.table("users").select("id,name,email,phone_e164,sauce").execute()
        users_by_id = {u["id"]: u for u in (users_res.data or [])}
        return _serialize_booking(b, user, users_by_id, p)

    merged = {**b, **updates}
    d = str(merged.get("date", ""))
    st = str(merged.get("start_time", ""))
    et = str(merged.get("end_time", ""))
    if not _booking_times_valid(d, st, et):
        raise HTTPException(status_code=400, detail="End time must be after start time")

    time_related = any(k in updates for k in ("date", "start_time", "end_time", "calendar_id"))
    if updates and time_related:
        cal_res2 = supabase.table("calendars").select("*").eq("id", merged.get("calendar_id", b["calendar_id"])).execute()
        cal2 = cal_res2.data[0] if cal_res2.data else {}
        if is_owner and not can_staff:
            if not _booking_fits_calendar_availability(cal2, d, st, et):
                raise HTTPException(
                    status_code=400,
                    detail="That time is outside this calendar's available hours.",
                )
            if _calendar_has_booking_conflict(str(merged.get("calendar_id", b["calendar_id"])), d, st, et, exclude_booking_id=booking_id):
                raise HTTPException(status_code=400, detail="This time overlaps another booking on that calendar.")
        elif can_staff and _calendar_has_booking_conflict(
            str(merged.get("calendar_id", b["calendar_id"])), d, st, et, exclude_booking_id=booking_id
        ):
            raise HTTPException(status_code=400, detail="This time overlaps another booking on that calendar.")

    supabase.table("bookings").update(updates).eq("id", booking_id).execute()
    refreshed = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    row = refreshed.data[0] if refreshed.data else merged

    if row.get("status") == "approved":
        cal_res = supabase.table("calendars").select("*").eq("id", row["calendar_id"]).execute()
        cal = cal_res.data[0] if cal_res.data else {}
        if row.get("google_event_id"):
            await gcal_delete_event(
                cal.get("google_calendar_id"),
                row.get("google_event_id"),
                str(user["id"]),
            )
        gid = await gcal_push_event(cal.get("google_calendar_id"), row, str(user["id"]))
        supabase.table("bookings").update({"google_event_id": gid}).eq("id", booking_id).execute()
        row = {**row, "google_event_id": gid}

    users_res = supabase.table("users").select("id,name,email,phone_e164,sauce").execute()
    users_by_id = {u["id"]: u for u in (users_res.data or [])}
    return _serialize_booking(row, user, users_by_id, p)


@api.post("/bookings/manual")
async def create_manual(data: ManualBookingIn, user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    if not permissions.has(p, "create_manual_booking"):
        raise HTTPException(status_code=403, detail="Manual bookings are not allowed for this account")
    cal_res = supabase.table("calendars").select("*").eq("id", data.calendar_id).execute()
    if not cal_res.data:
        raise HTTPException(status_code=404, detail="Calendar not found")
    cal = cal_res.data[0]
    _assert_calendar_in_scope(user, p, data.calendar_id)
    if not _booking_times_valid(data.date, data.start_time, data.end_time):
        raise HTTPException(status_code=400, detail="End time must be after start time")
    if _calendar_has_booking_conflict(data.calendar_id, data.date, data.start_time, data.end_time):
        raise HTTPException(status_code=400, detail="This time overlaps another booking on that calendar.")
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
    gid = await gcal_push_event(cal.get("google_calendar_id"), booking, str(user["id"]))
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
    _assert_calendar_in_scope(admin, p, b.get("calendar_id", ""))
    if b["status"] != "pending":
        raise HTTPException(status_code=400, detail="Booking not pending")
    cal_res = supabase.table("calendars").select("*").eq("id", b["calendar_id"]).execute()
    cal = cal_res.data[0] if cal_res.data else {}
    gid = await gcal_push_event(cal.get("google_calendar_id"), b, str(admin["id"]))
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
        "message": (
            (data.message.strip() if isinstance(data.message, str) and data.message.strip() else "")
            or f"All confirmed. See you in the space {_format_request_pretty_date(str(b['date']))} at {_format_request_time_point(str(b['start_time']))}. 🌴"
        ),
        "is_read": False,
        "created_at": now_iso(),
    }).execute()
    if invite_email.invite_email_delivery_configured():
        try:
            mem = supabase.table("users").select("email").eq("id", b["member_id"]).single().execute()
            to_em = (mem.data or {}).get("email")
            if to_em:
                base = str(FRONTEND_URL or "").rstrip("/") or "http://localhost:3000"
                sent, err, _provider_id = await invite_email.send_booking_decision_email(
                    to_email=to_em,
                    decision="approved",
                    calendar_name=str(cal.get("name") or "Calendar"),
                    date_str=str(b["date"]),
                    start_time=str(b["start_time"]),
                    end_time=str(b["end_time"]),
                    optional_message=data.message or "",
                    calendar_app_url=f"{base}/requests",
                )
                if not sent:
                    logger.warning("Booking approved email not sent to %s: %s", to_em, err)
        except Exception as e:
            logger.warning("Booking approved email error: %s", e)
    return {"ok": True}


@api.post("/bookings/{booking_id}/payment/checkout")
async def create_booking_checkout(
    booking_id: str,
    data: StripeCheckoutCreateIn,
    mod: dict = Depends(get_current_user),
):
    p = user_permissions_for(mod)
    if not permissions.has(p, "approve_deny_requests"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not stripe_connect_configured():
        raise HTTPException(status_code=503, detail="Stripe is not configured on the server.")
    st = read_stripe_connect_status()
    if not st.get("connected"):
        raise HTTPException(status_code=400, detail="Stripe is not connected. Connect Stripe in Profile → Accounts.")

    amount_cents = int(data.amount_cents or 0)
    currency = str((data.currency or "usd")).lower().strip() or "usd"
    if amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0.")
    # Stripe minimums vary; enforce a safe floor.
    if amount_cents < 50:
        raise HTTPException(status_code=400, detail="Amount is too small.")

    res = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    b = res.data[0]
    _assert_calendar_in_scope(mod, p, b.get("calendar_id", ""))
    if str(b.get("status")) != "approved":
        raise HTTPException(status_code=400, detail="Booking must be approved before creating checkout.")
    if not b.get("member_id"):
        raise HTTPException(status_code=400, detail="Booking is missing a member.")

    cal_res = supabase.table("calendars").select("name").eq("id", b.get("calendar_id")).execute()
    cal_name = str((cal_res.data or [{}])[0].get("name") or "Calendar")

    mem = supabase.table("users").select("email,name").eq("id", b["member_id"]).single().execute()
    mem_email = (mem.data or {}).get("email")
    mem_name = (mem.data or {}).get("name") or "Member"

    base_frontend = str(FRONTEND_URL or "").rstrip("/") or "http://localhost:3000"
    success_url = f"{base_frontend}/requests?stripe=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{base_frontend}/requests?stripe=cancel&booking={quote_plus(str(booking_id))}"

    desc = f"{cal_name} · {b.get('date')} {b.get('start_time')}-{b.get('end_time')}"
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            client_reference_id=str(booking_id),
            customer_email=str(mem_email) if mem_email else None,
            success_url=success_url,
            cancel_url=cancel_url,
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": currency,
                        "unit_amount": amount_cents,
                        "product_data": {
                            "name": "Booking fee",
                            "description": desc,
                        },
                    },
                }
            ],
            metadata={
                "booking_id": str(booking_id),
                "calendar": cal_name,
                "member": str(mem_name),
            },
        )
    except Exception:
        logger.exception("Stripe Checkout Session create failed")
        raise HTTPException(status_code=500, detail="Could not create Stripe checkout session.")

    url = session.get("url")
    sid = session.get("id")
    if not url or not sid:
        raise HTTPException(status_code=500, detail="Stripe did not return a checkout URL.")

    supabase.table("bookings").update(
        {
            "payment_required": True,
            "payment_amount_cents": amount_cents,
            "payment_currency": currency,
            "payment_status": "checkout_created",
            "stripe_checkout_session_id": str(sid),
            "stripe_checkout_url": str(url),
        }
    ).eq("id", booking_id).execute()

    return {"url": str(url)}


@api.post("/bookings/{booking_id}/deny")
async def deny_booking(booking_id: str, data: ApproveDenyIn, mod: dict = Depends(get_current_user)):
    p = user_permissions_for(mod)
    if not permissions.has(p, "approve_deny_requests"):
        raise HTTPException(status_code=403, detail="Not allowed to deny requests")
    res = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    b = res.data[0]
    _assert_calendar_in_scope(mod, p, b.get("calendar_id", ""))
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
        "message": (
            (data.message.strip() if isinstance(data.message, str) and data.message.strip() else "")
            or "This one couldn't be locked in this time. Feel free to find another time that fits"
        ),
        "is_read": False,
        "created_at": now_iso(),
    }).execute()
    cal_res = supabase.table("calendars").select("name").eq("id", b["calendar_id"]).execute()
    cal_name = str((cal_res.data or [{}])[0].get("name") or "Calendar") if cal_res.data else "Calendar"
    if invite_email.invite_email_delivery_configured():
        try:
            mem = supabase.table("users").select("email").eq("id", b["member_id"]).single().execute()
            to_em = (mem.data or {}).get("email")
            if to_em:
                base = str(FRONTEND_URL or "").rstrip("/") or "http://localhost:3000"
                sent, err, _provider_id = await invite_email.send_booking_decision_email(
                    to_email=to_em,
                    decision="denied",
                    calendar_name=cal_name,
                    date_str=str(b["date"]),
                    start_time=str(b["start_time"]),
                    end_time=str(b["end_time"]),
                    optional_message=data.message or "",
                    calendar_app_url=f"{base}/requests",
                )
                if not sent:
                    logger.warning("Booking denied email not sent to %s: %s", to_em, err)
        except Exception as e:
            logger.warning("Booking denied email error: %s", e)
    return {"ok": True}


@api.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, user: dict = Depends(get_current_user)):
    p = user_permissions_for(user)
    res = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Booking not found")
    b = res.data[0]
    is_owner = str(b.get("member_id")) == str(user["id"])
    can_any = permissions.has(p, "delete_any_booking")
    if not can_any:
        if not is_owner:
            raise HTTPException(status_code=403, detail="Not allowed to delete this booking")
        if b.get("status") not in ("pending", "approved"):
            raise HTTPException(status_code=400, detail="This booking cannot be canceled")
    _assert_calendar_in_scope(user, p, b.get("calendar_id", ""))
    cal_res = supabase.table("calendars").select("*").eq("id", b["calendar_id"]).execute()
    cal = cal_res.data[0] if cal_res.data else {}
    if str(b.get("source") or "") != "google_external":
        await gcal_delete_event(
            cal.get("google_calendar_id"),
            b.get("google_event_id"),
            str(user["id"]),
        )
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
    users_res = supabase.table("users").select("id,name,email,phone_e164,sauce").execute()
    users_by_id = {u["id"]: u for u in (users_res.data or [])}
    up = user_permissions_for(user)
    vscope = calendar_id_scope_for_user(user, up)
    if vscope is not None:
        raw = [b for b in raw if b.get("calendar_id") in vscope]
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

raw_cors = os.environ.get("CORS_ORIGINS", "*")
cors_origins = [o.strip() for o in raw_cors.split(",") if o.strip()]
if not cors_origins:
    cors_origins = ["*"]

allow_all = "*" in cors_origins
# Browsers reject `Access-Control-Allow-Credentials: true` when origin is `*`.
cors_allow_credentials = False if allow_all else True

app.add_middleware(
    CORSMiddleware,
    allow_credentials=cors_allow_credentials,
    allow_origins=["*"] if allow_all else cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
