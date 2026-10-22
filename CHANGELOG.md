# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-10-22

### Breaking changes

- Fetch handlers without validated params accept only the request. Handlers with `.params(...)` require a second argument containing `params`. Frameworks can supply this context directly; direct callers must pass it explicitly.

### Fixed

- Emit Node-compatible ESM imports and declarations.
- Clean build output before compiling and check Node runtime exports before packing.

### Added

- Export `RouteBoundaryFetchHandler` for framework-compatible handler signatures.

## [1.0.0] - 2026-07-03

### Added

- Added the immutable `createRouteBoundary()` composer for typed params, query, JSON body validation, pre-validation request guards, post-validation guards, typed context enrichment, early responses, local error mapping, and validation observers.
- Added configurable route error handling with request-local context, logging hooks, redaction support, and sanitized responses.
- Added Fetch response helpers for JSON, error JSON, and empty responses.
- Added optional JSON content-type enforcement and repeated query-parameter support.
- Added bounded streamed JSON and webhook body reads so payload limits are enforced before the complete body is buffered.

### Breaking Changes

- Removed `createRouteHandler()` and `RouteHandlerContext`. Use `createRouteBoundary()` for route composition or `validateJsonBody()` for standalone body validation.
- Renamed public boundary types into the consistent `RouteBoundary*` family.

### Changed

- Standardized validation failure shapes and response construction across route and webhook boundaries.
- Consolidated public package types in `src/types.ts`; implementation-only types remain beside their implementations.
- Replaced internal `any`-based guard storage with explicit erased guard types while preserving public generic inference.
- Narrowed the error-detail redaction callback to its actual record input and output contract.
- Made error mapper failures flow through the configured final error handler.
- Made replay-store failures return a fail-closed `503` response.
- Clarified that the generic webhook verifier checks HMAC-SHA256 over the exact supplied payload and does not implement provider-specific timestamp schemes.
- Declared the Node.js 18+ runtime requirement and side-effect-free package metadata.

### Security

- Authentication and rate-limit request guards can run before request parsing, preventing unauthorized or limited requests from receiving validation details.
- Body limits are enforced while reading streamed JSON and webhook payloads, including requests with absent or misleading `Content-Length` headers.
- Request-local context prevents identity, params, query, body, and error metadata from leaking across concurrent requests.
- Production sanitization now omits unredacted `ApiError` details and normalizes invalid HTTP error statuses to `500`.
- Default error-handler logs omit URL query strings and use the sanitized response message.
- Replay callbacks fail closed when the backing store is unavailable; replay IDs must be claimed atomically by the callback.

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
