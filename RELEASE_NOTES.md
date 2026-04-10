# ShutterQueue v0.9.7b Release Notes

**Release Date:** April 5, 2026

## Post-Release Fixes (April 6, 2026)

### Scheduler Start — In-App Datetime Picker

"Start Scheduler" now opens an in-app modal instead of the system OS dialog. The modal offers two options:

- **Upload first item now** — starts the scheduler and triggers an immediate first upload
- **Schedule first upload at: [date/time]** — lets you specify an exact date and time for the first upload (defaults to tomorrow at 06:00 local time); the time is validated against your configured time-window and days-of-week settings before being set

The old native dialog only offered "now", "on delay (full interval)", or "cancel" — the new picker gives precise control.

---

## What's New in 0.9.7b (April 5, 2026)

### Empty Titles Now Stay Blank Across All Platforms

When uploading a photo with no title set, ShutterQueue now ensures the title remains genuinely blank:

- **Flickr** was silently replacing a blank title with the photo's filename — this was Flickr's own server-side fallback behaviour when `title=""` is sent. ShutterQueue now explicitly clears the title via a follow-up API call after upload. If the title-clearing step fails, the upload itself still succeeds (best-effort).
- **Lemmy** was showing the photo's filename as the post title — since Lemmy requires a post name, it now uses `"Photo"` as a neutral placeholder when the title field is blank.
- **Tumblr, Bluesky, Mastodon, and PixelFed** were already handling blank titles correctly (skipping the title field entirely in composed post text).

### Lemmy Server Outages — Automatic Hourly Retry

When Lemmy is temporarily unavailable (HTTP 502, 503, 500, socket hang-up, network resets), ShutterQueue now handles this gracefully instead of marking the upload as permanently failed:

- Items show as yellow **"retrying…"** instead of red "failed"
- The Lemmy platform chip shows a yellow **↻** symbol with the retry attempt count in the tooltip
- ShutterQueue automatically retries the upload approximately **every hour** while the scheduler is active — no user action needed
- If other platforms (Bluesky, Mastodon, etc.) succeeded in the same upload, the item shows yellow "done (warnings)" and only the Lemmy chip shows ↻
- The queue shows the **next retry time** so you know when to expect another attempt
- When the server recovers and the retry succeeds, the item transitions back to its normal green state
- Retries continue indefinitely while the scheduler is on — no automatic give-up

### Lemmy Probe Order — lemmy.world (v0.19.x) Support Improved

lemmy.world runs Lemmy 0.19.17 and uses `POST /pictrs/image` with `images[]` field. This combination was previously last in the probe list (attempt 13 of 13). It's now **second**, so lemmy.world instances are discovered on the 2nd attempt after the modern `/api/v4/image` endpoint 404s. The result is cached, so all future uploads go directly to the right endpoint.

### Tumblr Uploads Fixed (User-Agent and Invalid Field)

Tumblr uploads were failing with a generic 400 Bad Request error. Two causes were identified and fixed:

1. **Missing User-Agent header** — Tumblr's API Agreement requires all apps to send a consistent `User-Agent` header. Node.js's built-in HTTP module does not add one automatically. ShutterQueue now sends `User-Agent: ShutterQueue/1.0` on all Tumblr requests.

2. **Invalid form field** — The photo post request was including a `description` field that is not part of Tumblr's legacy photo post API. This field had previously been silently ignored but Tumblr appears to have started rejecting requests that include it. The field has been removed.

### Lemmy Probe List and Response Parsing Updates

Improvements to handle pict-rs 0.5+ and recent Lemmy API changes:

- The pict-rs 0.5 upload response changed the image identifier key from `file` to `identifier` inside the `files[0]` object. ShutterQueue now checks both fields.
- The probe list was reordered and expanded to try the current `lemmy-js-client` upload path (`POST /api/v4/image` with both `images[]` and `image` field names) before falling back to older combinations.

Note: Some instances (lemmy.world, lemmy.sdf.org, lemmy.ml) returned HTTP 502 or socket hang-up errors during testing. Those are server-side infrastructure failures outside ShutterQueue's control and are unrelated to these fixes.

### Lemmy Image Upload Fix

