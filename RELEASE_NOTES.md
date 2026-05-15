# ShutterQueue v0.9.9 Release Notes

Release Date: May 15, 2026

This version bundles all improvements completed since v0.9.8 (including the work previously tracked as v0.9.8a).

## Beginner-Friendly Summary

v0.9.9 focuses on reliability, clarity, and safer automation:

- New: After image uploads setting with three choices (keep in queue, remove from queue, or delete+remove with typed safety confirmation).
- New: Use Large Fonts accessibility option with larger text, spacing, and layout adjustments.
- New: Universal mac build verification now automatically checks required runtime packages (including sharp arm64 and x64 slices) before considering a build publish-ready.
- New: The mac universal build command now uses npm's supported `--os` / `--cpu` flags so Apple Silicon Macs can stage the x64 sharp runtime without EBADPLATFORM.
- Original-file delete is now much more reliable on Windows, especially for the last photo uploaded in a batch.
- Delete failures now produce clearer, more useful messages and diagnostics.
- Flickr group-retry behavior is more controllable and more visible.
- Queue editing and text-entry focus behavior is more stable.
- Logging is easier to filter for troubleshooting uploads/deletes.
- Platform posting behavior was improved for Tumblr, Mastodon, PixelFed, Lemmy, and Flickr album handling.

## What Changed (Functional Outcomes)

### 1. New: After-Upload Queue Action Automation

In General App Settings, you can now choose:

- Do Nothing (leave items in queue)
- Remove items from queue (do not delete)
- Delete items and remove from queue

Safety behavior:

- Delete+remove requires typing Delete My Files to confirm.
- Items with upload errors are not auto-removed/deleted.
- Flickr group-add retry scenarios are handled so group retry queues are preserved.

### 2. New: Use Large Fonts Accessibility Option

In General App Settings, directly under Use Light Theme:

- New Use Large Fonts toggle.
- Significantly larger text across the app.
- Smallest text is scaled much more aggressively.
- Larger text also increases while preserving visual hierarchy.
- Spacing, controls, and layout were expanded to fit the larger scale.
- Wrapping/scroll behavior was improved for smaller displays.

### 3. Original File Delete Reliability (Major)

- Fixed stubborn Windows delete/recycle failures, especially the "last uploaded file" pattern.
- Recycle fallback logic is now more resilient to transient failures.
- Delete retries no longer trigger repeated disruptive Windows error popups.
- If a file is actively uploading, delete now blocks with a clear instruction instead of partially proceeding.

### 4. Better Delete Feedback and Diagnostics

- Delete results now clearly separate:
  - moved to Recycle Bin
  - failed
  - missing on disk
  - kept in queue
- Diagnostics were expanded so logs can better distinguish:
  - real file locks
  - transient recycle issues
  - path/environment-related recycle failures
- Toast/error messaging is now clearer and less noisy for non-technical users.

### 5. Queue and Editing UX Improvements

- Queue text editing (title/description/tags) is more stable and less likely to lose cursor focus.
- Unified in-app confirmation dialogs replaced remaining native browser-style confirms.
- Typed delete and queue actions now provide cleaner, more consistent interaction feedback.

### 6. Flickr Workflow Improvements

- Added better control over Flickr group-add queue behavior for new uploads.
- Added quick action to retry Flickr group additions now from Schedule view.
- Existing-album matching and create-album handling is more robust (including duplicate-title edge cases).
- Group retry scheduling behavior was hardened and made more predictable.

### 7. Multi-Platform Posting Improvements

- Tumblr caption formatting improved for cleaner title/description separation.
- Mastodon + PixelFed flow improved with optional PixelFed-first then Mastodon reshare behavior.
- Better guidance around required Mastodon scopes for reshare paths.
- Stream/cleanup handling was hardened in upload paths to reduce lingering file-lock side effects.

### 8. Logging and Troubleshooting Improvements

- New Uploads + Deletes log filter for focused troubleshooting.
- Better separation between operational logs and verbose diagnostic logs.
- Cleaner default log output while keeping deep diagnostics available when needed.

## Notes

- This is a version bump and integration checkpoint release.
- You can continue test-batch validation before publishing a full public release package.
- Full technical implementation details are preserved in CHANGELOG.md.
