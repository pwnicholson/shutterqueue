# ShutterQueue — A paced photo uploader (v0.9.6)

Releases can be downloaded on our Release page
https://github.com/pwnicholson/shutterqueue/releases

ShutterQueue is a powerful photo batch uploader for photographers and content creators who want to share their work across multiple social platforms simultaneously. Upload to Flickr, Tumblr, Bluesky, Mastodon, PixelFed, or any combination thereof with a single queue.

**Supported platforms:**
- Flickr (full feature support: groups, albums, location tagging)
- Tumblr (with blog selection and privacy controls)
- Bluesky (with threaded long-post support)
- Mastodon (with instance selection and privacy-aware behavior)
- PixelFed (tested and working in v0.9.6, with OAuth 2.0 browser authorization)

Note that this is purely vibe-coded using a combination of different AI tools. I am very open to suggestions, feedback, and help optimizing the tool or adding features.

ShutterQueue is free to use. For Flickr uploads, you'll need to generate your own API key (free from Flickr). Each platform has its own OAuth setup through ShutterQueue's integrated setup flows.

## Summary of Key Features

- **Multi-platform posting with target selection**
  - Upload to any combination of Flickr, Tumblr, Bluesky, Mastodon, and PixelFed
  - Choose different platforms for each queued photo
  - Capability-aware warnings: unsupported features on selected platforms are called out without blocking the upload
  - Partial success handling: if one platform fails, others still upload

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

- **Flickr-specific features** (Groups & Albums)
  - Quickly add photos to any combination of your albums or groups
  - Save and recall custom sets of frequently used albums and/or groups
  - See group size (member/photo count) at a glance
  - Auto-retry for adding photos to groups when user hits the group's limit of photos per day/week/month

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



## Setup Process

First, install the app!

