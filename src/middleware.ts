// The security headers.
//
// The app sends one policy per request: a Content-Security-Policy
// with a fresh nonce, and the small set of headers that cost nothing
// and close doors.
//
// The static files under /_next/static are served straight by Next,
// so the same headers are set for them in next.config.ts.
//
// See bugs/BUGS.md B15.

import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

const DEV = process.env.NODE_ENV !== "production";

export function middleware(request: NextRequest) {
  // A fresh nonce per request. Base64, because that is what a CSP
  // nonce is.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, DEV);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (!DEV) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  }
  return response;
}

export const config = {
  // Everything except the static files Next serves on its own.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
