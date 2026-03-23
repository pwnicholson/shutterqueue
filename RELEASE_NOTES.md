# ShutterQueue v0.9.5 Release Notes

**Release Date:** March 20, 2026

This is a major release introducing comprehensive multi-platform support, turning ShutterQueue from a Flickr-focused uploader into a unified photo-sharing tool for popular decentralized and commercial platforms.

## What's New in 0.9.5

### Major Features

#### 🚀 Multi-Platform Photo Uploading
ShutterQueue now supports uploading to **five major photo-sharing platforms** from a single queue:
- **Flickr** — the original platform with full feature support
- **Tumblr** — with blog selection, public/private visibility, and mature content tagging
- **Bluesky** — with optional threaded long-post mode for text-heavy descriptions
- **Mastodon** — with federated instance selection and privacy-aware posting
- **PixelFed** — with basic support (currently untested in live use)

**Per-item platform targeting:** Each queued photo can target one or multiple platforms. The queue respects capability differences, so unsupported features on selected platforms are called out without blocking the upload.

#### 🎯 Capability-Aware Upload Behavior
The app now understands what each platform supports and behaves intelligently:
- **Privacy mapping:** Automatically maps privacy levels to platform conventions (e.g., Flickr's public/private → Mastodon's public/private/unlisted)
- **Safety/content warnings:** Maps photo safety levels to each platform's content labeling system (Safe → Bluesky adult flag, Moderate/Restricted → Tumblr/Mastodon mature flags)
- **Location handling:** Warns only when explicit location data is set and none of the selected targets support location tagging (Flickr is the only location-capable platform currently supported)
- **Partial success:** If one platform fails, others still upload; you can retry failed targets without re-uploading successful ones

#### 📝 Per-Platform Post Composition
Each platform has its own posting options:
- **Post-text modes:** Choose whether to merge title/description/tags, include only title, etc.
- **Long-post handling (Bluesky):** Truncate text to character limit or split into a thread
- **Alt-text behavior:** Optional description-as-alt-text for image accessibility where supported
- **Hashtag insertion:** Optional automatic ShutterQueue hashtag for all uploads
- **Tags behavior:** Platform-specific hashtag formatting (safe spaces converted to underscores, etc.)

#### 🔐 Platform-Aware Setup and Authorization
Setup tab now uses dedicated tabs for each platform:
- **Flickr:** OAuth flow with API key/secret setup
- **Tumblr:** OAuth flow with blog selection and refresh
- **Bluesky:** Personal access token or app password
- **Mastodon:** Instance URL + personal access token with scope guidance
- **PixelFed:** Instance URL + personal access token

Each platform shows its auth status, can be logged out independently, and stores encrypted credentials locally.

### Key Improvements

#### Enhanced Queue Management
- **Target-service selection:** Batch-edit platform selections alongside metadata for multi-select items
- **Per-service upload state tracking:** Uploading to multiple platforms? Each platform's success/failure is tracked independently
- **Service normalization:** Robust handling ensures target platforms are preserved correctly across queue save/load
- **Regression protection:** New queue normalization tests prevent silent breakage as new platforms are added

#### Location Warnings (Refined)
- Location warnings only appear when you've explicitly set a location AND none of your selected targets support location tagging
- No warning when mixing Flickr (location-capable) with other platforms that lack location support
- Clearer warning message: *"Location data was set on this item, but none of the selected platforms support location tagging. The post was uploaded without location data."*

#### Update Checking
- New version notices now hotlink directly to the GitHub release page when you click them
- Notices include icon indicator showing which platforms are currently configured
- Update check can run automatically on launch or manually from Setup

#### UI Clarity
- Platform chips (Flickr "F", Tumblr "T", etc.) appear throughout the app showing target platforms
- Group/Album/Location sections now show *"Flickr only"* hints when non-Flickr platforms are selected
- Safety levels shown with platform-specific labels (Moderate/Mature, Restricted/Mature, etc.)
- Improved tag guidance: *"Multi-word tags are supported. Don't use a '#' — we'll add it for you where needed."*

#### Metadata Auto-Prefill
- Embedded EXIF/IPTC/XMP metadata is automatically read from new queue items
- Supported fields: title, description, GPS geotags, keywords/tags
- Falls back to filename for title and leaves description blank if not in metadata

#### Performance
- Queue tab stays responsive with hundreds of items thanks to deferred thumbnail loading
- Real resized thumbnails instead of embedded full images
- Automatic image-cache cleanup when items are removed

### Testing & Reliability

#### New Test Coverage
- Service-specific tests for Bluesky, PixelFed, and Mastodon
- Queue normalization regression tests ensuring platforms are preserved correctly
- All tests pass with `npm test`

#### Known Limitations
- **PixelFed:** Support has been added but has not yet been tested in live use. Reports of issues or confirmation of working instances are welcome.
- **Location tagging:** Currently only Flickr supports location metadata in uploads. This is a platform limitation, not a ShutterQueue limitation.

## Security & Privacy

All platform credentials are encrypted at rest using your OS's native credential storage (Windows DPAPI, macOS Keychain, or Linux credential store). OAuth tokens and API secrets are never stored in plain text.

## Getting Started with New Platforms

1. Navigate to the **Setup tab**
2. Find the platform you want to authorize (Tumblr, Bluesky, Mastodon, or PixelFed)
3. Enter required credentials and click the platform-specific authorization button
4. Complete the OAuth flow in your browser (your password is never shared with ShutterQueue)
5. Once authorized, you can select that platform as a target for queue items

### Flickr Setup (unchanged)
Still requires an API key/secret from https://www.flickr.com/services/

### Tumblr Setup
Requires Consumer Key and Consumer Secret from https://www.tumblr.com/oauth/apps

### Bluesky Setup
Use personal access token or app password from https://bsky.app/settings/app-passwords

### Mastodon Setup
1. Go to your Mastodon instance's settings
2. Generate a personal access token with at least: `read:accounts`, `write:media`, `write:statuses`
3. Enter your instance URL (e.g., mastodon.social) and the token

### PixelFed Setup
Similar to Mastodon—your instance URL + personal access token

## Download & Install

Releases are available at: https://github.com/pwnicholson/shutterqueue/releases

Windows users should download the .exe installer. macOS users should look for the .dmg file.

## Bug Reports & Feedback

Found an issue? Have a feature request? Please open an issue on GitHub:
https://github.com/pwnicholson/shutterqueue/issues

## Thanks

Thanks to all the testers and contributors who helped make this release possible. Special appreciation for the many humans and AI assistants who helped shape the multi-platform vision.

---

**Previous versions:** See [CHANGELOG.md](CHANGELOG.md) for version history.
