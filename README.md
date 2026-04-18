# ShutterQueue — A paced photo uploader (v0.9.8a)

Releases can be downloaded on our Release page
https://github.com/pwnicholson/shutterqueue/releases

ShutterQueue is a powerful photo batch uploader for photographers and content creators who want to share their work across multiple social platforms simultaneously. Upload to Flickr, Tumblr, Bluesky, Mastodon, PixelFed, Lemmy, or any combination thereof with a single queue.

**Supported platforms:**
- Flickr (full feature support: groups, albums, location tagging)
- Tumblr (with blog selection and privacy controls)
- Bluesky (with threaded long-post support)
- Mastodon (with instance selection and privacy-aware behavior)
- PixelFed (tested and working in v0.9.8a, with OAuth 2.0 browser authorization)
- Lemmy (with subscribed-community picker, original + cross-post workflow, and auto-resize guidance)

Note that this is purely vibe-coded using a combination of different AI tools. I am very open to suggestions, feedback, and help optimizing the tool or adding features.

ShutterQueue is free to use. For Flickr uploads, you'll need to generate your own API key (free from Flickr). Each platform has its own OAuth setup through ShutterQueue's integrated setup flows.

## Summary of Key Features

- **Multi-platform posting with target selection**
  - Upload to any combination of Flickr, Tumblr, Bluesky, Mastodon, PixelFed, and Lemmy
  - Choose different platforms for each queued photo
  - Capability-aware warnings: unsupported features on selected platforms are called out without blocking the upload
  - Partial success handling: if one platform fails, others still upload

- **Lemmy original + cross-post workflow**
  - Select multiple Lemmy communities per queue item
  - First selected community is treated as the original post by default
  - Remaining selected communities are posted as cross-posts referencing the original post URL
  - In single-item Lemmy editor, selected communities show Original/Crosspost badges and support right-click "Switch to original post"
  - Lemmy defaults to manual image resize at 2000x2000 (recommended for stricter instances)

- **Rich metadata and content composition**
  - Add title, description, and tags (individually or in batches)
  - Save and reuse custom tag sets, group sets, and album sets
  - Per-platform post-text composition modes (merge title/description/tags, title-only, etc.)
  - Optional description-as-alt-text for accessibility across platforms
  - Platform-specific safety/mature content labeling (maps to each platform's conventions)
  - Automatic hashtag insertion option for all uploads

- **Advanced geotagging and location privacy**
  - Search and set upload location using OpenStreetMap/Nominatim
  - Separate privacy controls for photo content and location data
  - Automatic Flickr geo accuracy mapping
  - Location-aware warnings when uploading to platforms without location support

- **Advanced scheduler with flexible batching**
  - Set photo queue to upload every X number of hours (from 1 hour to 1 week)
  - Only upload on specific days of the week or times of day
  - Process in batches of X photos at a time (ex: upload 3 photos every 24 hours)
  - Manually schedule any photo for a specific upload time and date
  - Queue respects manual scheduling chronologically
  - Can be minimized to system tray (Windows) or Menu Bar (Mac) and run silently in the background

- **Queue management and reliability**
  - Content-based duplicate detection warns when adding the same file (by SHA-256 hash, not filename)
  - Export full queue to JSON for backup; import later with merge or replace options
  - Duplicate detection runs after import to flag new collisions immediately
  - Automatic image caching for fast queue navigation with hundreds of photos
  - Thumbnail auto-regeneration after queue operations

- **Flickr-specific features** (Groups & Albums)
  - Quickly add photos to any combination of your albums or groups
  - Save and recall custom sets of frequently used albums and/or groups
  - See group size (member/photo count) at a glance
  - Auto-retry for adding photos to groups when user hits the group's limit of photos per day/week/month


## Setup Process

1. First, install the app!

2. Go to the "Setup" tab in the app and follow the instructions for the platform you want to enable. You can enable any platform you wish and ignore the others. The capabilities and features of the app will adjust to the platforms you have set up.

## Security

As of v0.7.9 and going forward, ShutterQueue stores your sensitive credentials (API Secret, OAuth tokens) in an encrypted format using Electron's **`safeStorage` API**. This API leverages your operating system's native credential storage:

- **Windows**: Credentials are encrypted using the Windows Data Protection API (DPAPI)  
- **macOS**: Credentials are stored in the system Keychain
- **Linux**: Credentials are encrypted and stored in the user's credential store

This means your credentials are protected at the OS level and cannot be easily extracted from ShutterQueue's configuration files. Your API Key is stored in plain text (since it's public), but your API Secret and OAuth tokens are always encrypted at rest.

Note: If someone gains access to your computer's user account, they can still decrypt these credentials. This is a fundamental limitation of any local application.

## Licenses

The app includes a **View Third-Party Licenses** button in the Setup tab.



## New in 0.9.8a

- **Safer delete behavior**
  - Queue items are no longer removed if moving the original file to Recycle Bin fails.
  - Delete flow now reports moved, missing, and failed files more clearly.
- **Faster queue editing**
  - Added **Clone Queue Item** and **Reset Status** to the queue context menu.
  - Cloning keeps metadata and creates a fresh pending copy with no selected platforms.
- **Cleaner duplicate protection**
  - Added duplicate-platform confirmation for the same source image.
  - Batch conflicts now use one merged confirmation dialog instead of repeated popups.
- **Cleaner location warning UX**
  - Location-only capability notices (when selected targets do not support location) no longer trigger red queue-list errors.
  - These now appear as yellow detail notices without error-style queue indicators when uploads otherwise succeeded.
- **Faster delete feedback**
  - Typed delete confirmation now immediately shows a busy `Deleting...` state so clicks are acknowledged right away.
  - Recycle Bin failure retries are shorter in interactive deletes, so repeated failures return feedback sooner.



