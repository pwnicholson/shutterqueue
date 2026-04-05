# Changelog

All notable changes to ShutterQueue will be documented in this file.

## [0.9.7a] - 2026-04-05

### Fixed
- **Lemmy image upload broken on lemmy.world and most instances**
  - The `/pictrs/image` upload endpoint returns a bare filename (e.g. `uuid.jpeg`) with no path in the response
  - ShutterQueue was incorrectly constructing `https://instance/uuid.jpeg` instead of the correct `https://instance/pictrs/image/uuid.jpeg`
  - All 11 endpoint combinations were failing because the URL probe was checking the wrong URL
  - Fix: bare filenames from `/pictrs/image` responses are now prefixed with `/pictrs/image/` before URL normalization

### Changed
- **Version bump to 0.9.7a**
  - Bumped local app version to `0.9.7a` in package/build metadata and UI fallback version display

### Tests
- Added regression test for pictrs bare filename path prefixing

## [0.9.7] - 2026-04-04

### Added
- **Original file deletion flow with strong safeguards**
  - Added queue action flow to move selected original files to the OS bin (`Recycle Bin` on Windows/Linux, `Trash Can` on macOS) instead of permanently deleting them
  - Added a typed confirmation modal that requires an exact phrase (`Delete N`) before the Delete action can be executed
  - Added a pre-warning modal when selected items include photos that have not been uploaded yet
  - Added a completion popup confirming how many files were moved to the OS bin
- **Missing-file relink helper for imported queues**
  - Added automatic relink prompts when queued files are missing, with one prompt per missing source folder
  - Prompts now state: `Can't find the files in XX. Select the new folder where they are and ShutterQueue will try to relink by matching filenames.`
  - Selecting a folder remaps missing queue file paths by filename, preserving already-valid items and prompting again only if unresolved folders remain
  - Added relink result summaries (relinked, unresolved, and ambiguous filename matches)
- **Queue item settings copy/paste tools**
  - Added `Copy Settings` for single-item context menus
  - Added `Paste Settings` for single-item and multi-select context menus when copied settings are available
  - Paste applies via existing queue update flow so undo behavior remains consistent
- **Flickr group info dialogs in Setup and Queue editors**
  - Added per-group info action to open a rich group info dialog (description, rules, additional info, admin blast, member/photo counts)
  - Added safe HTML rendering and external-link confirmation prompts inside the dialog
  - Added direct `Open Group Overview` fallback action for full group pages
- **Lemmy platform integration (setup + upload + editor)**
  - Added Lemmy setup/auth fields (instance URL + access token) with account test/logout
  - Added subscribed-community loading and refresh from Lemmy API (including federated/remote communities)
  - Added per-item Lemmy community selection in batch and single-item editors
  - Added Lemmy upload pipeline branch for image posts with service-state tracking and error/warning handling
  - Added platform-specific bottom editor tabs so Flickr and Lemmy fields can be shown independently when both services are selected
  - Added in-app warning banners noting that Lemmy integration is still unreliable
- **Selective queue removal with Flickr group retry preservation**
  - Added ability to remove items from the main queue while keeping them in scheduled Flickr group addition/retry operations
  - When removing items that have pending group retries, shows a modal with three options: "Cancel", "Keep In Group Queues Only" (marks item as `group_only`), or "Remove All"
  - Items marked as `group_only` remain invisible in the main queue but continue processing group operations until those complete
  - Auto-cleans `group_only` items once all group retry states complete
- **Per-platform upload status indicators on queue cards**
  - Added ✓ (success) and ✗ (failed) markers under platform icons on each queue card
  - Markers only appear after an upload has been attempted; pending items show no marker
- **File Missing badge on queue cards**
  - Queue cards now display a red `File Missing` badge when the file at the stored path cannot be resolved

### Changed
- **Version bump to 0.9.7**
  - Bumped local app version to `0.9.7` in package/build metadata and UI fallback version display
