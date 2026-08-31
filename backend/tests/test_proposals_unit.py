"""Proposal tests that do not require a live Supabase project."""
import hashlib
import hmac

import pytest
from pydantic import ValidationError

import permissions
import proposals


def test_proposal_permissions_are_configurable_and_admin_is_always_full():
    manager = permissions.resolve_effective("manager", {"manager": {"send_proposals": False}})
    member = permissions.resolve_effective("member", {})
    admin = permissions.resolve_effective("admin", {"admin": {"manage_proposals": False}})

    assert manager["view_proposals"] is False
    assert manager["send_proposals"] is False
    assert member["view_proposals"] is False
    assert admin["manage_proposals"] is True


def test_share_tokens_are_only_stored_as_sha256():
    token = "client-secret-token"
    digest = proposals.hash_share_token(token)

    assert digest == hashlib.sha256(token.encode()).hexdigest()
    assert token not in digest
    assert len(digest) == 64


def test_named_client_links_are_accepted_as_public_tokens():
    assert proposals.client_share_slug("Luis Corrales") == "luis-corrales"
    assert proposals._normalize_public_token("luis-corrales") == "luis-corrales"
    with pytest.raises(proposals.HTTPException) as error:
        proposals._normalize_public_token("ab")
    assert error.value.status_code == 404


def test_stripe_signature_uses_raw_body_and_rejects_stale_or_modified_payload():
    payload = b'{"id":"evt_123","type":"checkout.session.completed"}'
    secret = "whsec_test"
    timestamp = 1_700_000_000
    digest = hmac.new(
        secret.encode(),
        str(timestamp).encode() + b"." + payload,
        hashlib.sha256,
    ).hexdigest()
    header = f"t={timestamp},v1=bad,v1={digest}"

    assert proposals.verify_stripe_signature(payload, header, secret, now=timestamp)
    assert not proposals.verify_stripe_signature(payload + b" ", header, secret, now=timestamp)
    assert not proposals.verify_stripe_signature(payload, header, secret, now=timestamp + 301)


def test_proposal_model_validates_schedule_and_money():
    valid = proposals.ProposalCreate(
        client_name="A Client",
        client_email="client@example.com",
        session_date="2026-10-10",
        arrival_time="09:00",
        setup_time="10:00",
        shoot_time="11:00",
        wrap_time="12:00",
        rate_cents=100_00,
        deposit_percent=50,
    )
    assert valid.wrap_time == "12:00"
    seconds = proposals.ProposalCreate(
        client_name="A Client",
        client_email="client@example.com",
        arrival_time="09:00:00",
        setup_time="10:00:00",
        shoot_time="11:00:00",
        wrap_time="12:00:00",
    )
    assert seconds.arrival_time == "09:00"
    assert seconds.wrap_time == "12:00"

    with pytest.raises(ValidationError):
        proposals.ProposalCreate(
            client_name="A Client",
            client_email="client@example.com",
            arrival_time="12:00",
            wrap_time="11:00",
        )

    with pytest.raises(ValidationError):
        proposals.ProposalCreate(
            client_name="A Client",
            client_email="client@example.com",
            deposit_percent=101,
        )


def test_blank_draft_allowed_but_submit_boundary_requires_complete_fields():
    draft = proposals.ProposalCreate(
        client_name="",
        client_email="",
        calendar_id="",
        session_date="",
        arrival_time="",
        wrap_time="",
    )
    assert draft.client_name == ""
    assert draft.client_email == ""
    assert draft.title == "Untitled proposal"
    assert draft.calendar_id is None
    assert draft.session_date is None

    with pytest.raises(proposals.HTTPException) as error:
        proposals._validate_sendable(draft.model_dump(mode="json"))

    assert error.value.status_code == 400
    assert "client_name" in error.value.detail
    assert "client_email" in error.value.detail
    assert "calendar_id" in error.value.detail
    assert "rate" not in error.value.detail

    with pytest.raises(proposals.HTTPException) as rate_error:
        proposals._validate_sendable({
            **draft.model_dump(mode="json"),
            "client_name": "Alex",
            "client_email": "alex@example.com",
            "calendar_id": "calendar-1",
            "session_date": "2026-10-10",
            "arrival_time": "09:00",
            "wrap_time": "10:00",
            "rate_cents": 0,
        })
    assert rate_error.value.status_code == 400
    assert "rate" in rate_error.value.detail.lower()


