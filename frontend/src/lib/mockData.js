import { clientResumeStep, withResumeStep } from "./proposals";

const STORAGE_KEY = "s7_local_mock_proposals_v10";
const MOCK_PREFIX = "mock-proposal-";

function isLocalMockHost() {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

const isoDate = (daysFromNow) => {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + daysFromNow);
  return value.toISOString().slice(0, 10);
};

const nowIso = () => new Date().toISOString();

const baseProposal = ({
  id,
  title,
  status,
  client,
  day,
  rate,
}) => ({
  id,
  title,
  status,
  client_name: client,
  client_email: `${id}@example.com`,
  client_phone: "+1 305 555 0100",
  calendar_id: "",
  session_date: isoDate(day),
  arrival_time: "09:30",
  setup_time: "10:00",
  shoot_time: "10:30",
  wrap_time: "13:30",
  creative_brief: {
    brand_description:
      "A refined visual story built around confident, editorial imagery and Studio 7’s clean production style.",
    content_goals:
      "Create a versatile campaign library for web, social, launch announcements, and press.",
    target_audience:
      "Design-conscious clients and creative teams seeking premium visual direction.",
    desired_energy: "Warm, polished, modern, and assured.",
  },
  content_items: [
    {
      id: `${id}-content-1`,
      type: "Hero campaign images",
      quantity: 6,
      energy: "Editorial",
      visual_style: "Clean light and sculptural composition",
      description: "Primary imagery for the campaign launch and website.",
      deliverables: "6 retouched high-resolution images\nWeb-ready exports",
      image_url: "",
    },
    {
      id: `${id}-content-2`,
      type: "Lifestyle reels",
      quantity: 4,
      energy: "Natural motion",
      visual_style: "Vertical, intimate, behind-the-scenes",
      description: "Short-form moments designed for the social rollout.",
      deliverables: "4 edited vertical clips\n15–30 seconds each",
      image_url: "",
    },
  ],
  pricing: {
    currency: "USD",
    session_rate: rate,
    deposit_percent: 50,
    line_items: [
      {
        id: `${id}-line-1`,
        description: "Creative direction and studio production",
        quantity: 1,
        unit_price: rate,
      },
    ],
    deliverables: "15",
    turnaround: "7–10 business days",
    payment_terms:
      "A 50% payment confirms the booking. The remaining balance is due before final delivery.",
  },
  share_settings: {
    subject: `Your Studio 7 proposal — ${title}`,
    message: `Hi ${client.split(" ")[0]} — here is the creative plan we prepared for you.`,
    expires_days: 30,
  },
  rate_cents: Math.round(rate * 100),
  deposit_percent: 50,
  deliverables:
    "Retouched campaign imagery, social-ready exports, and edited vertical clips.",
  turnaround: "7–10 business days",
  version: 1,
  created_by: "Local demo",
  assigned_to: "Local demo",
  created_at: nowIso(),
  updated_at: nowIso(),
});