- **Delete completion guidance**
  - Updated the delete-complete popup to explicitly tell users files can be recovered from the OS `Recycle Bin`/`Trash Can`
- **Native text context menu parity**
  - Restored spell-check suggestions and `Add to Dictionary` entries in the custom right-click text menu while keeping Undo/Redo/Cut/Copy/Paste/Delete/Select All
- **Theme support and setup controls**
  - Added a persisted `Use Light Theme` setup toggle
  - Added light-theme palette tuning and contrast updates, including stronger selected-item outlines

### Fixed
- **Legacy queue import thumbnail compatibility**
  - Import normalization now accepts older path keys (`path`, `filePath`, `sourcePath`) and normalizes legacy `file://` / encoded photo paths so thumbnail generation can resolve older exported queues reliably
- **Missing relink no-op edge case**
  - Fixed relink behavior when ID filters were passed as an empty list so relinking now applies correctly instead of matching nothing
- **Flickr group-only items preserved through all queue operations**
  - Import (replace mode), `Remove`, and `Clear Uploaded` no longer destroy `group_only` queue entries
  - `group_only` status now recognized as valid during queue normalization on JSON import
- **Original file delete now uses strict path matching only**
  - Removed case-insensitive filename fallback from file path resolution to prevent accidental mismatched deletions
  - Delete action is blocked entirely when any selected item has a missing or unmapped file path
- **Platform status markers reset correctly with queue status**
  - Resetting a failed queue item's status via the Retry/Reset dialog now clears all per-service ✓/✗ markers
- **Bluesky token refresh retry now works reliably**
  - Fixed a variable scoping bug where post composition options (post text mode, alt text, resize options) were declared inside the `try` block, causing a `ReferenceError` in the token-refresh retry code path
  - Auto-refresh on `ExpiredToken` now correctly retries the full upload with the refreshed access token
- **Lemmy community picker sort stability**
  - Community list is always alphabetically ordered
  - Clicking items no longer causes the list to jump mid-interaction
  - Selected communities are promoted to the top only when re-opening the picker for an item that already has a saved selection (not on first open)
- **Lemmy upload image URL validated before post creation**
  - Upload response URL is normalized to an absolute instance URL
  - URL candidates from the upload response are ranked and quality-checked; API endpoint-style paths are rejected as image URLs
  - A live HTTP probe verifies each candidate URL actually returns image content (`image/*` content-type) before submitting the post
  - If all upload endpoint/field combinations fail to produce a valid image URL, the failure message includes full per-attempt diagnostics (endpoint, field name, HTTP status, content-type, reason)
- **Lemmy upload endpoint discovery is now self-healing per instance**
  - On first upload to an instance, ShutterQueue probes working endpoint + field-name combinations (which vary by Lemmy and pict-rs version)
  - The working combination is cached per instance URL and reused automatically on subsequent uploads
  - Cache survives app restarts (30-day TTL); stale or broken entries fall back to re-probing transparently
- **Lemmy failure messages now show community name instead of numeric ID**
  - Per-community errors now include the resolved community title, short name, and instance hostname
  - Known Lemmy error codes are translated to readable text (e.g. `only_mods_can_post_in_community` → "Only moderators can post in this community")
  - `invalid_url` errors immediately halt remaining community attempts with a clear explanation

### Tests
- Added Lemmy regression tests covering URL candidate ranking, image-URL heuristics, and candidate collection ordering

## [0.9.6b] - 2026-03-26

### Changed
- **Local development version rev and metadata alignment**
  - Bumped local app version to `0.9.6b` in package/build metadata and UI fallback version display
- **Queue undo UX and shortcut parity**
  - Added queue-level Undo controls for major queue edits (metadata edits, reorder, sort, and shuffle)
  - Ctrl+Z now routes through the same queue undo stack as the Undo button on the Queue tab
  - Consecutive text edits are coalesced so undo reverts a full field edit instead of stepping per keystroke
