# Changelog

All notable changes to ShutterQueue will be documented in this file.

## [0.9.3b] - 2026-03-13

### Added
- **Queue backup import/export**
  - Added JSON export/import for the full queue so you can save a backup and restore it later when files are still available at the same paths
  - Import now prompts whether to append to the existing queue or replace it, then runs duplicate detection so new duplicate collisions are flagged immediately

### Changed
- **Local image and preview performance enhancements**
  - Local queue images now use cached protocol-backed sources instead of heavy inline image payloads
  - Thumbnail and preview generation/use was optimized for faster open and smoother scrolling in larger queues
  - Added automatic image-cache pruning when queue items are removed or cleared to prevent stale cache growth
- **Queue tab split-pane scrolling**
  - Queue controls now stay fixed at the top of the queue pane while the queue list scrolls independently
  - The edit panel now has its own independent scroll area so queue navigation and metadata editing no longer fight for one page scroll

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