def test_payment_type_amount_and_status_mapping():
    proposal = {
        "rate_cents": 20_000,
        "deposit_percent": 50,
        "pricing": {"deposit_type": "percent", "deposit_value": 25},
    }
    assert proposals.payment_amount_cents(proposal, "deposit") == 5_000
    assert proposals.payment_amount_cents(proposal, "full") == 20_000
    assert proposals.proposal_status_for_payment("deposit") == "deposit_paid"
    assert proposals.proposal_status_for_payment("full") == "paid"

    fixed = {**proposal, "pricing": {"deposit_type": "fixed", "deposit_value": 75}}
    assert proposals.payment_amount_cents(fixed, "deposit") == 7_500


def test_client_share_step_resumes_where_they_stopped():
    assert proposals._client_share_step("client_approved") == "agreement"
    assert proposals._client_share_step("signed") == "payment"
    assert proposals._client_share_step("changes_requested") == "proposal"
    assert proposals._client_share_step("sent") is None
    assert proposals._client_share_step("viewed") is None


def test_share_url_appends_resume_step(monkeypatch):
    monkeypatch.delenv("PROPOSAL_PUBLIC_URL", raising=False)
    monkeypatch.setenv("FRONTEND_URL", "https://studio.example/")
    assert proposals._share_url("tai", step="payment") == "https://studio.example/p/tai?step=payment"
    assert proposals._share_url("tai", step="proposal") == "https://studio.example/p/tai?step=proposal"


