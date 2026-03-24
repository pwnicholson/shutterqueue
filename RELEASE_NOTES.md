# ShutterQueue v0.9.6 Release Notes

**Release Date:** March 24, 2026

## What's New in 0.9.6

### PixelFed: OAuth 2.0 Browser Authorization

PixelFed authorization has been migrated from a manual personal access token flow to a full **OAuth 2.0 Authorization Code flow**:

- Click **Connect with PixelFed**, approve access in your browser, then click **Complete Authorization** — no manual token copying required
- ShutterQueue registers itself with your PixelFed instance automatically and handles the token exchange
- The old manual token entry UI has been removed

### Per-Platform Prepend / Append Text

Each platform's Setup tab now has **prepend** and **append** text fields. Text entered here is added before or after every post body on that platform — useful for consistent disclaimers, signatures, or hashtag lines across all uploads:

- Bluesky: prepend / append text fields
- Mastodon: prepend / append text fields
- PixelFed: prepend / append text fields
- Tumblr: prepend / append text fields

### Global Tags per Platform

- **Flickr:** A new *"Add these tags to every post on Flickr"* field in Setup appends a fixed comma-separated tag list to every Flickr upload
- **Tumblr:** A new *"Add these tags to every post on Tumblr"* field does the same for Tumblr

### Queue UX Improvements

- **Ctrl+A / ⌘+A in queue tab** selects all items in the queue (when no text input is focused)
- **"No platform selected" badge** shown on queue items that have no target platform set, making misconfigured items easy to spot
- **"Flickr Groups with Pending Retries"** section heading clarified to indicate it is Flickr-specific

### General Settings Additions

- **"Automatically resume scheduler on app restart"** checkbox added under General App Settings
- **"Clear thumbnail and preview cache"** button added to manually purge cached images when needed

### Other Fixes and Polish

- Toast notifications are now **fixed-position** (top-right overlay) instead of shifting page layout
- Footer disclaimer updated: *"Not an official app for any included service"* (was Flickr-specific)
- Default Electron application menu removed for a cleaner windowed experience
- `clearImageCache` exposed to the renderer so cache clearing works end-to-end

## Security & Privacy

All platform credentials are encrypted at rest using your OS's native credential storage (Windows DPAPI, macOS Keychain, or Linux credential store). OAuth tokens and API secrets are never stored in plain text.

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
1. Enter your PixelFed instance URL on the Setup tab
2. Click **Connect with PixelFed** to open browser authorization
3. Approve access on your PixelFed instance
4. Return to ShutterQueue and click **Complete Authorization**

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
