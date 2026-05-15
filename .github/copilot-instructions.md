# ShutterQueue — Copilot Working Instructions

## Project Overview

ShutterQueue is an Electron + React (TypeScript) desktop app for photographers to batch-queue
and publish photos to multiple social/photo platforms simultaneously. 

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
- Run: `npm test`. Currently 51 tests. Keep all passing.
- Build: `npm run build`. Run after non-trivial changes.

## Version & Docs Policy

- Current release: `0.9.9` (package.json `"version"` field).
- When bumping versions, update **all** references consistently (package.json, UI fallback, docs).
- **Update CHANGELOG.md and RELEASE_NOTES.md after every significant fix**, not in batches.
  - Post-release fixes go under a `### Post-Release Fixes (YYYY-MM-DD)` subsection inside the current version block in CHANGELOG.
  - RELEASE_NOTES.md gets a `## Post-Release Fixes (Month DD, YYYY)` section prepended above the original release section.
- Never log changes under a new version entry until the version is actually bumped.

## Queue Schema Rules

- Preserve backward compatibility on queue import/export — flag migration risks explicitly.
- `group_only` field must be preserved through all queue read/write/normalize paths.
- New fields added to `QueueItem` must be added to: `src/types.ts`, normalization in `queue.cjs`, and relevant UI display.


