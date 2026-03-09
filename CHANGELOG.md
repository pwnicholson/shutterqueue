# Changelog

All notable changes to ShutterQueue will be documented in this file.

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