const luisCorralesProposal = () => {
  const id = `${MOCK_PREFIX}luis-corrales`;
  const base = baseProposal({
    id,
    title: "Corrales & Co.",
    status: "sent",
    client: "Luis Corrales",
    day: 0,
    rate: 3850,
  });
  return {
    ...base,
    client_email: "luis@corrales.co",
    client_phone: "+1 305 555 2424",
    session_date: "2026-08-24",
    arrival_time: "10:00",
    setup_time: "10:30",
    shoot_time: "11:00",
    wrap_time: "14:00",
    creative_brief: {
      brand_description:
        "Corrales & Co. is a wealth management and tax advisory firm providing strategic financial guidance to founders, entrepreneurs, business owners, and individuals focused on building, protecting, and growing long-term wealth.\n\nThe content strategy will position Luis Corrales as the trusted face behind the company — combining financial expertise, entrepreneurship, leadership, lifestyle, and real-world business insight.",
      content_goals:
        "Build a recognizable and trusted personal brand around Luis Corrales that consistently generates attention for Corrales & Co. Establish Luis as an authority in wealth management, tax strategy, entrepreneurship, and financial decision-making, and humanize the founder behind the company.\n\nEducate business owners through simple, valuable financial content, increase brand awareness and credibility, and create consistent content for Instagram, LinkedIn, TikTok, and other short-form platforms.\n\nTurn social attention into consultation and client opportunities. Maintain a minimum of 4 strong posts per week. Include 1 monthly strategy + performance call.",
      target_audience:
        "Entrepreneurs, founders, executives, professionals, real estate investors, high-income earners, and growing business owners.\n\nThey want smarter strategies for managing taxes, building wealth, protecting assets, and making long-term financial decisions.",
      desired_energy:
        "Confident, intelligent, aspirational, and trustworthy — modern financial authority without feeling overly corporate.\n\nPolished enough for wealth management.\nPersonal enough for social media.",
    },
    content_items: [
      {
        id: `${id}-content-1`,
        type: "Authority Reels",
        quantity: "10 videos",
        energy: "Confident, insightful and direct — Luis speaking as the expert in the room.",
        visual_style:
          "Clean cinematic lighting, professional environments, multiple compositions, subtitles, branded graphics and strategic B-roll. Topics include wealth-building strategies, tax mistakes entrepreneurs make, business-owner financial planning, investing principles, cash-flow management, founder finances, asset protection, financial myths, common client questions, and high-income financial decisions.",
        description: "Expert-facing reels that establish Luis as the authority in the room.",
        deliverables: "10 edited vertical reels with subtitles and branded graphics",
        image_url: "",
      },
      {
        id: `${id}-content-2`,
        type: "Founder / Lifestyle Reels",
        quantity: "5 videos",
        energy: "Aspirational, authentic and personal — showing the person behind the expertise.",
        visual_style:
          "Cinematic handheld and stabilized footage in motion: office, meetings, properties, walking shots, phone calls, business interactions and lifestyle environments.",
        description: "Personal founder footage that humanizes Luis behind Corrales & Co.",
        deliverables: "5 edited founder and lifestyle reels",
        image_url: "",
      },
      {
        id: `${id}-content-3`,
        type: "Brand Photography",
        quantity: "40+ edited photos",
        energy: "Premium, credible and timeless",
        visual_style:
          "Executive portraits, environmental portraits, office lifestyle, meetings, candid business moments, detail shots and social-media ready imagery for social, website, LinkedIn, press, marketing, and company materials.",
        description: "An ongoing visual library for social, web, and company materials.",
        deliverables: "40+ edited photos per month",
        image_url: "",
      },
    ],
    pricing: {
      ...base.pricing,
      session_rate: 3850,
      deliverables: "15",
      turnaround: "10–15 business days",
      line_items: [
        {
          id: `${id}-line-1`,
          description: "Creative direction and studio production",
          quantity: 1,
          unit_price: 3850,
        },
      ],
    },
    rate_cents: 385000,
    deliverables: "15 high quality edited videos, 40+ edited photos",
    turnaround: "10–15 business days",
    share_settings: {
      subject: "Your Studio 7 proposal — Corrales & Co.",
      message: "Hi Luis — here is the creative plan we prepared for you.",
      expires_days: 30,
    },
    current_revision_id: `${id}-revision-1`,
    share_url: typeof window !== "undefined" ? `${window.location.origin}/p/${id}` : `/p/${id}`,
    sent_at: nowIso(),
  };
};

