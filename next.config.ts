import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // QA drives the app from two origins (localhost + 127.0.0.1 through
  // the preview gateway). Two origins, because tabs share localStorage.
  // The sandbox's outer preview proxy also reaches dev on *.space-z.ai,
  // and shared tunnels reach dev on *.trycloudflare.com.
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.space-z.ai", "*.trycloudflare.com"],
  // The dev-tools indicator overlaps the composer on small screens,
  // and it never exists in production. Off in dev too.
  devIndicators: false,
  // Strict mode on. An app full of sockets, timers and async effects
  // hides double-mount bugs when it is off, and those bugs are the
  // ones that only show up on a slow phone.
  reactStrictMode: true,
  // No "X-Powered-By: Next.js". The framework is not the point.
  poweredByHeader: false,
  // The static files are served by Next without the middleware in
  // front of them, so they get their headers here. The Content-Security-
  // Policy comes from the middleware, which makes a nonce per request.
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    if (process.env.NODE_ENV === "production") {
      security.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      });
    }
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
