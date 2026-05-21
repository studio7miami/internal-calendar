/**
 * book.studio7.miami — booking HTML is served at / via vercel.json rewrites (URL stays clean).
 * Do not redirect to /booking/index.html here (that exposes the long path in the browser).
 */
export const config = {
  matcher: ["/((?!booking/|api/|brand/|static/).*)"],
};

export default function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  if (host !== "book.studio7.miami") {
    return;
  }
  // Let vercel.json rewrites handle / and SPA-style paths; /booking/* assets pass through.
}
