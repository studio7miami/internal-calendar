import {
  formatDeliverablesCount,
  isBlankProposal,
  normalizeProposal,
  normalizeProposalList,
  proposalActionPayload,
  proposalTotals,
  sectionIsComplete,
  serializeProposal,
} from "./proposals";

describe("proposal helpers", () => {
  test("normalizes wrapped API responses without dropping defaults", () => {
    const proposal = normalizeProposal({
      proposal: {
        id: "p1",
        client_name: "Alex",
        client_email: "client@example.com",
        client_phone: "555-0100",
        session_date: "2026-10-02",
        arrival_time: "09:00",
        setup_time: "10:00",
        shoot_time: "11:00",
        wrap_time: "14:00",
        calendar_id: "cal-1",
        creative_brief: {
          brand_description: "Editorial hospitality brand",
          content_goals: "Launch campaign",
          target_audience: "Travelers",
          desired_energy: "Warm and cinematic",
        },
        content_items: [{ type: "Reel", quantity: 2, energy: "Upbeat", visual_style: "Documentary" }],
        rate_cents: 125000,
        deposit_percent: 40,
        deliverables: "2 reels",
        turnaround: "7 days",
        pricing: { currency: "USD" },
        share_settings: { expires_days: 21 },
      },
      agreement: { proposal_id: "p1", immutable: true },
      payment_summary: { status: "pending" },
      signature_summary: { signer_name: "Alex" },
    });
    expect(proposal.id).toBe("p1");
    expect(proposal.client.contact_name).toBe("Alex");
    expect(proposal.client.email).toBe("client@example.com");
    expect(proposal.schedule.shoot_time).toBe("11:00");
    expect(proposal.vision.target_audience).toBe("Travelers");
    expect(proposal.content_items[0].visual_style).toBe("Documentary");
    expect(proposal.content_items).toHaveLength(3);
    expect(proposal.pricing.session_rate).toBe(1250);
    expect(proposal.pricing.deliverables).toBe("2");
    expect(formatDeliverablesCount("2")).toBe("2 files");
    expect(proposal.share.expires_days).toBe(21);
    expect(proposal.agreement).toEqual({ proposal_id: "p1", immutable: true });
    expect(proposal.signature_summary.signer_name).toBe("Alex");
    expect(proposal.pricing.currency).toBe("USD");
    expect(normalizeProposalList({ proposals: [{ id: "p1" }] })).toHaveLength(1);
  });

  test("serializes every canonical proposal field", () => {
    const proposal = normalizeProposal({
      id: "p1",
      version: 7,
      client_name: "Alex",
      client_email: "alex@example.com",
      client_phone: "555",
      calendar_id: "cal-1",
      session_date: "2026-10-02",
      arrival_time: "09:00",
      setup_time: "10:00",
      shoot_time: "11:00",
      wrap_time: "14:00",
      creative_brief: { brand_description: "Brand", content_goals: "Goals", target_audience: "Audience", desired_energy: "Energy" },
      content_items: [{ type: "Photo", quantity: 5, energy: "Calm", visual_style: "Clean" }],
      rate_cents: 125000,
      deposit_percent: 40,
      deliverables: "15",
      turnaround: "One week",
      assigned_to: "user-2",
    });
    const payload = serializeProposal(proposal);
    expect(payload).toMatchObject({
      version: 7,
      client_name: "Alex",
      client_email: "alex@example.com",
      calendar_id: "cal-1",
      session_date: "2026-10-02",
      rate_cents: 125000,
      deposit_percent: 40,
      deliverables: "15",
      turnaround: "One week",
      assigned_to: "user-2",
    });
    expect(payload.creative_brief.desired_energy).toBe("Energy");
    expect(payload.content_items[0].type).toBe("Photo");
  });

  test("normalizes clock values with seconds before save", () => {
    const payload = serializeProposal(normalizeProposal({
      arrival_time: "10:00:00",
      setup_time: "10:30:00",
      shoot_time: "11:00:00",
      wrap_time: "14:00:00",
    }));
    expect(payload.arrival_time).toBe("10:00");
    expect(payload.wrap_time).toBe("14:00");
  });

  test("calculates total and percentage deposit from session rate", () => {
    const result = proposalTotals({
      pricing: {
        session_rate: 200,
        deposit_percent: 50,
      },
    });
    expect(result).toEqual({ subtotal: 200, discount: 0, tax: 0, total: 200, deposit: 100 });
  });

  test("reports section completion from required content", () => {
    const proposal = normalizeProposal({
      client_name: "Alex",
      client_email: "alex@example.com",
      session_date: "2026-10-02",
      arrival_time: "09:00",
      content_items: [{ type: "Photography" }],
    });
    expect(sectionIsComplete("client", proposal)).toBe(true);
    expect(sectionIsComplete("content", proposal)).toBe(true);
    expect(sectionIsComplete("pricing", proposal)).toBe(false);
  });

  test("builds versioned action payloads", () => {
    const proposal = { version: 4, share: { expires_days: 45 } };
    expect(proposalActionPayload("approve", proposal)).toEqual({ version: 4 });
    expect(proposalActionPayload("archive", proposal)).toEqual({ version: 4 });
    expect(proposalActionPayload("send", proposal)).toEqual({ version: 4, expires_days: 45 });
    expect(proposalActionPayload("resend", proposal)).toEqual({ version: 4, expires_days: 45 });
    expect(proposalActionPayload("send", proposal, { channel: "text" })).toEqual({
      version: 4,
      expires_days: 45,
      channel: "text",
    });
  });

  test("treats untitled empty drafts as blank", () => {
    expect(isBlankProposal(normalizeProposal({ title: "", status: "draft" }))).toBe(true);
    expect(isBlankProposal(normalizeProposal({ title: "Untitled proposal", client_name: "Luis" }))).toBe(false);
  });
});
