# ShutterQueue — A paced uploader for Flickr (v0.9.1)

Releases can be downloaded on our Release page
https://github.com/pwnicholson/shutterqueue/releases

Note that this is purely vibe-coded using a combination of different AI tools. I am very open to suggestions, feedback, and help optimizing the tool or adding features.

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

