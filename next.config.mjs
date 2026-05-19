import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/demo/reset": ["./data/**/*"],
      "/api/demo/switch": ["./data/**/*"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // silent: true prevents source-map upload errors from crashing the build.
  // SENTRY_ORG must be the org slug (e.g. "provisum"), not a username.
  // SENTRY_PROJECT must be the URL slug from Sentry project settings, not the display name.
  // Upload errors are non-fatal; runtime error capture still works via instrumentation.ts.
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,

  webpack: {
    // Disable automatic middleware instrumentation — was causing MIDDLEWARE_INVOCATION_FAILED
    // on fresh builds without cache. Sentry still captures errors via instrumentation.ts.
    autoInstrumentMiddleware: false,
  },
});
