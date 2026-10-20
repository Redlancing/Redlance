import { type NextRequest, NextResponse } from "next/server";
import { REQUEST_PATH_HEADER } from "./server/request-path";
import { SESSION_COOKIE } from "./server/session-cookie";

// Optimistic check only (no database): signed-out visitors go straight to /login.
// Pages and API routes still verify the session themselves.
export function proxy(request: NextRequest): NextResponse {
  if (request.cookies.has(SESSION_COOKIE)) {
    // Layouts can't see the URL; hand them the requested path for their own login redirect.
    const headers = new Headers(request.headers);
    headers.set(
      REQUEST_PATH_HEADER,
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.next({ request: { headers } });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/feed/:path*",
    "/tracker/:path*",
    "/settings/:path*",
  ],
};