const initialProposals = () => {
  // Luis is the live client record. The rest of this catalog stays local-only.
  const luis = luisCorralesProposal();
  const portrait = baseProposal({
    id: `${MOCK_PREFIX}portrait-session`,
    title: "Founder Portrait Session",
    status: "sent",
    client: "Noah Williams",
    day: 18,
    rate: 1900,
  });
  const viewed = baseProposal({
    id: `${MOCK_PREFIX}brand-story`,
    title: "Brand Story Session",
    status: "viewed",
    client: "Elena Brooks",
    day: 21,
    rate: 3400,
  });
  const trial = baseProposal({
    id: `${MOCK_PREFIX}client-trial`,
    title: "Portrait Session",
    status: "sent",
    client: "Alex Rivera",
    day: 12,
    rate: 2200,
  });

  return [
    luis,
    baseProposal({
      id: `${MOCK_PREFIX}summer-campaign`,
      title: "Summer Campaign Content",
      status: "draft",
      client: "Ava Reynolds",
      day: 7,
      rate: 3200,
    }),
    baseProposal({
      id: `${MOCK_PREFIX}product-launch`,
      title: "Product Launch Story",
      status: "draft",
      client: "Jordan Lee",
      day: 10,
      rate: 4800,
    }),
    {
      ...baseProposal({
        id: `${MOCK_PREFIX}editorial-refresh`,
        title: "Editorial Refresh",
        status: "changes_requested",
        client: "Maya Chen",
        day: 14,
        rate: 2750,
      }),
      change_request: {
        id: `${MOCK_PREFIX}editorial-refresh-change`,
        client_name: "Maya Chen",
        message: "Could we shift the session later in the afternoon?",
        status: "open",
        created_at: nowIso(),
      },
    },
    {
      ...portrait,
      current_revision_id: `${portrait.id}-revision-1`,
      share_url: typeof window !== "undefined" ? `${window.location.origin}/p/${portrait.id}` : `/p/${portrait.id}`,
      sent_at: nowIso(),
    },
    {
      ...viewed,
      current_revision_id: `${viewed.id}-revision-1`,
      share_url: typeof window !== "undefined" ? `${window.location.origin}/p/${viewed.id}` : `/p/${viewed.id}`,
      sent_at: nowIso(),
    },
    {
      ...trial,
      current_revision_id: `${trial.id}-revision-1`,
      share_url: typeof window !== "undefined"
        ? `${window.location.origin}/p/${trial.id}`
        : `/p/${trial.id}`,
      sent_at: nowIso(),
    },
    baseProposal({
      id: `${MOCK_PREFIX}wellness-library`,
      title: "Wellness Brand Library",
      status: "deposit_paid",
      client: "Sofia Martinez",
      day: 23,
      rate: 5600,
    }),
  ];
};

const isRemovableUntitledMockDraft = (proposal) => {
  if (!proposal?.id?.startsWith(MOCK_PREFIX) || proposal.status !== "draft") return false;
  const title = String(proposal.title || "").trim().toLowerCase();
  return !title || title === "untitled proposal";
};

const loadProposals = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!Array.isArray(saved) || !saved.length) return initialProposals();
    const cleaned = saved.filter((proposal) => !isRemovableUntitledMockDraft(proposal));
    if (cleaned.length !== saved.length) saveProposals(cleaned);
    return cleaned.length ? cleaned : initialProposals();
  } catch {
    return initialProposals();
  }
};

const saveProposals = (proposals) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(proposals));
  return proposals;
};

const resetPublicProposal = (proposal) => {
  const next = { ...proposal, status: "sent", updated_at: nowIso() };
  delete next.client_approved_at;
  delete next.signed_at;
  delete next.signature_summary;
  delete next.payment_summary;
  return next;
};

const rewindPublicProposal = (proposal, to) => {
  const target = to || (
    ["paid", "deposit_paid"].includes(proposal.status) ? "payment"
      : proposal.status === "signed" ? "agreement"
        : "proposal"
  );
  if (target === "proposal") {
    const next = { ...proposal, status: "viewed", updated_at: nowIso() };
    delete next.client_approved_at;
    delete next.signed_at;
    delete next.signature_summary;
    delete next.payment_summary;
    return next;
  }
  if (target === "agreement") {
    const next = {
      ...proposal,
      status: "client_approved",
      client_approved_at: proposal.client_approved_at || nowIso(),
      updated_at: nowIso(),
    };
    delete next.signed_at;
    delete next.signature_summary;
    delete next.payment_summary;
    return next;
  }
  if (target === "payment") {
    const next = { ...proposal, status: "signed", updated_at: nowIso() };
    delete next.payment_summary;
    return next;
  }
  return proposal;
};

