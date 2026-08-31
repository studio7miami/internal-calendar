"""Proposal workflow API.

The module is configured by server.py so it follows the existing single-process
FastAPI/Supabase runtime without importing server.py (and creating a cycle).
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import logging
import os
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError, field_validator, model_validator

import invite_email
import permissions

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["proposals"])
PROPOSAL_MOCK_INBOX = (os.environ.get("PROPOSAL_EMAIL_COPY") or "tai@taistu.com").strip()

_db: Any = None
_auth_dependency: Optional[Callable[..., Awaitable[dict]]] = None
_permissions_for: Optional[Callable[[dict], dict]] = None
_gcal_push: Optional[Callable[[Optional[str], dict, str], Awaitable[Optional[str]]]] = None

PROPOSAL_FIELDS = (
    "id,status,title,client_name,client_email,client_phone,calendar_id,session_date,"
    "arrival_time,setup_time,shoot_time,wrap_time,creative_brief,content_items,"
    "pricing,share_settings,rate_cents,deposit_percent,deliverables,turnaround,version,created_by,"
    "assigned_to,current_revision_id,booking_id,approved_at,approved_by,sent_at,"
    "client_approved_at,signed_at,archived_at,created_at,updated_at"
)
SNAPSHOT_FIELDS = (
    "title", "client_name", "client_email", "client_phone", "calendar_id", "session_date",
    "arrival_time", "setup_time", "shoot_time", "wrap_time", "creative_brief",
    "content_items", "pricing", "share_settings", "rate_cents", "deposit_percent",
    "deliverables", "turnaround",
)
EDITABLE_FIELDS = set(SNAPSHOT_FIELDS) | {"assigned_to"}
ACTIVE_BOOKING_STATUSES = {"approved", "pending"}


def configure(
    *,
    db: Any,
    auth_dependency: Callable[..., Awaitable[dict]],
    permissions_for: Callable[[dict], dict],
    gcal_push: Callable[[Optional[str], dict, str], Awaitable[Optional[str]]],
) -> None:
    global _db, _auth_dependency, _permissions_for, _gcal_push
    _db = db
    _auth_dependency = auth_dependency
    _permissions_for = permissions_for
    _gcal_push = gcal_push


async def _current_user(request: Request) -> dict:
    if _auth_dependency is None:
        raise HTTPException(status_code=503, detail="Proposal API is not configured")
    return await _auth_dependency(request)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def hash_share_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def client_share_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return slug[:48]


def _share_token_taken(token: str) -> bool:
    if _db is None:
        return False
    found = (
        _db.table("proposal_shares")
        .select("id")
        .eq("token_hash", hash_share_token(token))
        .limit(1)
        .execute()
    )
    return bool(found.data)


def mint_share_token(client_name: str = "") -> str:
    """Public path segment, e.g. luis-corrales, then luis-corrales-2 if needed."""
    slug = client_share_slug(client_name)
    if not slug:
        return secrets.token_urlsafe(24)
    token = slug
    suffix = 2
    while _share_token_taken(token):
        token = f"{slug}-{suffix}"
        suffix += 1
        if suffix > 80:
            return f"{slug}-{secrets.token_urlsafe(6)}"
    return token


def choose_named_share_token(client_name: str, proposal_id: str, occupancy: dict[str, str]) -> str:
    """Pick luis-corrales unless another proposal already owns that hash (including revoked)."""
    slug = client_share_slug(client_name)
    if not slug:
        return secrets.token_urlsafe(24)
    token = slug
    suffix = 2
    while suffix <= 80:
        owner = occupancy.get(hash_share_token(token))
        if owner is None or str(owner) == str(proposal_id):
            return token
        token = f"{slug}-{suffix}"
        suffix += 1
    return f"{slug}-{secrets.token_urlsafe(6)}"


def _share_row_by_token(token: str) -> Optional[dict]:
    if _db is None:
        return None
    found = (
        _db.table("proposal_shares")
        .select("*")
        .eq("token_hash", hash_share_token(token))
        .limit(1)
        .execute()
    )
    return dict(found.data[0]) if found.data else None


def _write_share(
    proposal: dict,
    user: dict,
    revision_id: str,
    token: str,
    expires_days: int,
    existing: Optional[dict],
) -> str:
    expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_days)).isoformat()
    if existing:
        share_id = existing["id"]
        _db.table("proposal_shares").update({
            "revoked": False,
            "revoked_at": None,
            "revision_id": revision_id,
            "expires_at": expires_at,
            "sent_to_email": proposal.get("client_email") or "",
            "created_by": user["id"],
        }).eq("id", share_id).execute()
    else:
        share_id = str(uuid.uuid4())
        _db.table("proposal_shares").insert({
            "id": share_id,
            "proposal_id": proposal["id"],
            "revision_id": revision_id,
            "token_hash": hash_share_token(token),
            "sent_to_email": proposal.get("client_email") or "",
            "created_by": user["id"],
            "expires_at": expires_at,
            "revoked": False,
            "created_at": _now(),
        }).execute()
    _db.table("proposal_shares").update({
        "revoked": True, "revoked_at": _now()
    }).eq("proposal_id", proposal["id"]).eq("revoked", False).neq("id", share_id).execute()
    return token


def issue_share_token(proposal: dict, user: dict, revision_id: str, expires_days: int = 30) -> str:
    """Reuse this proposal's named URL (tai) instead of minting tai-2, tai-3 on every send."""
    slug = client_share_slug(proposal.get("client_name") or "")
    if not slug:
        token = secrets.token_urlsafe(24)
        while _share_row_by_token(token):
            token = secrets.token_urlsafe(24)
        return _write_share(proposal, user, revision_id, token, expires_days, None)

    token = slug
    suffix = 2
    while suffix <= 80:
        row = _share_row_by_token(token)
        if row is None or str(row.get("proposal_id")) == str(proposal["id"]):
            return _write_share(proposal, user, revision_id, token, expires_days, row)
        token = f"{slug}-{suffix}"
        suffix += 1
    token = f"{slug}-{secrets.token_urlsafe(6)}"
    return _write_share(proposal, user, revision_id, token, expires_days, _share_row_by_token(token))


def _normalize_public_token(token: str) -> str:
    cleaned = (token or "").strip()
    # Named links are short (luis-corrales). Random tokens are longer.
    if not re.fullmatch(r"[A-Za-z0-9_-]{3,200}", cleaned):
        raise HTTPException(status_code=404, detail="Proposal link not found")
    return cleaned


def _is_blank_draft(row: dict) -> bool:
    if str(row.get("status") or "") != "draft":
        return False
    if str(row.get("client_name") or "").strip():
        return False
    title = str(row.get("title") or "").strip().lower()
    if title and title not in ("untitled proposal", "untitled"):
        return False
    if row.get("session_date"):
        return False
    if int(row.get("rate_cents") or 0) > 0:
        return False
    brief = row.get("creative_brief") or {}
    if isinstance(brief, dict) and any(str(value or "").strip() for value in brief.values()):
        return False
    return True


def _purge_blank_drafts(rows: list[dict]) -> list[dict]:
    kept: list[dict] = []
    for row in rows:
        if not _is_blank_draft(row):
            kept.append(row)
            continue
        try:
            _db.table("proposals").delete().eq("id", row["id"]).eq("status", "draft").execute()
        except Exception:
            logger.exception("Could not delete blank proposal draft %s", row.get("id"))
            kept.append(row)
    return kept


def _share_url(token: str, *, step: Optional[str] = None) -> str:
    base = (os.environ.get("PROPOSAL_PUBLIC_URL") or "").strip().rstrip("/")
    if base:
        url = f"{base}/{token}"
    else:
        frontend = (os.environ.get("FRONTEND_URL") or "http://localhost:3000").rstrip("/")
        url = f"{frontend}/p/{token}"
    if step:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}step={step}"
    return url


def _client_share_step(status: Optional[str]) -> Optional[str]:
    """Accepted clients skip the proposal deck and land on the agreement."""
    if status in ("client_approved", "signed"):
        return "agreement"
    return None


