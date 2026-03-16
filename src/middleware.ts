import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const protectedPaths = ["/repos", "/config", "/days", "/export", "/sheet"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isDevWarmup = process.env.NODE_ENV === "development" && request.headers.get("x-gitsheet-dev-warmup") === "1";

  if (!isProtected) {
    return NextResponse.next();
  }

  if (isDevWarmup) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/repos/:path*", "/config/:path*", "/days/:path*", "/export/:path*", "/sheet/:path*"],
};