- **Queue thumbnail display defaults**
  - Increased the default queue thumbnail size to a larger 3:2 presentation for better image visibility in the queue list
  - Added a Setup option to re-enable the old small square thumbnails (`Use Small Thumbnails`)

### Fixed
- **Date Taken sorting reliability for subset selection**
  - Fixed Date Taken sorting so selected subsets now reorder correctly when capture dates are stored in EXIF-style timestamp formats
  - Queue-load and import normalization now convert parseable capture dates into ISO format for consistent sorting behavior
- **Queue edit panel stale-value issues during undo**
  - Fixed batch/single edit panel fields that could show stale values after undo while data had already reverted
- **Close behavior warning when work is pending**
  - Closing the window while scheduler is active and pending queue work exists now prompts with: Close the app, Minimize to Tray, or Return to App

### Tests
- Added queue date parsing regression tests covering EXIF-style timestamps and explicit timezone offsets

## [0.9.6a] - 2026-03-24

### Added
- **Tumblr post timing preference in Setup**
  - Added a Setup option to publish immediately or send uploads to the selected Tumblr blog queue
- **Queue reorder shortcuts in item context menu**
  - Added `Move to Top` and `Move to Bottom` actions to the queue item context menu
- **Dev-only runtime session badge**
  - Added a small `DEV HH:MM:SS` footer badge when running via `npm run dev`

### Changed
- **Local development version rev and metadata alignment**
  - Bumped local app version to `0.9.6a` in package/build metadata and UI fallback version display
- **Queue reorder UX feedback**
  - Queue drag targets now show a clearer insertion line and a count badge during multi-item moves

### Fixed
- **Major bug fix: queue reordering now applies reliably and stays visually in sync**
  - Fixed queue drag-and-drop so moves now apply reliably and the visible order stays in sync with the real queue order
  - Manual reordering, sorting, shuffle, and schedule-driven moves now stay visually consistent
- **Queue drag/drop visual reliability**
  - Fixed drag indicators so the multi-item count badge stays visible during reordering
- **Update-available notice stale-cache behavior after app upgrade**
  - Fixed stale cached update notices after upgrading so the app reports the correct current version
- **Loose semver comparison for local letter-suffix versions**
  - Fixed version comparison logic so versions like `0.9.6a` are correctly recognized as newer than `0.9.6` in update checks
  - The semver parser now captures and compares letter suffixes, enabling proper ordering of pre-release and local version strings

### Tests
- Added update-check regression tests covering:
  - stale cached update notices after version change
  - local letter-suffix version comparisons (for example `0.9.6a`)

## [0.9.6] - 2026-03-24

### Added
- **New platform support since 0.9.3c: Tumblr, Bluesky, PixelFed, and Mastodon**
  - Added full setup/auth flows for all four services with encrypted credential storage
  - Added per-service account verification/logout actions, status indicators, and platform chips
  - Added Tumblr OAuth/browser callback improvements plus Tumblr blog selection/refresh integration
- **Multi-platform queue targeting and service-aware upload behavior**
  - Added target-platform selection in single-item and batch editors
  - Added per-service upload state tracking so each item can partially succeed across mixed targets
  - Added normalized target-service handling across queue/main flows so selected platforms are preserved consistently
- **Capability-aware posting across platforms**
  - Added service-specific privacy and sensitivity handling, including automatic mapping/warnings when a platform does not support a selected option
  - Added capability-aware upload warnings, including location warnings only when explicit location data exists and none of the selected targets support location tagging
  - Added safer mixed-target behavior so capabilities are applied where supported without blocking other selected targets
- **Per-platform post composition and accessibility controls**
  - Added post-text composition modes for Tumblr, Bluesky, PixelFed, and Mastodon
  - Added Bluesky long-post handling modes (truncate vs thread)
  - Added optional Description -> alt text/image description behavior for supported services
  - Added optional automatic ShutterQueue hashtag/tag insertion for uploads
