/**
 * book.studio7.miami — booking HTML is served at / via vercel.json rewrites (URL stays clean).
 * Do not redirect to /booking/index.html here (that exposes the long path in the browser).
 *
 * team.studio7.miami /p/* — rewrite OG tags so iMessage and Slack previews say Proposal.
 */
export const config = {
  matcher: [
    "/p/:path*",
    "/((?!booking/|api/|brand/|static/|index\\.html).*)",
  ],
};

const PROPOSAL_TITLE = "Studio 7 Miami · Proposal";
const PROPOSAL_DESCRIPTION = "Review your Studio 7 Miami content proposal.";
const TEAM_TITLE = "Studio 7 Miami · Team";
const TEAM_DESCRIPTION = "Studio 7 Miami team hub — calendar, requests, and invites.";

export default async function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  const url = new URL(request.url);

  if (host === "book.studio7.miami") {
    return;
  }

  if (!url.pathname.startsWith("/p/")) {
    return;
  }

  try {
    const index = await fetch(new URL("/index.html", url.origin));
    if (!index.ok) return;
    const html = await index.text();
    const canonical = `${url.origin}${url.pathname}`;
    const next = html
      .replaceAll(TEAM_TITLE, PROPOSAL_TITLE)
      .replaceAll(TEAM_DESCRIPTION, PROPOSAL_DESCRIPTION)
      .replaceAll('content="https://team.studio7.miami/"', `content="${canonical}"`);
    return new Response(next, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  } catch {
    return;
  }
}
