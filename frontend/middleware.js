/**
 * book.studio7.miami → static public booking page (not the team React app).
 * CRA's SPA fallback serves /index.html for all hosts; middleware runs first.
 */
export const config = {
  matcher: ["/((?!booking/|api/|brand/|static/).*)"],
};

export default function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  if (host !== "book.studio7.miami") {
    return;
  }

  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/booking/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/static/")
  ) {
    return;
  }

  const dest = new URL("/booking/index.html", url.origin);
  dest.search = url.search;
  return Response.redirect(dest, 302);
}