Lemmy uploads were failing on all endpoints for lemmy.world and most standard Lemmy instances. The root cause was a URL construction bug: the `/pictrs/image` upload endpoint returns just a bare filename (like `a1b2c3d4.jpeg`) with no path info. ShutterQueue was building the image URL as `https://lemmy.world/a1b2c3d4.jpeg`, when the correct serving URL is `https://lemmy.world/pictrs/image/a1b2c3d4.jpeg`. The probe was then checking the wrong URL, failing, and moving on to try all other endpoint combinations — all of which also failed for unrelated reasons. The fix ensures bare filenames from pictrs responses are given the correct `/pictrs/image/` path prefix before the URL is used.

---

## Previous Release: v0.9.7a (April 5, 2026)

macOS build compilation fix — addressed a build issue that prevented the app from building on macOS.

---

## Previous Release: v0.9.7 (April 4, 2026)

### Platform Status Indicators on Queue Cards

Queue cards now display upload status visually under each platform icon:

- ✓ (green) shown after a successful upload to that service
- ✗ (red) shown after a failed upload to that service
- No indicator shown while upload is still pending—only status after an actual attempt
- Status markers now clear correctly when resetting a failed item's upload status via the Retry / Reset dialog

### File Missing Badge

Queue cards now show a red `File Missing` badge when the file at the stored path can no longer be found.

### Bluesky Token Refresh Fix

Bluesky uploads with an expired access token now recover correctly:

- Fixed a variable scoping bug that caused a crash (`blueskyPostTextMode is not defined`) during the token-refresh retry path
- After a successful token refresh the upload now retries automatically with the new access token

### Lemmy Community Picker Stability

- Community list is always alphabetically ordered and stays stable while you click through it
- Selected communities bubble to the top only when re-opening the picker for an item that already has saved selections, not on first open

### Lemmy Upload Reliability

Several fixes combine to prevent ShutterQueue from reporting a Lemmy post as successful when the image link was actually broken:

- Image URL returned by the upload endpoint is now normalized to an absolute URL before the post is created
- URL is quality-checked: API endpoint-style paths are no longer mistaken for image URLs
- A live network probe confirms the URL actually returns an image (`image/*`) before the post creation request is sent
- If the URL does not resolve as an image, ShutterQueue automatically tries other upload endpoint/field-name combinations (varying by Lemmy and pict-rs version)
- On first upload to a new instance ShutterQueue discovers and caches the working combination invisibly; subsequent uploads skip the probing step entirely
- If every combination fails, the error message includes full per-attempt diagnostics (endpoint, field name, HTTP status, content-type) to aid diagnosis

### Lemmy Failure Message Improvements

- Per-community errors now show the community name and instance host instead of a bare numeric ID
- Known Lemmy error codes are translated to readable text (e.g. `only_mods_can_post_in_community` → "Only moderators can post in this community")
- `invalid_url` errors now immediately stop remaining community attempts with a clear explanation

### In-App Lemmy Unreliability Warning

An amber warning banner is now shown in two places so users know upfront that Lemmy support is still a work in progress:

- **Lemmy Settings panel** — permanent banner at the top of Lemmy setup, always visible
- **Lemmy tab in the queue editor** — appears in both batch and single-item edit modes whenever the Lemmy tab is active

Banner text: *"Lemmy integration is still unreliable. Images may not display correctly on Lemmy posts."*

### Flickr Group-Only Entry Preservation

Items that were kept in Flickr group retry queues (`group_only` status) are now correctly preserved through:

- Queue import in replace mode
- Remove from queue
- Clear Uploaded

### Strict File Path Handling for Delete

- File path resolution no longer falls back to case-insensitive filename guessing
- Delete is blocked when any selected item has a missing or unmapped file path

---

## What's New in 0.9.7

### Delete Original Files to Recycle Bin / Trash Can

Queue removal can now move the original source files to your OS recycle location with explicit safety confirmations:

- Added a pre-warning if any selected files have not been uploaded yet, with `Yes, continue to delete` and `Cancel`
- Added a typed confirmation requirement (`Delete N`) before destructive file removal is allowed
- Added OS-aware destination behavior: files are moved to `Recycle Bin` on Windows/Linux and `Trash Can` on macOS
- Added completion popup confirming how many files were moved
- Added explicit recovery guidance in the completion popup so users know they can recover files from the `Recycle Bin` / `Trash Can`

### Spell-Check Suggestions Restored in Custom Context Menus

Text input right-click menus now keep both editing controls and spelling assistance:

- Restored misspelling suggestions when right-clicking underlined words in editable fields
- Added `Add to Dictionary` in the same menu
- Retained custom edit actions: Undo/Redo/Cut/Copy/Paste/Delete/Select All

### Legacy Queue Import Thumbnail Compatibility Fix