- **Capability-aware editor and setup UX improvements**
  - Added service-tabbed Setup flows for Flickr/Tumblr/Bluesky/PixelFed/Mastodon
  - Added clearer Flickr-only field hints and service-aware safety labeling in editors
  - Added updated tag guidance: "Multi-word tags are supported. Don't use a '#' - we'll add it for you where needed."
  - Added improved global notice/error banners and update-available notice handling
- **Test coverage and regression protection**
  - Added npm test command (`npm test`) for electron service tests
  - Added Bluesky/PixelFed/Mastodon service tests plus queue target-service normalization regression tests

## [0.9.3c] - 2026-03-15

### Added
- **Queue backup import/export**
  - Added JSON export/import for the full queue so you can save a backup and restore it later when files are still available at the same paths
  - Import now prompts whether to append to the existing queue or replace it, then runs duplicate detection so new duplicate collisions are flagged immediately
- **Embedded image metadata prefill on add**
  - New queue items now read embedded EXIF/IPTC/XMP title/description metadata when present and prefill those fields automatically
  - Embedded GPS geotags are also read automatically and prefill location coordinates for upload
  - Embedded keywords/tags are now imported and prefilled into each queue item's Tags field
  - If metadata is missing, title continues to default from filename and description remains blank

### Changed
- **Local image and preview performance enhancements**
  - Local queue images now use cached protocol-backed sources instead of heavy inline image payloads
  - Thumbnail and preview generation/use was optimized for faster open and smoother scrolling in larger queues
  - Added automatic image-cache pruning when queue items are removed or cleared to prevent stale cache growth
- **Queue tab split-pane scrolling**
  - Queue controls now stay fixed at the top of the queue pane while the queue list scrolls independently
  - The edit panel now has its own independent scroll area so queue navigation and metadata editing no longer fight for one page scroll
- **Queue sorting options**
  - Added Date Taken sorting (Old-New / New-Old) using embedded capture timestamps when available

### Fixed
- **Batch metadata consistency and selection-state correctness**
  - Fixed mixed/single selection mismatch where title/description fields could appear inconsistent across selection modes
  - Multi-select title/description/privacy/safety editing now behaves consistently and applies correctly to the selected cohort
  - Fixed saved tag sets in multi-select so choosing a set loads its tags into the batch add-tags field, and saving a tag set now uses the tags currently entered there
- **Queue backup import and thumbnail recovery**
  - Imported queue backups now let you choose whether to replace the current queue or add to it, with duplicate detection running immediately afterward
  - Thumbnail state is now refreshed after queue clear/import flows so missing or broken local thumbs regenerate correctly
- **Create-album workflow and upload behavior**
  - Fixed missing visibility for queued new-album creation in the Albums editor list
  - New album rows now appear with a distinct red `New` indicator and are fully selectable in edit flows
  - New albums are now actually created during upload when referenced, and are not created when no queued photos reference them
- **Saved tag-set dialog naming input**
  - Fixed the save-set name field to reliably take focus and accept typing when creating or overwriting a saved tag set

### UI
- **Batch edit experience improvements**
  - Replaced confusing single "Apply to selected" behavior with clearer field-specific actions and live updates where appropriate
  - Added dedicated compact action buttons for batch tag add and batch create-album add next to their corresponding fields
  - Tuned the new-album `New` badge size for cleaner visual hierarchy

## [0.9.3] - 2026-03-12

### Added
- **Queue sorting controls**
  - Shuffle the full queue or just the current multi-selection
  - Sort by full filename/path in either direction
  - Sort by title in either direction, with filename fallback when no title is set

### Changed
- **Major queue performance improvements**
  - Queue tab stays responsive with much larger queues
  - Thumbnail loading now happens in deferred batches instead of blocking the renderer
  - Actual resized thumbnails are generated instead of embedding full source images as preview data
  - Background queue refresh polling is less aggressive when the app is idle
