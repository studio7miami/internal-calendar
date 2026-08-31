"""US Letter service-agreement PDF for Studio 7 Miami."""
from __future__ import annotations

import base64
import io
import re
import unicodedata
from datetime import datetime
from typing import Any, Optional

from fpdf import FPDF


GOLD = (201, 162, 39)
INK = (17, 17, 17)
MUTED = (111, 111, 107)
PAPER = (252, 252, 250)
MARGIN = 25.4  # 1 inch


def _text(value: Any, fallback: str = "") -> str:
    raw = str(value or "").strip() or fallback
    if not raw:
        return ""
    return unicodedata.normalize("NFKD", raw).encode("latin-1", "ignore").decode("latin-1")


def _money(cents: int, currency: str = "USD") -> str:
    amount = max(0, int(cents or 0)) / 100
    if str(currency or "USD").upper() == "USD":
        return f"${amount:,.2f}"
    return f"{currency} {amount:,.2f}"


def _pretty_day(stamp: datetime) -> str:
    return stamp.strftime("%B %d, %Y").replace(" 0", " ")


def _date_long(value: Any) -> str:
    raw = _text(value)
    if not raw:
        return "Date to be confirmed"
    try:
        return _pretty_day(datetime.fromisoformat(raw[:10]))
    except ValueError:
        return raw


def _datetime_long(value: Any) -> str:
    raw = _text(value)
    if not raw:
        return ""
    try:
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        clock = stamp.strftime("%I:%M %p").lstrip("0")
        return f"{_pretty_day(stamp)} · {clock}"
    except ValueError:
        return raw


def _time_12h(value: Any) -> str:
    raw = _text(value)
    if not raw:
        return ""
    parts = raw.split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1][:2]) if len(parts) > 1 else 0
    except (TypeError, ValueError):
        return raw
    suffix = "PM" if hour >= 12 else "AM"
    twelve = hour % 12 or 12
    return f"{twelve}:{minute:02d} {suffix}"


def _totals(proposal: dict, agreement: dict) -> tuple[int, int, int]:
    pricing = agreement.get("pricing") if isinstance(agreement.get("pricing"), dict) else {}
    if not pricing:
        pricing = proposal.get("pricing") if isinstance(proposal.get("pricing"), dict) else {}
    rate = proposal.get("rate_cents")
    if rate in (None, ""):
        try:
            rate = round(float(pricing.get("session_rate") or 0) * 100)
        except (TypeError, ValueError):
            rate = 0
    try:
        percent = float(
            agreement.get("deposit_percent")
            if agreement.get("deposit_percent") not in (None, "")
            else pricing.get("deposit_percent")
            if pricing.get("deposit_percent") not in (None, "")
            else proposal.get("deposit_percent")
            or 50
        )
    except (TypeError, ValueError):
        percent = 50
    total = max(0, int(rate or 0))
    deposit = min(total, max(0, round(total * percent / 100)))
    return total, deposit, int(percent)


class AgreementPDF(FPDF):
    def header(self) -> None:
        self.set_fill_color(*PAPER)
        self.rect(0, 0, self.w, self.h, "F")
        self.set_y(self.t_margin)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*INK)
        self.cell(0, 5, "STUDIO 7 MIAMI", align="L")
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*GOLD)
        self.set_xy(self.l_margin, self.t_margin)
        self.cell(0, 5, "SERVICE AGREEMENT", align="R")
        self.ln(8)
        self.set_draw_color(17, 17, 17)
        self.set_line_width(0.2)
        y = self.get_y()
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.ln(10)

    def footer(self) -> None:
        self.set_y(-16)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 4, "Studio 7 Miami  ·  638 NW 62nd St, Miami, FL 33150", align="L")
        self.set_xy(self.l_margin, -16)
        self.cell(0, 4, "studio7.miami", align="R")


def _heading(pdf: AgreementPDF, label: str) -> None:
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(*GOLD)
    pdf.cell(0, 6, label.upper())
    pdf.ln(7)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(58, 58, 56)


def _body(pdf: AgreementPDF, text: str) -> None:
    pdf.multi_cell(0, 5.6, text)
    pdf.ln(2)


def _meta_cell(pdf: AgreementPDF, x: float, width: float, y: float, label: str, value: str) -> None:
    pdf.set_xy(x, y)
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(*GOLD)
    pdf.cell(width, 5, label.upper())
    pdf.set_xy(x, y + 5)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*INK)
    pdf.multi_cell(width, 6, value)