def verify_stripe_signature(
    payload: bytes,
    signature_header: str,
    secret: str,
    *,
    tolerance_seconds: int = 300,
    now: Optional[int] = None,
) -> bool:
    """Verify Stripe's v1 HMAC over the exact raw request body."""
    timestamp: Optional[int] = None
    signatures: list[str] = []
    for item in (signature_header or "").split(","):
        key, sep, value = item.strip().partition("=")
        if not sep:
            continue
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return False
        elif key == "v1":
            signatures.append(value)
    if timestamp is None or not signatures or not secret:
        return False
    current = int(time.time()) if now is None else now
    if abs(current - timestamp) > tolerance_seconds:
        return False
    signed = str(timestamp).encode("ascii") + b"." + payload
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, supplied) for supplied in signatures)


class ProposalCreate(BaseModel):
    title: str = Field(default="Untitled proposal", max_length=300)
    client_name: str = Field(default="", max_length=200)
    client_email: str = Field(default="", max_length=320)
    client_phone: Optional[str] = Field(default=None, max_length=50)
    calendar_id: Optional[str] = None
    session_date: Optional[date] = None
    arrival_time: Optional[str] = None
    setup_time: Optional[str] = None
    shoot_time: Optional[str] = None
    wrap_time: Optional[str] = None
    creative_brief: dict[str, Any] = Field(default_factory=dict)
    content_items: list[Any] = Field(default_factory=list)
    pricing: dict[str, Any] = Field(default_factory=dict)
    share_settings: dict[str, Any] = Field(default_factory=dict)
    rate_cents: int = Field(default=0, ge=0, le=100_000_000)
    deposit_percent: int = Field(default=50, ge=0, le=100)
    deliverables: Optional[str] = Field(default="", max_length=20_000)
    turnaround: Optional[str] = Field(default="", max_length=500)
    assigned_to: Optional[str] = None

    @field_validator("session_date", mode="before")
    @classmethod
    def blank_date_is_none(cls, value: Any) -> Any:
        return None if value == "" else value

    @field_validator("calendar_id", "assigned_to", mode="before")
    @classmethod
    def blank_reference_is_none(cls, value: Any) -> Any:
        return None if value == "" else value

    @field_validator("arrival_time", "setup_time", "shoot_time", "wrap_time", mode="before")
    @classmethod
    def validate_time(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None
        if hasattr(value, "hour") and hasattr(value, "minute"):
            return f"{int(value.hour):02d}:{int(value.minute):02d}"
        text = str(value).strip()
        if "T" in text:
            text = text.split("T", 1)[1]
        text = text.replace("Z", "").split("+")[0].split("-")[0].strip()
        parts = text.split(":")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1][:2].isdigit():
            hours = int(parts[0])
            minutes = int(parts[1][:2])
            if 0 <= hours < 24 and 0 <= minutes < 60:
                return f"{hours:02d}:{minutes:02d}"
        raise ValueError("times must use HH:MM")

    @model_validator(mode="after")
    def validate_schedule_order(self):
        ordered = [
            value for value in
            (self.arrival_time, self.setup_time, self.shoot_time, self.wrap_time)
            if value
        ]
        if ordered != sorted(ordered) or len(set(ordered)) != len(ordered):
            raise ValueError("schedule times must be in increasing order")
        return self


class ProposalUpdate(BaseModel):
    version: int = Field(ge=1)
    expected_version: Optional[int] = Field(default=None, ge=1)
    title: Optional[str] = Field(default=None, max_length=300)
    client_name: Optional[str] = Field(default=None, max_length=200)
    client_email: Optional[str] = Field(default=None, max_length=320)
    client_phone: Optional[str] = Field(default=None, max_length=50)
    calendar_id: Optional[str] = None
    session_date: Optional[date] = None
    arrival_time: Optional[str] = None
    setup_time: Optional[str] = None
    shoot_time: Optional[str] = None
    wrap_time: Optional[str] = None
    creative_brief: Optional[dict[str, Any]] = None
    content_items: Optional[list[Any]] = None
    pricing: Optional[dict[str, Any]] = None
    share_settings: Optional[dict[str, Any]] = None
    rate_cents: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    deposit_percent: Optional[int] = Field(default=None, ge=0, le=100)
    deliverables: Optional[str] = Field(default=None, max_length=20_000)
    turnaround: Optional[str] = Field(default=None, max_length=500)
    assigned_to: Optional[str] = None

    @field_validator("session_date", mode="before")
    @classmethod
    def blank_date_is_none(cls, value: Any) -> Any:
        return None if value == "" else value

    @field_validator("calendar_id", "assigned_to", mode="before")
    @classmethod
    def blank_reference_is_none(cls, value: Any) -> Any:
        return None if value == "" else value

    @field_validator("arrival_time", "setup_time", "shoot_time", "wrap_time", mode="before")
    @classmethod
    def validate_time(cls, value: Optional[str]) -> Optional[str]:
        return ProposalCreate.validate_time(value)


class VersionAction(BaseModel):
    version: Optional[int] = Field(default=None, ge=1)
    expected_version: Optional[int] = Field(default=None, ge=1)


class SendAction(VersionAction):
    expires_days: int = Field(default=30, ge=1, le=90)
    channel: str = "email"

    @field_validator("channel")
    @classmethod
    def validate_channel(cls, value: str) -> str:
        channel = str(value or "email").strip().lower()
        if channel not in ("email", "text"):
            raise ValueError("channel must be email or text")
        return channel


class CheckoutIn(BaseModel):
    payment_type: str

    @field_validator("payment_type")
    @classmethod
    def validate_payment_type(cls, value: str) -> str:
        if value not in ("deposit", "full", "remaining"):
            raise ValueError("payment_type must be deposit, full, or remaining")
        return value


class ChangeRequestIn(BaseModel):
    message: str = Field(min_length=2, max_length=5000)
    client_name: Optional[str] = Field(default=None, max_length=200)


class PublicApproveIn(BaseModel):
    client_name: Optional[str] = Field(default=None, max_length=200)


class SignatureIn(BaseModel):
    signer_name: str = Field(min_length=1, max_length=200)
    signer_email: EmailStr
    signature_data: str = Field(min_length=2, max_length=200_000)
    consent: bool

    @model_validator(mode="after")
    def require_consent(self):
        if not self.consent:
            raise ValueError("consent is required")
        return self


def _perms(user: dict) -> dict:
    if _permissions_for is None:
        return {}
    return _permissions_for(user)


def _require(user: dict, permission: str) -> None:
    if user.get("role") == "admin":
        return
    if not permissions.has(_perms(user), permission):
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")


