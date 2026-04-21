from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal
import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ---------- Setup ----------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

app = FastAPI(title="Studio 7 Miami Calendar API")
api = APIRouter(prefix="/api")


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
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


# ---------- Google Calendar STUB ----------
def gcal_push_event(calendar_google_id: Optional[str], booking: dict) -> Optional[str]:
    """STUB: would push event to Google Calendar via API. Returns mock google_event_id."""
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


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    created_at: str


class InviteIn(BaseModel):
    email: EmailStr


class CalendarIn(BaseModel):
    name: str
    color: str
    google_calendar_id: Optional[str] = ""
    is_active: bool = True


class BookingRequestIn(BaseModel):
    calendar_id: str
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    notes: Optional[str] = ""


class ManualBookingIn(BaseModel):
    calendar_id: str
    member_id: Optional[str] = None  # admin may book on behalf of member
    date: str
    start_time: str
    end_time: str
    notes: Optional[str] = ""


class ApproveDenyIn(BaseModel):
    message: Optional[str] = ""


# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.invites.create_index("token", unique=True)
    await db.bookings.create_index([("date", 1), ("calendar_id", 1)])
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])

    # Seed admin
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Seven",
            "role": "admin",
            "password_hash": hash_pw(admin_password),
            "created_at": now_iso(),
        })
        logger.info(f"Seeded admin {admin_email}")
    elif not verify_pw(admin_password, existing.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_pw(admin_password)}})
        logger.info(f"Admin password updated for {admin_email}")

    # Seed default calendars
    defaults = [
        {"name": "Photobooth", "color": "#A78BFA"},
        {"name": "Studio 7 Miami", "color": "#38BDF8"},
    ]
    for cal in defaults:
        if not await db.calendars.find_one({"name": cal["name"]}):
            await db.calendars.insert_one({
                "id": str(uuid.uuid4()),
                "name": cal["name"],
                "color": cal["color"],
                "google_calendar_id": "",
                "is_active": True,
                "created_at": now_iso(),
            })


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ---------- Auth endpoints ----------
@api.post("/auth/login")
async def login(data: LoginIn):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_pw(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["email"], user["role"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "created_at": user["created_at"],
        },
    }


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/register")
async def register(data: RegisterIn):
    """Registration happens via an admin-created invite token."""
    invite = await db.invites.find_one({"token": data.invite_token})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.get("used"):
        raise HTTPException(status_code=400, detail="Invite already used")
    if datetime.fromisoformat(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")

    email = invite["email"].lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="User already exists")

    user_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": user_id,
        "email": email,
        "name": data.name,
        "role": "member",
        "password_hash": hash_pw(data.password),
        "created_at": now_iso(),
    })
    await db.invites.update_one({"token": data.invite_token}, {"$set": {"used": True, "used_at": now_iso()}})
    token = create_token(user_id, email, "member")
    return {
        "token": token,
        "user": {"id": user_id, "email": email, "name": data.name, "role": "member", "created_at": now_iso()},
    }


