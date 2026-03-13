# ShutterQueue — A paced uploader for Flickr (v0.9.3a)

Releases can be downloaded on our Release page
https://github.com/pwnicholson/shutterqueue/releases

Note that this is purely vibe-coded using a combination of different AI tools. I am very open to suggestions, feedback, and help optimizing the tool or adding features.

ShutterQueue is free to use. It requires you generate your own Flickr API key, which is free and easily available from Flickr (see setup instructions below)

## Summary of Key Features

- **Advanced Metadata** - all individually or in batches
  - Add Title, Tags, Descriptions
   - Save and recall custom sets of tags that are frequently used together
  - Add geotagging/location data (at any level of granularity)
  - Set photo "safety" level for safe, moderate, or restricted photo content
  - Separate photo and location privacy controls
- **Groups and Albums** - all individually or in batches
  - Quickly add photos to any combination of your albums or groups
  - Save and recall custom sets of frequently used albums and/or groups
  - See group size (user count) at a glance as you select them
  - Auto-retry for adding photos to groups when user hits the group's limit of photos per day/week/month
- **Advanced Scheduler**
  - Set photo queue to upload every X number of hours (from 1 hour to 1 week)
  - Set photo queue to only upload on certain days of the week or certain times
  - Set photo queue to process in batches of X photos at a time (ex: upload 3 photos at a time every 24 hours)
  - Set any photo to upload at a specific time and date, regardless of queue status
  - Queue will catch if you have the same photo duplicated in the queue at the same time (based on file contents, not file name)
  - Can be minimized to the system tray (Windows) or Menu Bar (Mac) while it runs in the background, using very few resources.



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