def _one(table: str, row_id: str, select: str = "*") -> dict:
    result = _db.table(table).select(select).eq("id", row_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return dict(result.data[0])


def _proposal(row_id: str) -> dict:
    return _one("proposals", row_id, PROPOSAL_FIELDS)


def _event(
    proposal_id: str,
    event_type: str,
    *,
    user_id: Optional[str] = None,
    share_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    _db.table("proposal_events").insert({
        "id": str(uuid.uuid4()),
        "proposal_id": proposal_id,
        "event_type": event_type,
        "actor_user_id": user_id,
        "share_id": share_id,
        "metadata": metadata or {},
        "created_at": _now(),
    }).execute()


def _serialize(row: dict, token: Optional[str] = None) -> dict:
    result = dict(row)
    result["share_url"] = (
        _share_url(token, step=_client_share_step(row.get("status"))) if token else None
    )
    return result


def _effective_rate_cents(proposal: dict) -> int:
    stored = int(proposal.get("rate_cents") or 0)
    if stored > 0:
        return stored
    pricing = proposal.get("pricing") or {}
    if not isinstance(pricing, dict):
        return 0
    subtotal = 0.0
    for item in pricing.get("line_items") or []:
        if not isinstance(item, dict):
            continue
        try:
            subtotal += max(0.0, float(item.get("quantity") or 0)) * max(
                0.0, float(item.get("unit_price") or 0)
            )
        except (TypeError, ValueError):
            continue
    try:
        discount = max(0.0, float(pricing.get("discount") or 0))
        tax_rate = max(0.0, float(pricing.get("tax_rate") or 0))
    except (TypeError, ValueError):
        return 0
    taxable = max(0.0, subtotal - discount)
    return max(0, round((taxable + taxable * tax_rate / 100) * 100))


def _paid_payment_cents(proposal_id: str) -> int:
    result = (
        _db.table("proposal_payments")
        .select("amount_cents,status")
        .eq("proposal_id", proposal_id)
        .eq("status", "paid")
        .execute()
    )
    return sum(int(row.get("amount_cents") or 0) for row in (result.data or []))


def payment_amount_cents(proposal: dict, payment_type: str, *, paid_cents: int = 0) -> int:
    total = _effective_rate_cents(proposal)
    if payment_type == "full":
        return total
    if payment_type == "remaining":
        return max(0, total - max(0, paid_cents))
    if payment_type != "deposit":
        raise ValueError("payment_type must be deposit, full, or remaining")
    pricing = proposal.get("pricing") or {}
    if isinstance(pricing, dict) and pricing.get("deposit_type") == "fixed":
        try:
            return min(total, max(0, round(float(pricing.get("deposit_value") or 0) * 100)))
        except (TypeError, ValueError):
            return 0
    raw_percent = (
        pricing.get("deposit_value")
        if isinstance(pricing, dict) and pricing.get("deposit_value") not in (None, "")
        else proposal.get("deposit_percent")
    )
    try:
        percent = min(100.0, max(0.0, float(raw_percent or 0)))
    except (TypeError, ValueError):
        percent = 0
    return min(total, max(0, round(total * percent / 100)))


def proposal_status_for_payment(payment_type: str) -> str:
    if payment_type == "deposit":
        return "deposit_paid"
    if payment_type in ("full", "remaining"):
        return "paid"
    raise ValueError("payment_type must be deposit, full, or remaining")


def _public_status(status: str) -> str:
    return status or "draft"


def _action_version(proposal: dict, data: Optional[VersionAction], request: Request) -> int:
    supplied = None
    if data is not None:
        supplied = data.version if data.version is not None else data.expected_version
    if supplied is None:
        raw_header = (request.headers.get("if-match") or "").strip().strip('"')
        if raw_header:
            try:
                supplied = int(raw_header)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="If-Match must contain a numeric version") from exc
    return int(proposal["version"]) if supplied is None else int(supplied)


def _latest_active_share(proposal_id: str) -> Optional[dict]:
    result = (
        _db.table("proposal_shares").select("*").eq("proposal_id", proposal_id)
        .eq("revoked", False).order("created_at", desc=True).limit(1).execute()
    )
    return dict(result.data[0]) if result.data else None


def _optimistic_update(proposal_id: str, version: int, updates: dict) -> dict:
    payload = {**updates, "version": version + 1, "updated_at": _now()}
    result = (
        _db.table("proposals").update(payload).eq("id", proposal_id)
        .eq("version", version).execute()
    )
    if not result.data:
        exists = _db.table("proposals").select("id,version").eq("id", proposal_id).limit(1).execute()
        if not exists.data:
            raise HTTPException(status_code=404, detail="Proposal not found")
        raise HTTPException(
            status_code=409,
            detail={"message": "Proposal was changed by another user", "current_version": exists.data[0]["version"]},
        )
    return dict(result.data[0])


def _snapshot(proposal: dict) -> tuple[dict, dict]:
    payload = {key: proposal.get(key) for key in SNAPSHOT_FIELDS}
    agreement = {
        "proposal_id": proposal["id"],
        "client": {
            "name": proposal.get("client_name"),
            "email": proposal.get("client_email"),
            "phone": proposal.get("client_phone"),
        },
        "schedule": {
            key: proposal.get(key)
            for key in ("session_date", "arrival_time", "setup_time", "shoot_time", "wrap_time")
        },
        "creative_brief": proposal.get("creative_brief") or {},
        "content_items": proposal.get("content_items") or [],
        "title": proposal.get("title") or "Untitled proposal",
        "pricing": proposal.get("pricing") or {},
        "share_settings": proposal.get("share_settings") or {},
        "rate_cents": _effective_rate_cents(proposal),
        "deposit_percent": proposal.get("deposit_percent") or 0,
        "deliverables": proposal.get("deliverables") or "",
        "turnaround": proposal.get("turnaround") or "",
    }
    return payload, agreement


def _create_revision(proposal: dict, user_id: str) -> dict:
    previous = (
        _db.table("proposal_revisions").select("revision_number")
        .eq("proposal_id", proposal["id"]).order("revision_number", desc=True).limit(1).execute()
    )
    number = int(previous.data[0]["revision_number"]) + 1 if previous.data else 1
    payload, agreement = _snapshot(proposal)
    row = {
        "id": str(uuid.uuid4()),
        "proposal_id": proposal["id"],
        "revision_number": number,
        "proposal_version": proposal["version"],
        "snapshot": payload,
        "agreement_snapshot": agreement,
        "created_by": user_id,
        "created_at": _now(),
    }
    inserted = _db.table("proposal_revisions").insert(row).execute()
    return dict(inserted.data[0] if inserted.data else row)


def _studio7_calendar_id() -> Optional[str]:
    if _db is None:
        return None
    try:
        rows = _db.table("calendars").select("id,name,is_active").execute().data or []
    except Exception:
        return None
    for row in rows:
        if row.get("is_active") is False:
            continue
        if re.search(r"studio\s*7\s*miami", str(row.get("name") or ""), re.I):
            return row.get("id")
    return None


def _validate_sendable(proposal: dict) -> dict:
    if not str(proposal.get("calendar_id") or "").strip():
        studio_id = _studio7_calendar_id()
        if studio_id:
            proposal["calendar_id"] = studio_id
    required = ("client_name", "client_email", "calendar_id", "session_date", "arrival_time", "wrap_time")
    missing = [
        key for key in required
        if proposal.get(key) is None
        or (isinstance(proposal.get(key), str) and not str(proposal.get(key)).strip())
    ]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")
    try:
        TypeAdapter(EmailStr).validate_python(str(proposal["client_email"]).strip())
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail="Enter a valid client email") from exc
    if _effective_rate_cents(proposal) <= 0:
        raise HTTPException(status_code=400, detail="Proposal rate must be greater than zero")
    times = [
        proposal.get(key) for key in ("arrival_time", "setup_time", "shoot_time", "wrap_time")
        if proposal.get(key)
    ]
    if times != sorted(times) or len(set(times)) != len(times):
        raise HTTPException(status_code=400, detail="Schedule times must be in increasing order")
    calendars = _db.table("calendars").select("*").eq("id", proposal["calendar_id"]).limit(1).execute()
    if not calendars.data or not calendars.data[0].get("is_active", True):
        raise HTTPException(status_code=400, detail="Proposal calendar is missing or inactive")
    calendar = dict(calendars.data[0])
    availability = calendar.get("availability_weekly")
    if isinstance(availability, str):
        try:
            availability = json.loads(availability)
        except json.JSONDecodeError:
            availability = None
    if availability is not None:
        if not isinstance(availability, list) or not availability:
            raise HTTPException(status_code=409, detail="The proposal calendar has no available hours")
        try:
            session_day = datetime.strptime(str(proposal["session_date"]), "%Y-%m-%d")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid session date") from exc
        js_weekday = (session_day.weekday() + 1) % 7
        fits = False
        for slot in availability:
            if not isinstance(slot, dict):
                continue
            try:
                fits = (
                    int(slot.get("weekday", -1)) == js_weekday
                    and str(slot.get("start", ""))[:5] <= str(proposal["arrival_time"])[:5]
                    and str(proposal["wrap_time"])[:5] <= str(slot.get("end", ""))[:5]
                )
            except (TypeError, ValueError):
                fits = False
            if fits:
                break
        if not fits:
            raise HTTPException(status_code=409, detail="The proposal schedule is outside calendar availability")
    return calendar


def _has_conflict(proposal: dict) -> bool:
    query = (
        _db.table("bookings").select("id,start_time,end_time,source,hold_expires_at")
        .eq("calendar_id", proposal["calendar_id"]).eq("date", str(proposal["session_date"]))
        .in_("status", ["approved", "pending"]).execute()
    )
    now = datetime.now(timezone.utc)
    for booking in query.data or []:
        if proposal.get("booking_id") and str(booking["id"]) == str(proposal["booking_id"]):
            continue
        if booking.get("source") == "proposal":
            expiry = _parse_ts(booking.get("hold_expires_at"))
            if expiry and expiry < now:
                continue
        if str(proposal["arrival_time"]) < str(booking["end_time"]) and str(proposal["wrap_time"]) > str(booking["start_time"]):
            return True
    return False


