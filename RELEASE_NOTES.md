# ShutterQueue v0.9.6c Release Notes

**Release Date:** March 26, 2026

## What's New in 0.9.6c

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
- Features listed in prior release notes remain available in 0.9.6c.

## Download & Install

Releases are available at: https://github.com/pwnicholson/shutterqueue/releases

Windows users should download the `.exe` installer. macOS users should look for the `.dmg` file.

## Bug Reports & Feedback

Found an issue? Have a feature request? Please open an issue on GitHub:
https://github.com/pwnicholson/shutterqueue/issues

---

**Previous versions:** See [CHANGELOG.md](CHANGELOG.md) for version history.