Older exported queue JSON files can now resolve thumbnails more reliably after import:

- Import now recognizes legacy path keys (`path`, `filePath`, `sourcePath`) in addition to `photoPath`
- Legacy `file://` and encoded photo paths are normalized during import so local file lookups can succeed

### Automatic Missing-Folder Relink Prompt

When queue entries point to files that no longer exist at their expected paths (including stale queues after restart), ShutterQueue now prompts automatically:

- Shows a folder-specific statement: `Can't find the files in XX. Select the new folder where they are and ShutterQueue will try to relink by matching filenames.`
- Relinks missing items by filename from the selected folder while preserving already-valid queue entries
- If unresolved files remain from a different missing source folder, the dialog reappears for that folder
- Shows a clear summary of relinked, unresolved, and ambiguous filename matches

### Queue Item Settings Copy/Paste

Queue item context menus now support reusable settings transfer:

- Added `Copy Settings` for single-item selection
- Added `Paste Settings` for single-item and multi-select targets when copied settings exist
- Paste updates are integrated with queue undo support

### Flickr Group Info Popups

Flickr group lists now include quick info dialogs so you can review group details without leaving the app:

- Added `i` actions next to group names in Setup and Queue editor group lists
- Added popup sections for Additional Info, Group Rules, Admin Blast, and Group Description
- Added member/photo counts and an `Open Group Overview` button
- Added safe HTML rendering with confirmation prompts before opening external links

### Light Theme Mode

Setup now includes a persisted light-mode switch:

- Added `Use Light Theme` toggle in Setup
- Added blue-accent light palette with contrast tuning for text, borders, and surfaces
- Improved selected queue-item visibility in light mode

### Lemmy Support

ShutterQueue now includes initial Lemmy posting support:

- Added Lemmy setup fields (instance URL + access token) with authorization test/logout
- Added subscribed-community loading/refresh in Setup
- Added Lemmy community selection in single-item and batch editors
- Added Lemmy upload pipeline support for image posts
- Added platform-specific bottom editor tabs so Flickr and Lemmy unique fields can be switched cleanly when both are enabled
- Clarified current token retrieval steps in Setup help:
	- sign in on your Lemmy instance in browser
	- open DevTools (`F12`) -> `Application` / `Storage` -> `Cookies`
	- copy the `jwt` cookie value and paste it into ShutterQueue
	- re-copy a fresh `jwt` token if authorization fails later due to expiration

### Queue Undo Added

Queue tab editing now includes queue-level undo for major user edits:

- Added Undo support for metadata edits, queue reorder actions, sort actions, and shuffle actions
- Ctrl+Z now uses the same app undo stack as the Queue tab Undo button
- Consecutive text edits are grouped so undo behaves like field-level edits rather than keystroke-by-keystroke reversal
- Multi-select edit controls now stay in sync after undo so reverted values show immediately in the editor panel

### Larger Queue Thumbnails by Default

The Queue tab now uses larger thumbnails by default so images are easier to scan visually:

- Queue thumbnails now default to a larger 3:2 presentation in the queue list
- Setup now includes a `Use Small Thumbnails` option if you want to switch back to the previous compact square thumbnails

### Date Taken Sorting Fix

Date Taken sorting now correctly reorders selected subsets when photo capture timestamps are present as EXIF-style datetime strings:

- Date-based sorting now recognizes EXIF-style formats like `YYYY:MM:DD HH:MM:SS`
- Existing queue and imported items now normalize parseable capture dates for consistent date sorting
- Date Taken sort in the Queue tab now applies reliably for full-queue sorting
- Date Taken sort in the Queue tab now applies reliably for selected-subset sorting

### Close Warning for Pending Scheduler Work

If the scheduler is active and there are still queue items not yet uploaded, closing the app now prompts with:

- Close the app
- Minimize to Tray
- Return to App

### Notes

- This release combines safer file deletion controls, context-menu/spell-check reliability, richer Flickr metadata UI, light-theme support, and initial Lemmy integration.
- Features listed in prior release notes remain available in 0.9.7b.

## Download & Install

Releases are available at: https://github.com/pwnicholson/shutterqueue/releases

Windows users should download the `.exe` installer. macOS users should look for the `.dmg` file.

## Bug Reports & Feedback

Found an issue? Have a feature request? Please open an issue on GitHub:
https://github.com/pwnicholson/shutterqueue/issues

---

**Previous versions:** See [CHANGELOG.md](CHANGELOG.md) for version history.