def _notify(user_id: Optional[str], proposal_id: str, kind: str, title: str, message: str) -> None:
    if not user_id:
        return
    try:
        _db.table("notifications").insert({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "proposal_id": proposal_id,
            "booking_id": None,
            "type": kind,
            "title": title,
            "message": message,
            "is_read": False,
            "created_at": _now(),
        }).execute()
    except Exception:
        logger.exception("Could not create proposal notification")


async def _deliver_proposal_mail(
    proposal: dict, subject: str, html_body: str, text_body: str
) -> tuple[bool, Optional[str]]:
    to_email = str(proposal.get("client_email") or "").strip()
    if not to_email:
        return False, "Missing client email"
    delivered, error, _provider = await invite_email.deliver_html_email(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )
    return delivered, error


async def _copy_to_mock_inbox(
    proposal: dict, subject: str, html_body: str, text_body: str
) -> tuple[bool, Optional[str]]:
    """Send Tai a real To: copy. BCC is easy for Resend to drop, and Text skips client mail."""
    inbox = PROPOSAL_MOCK_INBOX
    if not inbox:
        return False, "No mock inbox"
    intended = str(proposal.get("client_email") or "").strip()
    copy_subject = f"[Copy · {intended or 'no client email'}] {subject}"
    try:
        delivered, error, _provider = await invite_email.deliver_html_email(
            to_email=inbox,
            subject=copy_subject[:200],
            html_body=html_body,
            text_body=text_body,
        )
        if not delivered:
            logger.warning("Proposal copy email to %s failed: %s", inbox, error)
        return delivered, error
    except Exception as exc:
        logger.exception("Could not send proposal copy email to %s", inbox)
        return False, str(exc)


async def _mock_process_email(proposal: dict, headline: str, detail: str) -> None:
    inbox = PROPOSAL_MOCK_INBOX
    if not inbox:
        return
    client = str(proposal.get("client_name") or "Client").strip() or "Client"
    intended = str(proposal.get("client_email") or "").strip()
    subject = f"[Proposal] {headline} — {client}"
    text = "\n".join([
        headline,
        "",
        detail,
        "",
        f"Client: {client}",
        f"Intended for: {intended or '—'}",
        f"Status: {proposal.get('status') or '—'}",
    ])
    html_body = (
        "<!doctype html><html><body style='font-family:Manrope,Helvetica,Arial,sans-serif;"
        "color:#111;line-height:1.55'>"
        f"<p>{html.escape(headline)}</p>"
        f"<p>{html.escape(detail)}</p>"
        f"<p>Client: {html.escape(client)}<br>Intended for: {html.escape(intended or '—')}<br>"
        f"Status: {html.escape(str(proposal.get('status') or '—'))}</p>"
        "</body></html>"
    )
    try:
        await invite_email.deliver_html_email(
            to_email=inbox,
            subject=subject[:200],
            html_body=html_body,
            text_body=text,
        )
    except Exception:
        logger.exception("Could not send proposal mock email to %s", inbox)


def _notify_approvers(proposal: dict) -> None:
    try:
        users = (
            _db.table("users").select("id,role").eq("is_disabled", False)
            .in_("role", ["admin", "manager"]).execute()
        )
        for target in users.data or []:
            if target.get("role") == "admin" or permissions.has(_permissions_for(target), "approve_proposals"):
                _notify(
                    target["id"], proposal["id"], "proposal_approval_requested",
                    "Proposal needs approval", f"{proposal['client_name']} proposal is ready for review.",
                )
    except Exception:
        logger.exception("Could not notify proposal approvers")


def _public_share(token: str) -> tuple[dict, dict, dict]:
    cleaned = _normalize_public_token(token)
    digest = hash_share_token(cleaned)
    result = _db.table("proposal_shares").select("*").eq("token_hash", digest).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proposal link not found")
    share = dict(result.data[0])
    if share.get("revoked"):
        latest = _latest_active_share(share["proposal_id"])
        if not latest:
            raise HTTPException(status_code=410, detail="Proposal link was revoked")
        share = latest
    expires = _parse_ts(share.get("expires_at"))
    if expires and expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Proposal link expired")
    proposal = _proposal(share["proposal_id"])
    revision = _one("proposal_revisions", share["revision_id"])
    return share, proposal, revision


_rate_windows: dict[str, deque[float]] = defaultdict(deque)


def _public_rate_limit(request: Request) -> None:
    limit = max(5, int(os.environ.get("PROPOSAL_PUBLIC_RATE_LIMIT", "60")))
    window = max(10, int(os.environ.get("PROPOSAL_PUBLIC_RATE_WINDOW_SEC", "60")))
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    bucket = _rate_windows[key]
    while bucket and bucket[0] <= now - window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests; try again shortly")
    bucket.append(now)
    if len(_rate_windows) > 10_000:
        for old_key in list(_rate_windows)[:1000]:
            if not _rate_windows[old_key] or _rate_windows[old_key][-1] <= now - window:
                _rate_windows.pop(old_key, None)


@router.get("/proposals")
async def list_proposals(
    status: Optional[str] = None,
    user: dict = Depends(_current_user),
):
    _require(user, "view_proposals")
    query = _db.table("proposals").select(PROPOSAL_FIELDS)
    if status:
        query = query.eq("status", status)
    rows = query.order("updated_at", desc=True).execute().data or []
    rows = _purge_blank_drafts(rows)
    return [_serialize(dict(row)) for row in rows]


@router.post("/proposals", status_code=201)
async def create_proposal(data: ProposalCreate, user: dict = Depends(_current_user)):
    _require(user, "edit_proposals")
    row = {
        "id": str(uuid.uuid4()),
        "status": "draft",
        **data.model_dump(mode="json"),
        "version": 1,
        "created_by": user["id"],
        "created_at": _now(),
        "updated_at": _now(),
    }
    result = _db.table("proposals").insert(row).execute()
    created = dict(result.data[0] if result.data else row)
    _event(created["id"], "created", user_id=user["id"])
    return _serialize(created)


@router.get("/proposals/{proposal_id}")
async def read_proposal(proposal_id: str, user: dict = Depends(_current_user)):
    _require(user, "view_proposals")
    proposal = _proposal(proposal_id)
    return _serialize(proposal)


@router.patch("/proposals/{proposal_id}")
async def update_proposal(
    proposal_id: str,
    data: ProposalUpdate,
    user: dict = Depends(_current_user),
):
    _require(user, "edit_proposals")
    proposal = _proposal(proposal_id)
    if proposal["status"] not in ("draft", "changes_requested"):
        raise HTTPException(status_code=409, detail="Only draft or change-requested proposals can be edited")
    raw = data.model_dump(exclude_unset=True, mode="json")
    version = raw.pop("version", proposal.get("version"))
    if version is None:
        raise HTTPException(status_code=409, detail="Proposal version is required")
    updates = {key: value for key, value in raw.items() if key in EDITABLE_FIELDS}
    if not updates:
        return _serialize(proposal)
    merged = {**proposal, **updates}
    try:
        ProposalCreate(**{key: merged.get(key) for key in ProposalCreate.model_fields})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    updated = _optimistic_update(proposal_id, int(version), updates)
    _event(proposal_id, "updated", user_id=user["id"], metadata={"fields": sorted(updates)})
    return _serialize(updated)


@router.post("/proposals/{proposal_id}/duplicate", status_code=201)
async def duplicate_proposal(proposal_id: str, user: dict = Depends(_current_user)):
    _require(user, "edit_proposals")
    original = _proposal(proposal_id)
    row = {
        "id": str(uuid.uuid4()),
        "status": "draft",
        **{key: original.get(key) for key in SNAPSHOT_FIELDS},
        "version": 1,
        "created_by": user["id"],
        "assigned_to": original.get("assigned_to"),
        "created_at": _now(),
        "updated_at": _now(),
    }
    result = _db.table("proposals").insert(row).execute()
    created = dict(result.data[0] if result.data else row)
    _event(created["id"], "duplicated", user_id=user["id"], metadata={"source_proposal_id": proposal_id})
    return _serialize(created)


