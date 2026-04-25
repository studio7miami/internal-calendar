/** Dev-only fixtures for `/preview/members/:role` — mirrors backend `permissions.py` keys. */

export const PREVIEW_CALENDAR_IDS = {
  miami: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
  photobooth: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
};

export const PREVIEW_USER_IDS = {
  admin: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001",
  manager: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002",
  member: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003",
};

const DEFS = [
  { key: "view_schedule", label: "View calendar" },
  { key: "create_request", label: "Create booking requests" },
  { key: "see_all_booking_details", label: "See all booking details" },
  { key: "create_manual_booking", label: "Add manual bookings" },
  { key: "approve_deny_requests", label: "View and approve / deny requests" },
  { key: "view_members_directory", label: "View team list" },
  { key: "assign_member_calendars", label: "Assign calendars to members" },
  { key: "delete_any_booking", label: "Delete or cancel any booking" },
];

const EFF_MEMBER = {
  view_schedule: true,
  create_request: true,
  see_all_booking_details: false,
  create_manual_booking: false,
  approve_deny_requests: false,
  view_members_directory: true,
  assign_member_calendars: false,
  delete_any_booking: false,
};

const EFF_MANAGER = {
  view_schedule: true,
  create_request: true,
  see_all_booking_details: true,
  create_manual_booking: true,
  approve_deny_requests: true,
  view_members_directory: true,
  assign_member_calendars: false,
  delete_any_booking: false,
};

const EFF_ADMIN = DEFS.reduce((acc, d) => {
  acc[d.key] = true;
  return acc;
}, {});

export const PREVIEW_PERM_CFG = {
  definitions: DEFS,
  effective: {
    member: { ...EFF_MEMBER },
    manager: { ...EFF_MANAGER },
  },
  stored: { member: {}, manager: {} },
};

export const PREVIEW_CALENDARS_DIRECTORY = [
  { id: PREVIEW_CALENDAR_IDS.miami, name: "Studio 7 Miami", color: "#38BDF8", is_active: true },
  { id: PREVIEW_CALENDAR_IDS.photobooth, name: "Studio 7 Photobooth", color: "#A78BFA", is_active: true },
];

export const PREVIEW_TEAM_USERS = [
  {
    id: PREVIEW_USER_IDS.admin,
    name: "Seven",
    email: "seven@studio7.miami",
    role: "admin",
    is_disabled: false,
    visible_calendar_ids: null,
  },
  {
    id: PREVIEW_USER_IDS.manager,
    name: "Jordan Lee",
    email: "jordan@studio7.miami",
    role: "manager",
    is_disabled: false,
    visible_calendar_ids: null,
  },
  {
    id: PREVIEW_USER_IDS.member,
    name: "Alex Rivera",
    email: "alex@studio7.miami",
    role: "member",
    is_disabled: false,
    visible_calendar_ids: [PREVIEW_CALENDAR_IDS.miami],
  },
];

export const PREVIEW_INVITES = [
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
    email: "pending@example.com",
    used: false,
    expires_at: new Date(Date.now() + 5 * 864e5).toISOString(),
    invite_link: `${typeof window !== "undefined" ? window.location.origin : ""}/invite/preview-token`,
  },
];

/**
 * @param {"member" | "manager" | "admin"} role
 * @returns {object} auth-shaped user for Members UI
 */
export function buildPreviewMe(role) {
  if (role === "admin") {
    return {
      id: PREVIEW_USER_IDS.admin,
      email: "seven@studio7.miami",
      name: "Seven",
      role: "admin",
      is_disabled: false,
      visible_calendar_ids: null,
      permissions: { ...EFF_ADMIN },
      mfa_enabled: false,
      mfa_setup_pending: false,
    };
  }
  if (role === "manager") {
    return {
      id: PREVIEW_USER_IDS.manager,
      email: "jordan@studio7.miami",
      name: "Jordan Lee",
      role: "manager",
      is_disabled: false,
      visible_calendar_ids: null,
      permissions: { ...EFF_MANAGER },
      mfa_enabled: false,
      mfa_setup_pending: false,
    };
  }
  return {
    id: PREVIEW_USER_IDS.member,
    email: "alex@studio7.miami",
    name: "Alex Rivera",
    role: "member",
    is_disabled: false,
    visible_calendar_ids: [PREVIEW_CALENDAR_IDS.miami],
    permissions: { ...EFF_MEMBER },
    mfa_enabled: false,
    mfa_setup_pending: false,
  };
}
