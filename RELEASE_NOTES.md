# ShutterQueue v0.9.6b Release Notes

**Release Date:** March 26, 2026

## What's New in 0.9.6b

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

- This release combines queue editing polish, thumbnail visibility improvements, and Date Taken sorting fixes.
- Features listed in prior release notes remain available in 0.9.6b.

## Download & Install

Releases are available at: https://github.com/pwnicholson/shutterqueue/releases

Windows users should download the `.exe` installer. macOS users should look for the `.dmg` file.

## Bug Reports & Feedback

Found an issue? Have a feature request? Please open an issue on GitHub:
https://github.com/pwnicholson/shutterqueue/issues

---

**Previous versions:** See [CHANGELOG.md](CHANGELOG.md) for version history.
