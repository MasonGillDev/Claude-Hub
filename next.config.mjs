/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard is used on 127.0.0.1 (see CLAUDE.md), but `next dev` binds
  // `localhost`. Without this, Next 16 blocks /_next/* dev resources (client
  // chunks + HMR) as cross-origin, so pages render but never hydrate — every
  // button goes dead. Allow both hostnames.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
