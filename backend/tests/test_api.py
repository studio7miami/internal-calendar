"""Studio 7 Miami Calendar API - comprehensive backend tests."""
import os
import uuid
import pytest
import requests

# Origin only, e.g. http://127.0.0.1:8000 — same as frontend REACT_APP_BACKEND_URL (frontend adds /api in api.js).
# If the env var already ends with /api, do not double it (otherwise every request is /api/api/... → 404).
_default_backend = "https://team-bookings-hub.preview.emergentagent.com"
_raw_base = os.environ.get("REACT_APP_BACKEND_URL", _default_backend).rstrip("/")
if _raw_base.endswith("/api"):
    API = _raw_base
else:
    API = f"{_raw_base}/api"

ADMIN_EMAIL = "seven@studio7.miami"
ADMIN_PASSWORD = "Studio7Miami"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and data["user"]["role"] == "admin"
    return data["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def member(admin_headers):
    """Create invite + register member."""
    email = f"test_member_{uuid.uuid4().hex[:8]}@studio7test.com"
    r = requests.post(f"{API}/invites", json={"email": email}, headers=admin_headers)
    assert r.status_code == 200, r.text
    invite = r.json()
    assert "email_sent" in invite
    assert "email_error" in invite
    token = invite["invite_link"].rsplit("/", 1)[-1]

    # validate invite
    v = requests.get(f"{API}/auth/invite/{token}")
    assert v.status_code == 200 and v.json()["email"] == email

    reg = requests.post(
        f"{API}/auth/register",
        json={
            "invite_token": token,
            "name": "Test Member",
            "password": "memberpass123",
            "phone_e164": "+13055559999",
            "sauce": "photography",
        },
    )
    assert reg.status_code == 200, reg.text
    d = reg.json()
    return {"email": email, "token": d["token"], "user": d["user"], "headers": {"Authorization": f"Bearer {d['token']}"}}


# ----- Auth -----
class TestAuth:
    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert "password_hash" not in data
        assert "permissions" in data
        perms = data["permissions"]
        assert perms.get("view_schedule") is True
        assert perms.get("approve_deny_requests") is True
        assert perms.get("reassign_booking_member") is True
        assert perms.get("see_all_booking_details") is True
        assert perms.get("assign_member_calendars") is True
        assert "phone_e164" in data

    def test_me_no_token(self):
        assert requests.get(f"{API}/auth/me").status_code == 401

    def test_members_bootstrap_admin(self, admin_headers):
        r = requests.get(f"{API}/members/bootstrap", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("users"), list)
        assert isinstance(data.get("invites"), list)
        assert isinstance(data.get("permissions"), dict)
        assert isinstance(data.get("calendars"), list)

    def test_invite_invalid_token(self):
        assert requests.get(f"{API}/auth/invite/bogus123").status_code == 404


# ----- Calendars -----
class TestCalendars:
    def test_list_calendars(self, admin_headers):
        r = requests.get(f"{API}/calendars", headers=admin_headers)
        assert r.status_code == 200
        cals = r.json()
        assert isinstance(cals, list)
        for c in cals:
            assert c.get("is_fixed") is False

    def test_member_cannot_create(self, member):
        r = requests.post(f"{API}/calendars", json={"name": "X", "color": "#fff"}, headers=member["headers"])
        assert r.status_code == 403

    def test_admin_can_create_and_delete(self, admin_headers):
        name = f"TEST_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/calendars",
            json={"name": name, "color": "#FF0000", "is_active": True},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        cal = r.json()
        assert cal["name"] == name and cal.get("is_fixed") is False
        d = requests.delete(f"{API}/calendars/{cal['id']}", headers=admin_headers)
        assert d.status_code == 200

    def test_admin_can_patch_color(self, admin_headers):
        name = f"PATCH_{uuid.uuid4().hex[:8]}"
        cr = requests.post(
            f"{API}/calendars",
            json={"name": name, "color": "#111111", "is_active": True},
            headers=admin_headers,
        )
        assert cr.status_code == 200, cr.text
        cid = cr.json()["id"]
        p = requests.patch(
            f"{API}/calendars/{cid}",
            json={
                "name": name,
                "color": "#33CCFF",
                "google_calendar_id": "",
                "is_active": True,
            },
            headers=admin_headers,
        )
        assert p.status_code == 200
        assert p.json()["color"] == "#33CCFF" and p.json().get("is_fixed") is False
        requests.delete(f"{API}/calendars/{cid}", headers=admin_headers)


def _calendar_id_or_create(admin_headers):
    """Return (calendar_id, created) so integration tests work when the project DB has no rows yet."""
    cals = requests.get(f"{API}/calendars", headers=admin_headers).json()
    if cals:
        return cals[0]["id"], False
    name = f"E2E_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/calendars",
        json={"name": name, "color": "#22C55E", "is_active": True},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"], True


# ----- Invites & RBAC -----
class TestInvitesRBAC:
    def test_member_cannot_invite(self, member):
        r = requests.post(f"{API}/invites", json={"email": "x@y.com"}, headers=member["headers"])
        assert r.status_code == 403

    def test_member_cannot_manual_book(self, member, admin_headers):
        cal_id, created = _calendar_id_or_create(admin_headers)
        try:
            r = requests.post(f"{API}/bookings/manual", json={
                "calendar_id": cal_id, "date": "2026-03-01", "start_time": "10:00", "end_time": "11:00"
            }, headers=member["headers"])
            assert r.status_code == 403
        finally:
            if created:
                requests.delete(f"{API}/calendars/{cal_id}", headers=admin_headers)

    def test_member_registered(self, member):
        u = member["user"]
        assert u["role"] == "member"
        assert "permissions" in u
        p = u["permissions"]
        assert p.get("view_schedule") is True
        assert p.get("see_all_booking_details") in (None, False)
        assert p.get("create_request") is True


# ----- Bookings flow -----
class TestBookings:
    def test_full_flow(self, admin_headers, member):
        cal_id, created_cal = _calendar_id_or_create(admin_headers)

        # Member requests
        r = requests.post(f"{API}/bookings/request", json={
            "calendar_id": cal_id, "date": "2026-04-10", "start_time": "14:00", "end_time": "15:00", "notes": "test req"
        }, headers=member["headers"])
        assert r.status_code == 200
        bid = r.json()["id"]
        assert r.json()["status"] == "pending"

        # Admin sees request
        reqs = requests.get(f"{API}/bookings/requests", headers=admin_headers).json()
        assert any(b["id"] == bid for b in reqs)

        # Admin approves
        ap = requests.post(f"{API}/bookings/{bid}/approve", json={"message": "ok"}, headers=admin_headers)
        assert ap.status_code == 200
        m_notifs = requests.get(f"{API}/notifications", headers=member["headers"]).json()
        assert any(
            n.get("type") == "request_approved" and n.get("booking_id") == bid for n in m_notifs
        ), "Member should receive in-app notification when a request is approved"

        # Verify approved + has google_event_id when viewed by admin
        bookings = requests.get(f"{API}/bookings", headers=admin_headers).json()
        b = next(x for x in bookings if x["id"] == bid)
        assert b["status"] == "approved"
        assert b.get("google_event_id", "").startswith("gcal_mock_")

        # Member sees own detail
        m_bookings = requests.get(f"{API}/bookings", headers=member["headers"]).json()
        b2 = next(x for x in m_bookings if x["id"] == bid)
        assert b2["is_own"] is True and b2.get("notes") == "test req"

        # Create manual booking by admin (owned by admin)
        mb = requests.post(f"{API}/bookings/manual", json={
            "calendar_id": cal_id, "date": "2026-04-11", "start_time": "09:00", "end_time": "10:00"
        }, headers=admin_headers)
        assert mb.status_code == 200
        mbid = mb.json()["id"]

        # Member sees manual booking but anonymized
        m_bookings2 = requests.get(f"{API}/bookings", headers=member["headers"]).json()
        anon = next(x for x in m_bookings2 if x["id"] == mbid)
        assert anon["is_own"] is False
        assert "notes" not in anon and "member_name" not in anon

        # Deny flow
        r2 = requests.post(f"{API}/bookings/request", json={
            "calendar_id": cal_id, "date": "2026-04-12", "start_time": "10:00", "end_time": "11:00"
        }, headers=member["headers"])
        bid2 = r2.json()["id"]
        dn = requests.post(f"{API}/bookings/{bid2}/deny", json={"message": "no"}, headers=admin_headers)
        assert dn.status_code == 200
        m_notifs2 = requests.get(f"{API}/notifications", headers=member["headers"]).json()
        assert any(
            n.get("type") == "request_denied" and n.get("booking_id") == bid2 for n in m_notifs2
        ), "Member should receive in-app notification when a request is denied"

        # Member cannot delete another user's booking
        assert requests.delete(f"{API}/bookings/{mbid}", headers=member["headers"]).status_code == 403

        # Member reschedules own approved booking, then cancels it
        patch = requests.patch(
            f"{API}/bookings/{bid}",
            json={"start_time": "15:00", "end_time": "16:00"},
            headers=member["headers"],
        )
        assert patch.status_code == 200, patch.text
        assert patch.json().get("start_time") == "15:00"
        assert requests.delete(f"{API}/bookings/{bid}", headers=member["headers"]).status_code == 200

        # Cleanup
        requests.delete(f"{API}/bookings/{mbid}", headers=admin_headers)
        requests.delete(f"{API}/bookings/{bid2}", headers=admin_headers)
        if created_cal:
            requests.delete(f"{API}/calendars/{cal_id}", headers=admin_headers)

    def test_request_rejects_overlap_with_pending(self, admin_headers, member):
        """Two overlapping pending holds on the same calendar should not both exist."""
        cal_id, created_cal = _calendar_id_or_create(admin_headers)
        try:
            slot = {"calendar_id": cal_id, "date": "2026-06-01", "start_time": "10:00", "end_time": "11:00", "notes": "a"}
            r1 = requests.post(f"{API}/bookings/request", json=slot, headers=member["headers"])
            assert r1.status_code == 200, r1.text
            r2 = requests.post(
                f"{API}/bookings/request",
                json={**slot, "notes": "b"},
                headers=member["headers"],
            )
            assert r2.status_code == 400, r2.text
            bid1 = r1.json()["id"]
            requests.delete(f"{API}/bookings/{bid1}", headers=member["headers"])
        finally:
            if created_cal:
                requests.delete(f"{API}/calendars/{cal_id}", headers=admin_headers)

    def test_manual_rejects_overlap(self, admin_headers):
        cal_id, created_cal = _calendar_id_or_create(admin_headers)
        try:
            body = {"calendar_id": cal_id, "date": "2026-06-02", "start_time": "14:00", "end_time": "15:30"}
            r1 = requests.post(f"{API}/bookings/manual", json=body, headers=admin_headers)
            assert r1.status_code == 200, r1.text
            r2 = requests.post(
                f"{API}/bookings/manual",
                json={**body, "start_time": "15:00", "end_time": "16:00"},
                headers=admin_headers,
            )
            assert r2.status_code == 400, r2.text
            mid = r1.json()["id"]
            requests.delete(f"{API}/bookings/{mid}", headers=admin_headers)
        finally:
            if created_cal:
                requests.delete(f"{API}/calendars/{cal_id}", headers=admin_headers)


# ----- Notifications -----
class TestNotifications:
    def test_notifications_and_read_all(self, member, admin_headers):
        cals = requests.get(f"{API}/calendars", headers=admin_headers).json()
        # create request -> creates confirmation notif for member
        requests.post(f"{API}/bookings/request", json={
            "calendar_id": cals[0]["id"], "date": "2026-05-01", "start_time": "10:00", "end_time": "11:00"
        }, headers=member["headers"])
        n = requests.get(f"{API}/notifications", headers=member["headers"])
        assert n.status_code == 200
        notifs = n.json()
        assert len(notifs) >= 1
        assert any(x["is_read"] is False for x in notifs)
        # mark all read
        requests.post(f"{API}/notifications/read-all", headers=member["headers"])
        notifs2 = requests.get(f"{API}/notifications", headers=member["headers"]).json()
        assert all(x["is_read"] for x in notifs2)
