# ShutterQueue Wishlist / Roadmap

## Done

* [x] Fix preview full-screen display sizing (fit to window)
* [x] Fix scheduler starter dialog to offer "now, wait, or cancel" options.
* [x] Store API keys in a more secure fashion
* [X] Fix text highlighting when shift-clicking on multiple items in the queue
* [X] Improve location for "start" and "stop" buttons to make it more obvious
* [X] Improve UI/UX around indicators in the top right corner
* [X] Group lists: filterable (type text to filter to groups that have a string in their name)
* [X] Group lists: sort selected groups alphabetically at top, then remaining groups alphabetically
* [X] Clean up 'item successfully added to group moderation queue' still showing up in red like an error on some items
* [X] Address queue tab loading lag
* [X] Verbose logging mode option: Capture all codes from Flickr API and display them in the log* 
* [X] Verify fix for group limit due to pagination of group lists
* [X] Enable Minimize to System Tray on Windows option
* [X] Verify status Menu Bar on Mac
* [X] Click and drag to move item priority for the group add list
* [X] Allow photos to be scheduled for a specific time, not just an interval and queue order
* [X] Add right-click context menu for queue items (single + multi-select actions)
* [X] Keep queued/scheduled time badges on their own line for consistent queue item layout
* [X] Improve setup instructions in-app (clickable Flickr developer link, step-by-step guide)
* [X] Saved "Sets" of groups/albums (user-defined)
* [X] Create saved sets of tags that can be quickly/easily added to photos in batches (similar to how the group/album saved sets work now)
* [X] Allow drag-and-drop of files into the app
* [X] Allow "open with" feature to open image files straight into the queue
* [X] Detect if duplicate items are in the queue at the same time and throw a warning (which can be dismissed by user)
* [X] Add geographic data at upload (country/region/city lookup)
* [X] Pull in basic info about groups size
* [X] Added a "check for new version" feature
* [X] Hotlink new version notices straight to the GitHub release when an update is detected
* [X] Add sorting options for the queue: sort by original file name (A-Z or Z-A), sort by Title (A-Z or Z-A), or shuffle the queue
* [X] Implement support for Tumblr
* [X] Implement support for Bluesky
* [X] Implement support for PixelFed (tested and working in v0.9.6)
* [X] Implement support for Mastodon

## Soon

* \[ ] Fix bug that displays past times for group addition retry attempts and verify that they aren't getting stuck
* \[ ] Implement support for Pixfed.com
* \[ ] Implement support for Lemmy Photo groups

## Nice-to-have

* \[ ] Implement dark mode/light mode switch for app UI
* \[ ] Per-group throttling (freq + quantity), link to group rules
* \[ ] Improve progress bar on uploads (just flashes now, doesn't show actual progress of the individual item, only the batch that is it in)
