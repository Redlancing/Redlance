import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./server/session-cookie";

// Optimistic check only (no database): signed-out visitors go straight to /login.
// Pages and API routes still verify the session themselves.
export function proxy(request: NextRequest): NextResponse {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
