# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-06-25

Initial release of `BoundaryEngine`, a secure HTTP boundary toolkit for Fetch-compatible TypeScript APIs.

### Added

- Added typed `ApiError` helpers, error factories, and sanitized error responses for route handlers.
- Added JSON body validation and query parameter validation helpers for Zod schemas.
- Added `createRouteHandler()` for consistent route execution, validation, error handling, and response shaping.
- Added webhook helpers for payload-size checks, HMAC signature verification, timestamp tolerance, replay hooks, and guard composition.
- Added client IP extraction with explicit trusted-proxy configuration, IPv4/IPv6 CIDR matching through `ipaddr.js`, Cloudflare header opt-in, and fail-closed production behavior.
- Added public IP validation utilities and CIDR matching helpers for both IPv4 and IPv6.
- Added TypeScript declarations, package-local tests, typecheck, build, and built-dist smoke scripts.

### Security

- `CF-Connecting-IP` trust is opt-in through `trustCfConnectingIp` and should only be enabled when direct origin access is blocked.
- `X-Forwarded-For` is trusted only when terminal proxy hops match configured trusted proxy CIDRs.
