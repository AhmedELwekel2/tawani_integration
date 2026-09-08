import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  // The dev server is reachable as localhost, 127.0.0.1 and the LAN IP. Without
  // these, Next blocks /_next/* dev resources for the non-canonical origins, the
  // client bundle never loads, and forms fall back to plain HTML submits.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.24"],
};

export default nextConfig;
