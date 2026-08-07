import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/**",
      },
    ],
  },
};

// Only wrap with Sentry's build tooling when Sentry is actually configured —
// the wrapper adds measurable dev-server compile overhead, and E2E/CI and
// unconfigured local dev shouldn't pay it. Vercel builds with the DSN env
// vars set get the full behavior (sourcemap upload when an auth token exists).
const sentryEnabled = Boolean(
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
    process.env.SENTRY_DSN ||
    process.env.SENTRY_AUTH_TOKEN
);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },
    })
  : nextConfig;
