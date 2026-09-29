import type { NextConfig } from "next";

// ── Phase 1 — production security headers (central) ────────────────────
// One source of truth (src/lib/security/headers.ts) drives both the
// Next.js headers() table and the security tests. Profiles:
//   · dev  — CSP allows the sandbox preview frame origins + dev eval,
//            no HSTS (http preview).
//   · prod — strict CSP (no unsafe-eval), HSTS, frame-ancestors 'self' +
//            SCHOOL_EMBED_ORIGINS (legitimate school-website embedding).
import { nextSecurityHeaderRules } from "./src/lib/security/headers";

// ── dev-stability: gateway-aware webpack lazyCompilation ────────────────
// The `/` god-entry dynamically imports every role panel; a FULL compile
// peaks ~3.1–3.4GB and OOM-kills the dev server (4GB cgroup). lazyCompilation
// compiles each panel only when the browser first visits it. The CUSTOM
// backend (fixed port + query-string stripping + same-origin client) makes
// it work behind the sandbox gateway — the stock backend burns an absolute
// `http://localhost:<random>/` URL into browser chunks, which every remote
// visitor fails to reach (blank preview). See src/lazy-compilation/*.js.
// webpack lazy-compilation backends are CommonJS by contract; next.config
// is compiled to CJS, so a cwd-absolute require is the only reliable path.
let lazyBackend: unknown;
if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  lazyBackend = require(`${process.cwd()}/src/lazy-compilation/backend`);
}

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["*.space-z.ai", "*.chatglm.cn", "*.z.ai", "127.0.0.1", "localhost", "*.localhost"],
  // NOTE (dev stability): dev.log / tmp-scripts / .zscripts are in
  // .gitignore — the watcher honors gitignore, so scratch scripts and the
  // request log never trigger Fast-Refresh rebuild loops.
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'framer-motion',
      'motion',
      'date-fns',
    ],
    // Memory guidance for Turbopack runs (webpack mode ignores it; kept for
    // the times the project is booted without --webpack).
    turbopackMemoryLimit: 2200,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Phase 1 — security headers on EVERY route (CSP, X-Content-Type-Options,
  // Referrer-Policy, Permissions-Policy, COOP, frame-ancestors; HSTS in
  // production). See src/lib/security/headers.ts for the profiles.
  async headers() {
    return nextSecurityHeaderRules();
  },
};

// Applied by `next dev --webpack` (Next 16): each panel compiles on first
// visit instead of the whole god-entry at once.
if (process.env.NODE_ENV !== "production" && lazyBackend) {
  (nextConfig as any).webpack = (config: any) => {
    config.experiments = {
      ...config.experiments,
      lazyCompilation: {
        imports: true,
        entries: false,
        backend: lazyBackend,
      },
    };
    // W2.3B — never watch the runtime SQLite database (db/*.db, journals,
    // uploads). Every prisma write touched custom.db, and the default
    // watcher (which does NOT honor .gitignore in webpack mode) answered
    // with a full Fast-Refresh rebuild — up to 8s of dev-server CPU per
    // write, HMR reconnects and stale-chunk overlays in live browsers.
    // (Replaces the default RegExp list with equivalent string globs —
    // webpack schema-validates mixed arrays strictly.)
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/node_modules/**", "**/.git/**", "**/db/**"],
    };
    console.log("[memory-fix] lazyCompilation enabled (gateway-aware custom backend, port 3777)");
    return config;
  };
}

export default nextConfig;