@router.post("/proposals/{proposal_id}/submit-approval")
async def submit_approval(
    proposal_id: str,
    request: Request,
    data: Optional[VersionAction] = None,
    user: dict = Depends(_current_user),
):
    _require(user, "edit_proposals")
    proposal = _proposal(proposal_id)
    if proposal["status"] not in ("draft", "changes_requested"):
        raise HTTPException(status_code=409, detail="Proposal is not editable")
    version = _action_version(proposal, data, request)
    if int(proposal["version"]) != version:
        raise HTTPException(
            status_code=409,
            detail={"message": "Proposal was changed by another user", "current_version": proposal["version"]},
        )
    _validate_sendable(proposal)
    revision = _create_revision(proposal, user["id"])
    updated = _optimistic_update(
        proposal_id, version,
        {"status": "pending_approval", "current_revision_id": revision["id"]},
    )
    _event(proposal_id, "submitted_for_approval", user_id=user["id"], metadata={"revision_id": revision["id"]})
    _notify_approvers(updated)
    return _serialize(updated)


@router.post("/proposals/{proposal_id}/approve")
async def approve_proposal(
    proposal_id: str,
    request: Request,
    data: Optional[VersionAction] = None,
    user: dict = Depends(_current_user),
):
    _require(user, "approve_proposals")
    proposal = _proposal(proposal_id)
    if proposal["status"] != "pending_approval":
        raise HTTPException(status_code=409, detail="Proposal is not awaiting approval")
    version = _action_version(proposal, data, request)
    updated = _optimistic_update(
        proposal_id, version,
        {"status": "approved", "approved_at": _now(), "approved_by": user["id"]},
    )
    _event(proposal_id, "approved_internal", user_id=user["id"])
    _notify(
        proposal.get("created_by"), proposal_id, "proposal_approved",
        "Proposal approved", f"{proposal['client_name']} proposal is ready to send.",
    )
    return _serialize(updated)


def _upsert_proposal_hold(proposal: dict, calendar: dict, user: dict) -> dict:
    hold_expiry = (datetime.now(timezone.utc) + timedelta(
        hours=max(1, int(os.environ.get("PROPOSAL_HOLD_HOURS", "72")))
    )).isoformat()
    booking = {
        "calendar_id": proposal["calendar_id"],
        "member_id": proposal.get("assigned_to") or proposal["created_by"],
        "date": str(proposal["session_date"]),
        "start_time": proposal["arrival_time"],
        "end_time": proposal["wrap_time"],
        "notes": f"Proposal hold — {proposal['client_name']}",
        "status": "pending",
        "source": "proposal",
        "proposal_id": proposal["id"],
        "hold_expires_at": hold_expiry,
    }
    if proposal.get("booking_id"):
        result = _db.table("bookings").update(booking).eq("id", proposal["booking_id"]).execute()
        if result.data:
            return dict(result.data[0])
    booking.update({"id": str(uuid.uuid4()), "created_at": _now()})
    result = _db.table("bookings").insert(booking).execute()
    return dict(result.data[0] if result.data else booking)


def _client_first_name(proposal: dict) -> str:
    return (str(proposal.get("client_name") or "there").strip().split() or ["there"])[0]


def _proposal_email(proposal: dict, link: str) -> tuple[str, str, str]:
    font = "Manrope, Helvetica, Arial, sans-serif"
    logo = "https://framerusercontent.com/assets/3HwVggLmyKfOrpHHCI76j8tFoTY.png"
    settings = proposal.get("share_settings") or {}
    if not isinstance(settings, dict):
        settings = {}
    first = _client_first_name(proposal)
    subject = str(settings.get("subject") or "Your Studio 7 proposal").strip()[:200]
    title = html.escape(str(proposal.get("title") or "Content proposal"))
    date_text = str(proposal.get("session_date") or "")
    deliverables_text = str(proposal.get("deliverables") or "")
    currency = str((proposal.get("pricing") or {}).get("currency") or "USD").upper()
    symbol = "$" if currency == "USD" else f"{currency} "
    rate = f"{symbol}{_effective_rate_cents(proposal) / 100:,.2f}"
    href = html.escape(link, quote=True)
    location = "Studio 7 Miami — 638 NW 62nd St, Miami, FL 33150"
    intro = html.escape(f"{first} — here’s what we put together for you.")

    def spec_row(label: str, value: str, last: bool = False) -> str:
        border = "none" if last else "1px solid rgba(17,17,17,0.08)"
        return (
            f'<tr><td style="padding:13px 0;border-bottom:{border};font-family:{font};'
            'font-size:10px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;'
            f'color:#6F6F6B;vertical-align:top;">{html.escape(label)}</td>'
            f'<td style="padding:13px 0 13px 16px;border-bottom:{border};font-family:{font};'
            f'font-size:14px;color:#111;text-align:right;line-height:1.45;">{value}</td></tr>'
        )

    specs = [
        ("Session", title),
        ("Date", html.escape(date_text)),
        ("Deliverables", html.escape(deliverables_text)),
        (
            "Location",
            '<span style="display:block">Studio 7 Miami</span>'
            '<span style="display:block">638 NW 62nd St, Miami, FL 33150</span>',
        ),
        ("Total", html.escape(rate)),
    ]
    specs = [(label, value) for label, value in specs if value]
    spec_html = "".join(spec_row(label, value, index == len(specs) - 1) for index, (label, value) in enumerate(specs))
    body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&display=swap" rel="stylesheet">