def render_agreement_pdf(
    *,
    proposal: dict,
    agreement: Optional[dict] = None,
    signature: Optional[dict] = None,
) -> bytes:
    agreement = agreement if isinstance(agreement, dict) else {}
    signature = signature if isinstance(signature, dict) else {}
    client = _text(
        (agreement.get("client") or {}).get("name") if isinstance(agreement.get("client"), dict) else "",
        _text(proposal.get("client_name"), "the Client"),
    )
    title = _text(agreement.get("title") or proposal.get("title"), "Content proposal")
    schedule = agreement.get("schedule") if isinstance(agreement.get("schedule"), dict) else {}
    if not schedule:
        schedule = {
            "session_date": proposal.get("session_date"),
            "arrival_time": proposal.get("arrival_time"),
            "shoot_time": proposal.get("shoot_time"),
            "wrap_time": proposal.get("wrap_time"),
        }
    pricing = agreement.get("pricing") if isinstance(agreement.get("pricing"), dict) else {}
    if not pricing:
        pricing = proposal.get("pricing") if isinstance(proposal.get("pricing"), dict) else {}
    currency = _text(pricing.get("currency"), "USD")
    total_cents, deposit_cents, percent = _totals(proposal, agreement)
    session_date = _date_long(schedule.get("session_date") or proposal.get("session_date"))
    arrival = _time_12h(schedule.get("arrival_time") or proposal.get("arrival_time"))
    shoot = _time_12h(schedule.get("shoot_time") or proposal.get("shoot_time"))
    wrap = _time_12h(schedule.get("wrap_time") or proposal.get("wrap_time"))
    deliverables = _text(
        agreement.get("deliverables") or pricing.get("deliverables") or proposal.get("deliverables"),
        "As outlined in the proposal",
    )
    turnaround = _text(
        agreement.get("turnaround") or pricing.get("turnaround") or proposal.get("turnaround"),
        "As outlined in the proposal",
    )
    payment_terms = _text(
        pricing.get("payment_terms"),
        f"A {percent}% deposit confirms the booking. The remaining balance is due before final delivery.",
    )
    terms = _text(
        agreement.get("terms"),
        "By signing, you confirm this proposal, the session schedule, and the deposit terms. A deposit locks your date; the balance is due under the payment terms.",
    )
    session_bits = [f"on {session_date}"]
    if arrival:
        session_bits.append(f"with arrival at {arrival}")
    if shoot:
        session_bits.append(f"shoot beginning at {shoot}")
    if wrap:
        session_bits.append(f"wrapping by {wrap}")

    pdf = AgreementPDF(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=True, margin=MARGIN)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*INK)
    pdf.multi_cell(0, 8, title)
    pdf.ln(4)

    top = pdf.get_y()
    col = (pdf.w - pdf.l_margin - pdf.r_margin) / 3
    _meta_cell(pdf, pdf.l_margin, col - 3, top, "Client", client)
    _meta_cell(pdf, pdf.l_margin + col, col - 3, top, "Session", session_date)
    _meta_cell(pdf, pdf.l_margin + col * 2, col, top, "Studio", "Studio 7 Miami")
    pdf.set_y(top + 16)

    _heading(pdf, "Parties")
    _body(
        pdf,
        f'This Service Agreement is entered into between Studio 7 Miami ("Studio 7") and {client} ("Client") '
        f'for the creative services described in the proposal titled "{title}."',
    )
    _heading(pdf, "Session")
    _body(pdf, f"Studio 7 will provide production services for {client} {', '.join(session_bits)}.")
    _heading(pdf, "Investment")
    _body(
        pdf,
        f"The total investment for this engagement is {_money(total_cents, currency)}. "
        f"A deposit of {percent}% ({_money(deposit_cents, currency)}) is due to confirm the booking. "
        "The remaining balance is due under the payment terms below.",
    )
    _heading(pdf, "Deliverables & turnaround")
    _body(pdf, f"Deliverables: {deliverables}. Estimated turnaround: {turnaround}.")
    _heading(pdf, "Payment terms")
    _body(pdf, payment_terms)
    _heading(pdf, "Acceptance")
    _body(
        pdf,
        f"{terms} By signing below, {client} acknowledges they have reviewed the proposal and agree to these terms as presented.",
    )

    pdf.ln(4)
    pdf.set_draw_color(17, 17, 17)
    y = pdf.get_y()
    pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
    pdf.ln(6)

    signer = _text(signature.get("signer_name"), "To be signed")
    signed_at = _datetime_long(signature.get("signed_at")) or "Pending"
    signer_email = _text(signature.get("signer_email"))
    image = _text(signature.get("signature_data"))
    sign_w = 80
    if image.startswith("data:image"):
        try:
            header, b64 = image.split(",", 1)
            raw = base64.b64decode(b64)
            kind = "PNG" if "png" in header.lower() else "JPEG"
            pdf.image(io.BytesIO(raw), x=pdf.l_margin, y=pdf.get_y(), w=sign_w, h=22, type=kind)
            pdf.ln(24)
        except Exception:
            pdf.ln(22)
    else:
        pdf.ln(16)
        pdf.set_draw_color(17, 17, 17)
        line_y = pdf.get_y()
        pdf.line(pdf.l_margin, line_y, pdf.l_margin + sign_w, line_y)
        pdf.ln(3)

    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(*GOLD)
    pdf.cell(sign_w + 8, 5, "SIGNATURE")
    pdf.cell(0, 5, "SIGNED")
    pdf.ln(6)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*INK)
    pdf.cell(sign_w + 8, 6, signer)
    pdf.cell(0, 6, signed_at)
    if signer_email:
        pdf.ln(6)
        pdf.set_x(pdf.l_margin + sign_w + 8)
        pdf.cell(0, 6, signer_email)

    out = pdf.output()
    return bytes(out) if not isinstance(out, (bytes, bytearray)) else bytes(out)


def agreement_filename(proposal: dict) -> str:
    slug = re.sub(
        r"[^a-z0-9]+",
        "-",
        _text(proposal.get("client_name") or proposal.get("title"), "studio-7").lower(),
    ).strip("-")
    return f"{slug or 'studio-7'}-agreement.pdf"