const requestData = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
};

const response = (config, data, status = 200) => ({
  data,
  status,
  statusText: status === 201 ? "Created" : "OK",
  headers: {},
  config,
  request: { localMock: true },
});

const bookingRows = (calendars) => {
  const ids = calendars.map((calendar) => calendar.id).filter(Boolean);
  if (!ids.length) return [];
  const calendarId = (index) => ids[index % ids.length];
  return [
    {
      id: "mock-booking-campaign",
      calendar_id: calendarId(0),
      date: isoDate(2),
      start_time: "10:00",
      end_time: "13:00",
      status: "approved",
      source: "manual",
      is_own: false,
      member_name: "Ava",
      notes: "Campaign production",
    },
    {
      id: "mock-booking-proposal-hold",
      calendar_id: calendarId(0),
      date: isoDate(7),
      start_time: "09:30",
      end_time: "13:30",
      status: "pending",
      source: "proposal",
      is_own: false,
      member_name: "Noah",
      notes: "Proposal hold — Founder Portrait Session",
      proposal_id: `${MOCK_PREFIX}portrait-session`,
    },
    {
      id: "mock-booking-photo-booth",
      calendar_id: calendarId(1),
      date: isoDate(4),
      start_time: "15:00",
      end_time: "18:00",
      status: "approved",
      source: "manual",
      is_own: false,
      member_name: "Jordan",
      notes: "Launch event",
    },
    {
      id: "mock-booking-brand-library",
      calendar_id: calendarId(0),
      date: isoDate(12),
      start_time: "11:00",
      end_time: "16:00",
      status: "approved",
      source: "proposal",
      is_own: false,
      member_name: "Sofia",
      notes: "Confirmed from proposal — Wellness Brand Library",
      proposal_id: `${MOCK_PREFIX}wellness-library`,
    },
  ];
};

const statusForAction = {
  "submit-approval": "pending_approval",
  approve: "approved",
  send: "sent",
  resend: "sent",
  "mark-accepted": "client_approved",
  archive: "archived",
};

const MOCK_LOCAL_TOKEN = "local-mock-token";

const MOCK_LOCAL_USER = {
  id: "local-mock-admin",
  email: "info@studio7.miami",
  name: "Seven",
  role: "admin",
  permissions: {
    view_proposals: true,
    edit_proposals: true,
    approve_proposals: true,
    send_proposals: true,
    view_calendars: true,
    manage_calendars: true,
    assign_member_calendars: true,
    view_members_directory: true,
  },
};

const MOCK_CALENDARS = [
  { id: "calendar-studio-7", name: "Studio 7 Miami", is_active: true },
];

function mockAgreement(proposal) {
  return {
    proposal_id: proposal.id,
    title: proposal.title || "Untitled proposal",
    client: {
      name: proposal.client_name,
      email: proposal.client_email,
      phone: proposal.client_phone,
    },
    schedule: {
      session_date: proposal.session_date,
      arrival_time: proposal.arrival_time,
      setup_time: proposal.setup_time,
      shoot_time: proposal.shoot_time,
      wrap_time: proposal.wrap_time,
    },
    creative_brief: proposal.creative_brief || {},
    content_items: proposal.content_items || [],
    pricing: proposal.pricing || {},
    rate_cents: proposal.rate_cents,
    deposit_percent: proposal.deposit_percent,
    deliverables: proposal.deliverables || "",
    turnaround: proposal.turnaround || "",
    terms:
      "By signing, you confirm this proposal, the session schedule, and the deposit terms. A deposit locks your date; the balance is due under the payment terms.",
  };
}

