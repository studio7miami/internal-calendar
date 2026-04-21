"""Studio 7 Miami Calendar API - comprehensive backend tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-bookings-hub.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

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
    token = invite["invite_link"].rsplit("/", 1)[-1]

    # validate invite
    v = requests.get(f"{API}/auth/invite/{token}")
    assert v.status_code == 200 and v.json()["email"] == email

    reg = requests.post(f"{API}/auth/register", json={"invite_token": token, "name": "Test Member", "password": "memberpass123"})
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
        assert r.json()["email"] == ADMIN_EMAIL
        assert "password_hash" not in r.json()

    def test_me_no_token(self):
        assert requests.get(f"{API}/auth/me").status_code == 401

    def test_invite_invalid_token(self):
        assert requests.get(f"{API}/auth/invite/bogus123").status_code == 404


# ----- Calendars -----
class TestCalendars:
    def test_list_has_seeds(self, admin_headers):
        r = requests.get(f"{API}/calendars", headers=admin_headers)
        assert r.status_code == 200
        names = [c["name"] for c in r.json()]
        assert "Photobooth" in names and "Studio 7 Miami" in names

    def test_member_cannot_create(self, member):
        r = requests.post(f"{API}/calendars", json={"name": "X", "color": "#fff"}, headers=member["headers"])
        assert r.status_code == 403

    def test_admin_crud(self, admin_headers):
        r = requests.post(f"{API}/calendars", json={"name": f"TEST_{uuid.uuid4().hex[:6]}", "color": "#FF0000"}, headers=admin_headers)
        assert r.status_code == 200
        cid = r.json()["id"]
        # patch
        p = requests.patch(f"{API}/calendars/{cid}", json={"name": "TEST_upd", "color": "#00FF00", "is_active": False}, headers=admin_headers)
        assert p.status_code == 200 and p.json()["color"] == "#00FF00"
        # verify
        g = requests.get(f"{API}/calendars", headers=admin_headers).json()
        assert any(c["id"] == cid and c["name"] == "TEST_upd" for c in g)
        # delete
        d = requests.delete(f"{API}/calendars/{cid}", headers=admin_headers)
        assert d.status_code == 200


# ----- Invites & RBAC -----
class TestInvitesRBAC:
    def test_member_cannot_invite(self, member):
        r = requests.post(f"{API}/invites", json={"email": "x@y.com"}, headers=member["headers"])
        assert r.status_code == 403

    def test_member_cannot_manual_book(self, member, admin_headers):
        cals = requests.get(f"{API}/calendars", headers=admin_headers).json()
        r = requests.post(f"{API}/bookings/manual", json={
            "calendar_id": cals[0]["id"], "date": "2026-03-01", "start_time": "10:00", "end_time": "11:00"
        }, headers=member["headers"])
        assert r.status_code == 403

    def test_member_registered(self, member):
        assert member["user"]["role"] == "member"


# ----- Bookings flow -----
class TestBookings:
    def test_full_flow(self, admin_headers, member):
        cals = requests.get(f"{API}/calendars", headers=admin_headers).json()
        cal_id = cals[0]["id"]

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

        # Cleanup
        requests.delete(f"{API}/bookings/{bid}", headers=admin_headers)
        requests.delete(f"{API}/bookings/{mbid}", headers=admin_headers)
        requests.delete(f"{API}/bookings/{bid2}", headers=admin_headers)


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