<title>{html.escape(subject)}</title>
<style>
  .s7-email-title {{
    margin: 0 0 10px;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: #111;
    white-space: nowrap;
  }}
  .s7-email-pad {{
    padding: 36px 28px 12px;
  }}
  @media only screen and (max-width: 600px) {{
    .s7-email-title {{
      font-size: 18px !important;
      letter-spacing: -0.03em !important;
      white-space: nowrap !important;
    }}
    .s7-email-pad {{
      padding: 28px 16px 12px !important;
    }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background:#F7F7F5;font-family:{font};color:#111;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{html.escape(f"{first} — here’s what we put together for you.")}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F7F5;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#F7F7F5;">
<tr><td bgcolor="#000000" style="background:#000;padding:0;text-align:center;line-height:0;"><img src="{logo}" width="600" alt="Studio 7 Miami" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:#000;"></td></tr>
<tr><td class="s7-email-pad" style="padding:36px 28px 12px;"><p style="margin:0 0 8px;font-size:10px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#6F6F6B;">Content proposal</p>
<h1 class="s7-email-title" style="margin:0 0 10px;font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.15;color:#111;white-space:nowrap;">Your session is ready to review</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#6F6F6B;">{intro}</p></td></tr>
<tr><td style="padding:20px 28px 8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FCFCFA;border:1px solid rgba(17,17,17,.08);border-radius:24px;">
<tr><td style="padding:22px 24px 8px;"><p style="margin:0;font-size:10px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#6F6F6B;">Your session at a glance</p></td></tr>
<tr><td style="padding:0 24px 8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">{spec_html}</table></td></tr></table></td></tr>
<tr><td style="padding:20px 28px 8px;" align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#111111" style="background:#111;border-radius:999px;">
<a href="{href}" style="display:inline-block;padding:14px 28px;font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;color:#F7F7F5;">View your proposal</a>
</td></tr></table></td></tr>
<tr><td style="padding:28px 28px 40px;text-align:center;"><p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#6F6F6B;">Studio 7 Miami<br>638 NW 62nd St, Miami, FL 33150</p>
<p style="margin:0;font-size:12px;line-height:1.6;"><a href="https://studio7.miami" style="color:#111;text-decoration:none;">studio7.miami</a><span style="color:#C8C8C4;"> · </span><a href="https://book.studio7.miami" style="color:#111;text-decoration:none;">book.studio7.miami</a></p>
</td></tr></table></td></tr></table></body></html>"""
    text = "\n".join(filter(None, [
        f"{first} — here’s what we put together for you.",
        "",
        f"Session: {proposal.get('title') or 'Content proposal'}",
        f"Date: {date_text}" if date_text else None,
        f"Deliverables: {deliverables_text}" if deliverables_text else None,
        f"Location: {location.replace(' — ', ', ')}", f"Total: {rate}", "",
        link, "", "Studio 7 Miami", "638 NW 62nd St, Miami, FL 33150",
        "https://studio7.miami",
    ]))
    return subject, body, text


async def _send(proposal: dict, version: int, expires_days: int, user: dict, *, channel: str = "email") -> dict:
    if proposal["status"] not in (
        "draft", "changes_requested", "approved", "sent", "viewed", "client_approved", "signed"
    ):
        raise HTTPException(status_code=409, detail="This proposal cannot be sent in its current state")
    if int(proposal["version"]) != version:
        raise HTTPException(
            status_code=409,
            detail={"message": "Proposal was changed by another user", "current_version": proposal["version"]},
        )
    calendar = _validate_sendable(proposal)
    if _has_conflict(proposal):
        raise HTTPException(status_code=409, detail="The proposal schedule conflicts with another booking")
    revision_id = proposal.get("current_revision_id")
    send_updates: dict[str, Any] = {"calendar_id": proposal.get("calendar_id")}
    if not revision_id:
        revision = _create_revision(proposal, user["id"])
        revision_id = revision["id"]
        send_updates["current_revision_id"] = revision_id
    booking = _upsert_proposal_hold(proposal, calendar, user)
    token = issue_share_token(proposal, user, revision_id, expires_days)
    link = _share_url(token, step=_client_share_step(proposal.get("status")))
    delivered = False
    error = None
    copy_sent = False
    copy_error = None
    subject, html_body, text_body = _proposal_email(proposal, link)
    copy_sent, copy_error = await _copy_to_mock_inbox(proposal, subject, html_body, text_body)
    if channel != "text":
        delivered, error = await _deliver_proposal_mail(proposal, subject, html_body, text_body)
    elif not copy_sent:
        error = copy_error
    updated = _optimistic_update(
        proposal["id"], version,
        {
            "status": (
                proposal["status"]
                if proposal["status"] in ("client_approved", "signed")
                else "sent"
            ),
            "sent_at": _now(),
            "booking_id": booking["id"],
            **send_updates,
        },
    )
    share_row = _share_row_by_token(token) or {}
    _event(
        proposal["id"], "sent", user_id=user["id"], share_id=share_row.get("id"),
        metadata={
            "email_delivered": delivered,
            "email_error": error,
            "copy_email_delivered": copy_sent,
            "copy_email_error": copy_error,
            "channel": channel,
        },
    )
    if proposal.get("assigned_to") and str(proposal["assigned_to"]) != str(user["id"]):
        _notify(
            proposal["assigned_to"], proposal["id"], "proposal_sent",
            "Proposal sent", f"{proposal['client_name']} proposal was sent.",
        )
    return {
        **_serialize(updated, token),
        "email_sent": delivered,
        "email_error": error,
        "copy_email_sent": copy_sent,
        "copy_email_error": copy_error,
    }


@router.post("/proposals/{proposal_id}/send")
async def send_proposal(
    proposal_id: str,
    request: Request,
    data: Optional[SendAction] = None,
    user: dict = Depends(_current_user),
):
    _require(user, "send_proposals")
    proposal = _proposal(proposal_id)
    return await _send(
        proposal,
        _action_version(proposal, data, request),
        data.expires_days if data else 30,
        user,
        channel=(data.channel if data else "email"),
    )


@router.post("/proposals/{proposal_id}/resend")
async def resend_proposal(
    proposal_id: str,
    request: Request,
    data: Optional[SendAction] = None,
    user: dict = Depends(_current_user),
):
    _require(user, "send_proposals")
    proposal = _proposal(proposal_id)
    return await _send(
        proposal,
        _action_version(proposal, data, request),
        data.expires_days if data else 30,
        user,
        channel=(data.channel if data else "email"),
    )


@router.post("/proposals/{proposal_id}/archive")
async def archive_proposal(
    proposal_id: str,
    request: Request,
    data: Optional[VersionAction] = None,
    user: dict = Depends(_current_user),
):
    _require(user, "manage_proposals")
    proposal = _proposal(proposal_id)
    if proposal["status"] == "archived":
        return _serialize(proposal)
    version = _action_version(proposal, data, request)
    updated = _optimistic_update(
        proposal_id, version, {"status": "archived", "archived_at": _now()}
    )
    _db.table("proposal_shares").update({"revoked": True, "revoked_at": _now()}).eq("proposal_id", proposal_id).execute()
    if proposal.get("booking_id"):
        _db.table("bookings").update({"status": "denied", "hold_expires_at": _now()}).eq("id", proposal["booking_id"]).eq("status", "pending").execute()
    _event(proposal_id, "archived", user_id=user["id"])
    return _serialize(updated)


def _mint_share_token(proposal: dict, user: dict, expires_days: int = 30) -> str:
    """Create or reuse a share link for an already-revisioned proposal (no email)."""
    revision_id = proposal.get("current_revision_id")
    if not revision_id:
        raise HTTPException(status_code=409, detail="Send the proposal once before creating a client link")
    return issue_share_token(proposal, user, revision_id, expires_days)


@router.post("/proposals/{proposal_id}/mark-accepted")
async def mark_accepted(
    proposal_id: str,
    request: Request,
    data: Optional[VersionAction] = None,
    user: dict = Depends(_current_user),
):
    """Staff marks a verbal/SMS yes as client_approved so the client can sign + pay."""
    _require(user, "edit_proposals")
    proposal = _proposal(proposal_id)
    if proposal["status"] in ("client_approved", "signed", "deposit_paid", "paid"):
        token = None
        if proposal.get("current_revision_id"):
            try:
                token = _mint_share_token(proposal, user)
            except HTTPException:
                token = None
        return _serialize(proposal, token)
    if proposal["status"] not in ("draft", "approved", "sent", "viewed"):
        raise HTTPException(
            status_code=409,
            detail="This proposal cannot be marked accepted in its current state",
        )
    version = _action_version(proposal, data, request)
    if int(proposal["version"]) != version:
        raise HTTPException(
            status_code=409,
            detail={"message": "Proposal was changed by another user", "current_version": proposal["version"]},
        )
    calendar = _validate_sendable(proposal)
    if _has_conflict(proposal):
        raise HTTPException(status_code=409, detail="The proposal schedule conflicts with another booking")
    timestamp = _now()
    updates: dict[str, Any] = {
        "status": "client_approved",
        "client_approved_at": timestamp,
        "calendar_id": proposal.get("calendar_id"),
    }
    revision_id = proposal.get("current_revision_id")
    if not revision_id:
        revision = _create_revision(proposal, user["id"])
        revision_id = revision["id"]
        updates["current_revision_id"] = revision_id
        proposal = {**proposal, "current_revision_id": revision_id}
    booking = _upsert_proposal_hold(proposal, calendar, user)
    updates["booking_id"] = booking["id"]
    updated = _optimistic_update(proposal_id, version, updates)
    _event(
        proposal_id,
        "marked_accepted",
        user_id=user["id"],
        metadata={"channel": "text", "previous_status": proposal["status"]},
    )
    token = _mint_share_token({**updated, "current_revision_id": revision_id}, user)
    _event(
        proposal_id,
        "share_refreshed",
        user_id=user["id"],
        metadata={"reason": "mark_accepted"},
    )
    payload = _serialize(updated, token)
    await _mock_process_email(
        {**updated, "status": "client_approved"},
        "Marked accepted",
        f"Sign + pay link: {payload.get('share_url') or '—'}",
    )
    return payload


@router.get("/proposals/{proposal_id}/activity")
async def proposal_activity(proposal_id: str, user: dict = Depends(_current_user)):
    _require(user, "view_proposals")
    _proposal(proposal_id)
    return (
        _db.table("proposal_events").select("*").eq("proposal_id", proposal_id)
        .order("created_at", desc=True).execute().data or []
    )


@router.get("/public/proposals/{token}")
async def public_proposal(token: str, request: Request):
    _public_rate_limit(request)
    share, proposal, revision = _public_share(token)
    if not share.get("first_viewed_at"):
        _db.table("proposal_shares").update({"first_viewed_at": _now(), "last_viewed_at": _now()}).eq("id", share["id"]).execute()
        if proposal["status"] == "sent":
            _db.table("proposals").update({
                "status": "viewed",
                "version": int(proposal["version"]) + 1,
                "updated_at": _now(),
            }).eq("id", proposal["id"]).eq("status", "sent").eq("version", proposal["version"]).execute()
        _event(proposal["id"], "viewed", share_id=share["id"])
    else:
        _db.table("proposal_shares").update({"last_viewed_at": _now()}).eq("id", share["id"]).execute()
    payments = (
        _db.table("proposal_payments").select("id,status,payment_type,amount_cents,currency,paid_at")
        .eq("proposal_id", proposal["id"]).order("created_at", desc=True).execute().data or []
    )
    signatures = (
        _db.table("proposal_signatures").select("id,signer_name,signer_email,signed_at")
        .eq("proposal_id", proposal["id"]).order("signed_at", desc=True).execute().data or []
    )
    current = _proposal(proposal["id"])
    public_status = _public_status(current.get("status", proposal["status"]))
    return {
        "proposal": {
            **revision["snapshot"],
            "id": proposal["id"],
            "status": public_status,
            "version": current.get("version"),
            "approved_at": current.get("client_approved_at"),
            "signed_at": current.get("signed_at"),
            "revision_number": revision["revision_number"],
        },
        "revision": {"id": revision["id"], "revision_number": revision["revision_number"], "created_at": revision["created_at"]},
        "agreement": revision["agreement_snapshot"],
        "payment_summary": payments[0] if payments else None,
        "signature_summary": signatures[0] if signatures else None,
    }


@router.post("/public/proposals/{token}/change-request", status_code=201)
async def public_change_request(token: str, data: ChangeRequestIn, request: Request):
    _public_rate_limit(request)
    share, proposal, revision = _public_share(token)
    if proposal["status"] not in ("sent", "viewed", "client_approved"):
        raise HTTPException(status_code=409, detail="Changes cannot be requested in the proposal's current state")
    row = {
        "id": str(uuid.uuid4()),
        "proposal_id": proposal["id"],
        "revision_id": revision["id"],
        "share_id": share["id"],
        "client_name": data.client_name or proposal["client_name"],
        "message": data.message.strip(),
        "status": "open",
        "created_at": _now(),
    }
    _db.table("proposal_change_requests").insert(row).execute()
    _db.table("proposals").update({
        "status": "changes_requested",
        "version": int(proposal["version"]) + 1,
        "updated_at": _now(),
    }).eq("id", proposal["id"]).eq("version", proposal["version"]).execute()
    _event(proposal["id"], "changes_requested", share_id=share["id"], metadata={"change_request_id": row["id"]})
    _notify(proposal.get("created_by"), proposal["id"], "proposal_changes_requested", "Client requested changes", data.message[:300])
    await _mock_process_email(
        proposal,
        "Client requested changes",
        data.message.strip(),
    )
    return {"id": row["id"], "status": "open"}


@router.post("/public/proposals/{token}/approve")
async def public_approve(token: str, data: PublicApproveIn, request: Request):
    _public_rate_limit(request)
    share, proposal, _revision = _public_share(token)
    if proposal["status"] in ("client_approved", "signed", "deposit_paid", "paid"):
        return {
            "ok": True,
            "status": _public_status(proposal["status"]),
            "approved_at": proposal.get("client_approved_at"),
            "version": proposal.get("version"),
        }
    if proposal["status"] not in ("sent", "viewed"):
        raise HTTPException(status_code=409, detail="Proposal cannot be approved in its current state")
    timestamp = _now()
    next_version = int(proposal["version"]) + 1
    _db.table("proposals").update({
        "status": "client_approved",
        "client_approved_at": timestamp,
        "version": next_version,
        "updated_at": timestamp,
    }).eq("id", proposal["id"]).eq("version", proposal["version"]).execute()
    client_name = data.client_name or proposal["client_name"]
    _event(proposal["id"], "client_approved", share_id=share["id"], metadata={"client_name": client_name})
    _notify(proposal.get("created_by"), proposal["id"], "proposal_client_approved", "Client approved proposal", f"{client_name} approved the proposal.")
    await _mock_process_email(
        {**proposal, "status": "client_approved", "client_name": client_name},
        "Client accepted the proposal",
        f"{client_name} accepted. Next is the agreement and deposit.",
    )
    return {"ok": True, "status": "client_approved", "approved_at": timestamp, "version": next_version}


@router.post("/public/proposals/{token}/sign", status_code=201)
async def public_sign(token: str, data: SignatureIn, request: Request):
    _public_rate_limit(request)
    share, proposal, revision = _public_share(token)
    if proposal["status"] not in ("sent", "viewed", "client_approved", "signed", "deposit_paid", "paid"):
        raise HTTPException(status_code=409, detail="Proposal cannot be signed in its current state")
    existing = (
        _db.table("proposal_signatures").select("id,signed_at").eq("proposal_id", proposal["id"])
        .eq("revision_id", revision["id"]).limit(1).execute()
    )
    if existing.data:
        return {"id": existing.data[0]["id"], "status": "signed", "signed_at": existing.data[0]["signed_at"]}
    timestamp = _now()
    agreement_json = json.dumps(revision["agreement_snapshot"], sort_keys=True, separators=(",", ":"), default=str)
    row = {
        "id": str(uuid.uuid4()),
        "proposal_id": proposal["id"],
        "revision_id": revision["id"],
        "share_id": share["id"],
        "signer_name": data.signer_name,
        "signer_email": str(data.signer_email).lower(),
        "signature_data": data.signature_data,
        "consent_text": "I agree to the exact proposal and agreement snapshot attached to this signature.",
        "agreement_snapshot": revision["agreement_snapshot"],
        "agreement_sha256": hashlib.sha256(agreement_json.encode()).hexdigest(),
        "ip_address": request.client.host if request.client else None,
        "user_agent": (request.headers.get("user-agent") or "")[:1000],
        "signed_at": timestamp,
    }
    _db.table("proposal_signatures").insert(row).execute()
    next_version = int(proposal["version"]) + 1
    _db.table("proposals").update({
        "status": "signed",
        "signed_at": timestamp,
        "version": next_version,
        "updated_at": timestamp,
    }).eq("id", proposal["id"]).eq("version", proposal["version"]).execute()
    _event(proposal["id"], "signed", share_id=share["id"], metadata={"signature_id": row["id"]})
    _notify(proposal.get("created_by"), proposal["id"], "proposal_signed", "Proposal signed", f"{data.signer_name} signed the proposal.")
    await _mock_process_email(
        {**proposal, "status": "signed"},
        "Agreement signed",
        f"{data.signer_name} signed the agreement ({data.signer_email}).",
    )
    return {"id": row["id"], "status": "signed", "signed_at": timestamp, "version": next_version}


async def _create_stripe_checkout(
    proposal: dict,
    revision: dict,
    share: dict,
    token: str,
    payment_type: str,
) -> dict:
    secret = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    paid_cents = _paid_payment_cents(proposal["id"]) if payment_type == "remaining" else 0
    amount = payment_amount_cents(proposal, payment_type, paid_cents=paid_cents)
    if amount < 50:
        raise HTTPException(status_code=400, detail="Payment amount is below Stripe's minimum charge")
    pricing = proposal.get("pricing") or {}
    pricing_currency = pricing.get("currency") if isinstance(pricing, dict) else None
    currency = str(pricing_currency or os.environ.get("PROPOSAL_CURRENCY") or "usd").lower()
    payment = {
        "id": str(uuid.uuid4()),
        "proposal_id": proposal["id"],
        "revision_id": revision["id"],
        "share_id": share["id"],
        "amount_cents": amount,
        "currency": currency,
        "payment_type": payment_type,
        "status": "pending",
        "created_at": _now(),
        "updated_at": _now(),
    }
    _db.table("proposal_payments").insert(payment).execute()
    return_url = _share_url(token)
    data = {
        "mode": "payment",
        "success_url": f"{return_url}?checkout=success",
        "cancel_url": f"{return_url}?checkout=cancelled",
        "customer_email": proposal["client_email"],
        "client_reference_id": proposal["id"],
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": payment["currency"],
        "line_items[0][price_data][unit_amount]": str(amount),
        "line_items[0][price_data][product_data][name]": (
            f"{'Deposit' if payment_type == 'deposit' else 'Remaining balance' if payment_type == 'remaining' else 'Full payment'} — "
            f"{proposal.get('title') or proposal['client_name']}"
        ),
        "metadata[proposal_id]": proposal["id"],
        "metadata[payment_id]": payment["id"],
        "metadata[payment_type]": payment_type,
        "payment_intent_data[metadata][proposal_id]": proposal["id"],
        "payment_intent_data[metadata][payment_id]": payment["id"],
        "payment_intent_data[metadata][payment_type]": payment_type,
        "expires_at": str(
            int(time.time())
            + min(86400, max(1800, int(os.environ.get("STRIPE_CHECKOUT_EXPIRES_SEC", "86400"))))
        ),
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            "https://api.stripe.com/v1/checkout/sessions",
            auth=(secret, ""),
            data=data,
            headers={"Idempotency-Key": payment["id"]},
        )
    if response.status_code not in (200, 201):
        _db.table("proposal_payments").update({"status": "failed", "updated_at": _now()}).eq("id", payment["id"]).execute()
        logger.error("Stripe Checkout create failed: %s", response.text[:1000])
        raise HTTPException(status_code=502, detail="Could not create checkout session")
    session = response.json()
    _db.table("proposal_payments").update({
        "stripe_checkout_session_id": session["id"],
        "checkout_url": session.get("url"),
        "updated_at": _now(),
    }).eq("id", payment["id"]).execute()
    _event(
        proposal["id"], "checkout_created", share_id=share["id"],
        metadata={"payment_id": payment["id"], "payment_type": payment_type},
    )
    return {
        "checkout_url": session.get("url"),
        "session_id": session["id"],
        "payment_id": payment["id"],
        "payment_type": payment_type,
        "amount_cents": amount,
    }


@router.post("/public/proposals/{token}/checkout", status_code=201)
async def public_checkout(token: str, data: CheckoutIn, request: Request):
    _public_rate_limit(request)
    share, proposal, revision = _public_share(token)
    if proposal["status"] not in ("client_approved", "signed", "deposit_paid"):
        raise HTTPException(status_code=409, detail="Approve or sign the proposal before checkout")
    if data.payment_type == "remaining" and proposal["status"] != "deposit_paid":
        raise HTTPException(status_code=409, detail="The remaining balance is only due after the first deposit")
    if data.payment_type == "deposit" and proposal["status"] == "deposit_paid":
        raise HTTPException(status_code=409, detail="The first deposit is already paid")
    return await _create_stripe_checkout(proposal, revision, share, token, data.payment_type)


async def _confirm_paid_booking(proposal: dict) -> None:
    if not proposal.get("booking_id"):
        logger.warning("Paid proposal %s has no linked booking", proposal["id"])
        return
    booking_result = _db.table("bookings").select("*").eq("id", proposal["booking_id"]).limit(1).execute()
    if not booking_result.data:
        logger.warning("Proposal %s linked booking is missing", proposal["id"])
        return
    booking = dict(booking_result.data[0])
    if booking.get("status") == "approved" and booking.get("google_event_id"):
        return
    calendar_result = _db.table("calendars").select("*").eq("id", booking["calendar_id"]).limit(1).execute()
    calendar = dict(calendar_result.data[0]) if calendar_result.data else {}
    google_event_id = booking.get("google_event_id")
    if not google_event_id and _gcal_push:
        google_event_id = await _gcal_push(
            calendar.get("google_calendar_id"), booking, str(proposal["created_by"])
        )
    _db.table("bookings").update({
        "status": "approved",
        "hold_expires_at": None,
        "approved_at": _now(),
        "approved_by": proposal["created_by"],
        "google_event_id": google_event_id,
    }).eq("id", booking["id"]).execute()


async def _process_stripe_event(event: dict) -> None:
    event_type = event.get("type")
    obj = ((event.get("data") or {}).get("object") or {})
    if event_type not in ("checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded"):
        return
    if event_type == "checkout.session.completed" and obj.get("payment_status") != "paid":
        return
    metadata = obj.get("metadata") or {}
    payment_id = metadata.get("payment_id")
    proposal_id = metadata.get("proposal_id") or obj.get("client_reference_id")
    if not payment_id and obj.get("id"):
        column = "stripe_checkout_session_id" if str(obj["id"]).startswith("cs_") else "stripe_payment_intent_id"
        found = _db.table("proposal_payments").select("*").eq(column, obj["id"]).limit(1).execute()
        if found.data:
            payment_id = found.data[0]["id"]
            proposal_id = found.data[0]["proposal_id"]
    if not payment_id or not proposal_id:
        logger.warning("Stripe event %s has no proposal payment metadata", event.get("id"))
        return
    current_payment = (
        _db.table("proposal_payments").select("id,status,payment_type,amount_cents")
        .eq("id", payment_id).limit(1).execute()
    )
    if not current_payment.data:
        raise RuntimeError("Proposal payment record not found")
    paid_amount = obj.get("amount_total") if str(obj.get("id", "")).startswith("cs_") else obj.get("amount_received")
    if paid_amount is not None and int(paid_amount) != int(current_payment.data[0]["amount_cents"]):
        raise RuntimeError("Stripe payment amount does not match proposal deposit")
    if current_payment.data[0].get("status") == "paid":
        await _confirm_paid_booking(_proposal(proposal_id))
        return
    payment_type = str(current_payment.data[0].get("payment_type") or metadata.get("payment_type") or "")
    target_status = proposal_status_for_payment(payment_type)
    updates = {
        "status": "paid",
        "paid_at": _now(),
        "updated_at": _now(),
        "stripe_event_id": event.get("id"),
    }
    if str(obj.get("id", "")).startswith("cs_"):
        updates["stripe_checkout_session_id"] = obj["id"]
        updates["stripe_payment_intent_id"] = obj.get("payment_intent")
    else:
        updates["stripe_payment_intent_id"] = obj.get("id")
    _db.table("proposal_payments").update(updates).eq("id", payment_id).execute()
    proposal = _proposal(proposal_id)
    await _confirm_paid_booking(proposal)
    _db.table("proposals").update({
        "status": target_status,
        "version": int(proposal["version"]) + 1,
        "updated_at": _now(),
    }).eq("id", proposal_id).execute()
    _event(
        proposal_id, "payment_received",
        metadata={"payment_id": payment_id, "payment_type": payment_type, "stripe_event_id": event.get("id")},
    )
    label = "deposit" if payment_type == "deposit" else "full balance"
    _notify(
        proposal.get("created_by"), proposal_id, "proposal_paid",
        f"Proposal {label} paid", f"{proposal['client_name']} paid the proposal {label}.",
    )
    await _mock_process_email(
        {**proposal, "status": target_status},
        f"Proposal {label} paid",
        f"{proposal.get('client_name') or 'Client'} paid the {label}.",
    )


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    secret = (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    tolerance = max(60, int(os.environ.get("STRIPE_WEBHOOK_TOLERANCE_SEC", "300")))
    if not verify_stripe_signature(payload, request.headers.get("stripe-signature", ""), secret, tolerance_seconds=tolerance):
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")
    try:
        event = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    event_id = str(event.get("id") or "")
    if not event_id:
        raise HTTPException(status_code=400, detail="Stripe event id is required")
    existing = _db.table("stripe_webhook_events").select("*").eq("stripe_event_id", event_id).limit(1).execute()
    if existing.data and existing.data[0].get("status") == "processed":
        return {"received": True, "duplicate": True}
    if existing.data and existing.data[0].get("status") == "processing":
        received = _parse_ts(existing.data[0].get("received_at"))
        if received and received > datetime.now(timezone.utc) - timedelta(minutes=10):
            return {"received": True, "duplicate": True, "processing": True}
    if not existing.data:
        try:
            _db.table("stripe_webhook_events").insert({
                "id": str(uuid.uuid4()),
                "stripe_event_id": event_id,
                "event_type": event.get("type"),
                "payload": event,
                "status": "processing",
                "received_at": _now(),
            }).execute()
        except Exception:
            race = _db.table("stripe_webhook_events").select("*").eq("stripe_event_id", event_id).limit(1).execute()
            if race.data and race.data[0].get("status") in ("processed", "processing"):
                return {
                    "received": True,
                    "duplicate": True,
                    "processing": race.data[0].get("status") == "processing",
                }
    else:
        _db.table("stripe_webhook_events").update({"status": "processing", "error": None}).eq("stripe_event_id", event_id).execute()
    try:
        await _process_stripe_event(event)
        _db.table("stripe_webhook_events").update({"status": "processed", "processed_at": _now()}).eq("stripe_event_id", event_id).execute()
    except Exception as exc:
        logger.exception("Stripe webhook processing failed")
        _db.table("stripe_webhook_events").update({"status": "failed", "error": str(exc)[:2000]}).eq("stripe_event_id", event_id).execute()
        raise HTTPException(status_code=500, detail="Webhook processing failed") from exc
    return {"received": True}
