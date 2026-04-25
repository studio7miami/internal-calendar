from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

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
import bcrypt
import jwt
import google_calendar_client
from fastapi import Body, FastAPI, APIRouter, HTTPException, Depends, Request
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import RedirectResponse
from urllib.parse import quote_plus
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
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

app = FastAPI(title="Studio 7 Miami Calendar API")
api = APIRouter(prefix="/api")

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


def create_mfa_login_token(user_id: str) -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "typ": "mfa_login",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        JWT_SECRET,
        algorithm=JWT_ALG,
    )


def parse_mfa_login_token(token: str) -> str:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    if payload.get("typ") != "mfa_login":
        raise ValueError("invalid mfa token type")
    return str(payload["sub"])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


MFA_OTP_TTL_LOGIN = timedelta(minutes=10)
MFA_OTP_TTL_SETUP = timedelta(minutes=10)
MFA_OTP_TTL_DISABLE = timedelta(minutes=10)


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


def _mfa_otp_expired(row: dict) -> bool:
    exp = _parse_utc(row.get("mfa_otp_expires"))
    if not exp:
        return True
    return datetime.now(timezone.utc) > exp


def _hash_mfa_otp(user_id: str, purpose: str, code: str) -> str:
    msg = f"{purpose}:{user_id}:{code}".encode()
    return hmac.new(JWT_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def _gen_mfa_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _normalize_phone_e164(raw: Optional[str]) -> str:
    if not raw or not str(raw).strip():
        raise ValueError("Phone number is required for SMS codes")
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


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "***"
    u, d = email.split("@", 1)
    if len(u) <= 2:
        return f"***@{d}"
    return f"{u[0]}***{u[-1]}@{d}"


def _mask_phone(phone: Optional[str]) -> str:
    if not phone or len(phone) < 4:
        return "***"
    return "***" + phone[-4:]


def _deliver_mfa_stub(user_id: str, channel: str, email: str, phone_e164: Optional[str], code: str) -> None:
    dest = email if channel == "email" else (phone_e164 or "")
    logger.info("[MFA stub] channel=%s dest=%s user_id=%s code=%s", channel, dest, user_id, code)


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
    # Use * so auth works before 002_users_2fa_password.sql is applied (totp_* columns optional).
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
    if u.get("role") == "admin":
        return True
    return bool(
        permissions.has(p, "view_members_directory")
        or permissions.has(p, "assign_member_calendars")
    )


def _auth_user_out(user: dict) -> dict:
    mfa_on = bool(user.get("totp_enabled")) and user.get("mfa_channel") in ("email", "phone")
    purpose = user.get("mfa_otp_purpose")
    pending_setup = (
        bool(user.get("mfa_otp_hash"))
        and purpose == "setup"
        and not _mfa_otp_expired(user)
    )
    out = {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user.get("role", "member"),
        "is_disabled": bool(user.get("is_disabled")),
        "created_at": user.get("created_at"),
        "mfa_enabled": mfa_on,
        "mfa_setup_pending": bool(pending_setup and not mfa_on),
        "mfa_channel": user.get("mfa_channel"),
        "mfa_pending_channel": user.get("mfa_pending_channel"),
        "phone_e164": user.get("phone_e164"),
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


class DisableIn(BaseModel):
    disabled: bool


class RolePatchIn(BaseModel):
    role: str


class VisibleCalendarsIn(BaseModel):
    # null = unrestricted (all active calendars). [] = no calendars.
    visible_calendar_ids: Optional[list[str]] = None


class MfaLoginIn(BaseModel):
    mfa_token: str
    code: str


class MfaCodeIn(BaseModel):
    code: str


class MfaSetupStartIn(BaseModel):
    channel: str  # "email" | "phone"
    phone_e164: Optional[str] = None


class MfaDisableSendIn(BaseModel):
    password: str


class MfaDisableIn(BaseModel):
    password: str
    code: str


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
    mfa_on = bool(user.get("totp_enabled")) and user.get("mfa_channel") in ("email", "phone")
    if mfa_on:
        channel = str(user.get("mfa_channel"))
        if channel == "phone" and not (user.get("phone_e164") or "").strip():
            raise HTTPException(
                status_code=500,
                detail="Two-factor is set to phone but no phone number is on file. Contact an admin.",
            )
        uid = user["id"]
        code = _gen_mfa_code()
        exp = datetime.now(timezone.utc) + MFA_OTP_TTL_LOGIN
        supabase.table("users").update({
            "mfa_otp_hash": _hash_mfa_otp(uid, "login", code),
            "mfa_otp_expires": exp.isoformat(),
            "mfa_otp_purpose": "login",
        }).eq("id", uid).execute()
        _deliver_mfa_stub(
            uid,
            channel,
            str(user.get("email") or ""),
            user.get("phone_e164") if channel == "phone" else None,
            code,
        )
        hint = _mask_email(str(user.get("email") or "")) if channel == "email" else _mask_phone(user.get("phone_e164"))
        return {
            "mfa_required": True,
            "mfa_token": create_mfa_login_token(uid),
            "mfa_sent_via": channel,
            "mfa_sent_hint": hint,
        }
    token = create_token(user["id"], user["email"], user["role"])
    return {
        "token": token,
        "user": _auth_user_out(user),
    }


@api.post("/auth/login/mfa")
async def login_mfa(data: MfaLoginIn):
    try:
        uid = parse_mfa_login_token(data.mfa_token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Verification step expired. Sign in again.")
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid verification step")
    res = supabase.table("users").select("*").eq("id", uid).execute()
    if not res.data:
        raise HTTPException(status_code=401, detail="User not found")
    user = res.data[0]
    if user.get("is_disabled"):
        raise HTTPException(status_code=403, detail="This account has been disabled. Please contact the admin.")
    if not user.get("totp_enabled") or user.get("mfa_channel") not in ("email", "phone"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is not active for this account")
    code = (data.code or "").strip().replace(" ", "")
    if len(code) < 6:
        raise HTTPException(status_code=400, detail="Enter the 6-digit code we sent you")
    if user.get("mfa_otp_purpose") != "login" or not user.get("mfa_otp_hash") or _mfa_otp_expired(user):
        raise HTTPException(status_code=401, detail="Code expired. Sign in again with your password.")
    if _hash_mfa_otp(uid, "login", code) != user.get("mfa_otp_hash"):
        raise HTTPException(status_code=401, detail="Invalid code")
    supabase.table("users").update({
        "mfa_otp_hash": None,
        "mfa_otp_expires": None,
        "mfa_otp_purpose": None,
    }).eq("id", uid).execute()
    token = create_token(user["id"], user["email"], user["role"])
    fr = supabase.table("users").select("*").eq("id", uid).limit(1).execute()
    row = fr.data[0] if fr.data else user
    return {
        "token": token,
        "user": _auth_user_out(row),
    }


@api.post("/auth/mfa/setup")
async def mfa_setup(body: MfaSetupStartIn, user: dict = Depends(get_current_user)):
    if user.get("totp_enabled") and user.get("mfa_channel") in ("email", "phone"):
        raise HTTPException(status_code=400, detail="Turn off 2FA before changing how you receive codes")
    ch = (body.channel or "").lower().strip()
    if ch not in ("email", "phone"):
        raise HTTPException(status_code=400, detail="Choose email or phone for verification codes")
    phone_norm: Optional[str] = None
    if ch == "phone":
        try:
            phone_norm = _normalize_phone_e164(body.phone_e164)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    uid = user["id"]
    code = _gen_mfa_code()
    exp = datetime.now(timezone.utc) + MFA_OTP_TTL_SETUP
    upd: dict[str, Any] = {
        "mfa_otp_hash": _hash_mfa_otp(uid, "setup", code),
        "mfa_otp_expires": exp.isoformat(),
        "mfa_otp_purpose": "setup",
        "mfa_pending_channel": ch,
        "totp_pending_secret": None,
    }
    if ch == "phone":
        upd["phone_e164"] = phone_norm
    supabase.table("users").update(upd).eq("id", uid).execute()
    fr = supabase.table("users").select("email,phone_e164").eq("id", uid).limit(1).execute()
    row = fr.data[0] if fr.data else user
    em = str(row.get("email") or user.get("email") or "")
    ph = row.get("phone_e164") if ch == "phone" else None
    _deliver_mfa_stub(uid, ch, em, ph if ch == "phone" else None, code)
    hint = _mask_email(em) if ch == "email" else _mask_phone(row.get("phone_e164"))
    return {"channel": ch, "sent_hint": hint}


@api.post("/auth/mfa/enable")
async def mfa_enable(data: MfaCodeIn, user: dict = Depends(get_current_user)):
    res = supabase.table("users").select(
        "mfa_otp_hash,mfa_otp_expires,mfa_otp_purpose,mfa_pending_channel,totp_enabled"
    ).eq("id", user["id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    row = res.data[0]
    if row.get("mfa_otp_purpose") != "setup" or not row.get("mfa_otp_hash") or _mfa_otp_expired(row):
        raise HTTPException(
            status_code=400,
            detail="Start set-up again and request a new code — this one expired or was not sent.",
        )
    code = (data.code or "").strip().replace(" ", "")
    if len(code) < 6:
        raise HTTPException(status_code=400, detail="Enter the 6-digit code")
    uid = user["id"]
    if _hash_mfa_otp(uid, "setup", code) != row.get("mfa_otp_hash"):
        raise HTTPException(status_code=400, detail="Code does not match.")
    ch = row.get("mfa_pending_channel")
    if ch not in ("email", "phone"):
        raise HTTPException(status_code=400, detail="Invalid set-up state. Start over.")
    supabase.table("users").update({
        "totp_enabled": True,
        "mfa_channel": ch,
        "mfa_pending_channel": None,
        "mfa_otp_hash": None,
        "mfa_otp_expires": None,
        "mfa_otp_purpose": None,
        "totp_secret": None,
        "totp_pending_secret": None,
    }).eq("id", user["id"]).execute()
    fr = supabase.table("users").select("*").eq("id", user["id"]).limit(1).execute()
    rows = fr.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="User record not found after 2FA enable")
    return {"ok": True, "user": _auth_user_out(rows[0])}


@api.post("/auth/mfa/cancel")
async def mfa_cancel(user: dict = Depends(get_current_user)):
    supabase.table("users").update({
        "totp_pending_secret": None,
        "mfa_otp_hash": None,
        "mfa_otp_expires": None,
        "mfa_otp_purpose": None,
        "mfa_pending_channel": None,
    }).eq("id", user["id"]).execute()
    return {"ok": True}


@api.post("/auth/mfa/disable/send-code")
async def mfa_disable_send_code(data: MfaDisableSendIn, user: dict = Depends(get_current_user)):
    res = supabase.table("users").select(
        "password_hash,totp_enabled,mfa_channel,email,phone_e164"
    ).eq("id", user["id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    row = res.data[0]
    if not row.get("totp_enabled") or row.get("mfa_channel") not in ("email", "phone"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
    if not verify_pw(data.password, row.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Incorrect password")
    uid = user["id"]
    channel = str(row.get("mfa_channel"))
    if channel == "phone" and not (row.get("phone_e164") or "").strip():
        raise HTTPException(status_code=400, detail="No phone number on file for this account")
    code = _gen_mfa_code()
    exp = datetime.now(timezone.utc) + MFA_OTP_TTL_DISABLE
    supabase.table("users").update({
        "mfa_otp_hash": _hash_mfa_otp(uid, "disable", code),
        "mfa_otp_expires": exp.isoformat(),
        "mfa_otp_purpose": "disable",
    }).eq("id", uid).execute()
    _deliver_mfa_stub(
        uid,
        channel,
        str(row.get("email") or ""),
        row.get("phone_e164") if channel == "phone" else None,
        code,
    )
    hint = _mask_email(str(row.get("email") or "")) if channel == "email" else _mask_phone(row.get("phone_e164"))
    return {"ok": True, "mfa_sent_via": channel, "mfa_sent_hint": hint}


@api.post("/auth/mfa/disable")
async def mfa_disable(data: MfaDisableIn, user: dict = Depends(get_current_user)):
    res = supabase.table("users").select(
        "password_hash,totp_enabled,mfa_channel,mfa_otp_hash,mfa_otp_expires,mfa_otp_purpose"
    ).eq("id", user["id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    row = res.data[0]
    if not row.get("totp_enabled") or row.get("mfa_channel") not in ("email", "phone"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
    if not verify_pw(data.password, row.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Incorrect password")
    code = (data.code or "").strip().replace(" ", "")
    if len(code) < 6:
        raise HTTPException(status_code=400, detail="Enter the 6-digit code")
    uid = user["id"]
    if row.get("mfa_otp_purpose") != "disable" or not row.get("mfa_otp_hash") or _mfa_otp_expired(row):
        raise HTTPException(status_code=400, detail='Request a new code with "Send verification code".')
    if _hash_mfa_otp(uid, "disable", code) != row.get("mfa_otp_hash"):
        raise HTTPException(status_code=400, detail="Invalid code")
    supabase.table("users").update({
        "totp_enabled": False,
        "mfa_channel": None,
        "totp_secret": None,
        "totp_pending_secret": None,
        "mfa_otp_hash": None,
        "mfa_otp_expires": None,
        "mfa_otp_purpose": None,
        "mfa_pending_channel": None,
    }).eq("id", user["id"]).execute()
    return {"ok": True}


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
    if not can_access_members_page(user, p):
        raise HTTPException(status_code=403, detail="Not allowed")
    res = supabase.table("users").select(
        "id,email,name,role,is_disabled,created_at,visible_calendar_ids"
    ).order("created_at", desc=True).execute()
    return res.data or []


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
    base = FRONTEND_URL.rstrip("/") + "/calendars"
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
    res = supabase.table("calendars").select("*").eq("is_active", True).order("created_at").execute()
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
    if str(b.get("member_id")) == str(user["id"]):
        return True
    if permissions.has(perms, "delete_any_booking"):
        return True
    if permissions.has(perms, "create_manual_booking"):
        return True
    return False


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
    scope = calendar_id_scope_for_user(user, p)
    if scope is not None:
        raw = [b for b in raw if b.get("calendar_id") in scope]
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
    if permissions.has(p, "approve_deny_requests"):
        sc = calendar_id_scope_for_user(user, p)
        if sc is not None:
            raw = [b for b in raw if b.get("calendar_id") in sc]
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
        users_res = supabase.table("users").select("id,name,email").execute()
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

    users_res = supabase.table("users").select("id,name,email").execute()
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
        "message": data.message or f"Your booking on {b['date']} was denied.",
        "is_read": False,
        "created_at": now_iso(),
    }).execute()
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
    users_res = supabase.table("users").select("id,name,email").execute()
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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
