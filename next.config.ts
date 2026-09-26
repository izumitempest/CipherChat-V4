import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // QA drives the app from two origins (localhost + 127.0.0.1 through
  // the preview gateway). Two origins, because tabs share localStorage.
  // The sandbox's outer preview proxy also reaches dev on *.space-z.ai.
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.space-z.ai"],
  // The dev-tools indicator overlaps the composer on small screens,
  // and it never exists in production. Off in dev too.
  devIndicators: false,
  reactStrictMode: false,
};

export default nextConfig;
