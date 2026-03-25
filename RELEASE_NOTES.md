# ShutterQueue v0.9.6a Release Notes

**Release Date:** March 24, 2026

## What's New in 0.9.6a

### Major Queue Reordering Fix

Queue reordering has been stabilized so the order you see is the real queue order:

- Drag-and-drop reordering now applies reliably
- Manual moves, sorting, shuffle, and schedule-driven moves stay visually in sync
- Multi-item drag now shows a clear count badge while moving items

### New Queue Shortcuts

Right-click any queue item to quickly:

- **Move to Top**
- **Move to Bottom**

### Tumblr Queue Posting Option

Tumblr setup now includes a post timing option so uploads can either:

- publish immediately, or
- be added to the selected Tumblr blog queue

### Smarter Dev Build Visibility

When running with `npm run dev`, the footer now shows a small **DEV** runtime badge so it is easier to confirm that a fresh development build is actually running.

### Update Check Fixes

- Fixed stale cached update notices after upgrading
- Added support for local version strings like `0.9.6a` in update checks

## Download & Install

Releases are available at: https://github.com/pwnicholson/shutterqueue/releases

Windows users should download the `.exe` installer. macOS users should look for the `.dmg` file.

## Bug Reports & Feedback

Found an issue? Have a feature request? Please open an issue on GitHub:
https://github.com/pwnicholson/shutterqueue/issues

---

**Previous versions:** See [CHANGELOG.md](CHANGELOG.md) for version history.
