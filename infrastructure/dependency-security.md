# Dependency security maintenance

Update direct dependencies with `bun update --latest`, then inspect `bun audit`
and run the repository validation gates. Keep the Expo SDK/native-module contract
and existing dependency patches intact. Native dependency updates require new
Android and iOS builds; an OTA does not update installed native code.

## Temporary overrides

- `@babel/core` 7.29.7 replaces Hot Updater Expo's 7.26.0 pin within Babel 7,
  fixing GHSA-4x5r-pxfx-6jf8. Remove the override once upstream uses a fixed
  Babel 7 version.
- `hono` 4.13.14 replaces Hot Updater Cloudflare's 4.12.34 pin within Hono 4,
  including the fixes reported by the dependency audit. Remove the override
  once upstream no longer pins a vulnerable Hono version. The deployed OTA
  service must also be rebuilt and deployed to receive server-side fixes.

## Outstanding upstream advisories (2026-10-26)

These remain visible in `bun audit`; they are not suppressed:

- GHSA-86w9-cpqp-85rv: Expo CLI uses node-forge 1.4.0. No fixed published
  version is listed. This concerns RSA signature verification in build tooling;
  updating the mobile bundle does not remediate it.
- GHSA-mrhx-c7xc-m3w5: Expo CLI and transitive tooling retain Zod 3.25.76.
  The App directly uses fixed Zod 4.6.7. Do not override Zod 3 with Zod 4
  without migrating and validating the upstream consumers.
- GHSA-w5hq-g745-h8pq: xcode 3.0.1 retains uuid 7.0.3. Its project-ID
  generator calls `v4()` without a buffer; the advisory concerns buffered
  v3/v5/v6 calls. Do not globally replace this old CommonJS dependency with
  an incompatible major solely to clear the audit report.

Recheck upstream releases before producing the store candidate. A passing
functional test suite does not imply that these advisories are resolved.
