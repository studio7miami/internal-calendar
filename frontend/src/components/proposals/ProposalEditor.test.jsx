import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProposalEditor from "./ProposalEditor";
import { normalizeProposal } from "../../lib/proposals";

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      role: "admin",
      permissions: {
        edit_proposals: true,
        approve_proposals: true,
        send_proposals: true,
      },
    },
  }),
}));

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

const proposal = normalizeProposal({
  id: "proposal-test",
  title: "Campaign proposal",
  status: "draft",
  version: 1,
  client_name: "Ava Reynolds",
  client_email: "ava@example.com",
  client_phone: "+13055550100",
  calendar_id: "calendar-1",
  session_date: "2026-09-10",
  arrival_time: "09:30",
  setup_time: "10:00",
  shoot_time: "10:30",
  wrap_time: "13:30",
  creative_brief: {
    brand_description: "Modern editorial campaign",
    content_goals: "Launch a new collection",
    target_audience: "Creative founders",
    desired_energy: "Warm and assured",
  },
  content_items: [
    {
      id: "content-1",
      type: "Campaign images",
      quantity: "6 photos",
      energy: "Editorial",
      visual_style: "Sculptural",
    },
  ],
  pricing: {
    currency: "USD",
    session_rate: 3200,
    deposit_percent: 50,
    deliverables: "Six retouched images",
    turnaround: "7–10 business days",
  },
  share_settings: {
    channel: "email",
    expires_days: 30,
  },
});

function renderEditor(overrides = {}) {
  const props = {
    proposal,
    onChange: jest.fn(),
    saveState: "saved",
    onAction: jest.fn(),
    actionState: "",
    calendars: [{ id: "calendar-1", name: "Studio 7 Miami" }],
    ...overrides,
  };
  return { props, ...render(<ProposalEditor {...props} />) };
}

test("renders the classic panel + canvas layout with card stack deck", () => {
  const { container } = renderEditor({ onBack: jest.fn() });

  expect(container.querySelector(".pb-panel")).toBeInTheDocument();
  expect(container.querySelector(".pb-canvas")).toBeInTheDocument();
  expect(container.querySelectorAll(".pb-panel-scroll .pb-group")).toHaveLength(4);
  expect(container.querySelectorAll(".pb-card-block")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: /Add content card/i })).not.toBeInTheDocument();
  expect(screen.queryByText("Session Schedule")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Select start time|Start time:/i })).toBeInTheDocument();
  expect(container.querySelector(".s7-deck")).toHaveAttribute("data-presentation", "stack");
  expect(container.querySelectorAll(".s7-slide")).toHaveLength(5);
});

test("opens send dialog with email and text options", async () => {
  const onAction = jest.fn().mockResolvedValue({
    ...proposal,
    status: "sent",
    share_url: "https://team.studio7.miami/p/ava-reynolds",
  });
  renderEditor({
    proposal: { ...proposal, status: "approved" },
    onAction,
  });

  fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(onAction).toHaveBeenCalledWith("send", { channel: "text" });
  expect(screen.getByRole("button", { name: /^Email$/i })).toBeInTheDocument();
  const text = screen.getByRole("link", { name: /^Text/i });
  expect(text).toHaveAttribute("href", expect.stringMatching(/^sms:/));
});

test("maps field edits through the proposal editor contract", () => {
  const onChange = jest.fn();
  renderEditor({ onChange });

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Test session" } });
  fireEvent.change(screen.getByLabelText("Client Name"), { target: { value: "Maya Chen" } });

  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Test session" }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    client: expect.objectContaining({ contact_name: "Maya Chen" }),
  }));
});

test("opens the full client preview and allows send from draft", () => {
  renderEditor();

  fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
  expect(screen.getByRole("button", { name: "Return to editor" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Return to editor" }));
  expect(screen.queryByRole("button", { name: /Submit for approval/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Send$/i })).not.toBeDisabled();
});

test("duplicates the proposal from the editor actions bar", () => {
  const onAction = jest.fn();
  renderEditor({ onAction });

  fireEvent.click(screen.getByRole("button", { name: /^Duplicate$/i }));
  expect(onAction).toHaveBeenCalledWith("duplicate");
});

test("editor actions are preview, duplicate, and send only", () => {
  renderEditor({
    proposal: { ...proposal, status: "sent", share_url: "https://example.com/p/token" },
  });

  expect(screen.getByRole("button", { name: /^Preview$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Duplicate$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Mark accepted$/i })).not.toBeInTheDocument();
});
