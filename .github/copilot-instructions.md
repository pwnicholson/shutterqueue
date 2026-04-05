# ShutterQueue — Copilot Working Instructions

## Project Overview

ShutterQueue is an Electron + React (TypeScript) desktop app for photographers to batch-queue
and publish photos to multiple social/photo platforms simultaneously. Current version: **0.9.7a**.

## Architecture

| Layer | Files | Notes |
|---|---|---|
| Renderer (React/TS) | `src/ui/App.tsx`, `src/types.ts`, `src/main.tsx` | Single large App.tsx; all UI state in React |
| Main process | `electron/main.cjs` | All IPC handlers, upload orchestration, store access |
| Preload bridge | `electron/preload.cjs` | Exposes typed `window.api` to renderer |
| Services | `electron/services/*.cjs` | One module per platform + queue/trash/image-prep/update |
| Tests | `electron/services/*.test.cjs` | Node built-in `node:test`; run with `npm test` |

## Active Platforms

Registered in `VALID_TARGET_SERVICES` in `electron/services/queue.cjs`:

- **Flickr** — full implementation; group pools with retry queues; `group_only` items concept
- **Tumblr** — OAuth1 via loopback (port 38945); caption from configurable post-text mode
- **Bluesky** — AT Protocol; token refresh retry; thread/truncate long-post modes; adult content label
- **Mastodon** — standard OAuth2; per-instance media limits via `/api/v2/instance`
- **PixelFed** — Mastodon-compatible API; OAuth2 via loopback (port 38946); location unsupported
- **Lemmy** — image upload + post creation; self-healing endpoint/fieldname probe cache; community picker

## Key Conventions

- Services are plain `.cjs` modules (not ES modules). `require()` throughout.
- `electron-store` (`store.get/set`) for all persistent settings. Never write to disk manually.
- Image preparation via `electron/services/image-prep.cjs` using `sharp`.
- Upload limit fetching is per-instance and cached; see `upload-limit-enforcement-notes.md`.
- Queue items carry `serviceStates: {}` — per-platform markers written by upload flow, cleared on reset.
- `group_only: true` items are invisible in main queue but run Flickr group retries until complete.
- Platform chips in UI are filtered to authorized services but stored selections are persisted as-is.
- File delete sends files to OS bin (not permanent delete); requires typed confirmation modal.
- Safety level: 1 = Safe, 2 = Moderate, 3 = Restricted. Each platform maps this differently.

## Testing Discipline

- **Always add regression tests** for new behavior when testable.
- Tests live in `electron/services/*.test.cjs` alongside the service under test.
- Export test-only helpers via `module.exports.__test__ = { ... }`.
- Run: `npm test`. Currently 44 tests. Keep all passing.
- Build: `npm run build`. Run after non-trivial changes.

## Version & Docs Policy

- Current release: `0.9.7a` (package.json `"version"` field).
- When bumping versions, update **all** references consistently (package.json, UI fallback, docs).
- **Update CHANGELOG.md and RELEASE_NOTES.md after every significant fix**, not in batches.
  - Post-release fixes go under a `### Post-Release Fixes (YYYY-MM-DD)` subsection inside the current version block in CHANGELOG.
  - RELEASE_NOTES.md gets a `## Post-Release Fixes (Month DD, YYYY)` section prepended above the original release section.
- Never log changes under a new version entry until the version is actually bumped.

## Queue Schema Rules

- Preserve backward compatibility on queue import/export — flag migration risks explicitly.
- `group_only` field must be preserved through all queue read/write/normalize paths.
- New fields added to `QueueItem` must be added to: `src/types.ts`, normalization in `queue.cjs`, and relevant UI display.

## Platform-Specific Notes

### Lemmy
- **Known issue: integration is still unreliable.** In-app warning banners are shown in the settings panel and queue editor Lemmy tab.
- Multi-endpoint/field-name probing: tries up to 11 combinations to find working upload config.
- Cached per-instance in `lemmyInstanceUploadConfigCache` (30-day TTL) via electron-store.
- `probePublicImageUrl()` live-fetches each candidate URL; only accepts `image/*` content-type.
- `invalid_url` API error triggers fail-fast: remaining communities halted immediately.
- Community errors use `describeCommunity()` which resolves "Title (name@host)" format (cached in `communityLabelCache` Map per upload run).
- `normalizeUploadedImageUrlForPost()` ensures absolute URL before post creation.
- Exported test helpers: `buildPostText`, `normalizeInstanceUrl`, `extractLemmyImageLimitsFromSitePayload`, `looksLikeLikelyUploadedImageUrl`, `collectUploadedImageUrlCandidates`, `pickUploadedImageUrl`.

### Bluesky
- Post-composition variables (`blueskyPostTextMode`, `blueskyLongPostMode`, etc.) must be declared **outside** `try` blocks in main.cjs upload branches — refresh-retry catch paths need them.
- Character counter in editor reflects actual composed text including hashtags and line breaks.
- `blueskyUseDescriptionAsAltText` (default true): controls whether Description or Title is used as image alt text.
- Adult label: safetyLevel ≥ 2 → label set on post record.

### Pixelfed
- Auth: OAuth2 loopback, port 38946, path `/pixelfed/callback`.
- Store keys: `pixelfedClientId`, `pixelfedClientSecretEnc`, `pixelfedHasClientSecret`, `pixelfedOauthInstanceUrl`, `pixelfedPendingCode`.
- Old manual token flow kept but hidden from primary UI.

### Tumblr
- Uses `caption` field for composed post text.
- `tumblrUseDescriptionAsImageDescription` (default true): sends Description as image metadata.
- OAuth1 today; OAuth2 migration is a future consideration.

### Mastodon / PixelFed image limits
- Fetch per-instance from `/api/v2/instance` (fallback `/api/v1/instance`).
- `configuration.media_attachments.image_size_limit` and `image_matrix_limit`.
- Preparation: fit-inside scaling, min JPEG quality 70, original used unchanged if already within limits.

### Flickr
- Group pool retry states survive queue removal if user chooses "Keep In Group Queues Only".
- `group_only` items auto-clean when all their group retry states complete.

## Repo Memory Files (read if relevant)

These are stored under `/memories/repo/` and contain detailed implementation notes:

| File | Topic |
|---|---|
| `bluesky-posting-notes.md` | Bluesky auth errors, post modes, character counter, adult content |
| `image-cache-notes.md` | Thumb/preview cache filename scheme; pruning on queue changes |
| `pixelfed-integration-notes.md` | OAuth flow, store keys, upload and privacy mapping |
| `tumblr-oauth-notes.md` | OAuth1 loopback, fallback, caption/privacy mapping |
| `upload-limit-enforcement-notes.md` | Per-instance image size/matrix limit fetching and preparation strategy |

## Upcoming / Wishlist

- Substack support
- Pixfed.com support
- Tumblr Communities
- Glass, Foto (nice-to-have)
- Reddit, Instagram, Threads (low priority / unlikely)