def test_changes_requested_email_is_branded_staff_notice(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://team.studio7.miami")
    subject, html_body, text = proposals._changes_requested_email(
        {"id": "p1", "title": "Launch", "client_name": "Tai", "session_date": "2026-09-12"},
        "Can we shift to afternoon?",
        "Tai",
    )
    assert subject.startswith("Changes requested")
    assert "Tai" in subject
    assert "Can we shift to afternoon?" in html_body
    assert "Open proposal" in html_body
    assert "framerusercontent.com" in html_body
    assert "/proposals/p1/edit" in html_body
    assert "Can we shift to afternoon?" in text


def test_named_share_tokens_follow_the_client_slug():
    assert proposals._named_share_tokens("Tai")[0] == "tai"
    assert "tai-2" in proposals._named_share_tokens("Tai")
    assert proposals._named_share_tokens("  ") == []


def test_public_url_defaults_to_short_p_route(monkeypatch):
    monkeypatch.delenv("PROPOSAL_PUBLIC_URL", raising=False)
    monkeypatch.setenv("FRONTEND_URL", "https://studio.example/")
    assert proposals._share_url("token123") == "https://studio.example/p/token123"


def test_client_share_token_uses_the_client_name():
    assert proposals.client_share_slug("Luis Corrales") == "luis-corrales"
    assert proposals.mint_share_token("Luis Corrales") == "luis-corrales"
    assert proposals.mint_share_token("  ") != ""
    assert " " not in proposals.mint_share_token("Ava Reynolds")


def test_named_share_reuses_this_proposal_even_when_revoked_row_exists():
    proposal_id = "proposal-tai"
    other = "proposal-other"
    occupancy = {
        proposals.hash_share_token("tai"): proposal_id,
        proposals.hash_share_token("tai-2"): proposal_id,
        proposals.hash_share_token("tai-3"): proposal_id,
    }
    assert proposals.choose_named_share_token("Tai", proposal_id, occupancy) == "tai"
    assert proposals.choose_named_share_token("Tai", other, occupancy) == "tai-4"


def test_sent_proposals_can_rename_title_only():
    sent = {"status": "sent", "title": "Untitled proposal"}
    assert proposals._editable_updates(sent, {"title": "Test session", "client_name": "Tai"}) == {
        "title": "Test session"
    }
    assert proposals._editable_updates(sent, {"title": "Untitled proposal", "client_name": "Tai"}) == {}
    with pytest.raises(proposals.HTTPException) as error:
        proposals._editable_updates({"status": "paid", "title": "Done"}, {"title": "Nope"})
    assert error.value.status_code == 409


def test_stripe_checkout_name_uses_payment_kind_and_proposal_title():
    assert proposals.checkout_product_name("deposit", "") == "Deposit – Content Proposal"
    assert proposals.checkout_product_name("deposit", "Untitled proposal") == "Deposit – Content Proposal"
    assert proposals.checkout_product_name("full", "Corrales & Co.") == "Full Payment – Corrales & Co."
    assert proposals.checkout_product_name("remaining", "Test") == "Balance – Test"


def test_blank_drafts_are_the_empty_untitled_ones():
    blank = {"status": "draft", "title": "Untitled proposal", "client_name": "", "rate_cents": 0, "creative_brief": {}}
    named = {**blank, "client_name": "Luis Corrales"}
    assert proposals._is_blank_draft(blank) is True
    assert proposals._is_blank_draft(named) is False
    assert proposals._is_blank_draft({**blank, "status": "sent"}) is False


def test_serialization_includes_resume_step_for_signed(monkeypatch):
    monkeypatch.setenv("PROPOSAL_PUBLIC_URL", "https://studio.example/p")
    result = proposals._serialize({"id": "p1", "status": "signed"}, "tai")
    assert result["share_url"] == "https://studio.example/p/tai?step=payment"
    result = proposals._serialize({"id": "p1", "status": "client_approved"}, "tai")
    assert result["share_url"] == "https://studio.example/p/tai?step=agreement"
    result = proposals._serialize({"id": "p1", "status": "changes_requested"}, "tai")
    assert result["share_url"] == "https://studio.example/p/tai?step=proposal"
    result = proposals._serialize({"id": "p1", "status": "sent"}, "tai")
    assert result["share_url"] == "https://studio.example/p/tai"


class _ShareQuery:
    def __init__(self, rows, counter):
        self.rows = rows
        self.counter = counter
        self.filters = []

    def select(self, *_args):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def execute(self):
        self.counter["n"] += 1
        matches = [
            row for row in self.rows
            if all(row.get(key) == value for key, value in self.filters)
        ]
        return _Result([dict(row) for row in matches])


class _ShareDB:
    def __init__(self, rows):
        self.rows = rows
        self.executes = {"n": 0}

    def table(self, name):
        assert name == "proposal_shares"
        return _ShareQuery(self.rows, self.executes)


def test_active_share_token_uses_one_query_and_prefers_live_named_slug(monkeypatch):
    live = proposals.hash_share_token("luis-corrales")
    other = proposals.hash_share_token("someone-else")
    db = _ShareDB([
        {"proposal_id": "p1", "token_hash": live, "revoked": False},
        {"proposal_id": "p2", "token_hash": other, "revoked": False},
    ])
    monkeypatch.setattr(proposals, "_db", db)

    assert proposals._active_share_token({"id": "p1", "client_name": "Luis Corrales"}) == "luis-corrales"
    assert db.executes["n"] == 1

    db.rows[0]["revoked"] = True
    assert proposals._active_share_token({"id": "p1", "client_name": "Luis Corrales"}) == "luis-corrales"
    assert db.executes["n"] == 2


def test_serialization_keeps_new_flat_fields(monkeypatch):
    monkeypatch.setenv("PROPOSAL_PUBLIC_URL", "https://studio.example/p")
    row = {
        "id": "p1",
        "title": "Campaign launch",
        "pricing": {"currency": "USD", "line_items": []},
        "share_settings": {"subject": "Your launch proposal"},
        "version": 4,
    }
    result = proposals._serialize(row, "share-token")
    assert result["title"] == "Campaign launch"
    assert result["pricing"]["currency"] == "USD"
    assert result["share_settings"]["subject"] == "Your launch proposal"
    assert result["version"] == 4
    assert result["share_url"] == "https://studio.example/p/share-token"
    for field in ("title", "pricing", "share_settings"):
        assert field in proposals.PROPOSAL_FIELDS.split(",")
        assert field in proposals.SNAPSHOT_FIELDS
        assert field in proposals.EDITABLE_FIELDS


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows, operation=None, payload=None):
        self.rows = rows
        self.operation = operation
        self.payload = payload
        self.filters = []

    def select(self, *_args):
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def limit(self, _value):
        return self

    def execute(self):
        matches = [
            row for row in self.rows
            if all(row.get(key) == value for key, value in self.filters)
        ]
        if self.operation == "update":
            for row in matches:
                row.update(self.payload)
        return _Result([dict(row) for row in matches])


class _FakeDB:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        assert name == "proposals"
        return _Query(self.rows)


def test_optimistic_update_rejects_stale_version(monkeypatch):
    monkeypatch.setattr(proposals, "_db", _FakeDB([{"id": "p1", "version": 3}]))

    with pytest.raises(proposals.HTTPException) as error:
        proposals._optimistic_update("p1", 2, {"status": "approved"})

    assert error.value.status_code == 409
    assert error.value.detail["current_version"] == 3
