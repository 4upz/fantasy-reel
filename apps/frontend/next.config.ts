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
      // Auto-create a Sentry cron monitor per entry in vercel.json and send
      // in_progress/ok/error check-ins around each run, so a job that stops
      // firing or starts failing pages us instead of failing silently.
      //
      // This is the App Router option. The `webpack.automaticVercelMonitors`
      // flag in Sentry's docs only injects the crons config into the *pages*
      // router templates (see the SDK's wrappingLoader + apiWrapperTemplate) —
      // our crons are `app/api/cron/*/route.ts`, so that flag is a no-op here.
      // Enabling both makes the SDK warn and use this one anyway.
      //
      // Only active when process.env.VERCEL is set; local builds skip it.
      _experimental: {
        vercelCronsMonitoring: true,
      },
    })
  : nextConfig;