- **Better large-queue rendering behavior**
  - Queue rows are cheaper to render and stay more responsive while thumbnails continue loading
  - Startup and queue-tab open behavior are noticeably smoother, especially with hundreds of queued photos

### Fixed
- **Queue sorting and scheduling behavior**
  - Single-item selection now behaves like full-queue sort/shuffle as intended
  - Manual schedules return items to the correct chronological place in the queue
  - Clear manual schedule only enables for selected scheduled items and only clears those selected items
- **Queue tab startup interaction glitch**
  - Reduced the odd first-open queue tab focus/interaction issue seen immediately after app launch

## [0.9.2] - 2026-03-09

### Added
- **Geotagging support (OpenStreetMap/Nominatim + Flickr geo APIs)**
  - Location search for single-item edit
  - Batch location set/clear for multi-selection
  - Geo privacy controls for both single-item and batch flows
  - Automatic Flickr geo accuracy mapping and upload integration
- **Group scale indicators**
  - Group lists now include size context in labels (e.g. `Group Name (115k)`)
  - Member/photo count metadata retrieved via Flickr group info APIs
- **Check for new version feature**
  - Can be disabled or manually run on the Setup tab


### Changed
- **Faster startup list loading**
  - Group list now returns quickly, with counts refreshed in the background
  - Albums and groups auto-load independently on app launch so one does not block the other
- **Improved scrolling comfort in Queue tab**
  - Added extra bottom space to queue/edit areas so bottom controls remain fully visible after scrolling

### Fixed
- **Group/album display text normalization**
  - Decode HTML entity-encoded names/titles from Flickr (e.g. `&amp;` → `&`)
  - Added resilient handling for double-encoded entities and cached group name normalization

## [0.9.1] - 2026-03-09

### Added
- **Duplicate detection**: Hash-based duplicate detection that warns when attempting to add the same file (by content, not name) to the queue
  - Warning modal displays all duplicate sets with file paths
  - Options to keep duplicates or remove all but the first instance
  - Dismissed warnings are suppressed until items leave the queue

## [0.9.0] - 2026-03-09

### Added
- **Saved tag sets**: Create and save sets of tags that can be quickly applied to photos in batches
  - Full UI/UX parity with existing group/album saved sets
  - Dropdown menu for quick selection
  - Delete saved tag sets with confirmation dialog
  - Visual improvements: blue section dividers between edit sections in batch and single-item views

### Fixed
- Field order in single-item edit view now shows Title → Description → Tags → Privacy → Groups/Albums
- Improved button labels for all three saved set types: "Save entered Tags as a set", "Save selected Groups as a set", "Save selected Albums as a set"

## [0.8.1] - 2026-03-08

### Added
- **Queue item context menu**: Click the ⋮ (three-dot) menu button on any queue item to Remove, Upload Now, or Schedule items
- **Right-click context menu**: Full context menu support for Windows, Mac (right-click or ctrl-click)
- **Confirmation dialogs**: Remove Item now requires confirmation to prevent accidental deletion
- Multi-selection support for context menu actions

## [0.8.0] - 2026-03-07

### Added
- **Manual photo scheduling**: Items can now be scheduled for a specific upload time within the current queue
- **Enhanced visual feedback**: Added toast notifications and confirmation dialogs for user actions
- **Improved queue management**: Better UI/UX for group management and batch operations
- Automatically reorder manually scheduled items to their correct position when modified

## [0.7.9] - 2026-03-06

### Security
- **Encrypted credential storage**: Sensitive credentials (API Secret, OAuth tokens) now encrypted using Electron's `safeStorage` API
  - Windows: DPAPI encryption
  - macOS: System Keychain
  - Linux: User credential store

### Added
- **System tray support**: Minimize to system tray on Windows
- **Menu bar support**: Verified status menu bar on macOS

## Earlier versions

See [WISHLIST.md](WISHLIST.md) for completed features from earlier versions.