1. ✅ Go to Flickr's Developer Page (usually https://www.flickr.com/services/ ) and click "Get an API key"

   * Choose "Non-commercial" for your key type
   * Name the app whatever you like (I suggest something like "ShutterQueue - \[your user name]"
   * Read and acknowledge the Flickr terms (and seriously, don't use this tool to abuse the API!)

2. ✅ Copy the API Key into the ShutterQueue setup tab
3. ✅ Copy the Secret Key into the ShutterQueue 'setup' tab
4. ✅ Click "Save", then click "Start Authorization."
5. ✅ **This will open a browser window to Flickr's OAuth page**

   * If you aren't already logged into Flickr, you'll need to log in to your account. This will NOT give ShutterQueue your account information.

6. ✅ Click the "Ok I'll Authorize It" button

   * This should return you to the ShutterQueue app and you should now be logged in!

## Security

As of v0.7.9 (and continuing in v0.8.0), ShutterQueue stores your sensitive credentials (API Secret, OAuth tokens) in an encrypted format using Electron's **`safeStorage` API**. This API leverages your operating system's native credential storage:

- **Windows**: Credentials are encrypted using the Windows Data Protection API (DPAPI)  
- **macOS**: Credentials are stored in the system Keychain
- **Linux**: Credentials are encrypted and stored in the user's credential store

This means your credentials are protected at the OS level and cannot be easily extracted from ShutterQueue's configuration files. Your API Key is stored in plain text (since it's public), but your API Secret and OAuth tokens are always encrypted at rest.

Note: If someone gains access to your computer's user account, they can still decrypt these credentials. This is a fundamental limitation of any local application.

## Licenses

The app includes a **View Third-Party Licenses** button in the Setup tab.





## New to 0.9.6

- **New platform support**
  - Added Tumblr, Bluesky, PixelFed, and Mastodon support alongside Flickr
  - Queue items can now target one or multiple platforms at once
  - PixelFed support is tested and working in v0.9.6
- **Platform-aware posting behavior**
  - Added per-platform post composition controls, privacy/sensitivity handling, and accessibility text options where supported
  - Added service-aware upload warnings so unsupported capabilities are called out without blocking supported targets
  - Added clearer editor hints for Flickr-only fields when non-Flickr targets are selected
- **Setup and update-check improvements**
  - Setup now has service-specific tabs and authorization flows for each supported platform
  - Update-available notices now hotlink directly to the matching GitHub release page





## New to 0.9.3c (since 0.9.3a)

- **Import and use file metadata**
  - New queue items now read embedded EXIF/IPTC/XMP metadata when present and prefill those fields automatically. Supported fields include: title, description, GPS geotags, keywords/tags
- **Queue backup and restore**
  - Export the full queue to JSON and import it later
  - Choose whether imports replace the current queue or add to it
  - Duplicate detection runs right after import so collisions are flagged immediately
- **Queue tab layout improvements**
  - Queue controls stay fixed while the queue list scrolls in its own pane
  - The edit panel now scrolls independently from the queue list
- **Batch tag workflow fixes**
  - Saved tag sets now load into the batch add-tags field as expected
  - Saving a tag set in multi-select now uses the tags currently typed into that field
- **Thumbnail recovery after import**
  - Clearing the queue and importing a backup now correctly regenerates missing or broken thumbnails

## New to 0.9.3a (since 0.9.3)

- **Performance upgrades for image handling**
  - Faster and lighter local queue image display and preview loading
  - Better responsiveness while browsing larger queues
  - Automatic stale image-cache cleanup when queue items are removed
- **Batch edit behavior fixes**
  - Fixed title/description state mismatches between single-select and multi-select editing
  - Multi-select metadata updates are now more consistent and predictable
- **UI polish and create-album clarity**
  - Batch edit controls are clearer with dedicated action buttons where needed
  - New queued album names now appear directly in album lists with a visible `New` badge
  - New albums are only created at upload time when still referenced by queued photos

## New to 0.9.3 (since 0.9.2)

- **Major queue performance improvements**
  - Large queues are dramatically more responsive during startup and while the Queue tab is open
  - Thumbnail work is now deferred and loaded in batches so the app stays usable while images populate in
  - The app now generates real resized thumbnails instead of loading full image files into the queue UI
  - Queue row rendering is lighter overall, which helps a lot once queue sizes get into the hundreds
- **Queue sorting controls**
  - Shuffle the queue or the selected items
  - Sort by filename/path A-Z or Z-A
  - Sort by title A-Z or Z-A with filename fallback when no custom title is set
- **Manual schedule and queue behavior fixes**
  - Scheduled items keep their intended chronological placement
  - Clear Selected Manual Schedule only acts on selected scheduled items
  - Single-item selection now behaves correctly for queue-wide sort/shuffle actions

## New to 0.9.2 (since 0.9.1)

- **Geotagging added**
  - Search and set upload location using OpenStreetMap Nominatim
  - Single-item and batch location editing
  - Geo privacy controls (separate from photo privacy)
  - Location metadata is sent to Flickr during upload
- **Group list improvements**
  - Group labels now show size context where available (e.g., `All People (115k)`)
  - Group member/photo counts refresh in the background for better perceived performance
  - Group and album lists auto-load on app open without requiring a manual Setup refresh
- **String parsing cleanup for Flickr-provided names**
  - Decodes entity-encoded text like `&amp;` so names display as intended
  - Handles inconsistently encoded strings more robustly
- **Queue/Edit scrolling comfort**
  - Added extra bottom breathing room so lower controls are fully visible at the end of scroll
- **Added the ability to check for new app versions**


## New to 0.9.1

- **Duplicate detection**: Content-based duplicate detection warns you when attempting to add the same file to the queue. Uses SHA-256 hashing to compare file contents (not filenames).
  - Interactive modal shows all duplicate sets with file paths
  - Choose to keep duplicates or remove all but the first instance
  - Warnings can be dismissed and won't show again for the same set while items remain in queue
- **Saved sets for Tags**: Similar to saved sets for Groups and Albums, but for tags.
- **Misc other improvements**
  - Improved visual design with blue section dividers between edit sections
  - Better field organization: Single-item edit view now shows fields in logical order: Title → Description → Tags → Privacy → Groups/Albums
  - Clearer save buttons: Updated labels for all three saved set types for better clarity

## New to 0.9.0

- **Saved sets for Groups & Albums**: Create and save sets of albums and groups that can be quickly applied to photos in batches.
  - Dropdown menu for quick selection of saved sets
  - Red '×' delete button with confirmation dialog

## New to 0.8.1

- **Queue item context menu**: Click the ⋮ (three-dot) menu button on any queue item to Remove, Upload Now, or Schedule items. Supports single and multi-selection.
- **Right-click context menu**: Windows users can right-click queue items. Mac users can also right-click (or ctrl-click). Menu availability updated for all platforms.
- **Confirmation dialogs**: Remove Item now requires confirmation to prevent accidental deletion.

## New to 0.8.0

- **Manual photo scheduling**: Items can now be scheduled for a specific upload time within the current queue, rather than just relying on queue order and batch intervals. Manually scheduled items are automatically reordered to their correct position when modified.
- **Enhanced visual feedback**: Added toast notifications and confirmation dialogs for user actions.
- **Improved queue management**: Better UI/UX for group management and batch operations.


