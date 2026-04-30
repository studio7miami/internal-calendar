"""
Role-based permissions. Admin role is always full access in code; member/manager
defaults and overrides live in `app_config` (or fall back to DEFAULT_ROLE_PERMISSIONS).
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

# (key, short label) — used in API + admin UI
PERMISSION_DEFINITIONS: Tuple[Tuple[str, str], ...] = (
    ("view_schedule", "View calendar"),
    ("create_request", "Create booking requests"),
    ("see_all_booking_details", "See all booking details"),
    ("create_manual_booking", "Add manual bookings"),
    ("approve_deny_requests", "View and approve / deny requests"),
    ("view_members_directory", "View team list"),
    ("assign_member_calendars", "Assign calendars to members"),
    ("delete_any_booking", "Delete or cancel any booking"),
)

PERMISSION_KEYS = [k for k, _ in PERMISSION_DEFINITIONS]

DEFAULT_MEMBER: Dict[str, bool] = {
    "view_schedule": True,
    "create_request": True,
    "see_all_booking_details": False,
    "create_manual_booking": False,
    "approve_deny_requests": False,
    "view_members_directory": False,
    "assign_member_calendars": False,
    "delete_any_booking": False,
}

# Managers: schedule + full detail + requests per product brief; toggles are admin-editable
DEFAULT_MANAGER: Dict[str, bool] = {
    "view_schedule": True,
    "create_request": True,
    "see_all_booking_details": True,
    "create_manual_booking": True,
    "approve_deny_requests": True,
    "view_members_directory": True,
    "assign_member_calendars": False,
    "delete_any_booking": False,
}

DEFAULTS_BY_ROLE: Dict[str, Dict[str, bool]] = {
    "member": {**DEFAULT_MEMBER},
    "manager": {**DEFAULT_MANAGER},
}


def _full_admin_permissions() -> Dict[str, bool]:
    return {k: True for k in PERMISSION_KEYS}


def merge_with_defaults(
    role: str,
    overrides: Optional[Dict[str, bool]],
) -> Dict[str, bool]:
    if role == "admin":
        return _full_admin_permissions()
    base = DEFAULTS_BY_ROLE.get(role, DEFAULT_MEMBER).copy()
    if not overrides:
        return {k: base.get(k, False) for k in PERMISSION_KEYS}
    for k in PERMISSION_KEYS:
        if k in overrides:
            base[k] = bool(overrides[k])
    for k in PERMISSION_KEYS:
        if k not in base:
            base[k] = DEFAULTS_BY_ROLE.get(role, DEFAULT_MEMBER).get(k, False)
    return {k: bool(base.get(k, False)) for k in PERMISSION_KEYS}


def resolve_effective(
    role: str,
    stored: Optional[Dict[str, Any]],
) -> Dict[str, bool]:
    """`stored` is the app_config `role_permissions` object: { member: {...}, manager: {...} }"""
    if role == "admin":
        return _full_admin_permissions()
    if role not in ("member", "manager"):
        return merge_with_defaults("member", (stored or {}).get("member"))
    ovr = (stored or {}).get(role) if stored else None
    return merge_with_defaults(role, ovr)


def has(
    perms: Dict[str, bool],
    key: str,
) -> bool:
    return bool(perms.get(key))


def sanitize_stored(
    body: Any,
) -> Optional[Dict[str, Dict[str, bool]]]:
    if body is None:
        return None
    if not isinstance(body, dict):
        return None
    out: Dict[str, Dict[str, bool]] = {"member": {}, "manager": {}}
    for role in ("member", "manager"):
        if role not in body:
            continue
        r = body[role]
        if not isinstance(r, dict):
            continue
        for k in PERMISSION_KEYS:
            if k in r:
                out[role][k] = bool(r[k])
    return out


def definitions_for_api() -> list[dict[str, str]]:
    return [{"key": k, "label": l} for k, l in PERMISSION_DEFINITIONS]