@api.get("/auth/invite/{token}")
async def get_invite(token: str):
    invite = await db.invites.find_one({"token": token}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.get("used"):
        raise HTTPException(status_code=400, detail="Invite already used")
    if datetime.fromisoformat(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")
    return {"email": invite["email"]}


# ---------- Invites (admin) ----------
@api.post("/invites")
async def create_invite(data: InviteIn, admin: dict = Depends(require_admin)):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="User already exists")
    # Invalidate existing pending invites
    await db.invites.update_many({"email": email, "used": {"$ne": True}}, {"$set": {"used": True, "used_at": now_iso()}})
    token = secrets.token_urlsafe(32)
    doc = {
        "id": str(uuid.uuid4()),
        "token": token,
        "email": email,
        "used": False,
        "created_by": admin["id"],
        "created_at": now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }
    await db.invites.insert_one(doc)
    link = f"{FRONTEND_URL}/invite/{token}"
    # STUB email sending
    logger.info(f"[EMAIL STUB] Magic link for {email}: {link}")
    return {"id": doc["id"], "email": email, "invite_link": link, "expires_at": doc["expires_at"]}


@api.get("/invites")
async def list_invites(admin: dict = Depends(require_admin)):
    items = await db.invites.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for it in items:
        it["invite_link"] = f"{FRONTEND_URL}/invite/{it['token']}"
    return items


# ---------- Users (admin) ----------
@api.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return users


# ---------- Calendars ----------
@api.get("/calendars")
async def list_calendars(user: dict = Depends(get_current_user)):
    cals = await db.calendars.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return cals


@api.post("/calendars")
async def create_calendar(data: CalendarIn, admin: dict = Depends(require_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "color": data.color,
        "google_calendar_id": data.google_calendar_id or "",
        "is_active": data.is_active,
        "created_by": admin["id"],
        "created_at": now_iso(),
    }
    await db.calendars.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/calendars/{cal_id}")
async def update_calendar(cal_id: str, data: CalendarIn, admin: dict = Depends(require_admin)):
    upd = {"name": data.name, "color": data.color, "google_calendar_id": data.google_calendar_id or "", "is_active": data.is_active}
    res = await db.calendars.update_one({"id": cal_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Calendar not found")
    cal = await db.calendars.find_one({"id": cal_id}, {"_id": 0})
    return cal


@api.delete("/calendars/{cal_id}")
async def delete_calendar(cal_id: str, admin: dict = Depends(require_admin)):
    res = await db.calendars.delete_one({"id": cal_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return {"ok": True}


# ---------- Bookings ----------
async def _get_user_lookup():
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return {u["id"]: u for u in users}


def _serialize_booking(b: dict, viewer: dict, users_by_id: dict) -> dict:
    """Return booking with detail only if viewer is admin or owner; otherwise anonymize."""
    is_admin = viewer.get("role") == "admin"
    is_owner = b.get("member_id") == viewer["id"]
    can_see_detail = is_admin or is_owner
    base = {
        "id": b["id"],
        "calendar_id": b["calendar_id"],
        "date": b["date"],
        "start_time": b["start_time"],
        "end_time": b["end_time"],
        "status": b.get("status", "approved"),
        "source": b.get("source", "manual"),
        "is_own": is_owner,
    }
    if can_see_detail:
        owner = users_by_id.get(b.get("member_id"))
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
    q = {}
    if status:
        q["status"] = status
    else:
        q["status"] = {"$in": ["approved", "pending"]}
    raw = await db.bookings.find(q, {"_id": 0}).sort("date", 1).to_list(2000)
    users_by_id = await _get_user_lookup()
    return [_serialize_booking(b, user, users_by_id) for b in raw]


@api.get("/bookings/requests")
async def list_requests(user: dict = Depends(get_current_user)):
    """Admin sees all pending; member sees own (all statuses)."""
    if user["role"] == "admin":
        raw = await db.bookings.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    else:
        raw = await db.bookings.find({"member_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    users_by_id = await _get_user_lookup()
    return [_serialize_booking(b, user, users_by_id) for b in raw]


@api.post("/bookings/request")
async def create_request(data: BookingRequestIn, user: dict = Depends(get_current_user)):
    cal = await db.calendars.find_one({"id": data.calendar_id})
    if not cal:
        raise HTTPException(status_code=404, detail="Calendar not found")
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
        "google_event_id": None,
        "created_at": now_iso(),
    }
    await db.bookings.insert_one(booking)

    # Notify all admins
    admins = await db.users.find({"role": "admin"}, {"_id": 0}).to_list(50)
    for a in admins:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": a["id"],
            "booking_id": booking["id"],
            "type": "request_submitted",
            "title": "New booking request",
            "message": f"{user['name']} requested {cal['name']} on {data.date} {data.start_time}-{data.end_time}",
            "is_read": False,
            "created_at": now_iso(),
        })
    # Confirmation to member
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "booking_id": booking["id"],
        "type": "request_confirmed",
        "title": "Request submitted",
        "message": f"Your {cal['name']} request for {data.date} is awaiting approval.",
        "is_read": False,
        "created_at": now_iso(),
    })
    booking.pop("_id", None)
    return booking


@api.post("/bookings/manual")
async def create_manual(data: ManualBookingIn, admin: dict = Depends(require_admin)):
    cal = await db.calendars.find_one({"id": data.calendar_id})
    if not cal:
        raise HTTPException(status_code=404, detail="Calendar not found")
    member_id = data.member_id or admin["id"]
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
    # Push to Google Calendar (stub)
    gid = gcal_push_event(cal.get("google_calendar_id"), booking)
    booking["google_event_id"] = gid
    await db.bookings.insert_one(booking)
    booking.pop("_id", None)
    return booking


@api.post("/bookings/{booking_id}/approve")
async def approve_booking(booking_id: str, data: ApproveDenyIn, admin: dict = Depends(require_admin)):
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] != "pending":
        raise HTTPException(status_code=400, detail="Booking not pending")
    cal = await db.calendars.find_one({"id": b["calendar_id"]})
    gid = gcal_push_event(cal.get("google_calendar_id") if cal else None, b)
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "status": "approved",
        "google_event_id": gid,
        "approval_message": data.message or "",
        "approved_at": now_iso(),
        "approved_by": admin["id"],
    }})
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": b["member_id"],
        "booking_id": booking_id,
        "type": "request_approved",
        "title": "Booking approved",
        "message": data.message or f"Your booking on {b['date']} has been approved.",
        "is_read": False,
        "created_at": now_iso(),
    })
    return {"ok": True}