function mockPublicPayload(proposal) {
  return {
    proposal: {
      ...proposal,
      status: proposal.status,
      change_request: proposal.change_request || null,
    },
    revision: {
      id: proposal.current_revision_id || `${proposal.id}-revision-1`,
      revision_number: 1,
      created_at: proposal.created_at || nowIso(),
    },
    agreement: mockAgreement(proposal),
    payment_summary: proposal.payment_summary || null,
    signature_summary: proposal.signature_summary || null,
    change_request: proposal.change_request || null,
  };
}

export function installLocalMocking(instance) {
  let calendars = [];

  instance.interceptors.request.use((config) => {
    if (process.env.REACT_APP_USE_MOCK_DATA !== "true" || !isLocalMockHost()) return config;

    const method = String(config.method || "get").toLowerCase();
    const url = String(config.url || "").replace(/^\/+/, "");
    const proposalMatch = url.match(/^proposals\/([^/]+)$/);
    const activityMatch = url.match(/^proposals\/([^/]+)\/activity$/);
    const actionMatch = url.match(/^proposals\/([^/]+)\/([^/]+)$/);
    // publicProposalApi baseURL already ends at /public/proposals, so paths are token or token/action
    const publicMatch = url.match(/^(?:public\/proposals\/)?(mock-proposal-[^/]+)(?:\/([^/]+))?$/);

    const use = (data, status = 200) => {
      config.adapter = async () => response(config, data, status);
      return config;
    };

    if (method === "post" && url === "auth/login") {
      const body = requestData(config.data);
      return use({
        token: MOCK_LOCAL_TOKEN,
        user: { ...MOCK_LOCAL_USER, email: body.email || MOCK_LOCAL_USER.email },
      });
    }

    if (method === "post" && url === "auth/login/mfa") {
      return use({ token: MOCK_LOCAL_TOKEN, user: MOCK_LOCAL_USER });
    }

    if (method === "get" && url === "auth/me") {
      const auth = String(config.headers?.Authorization || "");
      const token = localStorage.getItem("s7_token");
      const hasMockToken = token === MOCK_LOCAL_TOKEN || auth.includes(MOCK_LOCAL_TOKEN);
      if (hasMockToken) {
        return use(MOCK_LOCAL_USER);
      }
      return use({ detail: "Not authenticated" }, 401);
    }

    if (method === "get" && url === "users") {
      return use([MOCK_LOCAL_USER]);
    }

    if (method === "get" && url === "notifications") {
      return use([]);
    }

    if (method === "post" && url === "notifications/read-all") {
      return use({ ok: true });
    }

    if (method === "get" && url === "requests") {
      return use([]);
    }

    if (method === "get" && url === "calendars") {
      calendars = MOCK_CALENDARS;
      return use(MOCK_CALENDARS);
    }

    if (method === "get" && url === "bookings") {
      return use(bookingRows(calendars));
    }

    if (publicMatch) {
      const proposalId = publicMatch[1];
      const publicAction = publicMatch[2];
      const proposals = loadProposals();
      const index = proposals.findIndex((proposal) => proposal.id === proposalId);
      if (index < 0) return use({ detail: "Proposal link not found" }, 404);
      const current = proposals[index];

      if (method === "get" && !publicAction) {
        const restarting = typeof window !== "undefined"
          && new URLSearchParams(window.location.search).get("restart") === "1";
        if (restarting) {
          const reset = resetPublicProposal(current);
          proposals[index] = reset;
          saveProposals(proposals);
          return use(mockPublicPayload(reset));
        }
        if (current.status === "sent") {
          const viewed = {
            ...current,
            status: "viewed",
            version: Number(current.version || 0) + 1,
            updated_at: nowIso(),
          };
          proposals[index] = viewed;
          saveProposals(proposals);
          return use(mockPublicPayload(viewed));
        }
        return use(mockPublicPayload(current));
      }

      if (method === "post" && publicAction === "rewind") {
        const body = requestData(config.data);
        const updated = rewindPublicProposal(current, body.to);
        proposals[index] = updated;
        saveProposals(proposals);
        return use({ ok: true, status: updated.status, version: updated.version });
      }

      if (method === "post" && publicAction === "approve") {
        if (["client_approved", "signed", "deposit_paid", "paid"].includes(current.status)) {
          return use({ ok: true, status: current.status, approved_at: current.client_approved_at, version: current.version });
        }
        const updated = {
          ...current,
          status: "client_approved",
          client_approved_at: nowIso(),
          version: Number(current.version || 0) + 1,
          updated_at: nowIso(),
        };
        proposals[index] = updated;
        saveProposals(proposals);
        return use({ ok: true, status: "client_approved", approved_at: updated.client_approved_at, version: updated.version });
      }

      if (method === "post" && publicAction === "sign") {
        const body = requestData(config.data);
        const updated = {
          ...current,
          status: "signed",
          signed_at: nowIso(),
          version: Number(current.version || 0) + 1,
          updated_at: nowIso(),
          signature_summary: {
            id: `${current.id}-signature`,
            signer_name: body.signer_name || current.client_name,
            signer_email: body.signer_email || current.client_email,
            signed_at: nowIso(),
            signature_data: body.signature_data || "",
          },
        };
        proposals[index] = updated;
        saveProposals(proposals);
        return use({ id: updated.signature_summary.id, status: "signed", signed_at: updated.signed_at, version: updated.version }, 201);
      }

      if (method === "post" && publicAction === "change-request") {
        const body = requestData(config.data);
        const updated = {
          ...current,
          status: "changes_requested",
          version: Number(current.version || 0) + 1,
          updated_at: nowIso(),
          change_request: {
            id: `${current.id}-change`,
            client_name: body.client_name || current.client_name,
            message: body.message || "",
            status: "open",
            created_at: nowIso(),
          },
        };
        proposals[index] = updated;
        saveProposals(proposals);
        return use({ id: `${current.id}-change`, status: "open" }, 201);
      }

      if (method === "post" && publicAction === "checkout") {
        const body = requestData(config.data);
        const paymentType = body.payment_type === "full" || body.payment_type === "remaining" ? body.payment_type : "deposit";
        const updated = {
          ...current,
          status: paymentType === "deposit" ? "deposit_paid" : "paid",
          version: Number(current.version || 0) + 1,
          updated_at: nowIso(),
          payment_summary: {
            id: `${current.id}-payment`,
            status: "paid",
            payment_type: paymentType,
            amount_cents: current.rate_cents || 0,
            currency: "USD",
            paid_at: nowIso(),
          },
        };
        proposals[index] = updated;
        saveProposals(proposals);
        return use({
          checkout_url: `${window.location.origin}/p/${proposalId}?checkout=success`,
          payment_type: paymentType,
        }, 201);
      }
    }

    if (url === "proposals" && method === "get") {
      return use(loadProposals());
    }

    if (url === "proposals" && method === "post") {
      const proposals = loadProposals();
      const created = {
        ...baseProposal({
          id: `${MOCK_PREFIX}${Date.now()}`,
          title: "Untitled proposal",
          status: "draft",
          client: "",
          day: 7,
          rate: 0,
        }),
        ...requestData(config.data),
      };
      saveProposals([created, ...proposals]);
      return use(created, 201);
    }

    if (activityMatch && method === "get" && activityMatch[1].startsWith(MOCK_PREFIX)) {
      return use([
        {
          id: `${activityMatch[1]}-activity`,
          event_type: "demo_seeded",
          created_at: nowIso(),
          metadata: { message: "Added to the local preview." },
        },
      ]);
    }

    if (proposalMatch && proposalMatch[1].startsWith(MOCK_PREFIX)) {
      const proposals = loadProposals();
      const index = proposals.findIndex((proposal) => proposal.id === proposalMatch[1]);
      if (index < 0) return use({ detail: "Mock proposal not found" }, 404);
      if (method === "get") return use(proposals[index]);
      if (method === "patch") {
        const patch = requestData(config.data);
        const updated = {
          ...proposals[index],
          ...patch,
          version: Number(proposals[index].version || 0) + 1,
          updated_at: nowIso(),
        };
        proposals[index] = updated;
        saveProposals(proposals);
        return use(updated);
      }
    }

    if (actionMatch && actionMatch[1].startsWith(MOCK_PREFIX) && method === "get" && actionMatch[2] === "client-link") {
      const proposals = loadProposals();
      const found = proposals.find((proposal) => proposal.id === actionMatch[1]);
      if (!found) return use({ detail: "Mock proposal not found" }, 404);
      if (found.status === "archived") {
        return use({ detail: "Archived proposals do not have a client link" }, 409);
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const shareUrl = withResumeStep(`${origin}/p/${found.id}`, found.status);
      return use({ share_url: shareUrl, step: clientResumeStep(found.status) });
    }

    if (actionMatch && actionMatch[1].startsWith(MOCK_PREFIX) && method === "post") {
      const proposals = loadProposals();
      const index = proposals.findIndex((proposal) => proposal.id === actionMatch[1]);
      if (index < 0) return use({ detail: "Mock proposal not found" }, 404);
      if (actionMatch[2] === "duplicate") {
        const duplicate = {
          ...proposals[index],
          id: `${MOCK_PREFIX}${Date.now()}`,
          title: `${proposals[index].title} — Copy`,
          status: "draft",
          version: 1,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        saveProposals([duplicate, ...proposals]);
        return use(duplicate, 201);
      }
      if (actionMatch[2] === "mark-accepted") {
        const current = proposals[index];
        if (["client_approved", "signed", "deposit_paid", "paid"].includes(current.status)) {
          return use(current);
        }
        if (!["sent", "viewed"].includes(current.status)) {
          return use({ detail: "Only sent proposals can be marked accepted" }, 409);
        }
        const updated = {
          ...current,
          status: "client_approved",
          client_approved_at: nowIso(),
          version: Number(current.version || 0) + 1,
          updated_at: nowIso(),
          share_url: `${typeof window !== "undefined" ? window.location.origin : ""}/p/${actionMatch[1]}?step=agreement`,
        };
        proposals[index] = updated;
        saveProposals(proposals);
        return use(updated);
      }
      const nextStatus = statusForAction[actionMatch[2]];
      const updated = {
        ...proposals[index],
        status: nextStatus || proposals[index].status,
        version: Number(proposals[index].version || 0) + 1,
        updated_at: nowIso(),
      };
      if (actionMatch[2] === "send" || actionMatch[2] === "resend") {
        const preserve = ["client_approved", "signed"].includes(proposals[index].status);
        updated.status = preserve ? proposals[index].status : "sent";
        updated.share_url = withResumeStep(`${window.location.origin}/p/${actionMatch[1]}`, updated.status);
        updated.sent_at = nowIso();
      }
      proposals[index] = updated;
      saveProposals(proposals);
      return use(updated);
    }

    // Mock mode: don't fall through to the real backend (prevents 401 logout loops).
    if (method === "get") {
      return use([]);
    }
    if (method === "post" || method === "patch" || method === "put" || method === "delete") {
      return use({ ok: true });
    }

    return config;
  });

  instance.interceptors.response.use((result) => {
    if (
      process.env.REACT_APP_USE_MOCK_DATA === "true" &&
      isLocalMockHost() &&
      String(result.config?.url || "").replace(/^\/+/, "") === "calendars" &&
      Array.isArray(result.data)
    ) {
      calendars = result.data.filter((calendar) => calendar.is_active !== false);
    }
    return result;
  });
}