@api.post("/bookings/{booking_id}/deny")
async def deny_booking(booking_id: str, data: ApproveDenyIn, admin: dict = Depends(require_admin)):
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] != "pending":
        raise HTTPException(status_code=400, detail="Booking not pending")
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "status": "denied",
        "approval_message": data.message or "",
        "denied_at": now_iso(),
        "denied_by": admin["id"],
    }})
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": b["member_id"],
        "booking_id": booking_id,
        "type": "request_denied",
        "title": "Booking denied",
        "message": data.message or f"Your booking on {b['date']} was denied.",
        "is_read": False,
        "created_at": now_iso(),
    })
    return {"ok": True}


@api.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, admin: dict = Depends(require_admin)):
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    cal = await db.calendars.find_one({"id": b["calendar_id"]})
    gcal_delete_event(cal.get("google_calendar_id") if cal else None, b.get("google_event_id"))
    await db.bookings.delete_one({"id": booking_id})
    return {"ok": True}


# ---------- Notifications ----------
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    notifs = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return notifs


@api.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": notif_id, "user_id": user["id"]}, {"$set": {"is_read": True}})
    return {"ok": True}


@api.post("/notifications/read-all")
async def mark_all_read(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "is_read": False}, {"$set": {"is_read": True}})
    return {"ok": True}


# ---------- Chat (LLM) ----------
class ChatIn(BaseModel):
    message: str
    model: Optional[str] = "claude"  # "claude" | "gpt"


async def _build_calendar_context(user: dict) -> str:
    """Assemble a text snapshot of calendars + upcoming bookings visible to this user."""
    cals = await db.calendars.find({}, {"_id": 0}).to_list(200)
    cal_by_id = {c["id"]: c for c in cals}
    # Upcoming + today (last 30 days + next 180 days to keep context bounded)
    today = datetime.now(timezone.utc).date().isoformat()
    lookback = (datetime.now(timezone.utc).date() - timedelta(days=30)).isoformat()
    horizon = (datetime.now(timezone.utc).date() + timedelta(days=180)).isoformat()
    raw = await db.bookings.find(
        {"status": {"$in": ["approved", "pending"]}, "date": {"$gte": lookback, "$lte": horizon}},
        {"_id": 0},
    ).sort("date", 1).to_list(2000)
    users_by_id = await _get_user_lookup()

    is_admin = user.get("role") == "admin"
    lines = []
    for b in raw:
        cal = cal_by_id.get(b["calendar_id"], {})
        cal_name = cal.get("name", "Unknown")
        is_owner = b.get("member_id") == user["id"]
        if is_admin or is_owner:
            owner = users_by_id.get(b.get("member_id"), {})
            who = owner.get("name", "—")
            note = (b.get("notes") or "").replace("\n", " ")[:120]
            lines.append(
                f"- {b['date']} {b['start_time']}-{b['end_time']} | {cal_name} | {b['status']} | {who}"
                + (f" | notes: {note}" if note else "")
            )
        else:
            # Members see other bookings as anonymous "Booked"
            lines.append(f"- {b['date']} {b['start_time']}-{b['end_time']} | {cal_name} | booked")

    cal_list = ", ".join(f"{c['name']} ({c.get('color','')})" for c in cals) or "(none)"
    return (
        f"Calendars: {cal_list}\n"
        f"Today (UTC): {today}\n"
        f"Upcoming and recent bookings visible to this user:\n"
        + ("\n".join(lines) if lines else "(none)")
    )


@api.post("/chat")
async def chat(data: ChatIn, user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    provider, model_id = ("anthropic", "claude-sonnet-4-5-20250929")
    if (data.model or "").lower() in ("gpt", "openai", "gpt-5.2"):
        provider, model_id = ("openai", "gpt-5.2")

    context = await _build_calendar_context(user)
    system_prompt = (
        "You are the Studio 7 Miami internal calendar assistant.\n"
        f"The current user is {user.get('name')} (role: {user.get('role')}, email: {user.get('email')}).\n"
        "You answer scheduling questions (availability, what's booked when, who has what, etc.) concisely.\n"
        "- Be succinct. Use bullet points for lists.\n"
        "- All times are in the America/New_York (Miami) local timezone.\n"
        "- If the user asks whether a specific date/time is available, check the booking list and answer yes/no, citing any overlaps.\n"
        "- Format times in 12-hour format (e.g., 4:00 PM).\n"
        "- Respect visibility: members only see detail for their own bookings; others appear as 'booked'.\n"
        "- If you don't know, say so — do not invent.\n\n"
        f"=== Calendar context ===\n{context}"
    )

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"s7-{user['id']}",
            system_message=system_prompt,
        ).with_model(provider, model_id)
        reply = await chat.send_message(UserMessage(text=data.message))
        return {"reply": reply, "model": f"{provider}/{model_id}"}
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
