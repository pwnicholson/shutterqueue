# Changelog

All notable changes to ShutterQueue will be documented in this file.

## [0.9.9] - 2026-05-15

This release rolls up all post-release fixes completed after 0.9.8 (including the work previously tracked under 0.9.8a), with full technical detail retained below.

### Post-Release Fixes (2026-05-15)
- **Added automatic universal mac build verification for required runtime assets**
  - Added a dedicated build verification script that checks the produced `.app` bundle is truly universal (`arm64` + `x86_64`).
  - Verification now also checks that all required sharp runtime packages are present in the packaged app (`@img/sharp-darwin-arm64`, `@img/sharp-darwin-x64`, and both libvips packages), and confirms native `.node` binaries exist for both slices.
  - Added a new `dist:mac:universal` npm script that builds the universal app and fails automatically if verification detects a missing runtime dependency.
- **Corrected Apple Silicon mac install flags for the sharp runtime packages**
  - The mac build scripts now use npm's supported `--os=darwin` and `--cpu=...` overrides instead of the unsupported `npm_config_platform` / `npm_config_arch` environment variables.
  - This prevents `EBADPLATFORM` when staging the x64 sharp runtime packages on an arm64 Mac before the universal build.
- **Hardened universal mac sharp staging for npm v11 on Apple Silicon**
  - Added a dedicated `stage:sharp:mac:universal` script that stages both arm64 and x64 sharp runtime packages before packaging.
  - The x64 staging step now uses a forced cross-arch install path, because npm v11 can still reject direct x64 package adds on arm64 hosts during universal build prep.
  - Universal build verification continues to fail publish readiness if either sharp architecture slice is missing in the packaged app.
- **Added "After image uploads" setting in General App Settings**
  - New dropdown with three options: *Do Nothing (leave items in queue)*, *Remove items from queue (do not delete)*, and *Delete items and remove from queue*.
  - When the scheduler completes an upload batch, successfully uploaded items are automatically removed or sent to the Recycle Bin based on this setting.
  - Selecting the "Delete items" option requires typing **Delete My Files** in a confirmation dialog before the setting is activated.
- **Added "Use Large Fonts" accessibility toggle in General App Settings**
  - New persisted toggle directly under *Use Light Theme* enables a large-font mode across the app.
  - Large-font mode significantly increases typography sizes, with smallest labels/status text scaled to roughly double while larger headings/buttons are increased less to preserve visual hierarchy.
  - Spacing and control sizing were expanded for readability, queue text now wraps in large-font mode, and key panes/dialogs allow horizontal scrolling where needed on smaller resolutions.

### Post-Release Fixes (2026-05-14)
- **Fixed delete diagnostics regression that could abort file deletion before any logging occurred**
  - The new delete-request diagnostics accidentally called a non-existent helper (`getRecentPhotoAccessSummary`) instead of the existing `getRecentPhotoAccess`, causing `queue:deleteOriginalsByIds` to throw before the trash attempt began.
  - Delete diagnostics logging is now wrapped so any future diagnostics failure logs a warning instead of breaking original-file deletion.
- **Delete diagnostics now capture renderer focus/preview state and per-file preflight snapshots**
  - Right before original-file deletion starts, the renderer now sends a structured snapshot covering the active item, selected items, open preview state, preview source kind (`sqimg` vs remote), thumbnail/preview cache counts, and the currently focused DOM element.
  - Main-process logging now records that renderer snapshot together with queue-side target metadata and a per-file preflight diagnostic pass before any trash attempt begins.
  - This is intended to root-cause the remaining pattern where the last uploaded file, or a small subset of the most recent files in a batch, disproportionately fails Recycle Bin deletion despite succeeding exclusive-open and rename probes.
- **PowerShell recycle fallback now directly renames files into `$Recycle.Bin` instead of using Shell COM**
  - Previous approach used `Shell.Application.Namespace().MoveHere()` (Shell COM) which silently fails for some files even when Node.js rename probes succeed (`canRenameRoundTrip: true`).
  - New approach gets the current user's SID, locates `<drive>:\$Recycle.Bin\<SID>\`, generates a `$R<random>.<ext>` filename and companion `$I<random>` metadata file (Vista+ binary format), then calls `System.IO.File.Move()` to rename the file in — completely bypassing all Windows Shell COM and SHFileOperation.
  - Also removed the `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile` step that was the source of the repeated "file is open in another program" Windows dialogs shown during failed delete retries.
  - Files moved this way appear normally in the Windows Recycle Bin (name, original path, date deleted, file size) and can be restored as usual.

### Post-Release Fixes (2026-05-13)
- **Windows recycle fallback now retries transient `did not move file` outcomes**
  - Delete retry classification now treats `PowerShell recycle fallback did not move file` as retryable, so fallback attempts continue instead of failing after the first fallback pass.
  - This addresses cases where lock probes show the file is available (`canOpenExclusive: true`, no lock owners) but recycle completion lags and the first fallback check reports a false failure.
- **Delete UI/logging now clearly identifies likely Recycle Bin-path failures**
  - When failures include `recycle fallback did not move file`, delete toasts now include a specific Recycle Bin-path hint instead of implying a generic app-held lock.
  - Trash failure logs now include `likelyRecyclePathIssue` classification when fallback did-not-move errors occur alongside successful exclusive-open and rename probes.
- **PowerShell recycle fallback settle window increased**
  - Shell recycle polling window increased from ~3 seconds to ~12 seconds before declaring fallback failure.
  - This reduces false-negative delete failures when `Shell.Application` recycle completion is delayed.
- **PowerShell recycle fallback host timeout/apartment settings corrected**
  - Increased fallback process timeout to 20 seconds so the 12-second recycle settle polling window can actually complete.
  - Fallback PowerShell process now runs with `-STA` for more reliable COM `Shell.Application` recycle behavior.
- **Added regression coverage for did-not-move fallback retries**
  - Added trash-service test coverage to ensure fallback retries can recover when the first PowerShell fallback attempt reports `did not move file`.

### Post-Release Fixes (2026-05-11)
- **Expanded delete-failure diagnostics to separate true file locks from recycle-path failures**
  - Bumped delete diagnostics schema to `diagnosticsVersion: 4`.
  - Added Windows volume/environment fields (`isUncPath`, `driveType`, `driveFormat`, `driveIsReady`, `driveProbeError`) for failed delete attempts.
  - Added lock-probe parse visibility and output snippets (`lockingProcessProbeParsed`, `lockingProcessProbeStdoutSnippet`, `lockingProcessProbeStderrSnippet`) so Restart Manager probe behavior is visible in logs when `lockingProcesses` is empty.
  - This instrumentation is intended to diagnose cases where `shell.trashItem` and PowerShell recycle fallback both fail with `did not move file` even when exclusive-open and rename probes indicate the file is not currently locked.

### Post-Release Fixes (2026-05-10)
- **Fixed last-uploaded file being locked by Windows after each batch completes**
  - `nativeImage.createFromPath()` (Electron's image loader, used for thumbnail and preview generation) opens photos via the Windows image subsystem and holds the file handle until the object is garbage collected.
  - For intermediate files in a batch, subsequent processing triggers GC and releases the handle. For the last file there is no subsequent work, so the handle — and the Windows file lock — persists indefinitely.
  - Both `getOrCreateThumbPath` and `getOrCreatePreviewPath` have been rewritten to use `sharp` instead, which explicitly closes file handles as soon as each conversion finishes.
- **Original-file delete now runs atomically and refuses actively uploading files**
  - Added a new main-process delete IPC that performs original-file trashing plus queue detach/remove updates in one step, instead of splitting that work across separate renderer and queue calls.
  - If any targeted file is currently in an active upload, delete now stops immediately and tells the user to cancel the upload first.
  - This prevents partial delete-state drift where files were moved but stale queue rows could remain and trigger immediate missing-file relink prompts.
- **Added Flickr upload stream-release regression coverage for the last-file lock investigation**
  - Added a focused test ensuring Flickr upload destroys its source read stream on successful completion.
  - This locks in the upload-side cleanup path most closely associated with the recurring "last uploaded file stays undeletable until restart" symptom.

### Post-Release Fixes (2026-05-05)
- **Delete diagnostics can now capture Windows lock-holder processes**
  - Added a Windows Restart Manager probe to trash-failure diagnostics so logs can include the process IDs/app names currently holding a file lock at delete-failure time.
  - Diagnostics schema was bumped to include `lockingProcesses` and `lockingProcessProbeError` fields.
- **PowerShell recycle fallback path parsing hardened**
  - Fallback recycle script now derives folder/name via `System.IO.FileInfo` to avoid false `Unable to parse source path for recycle fallback` failures on valid paths.
- **Windows recycle fallback errors are now summarized instead of dumping full command text**
  - PowerShell fallback failure handling now extracts concise reason text (for example `PowerShell recycle fallback did not move file.`) instead of returning raw `Command failed: powershell.exe ...` command blobs.
  - This keeps delete failure diagnostics readable in UI while preserving detailed structured diagnostics in logs.
- **Top toast notifications are now constrained and capped to prevent long banner overflow**
  - Toast messages are normalized and length-capped before render.
  - Toast container now has an explicit max width and wraps text so long failure messages no longer stretch across the app header/title region.
- **Typed-delete failure summary now uses compact first-error text**
  - Delete result toast now summarizes the first failure using compact error text instead of raw multiline command output.
- **Delete flow no longer applies extra long recent-upload retry windows by default**
  - Reverted the heavier recent-upload retry profile after it caused prolonged blocking/non-responsive delete waits without solving root cause.
  - Focus is now on identifying and eliminating lock owners rather than extending delete wait loops.

### Post-Release Fixes (2026-05-08)
- **Activity Log now has an `Uploads + Deletes` filter for focused troubleshooting**
  - Added a dedicated log filter mode that shows upload lifecycle, post-upload release probes, and delete/trash outcomes without the broader scheduler and group-retry chatter included by `Activity`.
  - This makes it easier to diagnose stuck-upload and delete issues without filling the visible log with unrelated Flickr retry checks.
- **Log filter matching semantics corrected and broadened**
  - `Uploads + Deletes` now matches a wider set of upload lifecycle lines (including success, retry/fail summaries, reshare/cross-post outcomes, and post-upload probes) plus delete lifecycle lines.
  - `Warnings + Errors` and `Uploads + Deletes` now explicitly exclude API-only entries for consistent category behavior.
  - `Activity` mode remains non-API activity while `All` remains unconditional.

### Post-Release Fixes (2026-05-04)
- **Windows PowerShell recycle fallback parser regression fixed**
  - Fixed a script assembly bug in the fallback recycle path where an inline PowerShell `#` comment could comment out the remainder of a single-line script and trigger `Missing closing '}'` parse errors.
  - Fallback script assembly now uses newline-separated commands and avoids comment-related truncation so delete fallback execution can complete.
- **Delete outcome toast reporting is now consolidated and durable for partial failures**
  - Typed-delete flow now emits one consolidated post-delete toast (instead of multiple rapid toasts competing for a single-slot toast UI).
  - Partial-failure notifications now include failed filename previews, first failure detail, and kept-in-queue counts so failed deletes are visible and actionable.
  - Toast timer handling now cancels/replaces prior dismiss timers to prevent older timers from prematurely clearing new toasts.

### Post-Release Fixes (2026-05-03)
- **Flickr create-album reconciliation now forces case-insensitive existing-album match before create**
  - Upload flow now refreshes the Flickr album cache and resolves queued `createAlbums` titles against existing albums using case-insensitive keys before attempting `photosets.create`.
  - This auto-heals older queue items affected by prior title-casing drift and prevents unnecessary duplicate album creation when a differently-cased title already exists.
  - Flickr album refresh now also runs a bulk queue reconciliation pass so older queued items are repaired ahead of upload (matched titles are moved from `createAlbums` into `albumIds`).
- **Flickr pending new-album selection now preserves original title casing**
  - Fixed a renderer pending-album id/title round-trip bug that could lowercase pending new-album titles during certain album toggle flows.
  - Pending album ids now use encoded original titles, and title decoding preserves exact casing for updates to `createAlbums` queue fields.
- **Flickr upload-time album cache checks now include stored `userNsid` context**
  - `getFlickrAuth()` now includes `userNsid` so album list/cache checks used by ensure-album logic are consistently scoped to the expected Flickr account context during upload.
- **Flickr queue-behavior toggle is now visible in both requested UI locations and stays synced**
  - Fixed placement in Setup so the option is always shown on the Flickr sub-tab under API settings and above the Flickr Groups / Albums section (it was previously inside a not-authorized-only block).
  - Added a second synced copy of the same toggle on the Schedule tab under `Flickr Groups with Pending Retries` and above the pending-groups list.
- **New Flickr setup option can defer new group-add attempts behind existing per-group retry queues**
  - Added a new Flickr setup checkbox under the API section: `Add new uploads to the bottom of the existing Group-add queues...` (default OFF).
  - When enabled, if a newly uploaded photo targets a Flickr group that already has pending retry items, ShutterQueue skips the immediate `groups.pools.add` attempt for that group and appends the new photo to that group's retry queue instead.
  - Groups without existing retry backlog still attempt immediate add as before.
- **Unified in-app confirmation dialogs replaced remaining native renderer confirms**
  - Replaced remaining `window.confirm(...)` usage in the renderer with a shared React modal confirm flow for queue actions, uploads, duplicate-platform checks, link-open prompts, cache clear, and saved-set deletion.
  - Added a promise-based confirmation dialog state/handler so confirmation UX stays consistent with existing in-app dialogs and avoids native browser modal side effects.
  - Updated duplicate-platform confirmation call sites (single-item and batch selectors) to use async modal confirmations.
- **Flickr new-album flow now avoids duplicate album creation across long-running/restarted queues**
  - Album ensure flow now forces one fresh Flickr album list refresh when a requested "create album" title is missing from cache before attempting album creation.
  - If Flickr returns a duplicate-title error during create, ShutterQueue now re-lists albums and resolves to the existing album by title instead of treating it as a failed create.
  - This hardens cases where queue items targeting the same new album are uploaded days/weeks apart with app restarts between uploads.

### Post-Release Fixes (2026-05-02)
- **Upload stream cleanup hardened to reduce lingering Windows file locks after batch completion**
  - Added explicit read-stream teardown in Tumblr, Lemmy, Mastodon, and PixelFed upload paths so source/prepared files are always released on success, timeout, and request errors.
  - Tumblr upload now also has a 30-second request timeout and stream-error handling aligned with other platform upload services.
  - Added regression test coverage for Tumblr upload stream cleanup to verify stream destruction after successful post creation.
  - Added a verbose-logging-only post-upload file-release probe in the main process so logs can now capture immediate exclusive-open results and active handle counts after each item finishes.
- **Operational logs were simplified and shifted to verbose where requested**
  - Queue reorder and image-cache prune/clear logs are now verbose-only.
  - Delete/trash logs now keep always-on single-line summaries and detailed failure diagnostics, while retry/fallback success-detail chatter is verbose-only.
  - Tumblr/PixelFed OAuth loopback listener/callback event chatter is reduced in always-on logs; non-failure callback/listener detail is now verbose-only.
  - Periodic scheduler/checkpoint messages (for example scheduler ticks and "no due retries" checks) are now verbose-only.
- **Default log now uses a single combined success line per photo upload**
  - Individual per-platform success messages ("Uploaded to Flickr", "Uploaded to Bluesky", etc.) are now verbose-only.
  - After each upload completes, the always-on log emits one concise line, for example: `photo.jpg uploaded to Flickr, Tumblr, and Bluesky`.
  - Partial-success, warning, retry, and failure outcomes continue to produce distinct always-on summary lines.
- **Additional verbose-only demotions for high-frequency background events**
  - Flickr group-size refresh start/complete heartbeats are now verbose-only (cache maintenance detail).
  - Flickr group sweep attempt/completion logs are now verbose-only; only sweep failures remain always-on.
  - Flickr group and album list load logs are now verbose-only.
  - Individual Lemmy community cross-post success lines are now verbose-only (captured by combined success summary).
  - Lemmy auto-resize diagnostic is now verbose-only.
  - Renderer webContents re-focus debug events are now verbose-only.
- **Added `logMode` helper** (`logMode.operational` / `logMode.diagnostic`) to main.cjs to formalize two-tier logging and make future logging intent explicit.
- **Added `SERVICE_DISPLAY_NAMES` and `formatServiceList` helpers** to main.cjs for consistent platform name formatting in combined success messages.
- **Text-entry focus bug follow-up hardening in renderer and main process**
  - Single-item Title/Description/Tags edits now update local UI immediately and persist with a short debounce/blur flush instead of forcing a full queue round-trip on every keystroke.
  - Queue replacement from `queueUpdate` can now be skipped while text entry is active for text-field edit commits, reducing caret/focus churn during typing.
  - Replaced blocking renderer `alert()` usage (delete/location failures) with non-blocking toasts to avoid focus disruption from modal JS dialogs.
  - Removed aggressive `webContents` blur-triggered re-focus loop in the main process to reduce focus tug-of-war while preserving normal window focus recovery on show/restore/focus events.
- **Windows delete/recycle fallback now better handles asynchronous recycle behavior and transient fallback contention**
  - PowerShell recycle fallback now tries `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(..., SendToRecycleBin)` first, then falls back to `Shell.Application` recycle if needed.
  - `Shell.Application.MoveHere` fallback now waits/polls briefly before declaring failure, avoiding false negatives where recycle completes asynchronously.
  - Trash service now supports retrying fallback strategy on transient retryable errors (`fallbackMaxAttempts`, `fallbackRetryDelayMs`) and the main delete flows now use multiple fallback attempts.
  - Added regression test coverage for successful retry-after-fallback-failure behavior.

### Post-Release Fixes (2026-05-01)
- **Renderer text-entry focus is now re-synced when the app window is active**
  - Added BrowserWindow/WebContents focus synchronization hooks on window focus/show/restore transitions.
  - Added recovery for cases where `webContents` blurs while the window is still focused, which could leave text inputs non-responsive until alt-tab.
  - Focus recovery is best-effort and only runs when the app window is already focused, avoiding aggressive focus stealing from other apps.

### Post-Release Fixes (2026-04-25)
- **Immediate scheduler startup retry now respects due-time gates (no hidden force-reset)**
  - Fixed startup/resume Flickr group retry sweep so it no longer processes all retry entries as force-due.
  - Startup sweep now checks only retries that are already due, preventing launch-time attempts from re-scheduling future-due retries forward unexpectedly.
  - The manual "Retry Group Additions Now" action remains the explicit force-due path when the user wants immediate retries regardless of due time.
- **Added clearer "no due groups" diagnostics for Flickr retry troubleshooting**
  - When scheduler ticks find no due retries, logs now include retry state count and earliest pending retry timestamp.
  - This makes it explicit whether retries are truly idle versus waiting on a future due window.

### Post-Release Fixes (2026-04-22)
- **Windows delete retries now treat common file-lock errors as transient**
  - Recycle-bin move retry logic now also retries common Windows lock/delete signatures (for example `EPERM`, `EBUSY`, sharing-violation, and "file is open in another program") instead of failing immediately on first hit.
  - This improves delete reliability when another process briefly holds the file handle (often seen on the last recently-uploaded image).
- **Windows PowerShell recycle fallback now receives the file path correctly**
  - Fixed a parameter-passing bug where the fallback script could receive a null path (`$args[0]`) and fail even when the file definitely existed.
  - The fallback now injects an escaped literal path directly into the script before execution, eliminating null-argument failures.
- **Delete failure logging now captures deeper live lock diagnostics**
  - Failed trash moves now include a versioned diagnostics snapshot captured at failure time, including runtime metadata (`nodePid`, `appVersion`, uptime), active handle-type counts, Windows exclusive-open probe results, and rename round-trip probe results.
  - This makes persistent "file is open in another app" cases easier to classify as true lock contention versus fallback/argument-path issues.
- **Windows recycle fallback no longer depends on `Split-Path` parameter-set behavior**
  - Fixed a PowerShell fallback failure where `Split-Path -LiteralPath ... -Parent/-Leaf` could throw "Parameter set cannot be resolved" on some systems.
  - Fallback now uses .NET path parsing (`System.IO.Path::GetDirectoryName/GetFileName`) before Shell namespace recycle move.
- **Queue editor and typed-delete text input focus stability hardened**
  - Queue list replacement is now always paused while a queue text-editable field is focused (instead of only when background uploads/scheduler were idle), reducing caret-loss and focus jumps during active edits.
  - Added a pointer-down focus recovery guard that re-focuses clicked text-editable targets if a concurrent render/update steals focus in the same frame.

### Post-Release Fixes (2026-04-21)
- **Flickr group-add retries now execute due groups instead of deferring them**
  - Fixed retry scheduling so overdue Flickr group-add retries are attempted immediately when due, rather than being bumped forward before attempt selection.
  - Due Flickr group retries are now processed at the group level: each selected due group is drained across its eligible photos until completion or until a new retry cooldown is scheduled again for that group.
  - Keeps group-level cooldown alignment by propagating a newly scheduled retry time to remaining retry entries in that same group when rate-limited again.
- **Schedule tab now includes `Retry Group Additions Now` for Flickr pending retries**
  - Added a manual action button next to the "Flickr Groups with Pending Retries" section title.
  - Clicking it immediately retries pending Flickr group additions as if retry timers were due now, then refreshes the pending-retry view.

- **Tumblr merged title/description captions now preserve blank-line breaks**
  - In `title_then_description` mode, Tumblr captions now insert a blank line between Title and Description so merged text does not run together.
  - Appended Tumblr footer text now always starts after a blank line from the main caption body.
- **Windows trash abort recovery now includes a secondary recycle-bin strategy**
  - After normal Electron trash retries are exhausted on repeated "Operation was aborted" errors, ShutterQueue now attempts a Windows Shell-based PowerShell recycle move as a fallback.
  - Successful fallback recoveries are logged so stubborn per-file delete failures can be distinguished from persistent lock/drive issues.
- **Large manual Upload Now batches now refresh queue state progressively**
  - Manual multi-item "Upload now" now refreshes dynamic queue state during the run (not only at the end), improving status visibility for long ad-hoc batches.
  - Background queue refresh now avoids committing unchanged queue snapshots, reducing unnecessary heavy re-renders while many items are uploading.

### Post-Release Fixes (2026-04-18)
- **Optional PixelFed-first Mastodon reshare flow added (default ON when both services are selected)**
  - New synced setup toggle (shown in both PixelFed and Mastodon setup panels) controls whether ShutterQueue posts to PixelFed first and then boosts that same post on Mastodon instead of uploading media to Mastodon separately.
  - Toggle appears only when both PixelFed and Mastodon are authorized and is enabled by default.
  - Upload orchestration now resolves the PixelFed post URL on Mastodon and performs a reblog/boost when this option is enabled.
- **Mastodon reshare scope guidance and error messaging improved**
  - Mastodon setup instructions now explicitly include the extra read scope needed for reshare URL resolution (`read:search`) when using granular scopes.
  - When Mastodon rejects a reshare with insufficient scopes, the item error now includes a direct re-authorization hint describing the required scopes.
- **Delete confirmation now counts unique files (not duplicate queue entries)**
  - If the same photo appears multiple times in queue (for example, cloned entries), the typed delete confirmation now shows the number of unique source files being deleted.
  - Deletion behavior is unchanged: all linked queue entries for that deleted source file are still removed together.
- **Delete-to-Recycle Bin reliability increased for repeated abort errors**
  - Interactive delete now uses more aggressive retry settings (higher attempt count plus final grace retry) when moving originals to the OS bin.
  - If all failures are repeated "Operation was aborted" responses, the delete result dialog now includes a targeted hint that this may be a drive-level Recycle Bin issue.

### Summary (Beginner-Friendly)
- This patch reduces noise from non-critical location capability notices.
- If an item has location data but is posted only to platforms that do not support location, ShutterQueue now keeps upload status visually successful and avoids red queue-level error markers.

### Fixed
- **Location capability notice no longer appears as a red queue-list error when uploads succeeded**
  - Location-only capability messages are now treated as a warning/notice in the item detail area (yellow), not as an error.
  - Queue cards no longer show a red `Error` badge for fully successful multi-platform uploads that only had this location-support notice.
  - Upload outcome status remains `done` for this location-only warning case instead of `done_warn`.
- **Delete confirmation now responds immediately and failed trash attempts return faster**
  - After typed delete confirmation, the dialog now enters a clear busy state (`Deleting...`) immediately so clicks are acknowledged right away.
  - Delete buttons/inputs are disabled while processing to prevent duplicate submissions and accidental re-clicks.
  - Recycle Bin move retries are now shorter in interactive delete flows, reducing long waits when Windows repeatedly returns abort errors.

## [0.9.8] - 2026-04-17

### Summary (Beginner-Friendly)
- This release focuses on safer deletes, clearer warnings, and easier queue editing.
- If moving a file to Recycle Bin fails, ShutterQueue now keeps that item in your queue so nothing disappears unexpectedly.
- You can now clone a queue item to quickly make a second version of the same photo with different settings.
- Duplicate-platform warnings are clearer and less spammy, especially in batch edits.

### Highlights
- **Safer file deletion**
  - Delete only removes queue items whose original files were actually moved to Recycle Bin.
  - Failed delete moves now keep those items in queue and report what happened.
  - Deleting a file that appears in multiple queue entries now warns you and can clean up all related entries together.
- **Better queue editing tools**
  - Added **Clone Queue Item** in the item context menu.
  - Added **Reset Status** for attempted/uploaded items without losing metadata.
  - Improved text-field stability while typing by avoiding mid-edit queue refresh replacements.
- **Clearer duplicate checks**
  - When the same image is targeted to the same platform more than once, ShutterQueue asks for confirmation.
  - Batch confirmations are now merged into one dialog with a capped preview list.
- **Improved diagnostics and retry behavior**
  - Trash failures now log richer filesystem diagnostics for troubleshooting.
  - Upload outcome logs now include a final per-item status summary.
  - Bluesky `NotEnoughResources` is treated as transient and auto-retried.
- **Lemmy workflow improvements**
  - Default Lemmy resize is enabled at 2000x2000.
  - Multi-community posting supports original-post + cross-post flow with retry-safe progress.

## [0.9.7b] - 2026-04-05

### Post-Release Fixes (2026-04-17)
- **Delete originals now includes items kept in Flickr group-only mode (restored behavior)** — in the multi-select "Remove + Delete Files" flow, choosing "Keep In Group Additions Queue Only" now again deletes all selected original files while still preserving pending Flickr group-add retry state by detaching those items to `group_only`
- **Tumblr upload errors now include richer API detail when available** — Tumblr error parsing now supports additional payload shapes (`response.errors` object maps, `response.error_description`, `message`) and upgrades generic "Bad Request" to include HTTP context (`Bad Request (HTTP 400)`) when Tumblr provides no further detail
- **New context-menu "Reset Status" action for attempted/uploaded items** — right-clicking eligible queue items now shows "Reset Status", which clears upload attempt state (`status`, per-platform states, Flickr group-add states, upload/error markers) and returns items to editable `pending` while preserving all metadata selections (title/description/tags, targets, Flickr groups/albums, location, Lemmy communities, etc.)
- **Reset Status now appears with Copy/Paste tools and uses a higher-contrast section divider** — moved "Reset Status" into the top context-menu tools group and increased separation contrast with a thicker accent-colored divider for easier visual scanning
- **Queue batch group outlines are now much bolder for visibility** — the grouped upload box border was increased to 3x thickness (1.5px -> 4.5px) with stronger accent contrast so grouped items are clearly distinguishable from normal item borders
- **Tumblr now uses original-first upload with targeted media-failure fallback** — uploads now try the original source file first; if Tumblr returns known media-processing failures (e.g. `Media file too large`, `Magick error: Insufficient memory`), ShutterQueue performs a one-time constrained prep retry (10 MB + conservative dimension cap) to avoid server-side convert failures while still preferring original upload by default
- **Added explicit per-item upload outcome summary logging** — each upload attempt now logs a final `Upload item outcome` entry with item id, final queue status (`done`, `done_warn`, `retry`, `failed`), warning/error counts, and per-platform service-state statuses so "failed again" cases can be traced immediately even when only platform success lines are visible
- **Delete-to-Recycle Bin now retries abort errors more aggressively and reports zero-move outcomes clearly** — trash moves now use stronger retry timing plus a final grace retry when abort errors persist and the file still exists, and the delete completion alert now explicitly says when zero files were moved (with failed/missing counts) instead of implying success
- **Delete flow is now partial-safe: failed trash moves are kept in queue** — when deleting selected items, ShutterQueue now removes/detaches only items whose originals were successfully moved to the OS bin (or already missing on disk); items whose trash move failed are kept in queue and explicitly reported so they are never silently removed without their original being trashed
- **Trash failure logs now include filesystem diagnostics for root-cause analysis** — failed trash entries now log structured error metadata (`errorCode`, `errorErrno`, `errorSyscall`) plus path diagnostics (exists/read/write/access/open checks, parent/root existence, stat/realpath details) so repeated `Operation was aborted` cases can be traced to lock/permission/drive conditions
- **New queue context-menu action: Clone Queue Item** — right-clicking an item now supports cloning it directly below the source row, copying metadata while resetting upload state and defaulting the clone to no selected target platforms so users can create per-platform variants of the same image
- **Duplicate platform-on-same-image selection now prompts for confirmation** — when enabling a platform on an item where another queue listing for the same source file already has that platform selected, ShutterQueue now asks for explicit confirmation before allowing duplicate posting to the same platform
- **Delete-file flow now warns about other pending listings of the same image and removes all related listings on confirm** — if the same source image is still queued elsewhere for upload, delete now warns that future uploads will be impossible; confirming proceeds with delete and removes all queue entries tied to that file path (while still preserving partial-safe behavior if trash move fails)
- **Duplicate-platform confirmation now includes clearer image context** — the warning prompt now includes the queue item's title and filename (for example, `CN Tower Toronto (PWN0456.jpg)`) so users can clearly identify which listing the duplicate-platform confirmation refers to
- **Queue typing/cursor stability improved while editing text fields** — background queue polling now skips queue-list refreshes while a queue text input/textarea is actively focused, reducing intermittent cursor jumps and "can't type" moments caused by mid-edit state refresh churn
- **Batch duplicate-platform confirmations are now merged into one dialog with capped preview** — when enabling a platform across many selected items that conflict with existing same-image targets, ShutterQueue now shows a single confirmation dialog listing up to 10 items and appending `...and other files` for larger selections

### Post-Release Fixes (2026-04-16)
- **Recycle Bin delete reliability improved on transient OS aborts** — moving originals to the OS bin now retries transient "Operation was aborted" failures automatically before reporting a failure, and delete accounting now treats race-condition missing files as "missing on disk" instead of hard failures
- **Bluesky `NotEnoughResources` is now treated as a transient retryable failure** — this error now follows the automatic hourly retry path (up to normal retry limits) instead of immediately becoming a permanent failure

### Post-Release Fixes (2026-04-14)
- **Lemmy now defaults to recommended 2000x2000 image resizing** — new Lemmy installs now start with manual resize enabled at 2000 px by 2000 px, the retry fallback for suspected size-limit failures now also uses 2000x2000, and the Setup tab now recommends keeping that limit unless the instance clearly supports larger uploads
- **Removed the old in-app Lemmy instability warning** — the Setup and queue-editor Lemmy panels no longer show the generic "integration is unreliable" warning banner; that space is now used for actionable guidance about image-size limits and the recommended 2000x2000 resize setting
- **Lemmy can now cross-post to multiple communities from one original post** — the first selected Lemmy community is treated as the original post destination, additional selected communities are posted as cross-posts that link back to that original post, and right-clicking a selected community in the single-item Lemmy editor now lets you switch which community is the original post target
- **Lemmy cross-post retries no longer duplicate the original post** — when the original post succeeds but some cross-post communities fail transiently, ShutterQueue now saves the original post URL plus the completed/permanently failed community lists and only retries the remaining communities later instead of reposting the original
- **Manual validation confirmed for Lemmy cross-post flow** — original-post + cross-post behavior validated successfully in live use; first-selected default + right-click switch behavior worked as expected

### Post-Release Fixes (2026-04-06)
- **Scheduler start now uses an in-app datetime picker instead of the native OS dialog** — "Start Scheduler" now opens an in-app modal with two options: "Upload first item now" (immediate) or "Schedule first upload at: [date/time picker]" (defaults to tomorrow at 06:00 local time); the chosen time is passed through `bumpToNextAllowed` and the configured time-window/days rules before being set as `nextRunAt`; removes the limited native OS dialog that only offered "now", "on delay", or "cancel"
- **Lemmy retry now fires even when another platform (e.g. Tumblr) also failed** — `processLemmyRetries` was skipping items whose overall status was `"failed"` (which happens when a non-transient failure like Tumblr "Bad Request" co-occurs with the Lemmy transient error); the filter now also processes `"failed"` items that have a Lemmy retry pending
- **Lemmy HTTP requests now time out after 30 seconds** — `lemmyRequest` (API/post creation calls) and the multipart image upload had no socket timeout; if a Lemmy server dropped the TCP connection without returning an HTTP response the upload lock would be held for the OS-level TCP timeout (~2–4 min on Windows), blocking all subsequent scheduler retries; both requests now call `req.setTimeout(30000)` to destroy and reject after 30 s
- **Detail panel error display cleaned up** — Lemmy probe-list errors are now truncated to a single summary line ("Lemmy image upload failed on all endpoints. (see log for details)"); all error lines now append "(see log for details)"; the Lemmy transient-retry notice no longer appears as a separate "Waiting:" entry (the inline "Lemmy — Waiting to retry" line replaces it); the Lemmy retry box is now a plain inline line instead of a bordered box; dismiss buttons now correctly map back to the raw message even after truncation
- **Lemmy retry info line now always shows the scheduled time** — was showing "shortly (overdue)" which is vague; now shows the actual timestamp with "(overdue)" appended if it is in the past
- **Lemmy retry items incorrectly converted to `done` on app restart** — `loadQueue`'s `done_warn`→`done` migration was only checking `groupAddStates` for pending problems, not `serviceStates`; items with a pending Lemmy retry in `serviceStates.lemmy.status === "retry"` were being silently demoted to `done` on every `loadQueue` call, and when anything triggered a `saveQueue` on that array the `done` status was written to disk, permanently orphaning the retry; the migration now also checks `serviceStates` for any pending service retry, and a second migration converts any already-saved `done` items back to `done_warn` if they have a pending service retry
- **`processLemmyRetries` also covers `done` items** — added as belt-and-suspenders so items incorrectly saved as `done` (due to the above) are still picked up for retry
- **Tumblr upload now resizes large files** — `prepareImageForUpload` is now called before sending to Tumblr with a 20 MB limit, matching the Tumblr API maximum; previously the raw original file was sent and files over 20 MB received a "Bad Request" rejection

### Fixed
- **Empty title now stays blank on upload across all platforms**
  - Flickr was silently replacing a blank title with the photo's filename (server-side behaviour when `title=""` is sent); ShutterQueue now calls `flickr.photos.setMeta` after upload to explicitly clear the title field when the item title is blank (best-effort; a `setMeta` failure does not block or fail the upload)
  - Lemmy was showing the photo's filename as the post title when the item title was empty; `derivePostName` now returns `"Photo"` as a neutral placeholder instead of the filename (Lemmy's `name` field is required and cannot be left blank)
  - Tumblr, Bluesky, Mastodon, and PixelFed already skipped empty titles correctly — no changes needed for those platforms

- **Lemmy 502/503 server outages now show yellow "retrying" instead of red "failed"**
  - Transient server/network errors (HTTP 502, 503, 504, 500, socket hang-up, ECONNRESET, ETIMEDOUT, etc.) are now detected and treated separately from permanent failures
  - Items affected by transient Lemmy errors display as yellow "retrying…" with an ↻ marker on the Lemmy chip, instead of red "failed"
  - ShutterQueue automatically retries Lemmy uploads approximately every hour while the scheduler is active — no user action required
  - If other platforms (Bluesky, Mastodon, etc.) succeeded but Lemmy failed transiently, the item shows as yellow "done (warnings)" with Lemmy marked ↻ and a next-retry timestamp
  - When the Lemmy server recovers, the retry succeeds and the item transitions to normal "done" or "done_warn" state
  - The retry count and first-failed timestamp are preserved across retries for diagnostics
  - Added `processLemmyRetries()` called on every scheduler tick (independent of upload batch interval, same pattern as Flickr group retries)
  - Added `isLemmyTransientError()` helper to classify server/network errors
  - New `"retry"` status added to `QueueStatus` and `serviceStates[svc].status` in types

- **Tumblr uploads failing with "Bad Request"**
  - Tumblr's API requires a `User-Agent` header; Node.js `https.request` does not add one automatically
  - All requests (OAuth handshake and photo post) now send `User-Agent: ShutterQueue/1.0` as required by the Tumblr API agreement
  - Additionally removed the non-standard `description` field that was being sent in photo post requests — Tumblr's legacy photo post endpoint does not accept this field and had started rejecting it
  - Removed `description` from the OAuth signature data accordingly

- **Lemmy image upload improvements for pict-rs 0.5+ and Lemmy 0.19.x**
  - pict-rs 0.5+ changed the upload response format: the image identifier field is now called `identifier` instead of `file` in the `files[0]` object
  - Added `fileRow.identifier` to the candidate URL extraction list so pict-rs 0.5+ responses are handled correctly
  - Reordered probe list to try `POST /api/v4/image` with `images[]` first (Lemmy 0.20+ method), then `POST /pictrs/image` with `images[]` second — this is the correct method for Lemmy 0.19.x instances including lemmy.world (the largest Lemmy instance, running 0.19.17)
  - Previously `/pictrs/image` + `images[]` was last of 13 combinations; it's now second, meaning lemmy.world will be identified on the 2nd probe attempt instead of the 13th
  - Note: 502 and socket hang-up errors seen on some instances are server-side infrastructure failures unrelated to these changes

- **Lemmy image upload broken on lemmy.world and most instances**
  - The `/pictrs/image` upload endpoint returns a bare filename (e.g. `uuid.jpeg`) with no path in the response
  - ShutterQueue was incorrectly constructing `https://instance/uuid.jpeg` instead of the correct `https://instance/pictrs/image/uuid.jpeg`
  - All 11 endpoint combinations were failing because the URL probe was checking the wrong URL
  - Fix: bare filenames from `/pictrs/image` responses are now prefixed with `/pictrs/image/` before URL normalization

### Changed
- **Version bump to 0.9.7b**
  - Bumped local app version to `0.9.7b` in package/build metadata and UI fallback version display

### Tests
- Added regression test for pictrs bare filename path prefixing
- Added regression tests for `derivePostName` (blank title uses "Photo" not filename)

## [0.9.7a] - 2026-04-05

### Fixed
- **macOS build compilation fix**
  - Fixed a compilation issue that prevented the app from building on macOS

### Changed
- **Version bump to 0.9.7a**
  - Bumped local app version to `0.9.7a` in package/build metadata and UI fallback version display

## [0.9.7] - 2026-04-04

### Added
- **Original file deletion flow with strong safeguards**
  - Added queue action flow to move selected original files to the OS bin (`Recycle Bin` on Windows/Linux, `Trash Can` on macOS) instead of permanently deleting them
  - Added a typed confirmation modal that requires an exact phrase (`Delete N`) before the Delete action can be executed
  - Added a pre-warning modal when selected items include photos that have not been uploaded yet
  - Added a completion popup confirming how many files were moved to the OS bin
- **Missing-file relink helper for imported queues**
  - Added automatic relink prompts when queued files are missing, with one prompt per missing source folder
  - Prompts now state: `Can't find the files in XX. Select the new folder where they are and ShutterQueue will try to relink by matching filenames.`
  - Selecting a folder remaps missing queue file paths by filename, preserving already-valid items and prompting again only if unresolved folders remain
  - Added relink result summaries (relinked, unresolved, and ambiguous filename matches)
- **Queue item settings copy/paste tools**
  - Added `Copy Settings` for single-item context menus
  - Added `Paste Settings` for single-item and multi-select context menus when copied settings are available
  - Paste applies via existing queue update flow so undo behavior remains consistent
- **Flickr group info dialogs in Setup and Queue editors**
  - Added per-group info action to open a rich group info dialog (description, rules, additional info, admin blast, member/photo counts)
  - Added safe HTML rendering and external-link confirmation prompts inside the dialog
  - Added direct `Open Group Overview` fallback action for full group pages
- **Lemmy platform integration (setup + upload + editor)**
  - Added Lemmy setup/auth fields (instance URL + access token) with account test/logout
  - Added subscribed-community loading and refresh from Lemmy API (including federated/remote communities)
  - Added per-item Lemmy community selection in batch and single-item editors
  - Added Lemmy upload pipeline branch for image posts with service-state tracking and error/warning handling
  - Added platform-specific bottom editor tabs so Flickr and Lemmy fields can be shown independently when both services are selected
  - Added in-app warning banners noting that Lemmy integration is still unreliable
- **Selective queue removal with Flickr group retry preservation**
  - Added ability to remove items from the main queue while keeping them in scheduled Flickr group addition/retry operations
  - When removing items that have pending group retries, shows a modal with three options: "Cancel", "Keep In Group Queues Only" (marks item as `group_only`), or "Remove All"
  - Items marked as `group_only` remain invisible in the main queue but continue processing group operations until those complete
  - Auto-cleans `group_only` items once all group retry states complete
- **Per-platform upload status indicators on queue cards**
  - Added ✓ (success) and ✗ (failed) markers under platform icons on each queue card
  - Markers only appear after an upload has been attempted; pending items show no marker
- **File Missing badge on queue cards**
  - Queue cards now display a red `File Missing` badge when the file at the stored path cannot be resolved

### Changed
- **Version bump to 0.9.7**
  - Bumped local app version to `0.9.7` in package/build metadata and UI fallback version display
- **Delete completion guidance**
  - Updated the delete-complete popup to explicitly tell users files can be recovered from the OS `Recycle Bin`/`Trash Can`
- **Native text context menu parity**
  - Restored spell-check suggestions and `Add to Dictionary` entries in the custom right-click text menu while keeping Undo/Redo/Cut/Copy/Paste/Delete/Select All
- **Theme support and setup controls**
  - Added a persisted `Use Light Theme` setup toggle
  - Added light-theme palette tuning and contrast updates, including stronger selected-item outlines

### Fixed
- **Legacy queue import thumbnail compatibility**
  - Import normalization now accepts older path keys (`path`, `filePath`, `sourcePath`) and normalizes legacy `file://` / encoded photo paths so thumbnail generation can resolve older exported queues reliably
- **Missing relink no-op edge case**
  - Fixed relink behavior when ID filters were passed as an empty list so relinking now applies correctly instead of matching nothing
- **Flickr group-only items preserved through all queue operations**
  - Import (replace mode), `Remove`, and `Clear Uploaded` no longer destroy `group_only` queue entries
  - `group_only` status now recognized as valid during queue normalization on JSON import
- **Original file delete now uses strict path matching only**
  - Removed case-insensitive filename fallback from file path resolution to prevent accidental mismatched deletions
  - Delete action is blocked entirely when any selected item has a missing or unmapped file path
- **Platform status markers reset correctly with queue status**
  - Resetting a failed queue item's status via the Retry/Reset dialog now clears all per-service ✓/✗ markers
- **Bluesky token refresh retry now works reliably**
  - Fixed a variable scoping bug where post composition options (post text mode, alt text, resize options) were declared inside the `try` block, causing a `ReferenceError` in the token-refresh retry code path
  - Auto-refresh on `ExpiredToken` now correctly retries the full upload with the refreshed access token
- **Lemmy community picker sort stability**
  - Community list is always alphabetically ordered
  - Clicking items no longer causes the list to jump mid-interaction
  - Selected communities are promoted to the top only when re-opening the picker for an item that already has a saved selection (not on first open)
- **Lemmy upload image URL validated before post creation**
  - Upload response URL is normalized to an absolute instance URL
  - URL candidates from the upload response are ranked and quality-checked; API endpoint-style paths are rejected as image URLs
  - A live HTTP probe verifies each candidate URL actually returns image content (`image/*` content-type) before submitting the post
  - If all upload endpoint/field combinations fail to produce a valid image URL, the failure message includes full per-attempt diagnostics (endpoint, field name, HTTP status, content-type, reason)
- **Lemmy upload endpoint discovery is now self-healing per instance**
  - On first upload to an instance, ShutterQueue probes working endpoint + field-name combinations (which vary by Lemmy and pict-rs version)
  - The working combination is cached per instance URL and reused automatically on subsequent uploads
  - Cache survives app restarts (30-day TTL); stale or broken entries fall back to re-probing transparently
- **Lemmy failure messages now show community name instead of numeric ID**
  - Per-community errors now include the resolved community title, short name, and instance hostname
  - Known Lemmy error codes are translated to readable text (e.g. `only_mods_can_post_in_community` → "Only moderators can post in this community")
  - `invalid_url` errors immediately halt remaining community attempts with a clear explanation

### Tests
- Added Lemmy regression tests covering URL candidate ranking, image-URL heuristics, and candidate collection ordering

## [0.9.6b] - 2026-03-26

### Changed
- **Local development version rev and metadata alignment**
  - Bumped local app version to `0.9.6b` in package/build metadata and UI fallback version display
- **Queue undo UX and shortcut parity**
  - Added queue-level Undo controls for major queue edits (metadata edits, reorder, sort, and shuffle)
  - Ctrl+Z now routes through the same queue undo stack as the Undo button on the Queue tab
  - Consecutive text edits are coalesced so undo reverts a full field edit instead of stepping per keystroke
- **Queue thumbnail display defaults**
  - Increased the default queue thumbnail size to a larger 3:2 presentation for better image visibility in the queue list
  - Added a Setup option to re-enable the old small square thumbnails (`Use Small Thumbnails`)

### Fixed
- **Date Taken sorting reliability for subset selection**
  - Fixed Date Taken sorting so selected subsets now reorder correctly when capture dates are stored in EXIF-style timestamp formats
  - Queue-load and import normalization now convert parseable capture dates into ISO format for consistent sorting behavior
- **Queue edit panel stale-value issues during undo**
  - Fixed batch/single edit panel fields that could show stale values after undo while data had already reverted
- **Close behavior warning when work is pending**
  - Closing the window while scheduler is active and pending queue work exists now prompts with: Close the app, Minimize to Tray, or Return to App

### Tests
- Added queue date parsing regression tests covering EXIF-style timestamps and explicit timezone offsets

## [0.9.6a] - 2026-03-24

### Added
- **Tumblr post timing preference in Setup**
  - Added a Setup option to publish immediately or send uploads to the selected Tumblr blog queue
- **Queue reorder shortcuts in item context menu**
  - Added `Move to Top` and `Move to Bottom` actions to the queue item context menu
- **Dev-only runtime session badge**
  - Added a small `DEV HH:MM:SS` footer badge when running via `npm run dev`

### Changed
- **Local development version rev and metadata alignment**
  - Bumped local app version to `0.9.6a` in package/build metadata and UI fallback version display
- **Queue reorder UX feedback**
  - Queue drag targets now show a clearer insertion line and a count badge during multi-item moves

### Fixed
- **Major bug fix: queue reordering now applies reliably and stays visually in sync**
  - Fixed queue drag-and-drop so moves now apply reliably and the visible order stays in sync with the real queue order
  - Manual reordering, sorting, shuffle, and schedule-driven moves now stay visually consistent
- **Queue drag/drop visual reliability**
  - Fixed drag indicators so the multi-item count badge stays visible during reordering
- **Update-available notice stale-cache behavior after app upgrade**
  - Fixed stale cached update notices after upgrading so the app reports the correct current version
- **Loose semver comparison for local letter-suffix versions**
  - Fixed version comparison logic so versions like `0.9.6a` are correctly recognized as newer than `0.9.6` in update checks
  - The semver parser now captures and compares letter suffixes, enabling proper ordering of pre-release and local version strings

### Tests
- Added update-check regression tests covering:
  - stale cached update notices after version change
  - local letter-suffix version comparisons (for example `0.9.6a`)

## [0.9.6] - 2026-03-24

### Added
- **New platform support since 0.9.3c: Tumblr, Bluesky, PixelFed, and Mastodon**
  - Added full setup/auth flows for all four services with encrypted credential storage
  - Added per-service account verification/logout actions, status indicators, and platform chips
  - Added Tumblr OAuth/browser callback improvements plus Tumblr blog selection/refresh integration
- **Multi-platform queue targeting and service-aware upload behavior**
  - Added target-platform selection in single-item and batch editors
  - Added per-service upload state tracking so each item can partially succeed across mixed targets
  - Added normalized target-service handling across queue/main flows so selected platforms are preserved consistently
- **Capability-aware posting across platforms**
  - Added service-specific privacy and sensitivity handling, including automatic mapping/warnings when a platform does not support a selected option
  - Added capability-aware upload warnings, including location warnings only when explicit location data exists and none of the selected targets support location tagging
  - Added safer mixed-target behavior so capabilities are applied where supported without blocking other selected targets
- **Per-platform post composition and accessibility controls**
  - Added post-text composition modes for Tumblr, Bluesky, PixelFed, and Mastodon
  - Added Bluesky long-post handling modes (truncate vs thread)
  - Added optional Description -> alt text/image description behavior for supported services
  - Added optional automatic ShutterQueue hashtag/tag insertion for uploads
- **Capability-aware editor and setup UX improvements**
  - Added service-tabbed Setup flows for Flickr/Tumblr/Bluesky/PixelFed/Mastodon
  - Added clearer Flickr-only field hints and service-aware safety labeling in editors
  - Added updated tag guidance: "Multi-word tags are supported. Don't use a '#' - we'll add it for you where needed."
  - Added improved global notice/error banners and update-available notice handling
- **Test coverage and regression protection**
  - Added npm test command (`npm test`) for electron service tests
  - Added Bluesky/PixelFed/Mastodon service tests plus queue target-service normalization regression tests

## [0.9.3c] - 2026-03-15

### Added
- **Queue backup import/export**
  - Added JSON export/import for the full queue so you can save a backup and restore it later when files are still available at the same paths
  - Import now prompts whether to append to the existing queue or replace it, then runs duplicate detection so new duplicate collisions are flagged immediately
- **Embedded image metadata prefill on add**
  - New queue items now read embedded EXIF/IPTC/XMP title/description metadata when present and prefill those fields automatically
  - Embedded GPS geotags are also read automatically and prefill location coordinates for upload
  - Embedded keywords/tags are now imported and prefilled into each queue item's Tags field
  - If metadata is missing, title continues to default from filename and description remains blank

### Changed
- **Local image and preview performance enhancements**
  - Local queue images now use cached protocol-backed sources instead of heavy inline image payloads
  - Thumbnail and preview generation/use was optimized for faster open and smoother scrolling in larger queues
  - Added automatic image-cache pruning when queue items are removed or cleared to prevent stale cache growth
- **Queue tab split-pane scrolling**
  - Queue controls now stay fixed at the top of the queue pane while the queue list scrolls independently
  - The edit panel now has its own independent scroll area so queue navigation and metadata editing no longer fight for one page scroll
- **Queue sorting options**
  - Added Date Taken sorting (Old-New / New-Old) using embedded capture timestamps when available

### Fixed
- **Batch metadata consistency and selection-state correctness**
  - Fixed mixed/single selection mismatch where title/description fields could appear inconsistent across selection modes
  - Multi-select title/description/privacy/safety editing now behaves consistently and applies correctly to the selected cohort
  - Fixed saved tag sets in multi-select so choosing a set loads its tags into the batch add-tags field, and saving a tag set now uses the tags currently entered there
- **Queue backup import and thumbnail recovery**
  - Imported queue backups now let you choose whether to replace the current queue or add to it, with duplicate detection running immediately afterward
  - Thumbnail state is now refreshed after queue clear/import flows so missing or broken local thumbs regenerate correctly
- **Create-album workflow and upload behavior**
  - Fixed missing visibility for queued new-album creation in the Albums editor list
  - New album rows now appear with a distinct red `New` indicator and are fully selectable in edit flows
  - New albums are now actually created during upload when referenced, and are not created when no queued photos reference them
- **Saved tag-set dialog naming input**
  - Fixed the save-set name field to reliably take focus and accept typing when creating or overwriting a saved tag set

### UI
- **Batch edit experience improvements**
  - Replaced confusing single "Apply to selected" behavior with clearer field-specific actions and live updates where appropriate
  - Added dedicated compact action buttons for batch tag add and batch create-album add next to their corresponding fields
  - Tuned the new-album `New` badge size for cleaner visual hierarchy

## [0.9.3] - 2026-03-12

### Added
- **Queue sorting controls**
  - Shuffle the full queue or just the current multi-selection
  - Sort by full filename/path in either direction
  - Sort by title in either direction, with filename fallback when no title is set

### Changed
- **Major queue performance improvements**
  - Queue tab stays responsive with much larger queues
  - Thumbnail loading now happens in deferred batches instead of blocking the renderer
  - Actual resized thumbnails are generated instead of embedding full source images as preview data
  - Background queue refresh polling is less aggressive when the app is idle
- **Better large-queue rendering behavior**
  - Queue rows are cheaper to render and stay more responsive while thumbnails continue loading
  - Startup and queue-tab open behavior are noticeably smoother, especially with hundreds of queued photos

### Fixed
- **Queue sorting and scheduling behavior**
  - Single-item selection now behaves like full-queue sort/shuffle as intended
  - Manual schedules return items to the correct chronological place in the queue
  - Clear manual schedule only enables for selected scheduled items and only clears those selected items
- **Queue tab startup interaction glitch**
  - Reduced the odd first-open queue tab focus/interaction issue seen immediately after app launch

## [0.9.2] - 2026-03-09

### Added
- **Geotagging support (OpenStreetMap/Nominatim + Flickr geo APIs)**
  - Location search for single-item edit
  - Batch location set/clear for multi-selection
  - Geo privacy controls for both single-item and batch flows
  - Automatic Flickr geo accuracy mapping and upload integration
- **Group scale indicators**
  - Group lists now include size context in labels (e.g. `Group Name (115k)`)
  - Member/photo count metadata retrieved via Flickr group info APIs
- **Check for new version feature**
  - Can be disabled or manually run on the Setup tab


### Changed
- **Faster startup list loading**
  - Group list now returns quickly, with counts refreshed in the background
  - Albums and groups auto-load independently on app launch so one does not block the other
- **Improved scrolling comfort in Queue tab**
  - Added extra bottom space to queue/edit areas so bottom controls remain fully visible after scrolling

### Fixed
- **Group/album display text normalization**
  - Decode HTML entity-encoded names/titles from Flickr (e.g. `&amp;` → `&`)
  - Added resilient handling for double-encoded entities and cached group name normalization

## [0.9.1] - 2026-03-09

### Added
- **Duplicate detection**: Hash-based duplicate detection that warns when attempting to add the same file (by content, not name) to the queue
  - Warning modal displays all duplicate sets with file paths
  - Options to keep duplicates or remove all but the first instance
  - Dismissed warnings are suppressed until items leave the queue

## [0.9.0] - 2026-03-09

### Added
- **Saved tag sets**: Create and save sets of tags that can be quickly applied to photos in batches
  - Full UI/UX parity with existing group/album saved sets
  - Dropdown menu for quick selection
  - Delete saved tag sets with confirmation dialog
  - Visual improvements: blue section dividers between edit sections in batch and single-item views

### Fixed
- Field order in single-item edit view now shows Title → Description → Tags → Privacy → Groups/Albums
- Improved button labels for all three saved set types: "Save entered Tags as a set", "Save selected Groups as a set", "Save selected Albums as a set"

## [0.8.1] - 2026-03-08

### Added
- **Queue item context menu**: Click the ⋮ (three-dot) menu button on any queue item to Remove, Upload Now, or Schedule items
- **Right-click context menu**: Full context menu support for Windows, Mac (right-click or ctrl-click)
- **Confirmation dialogs**: Remove Item now requires confirmation to prevent accidental deletion
- Multi-selection support for context menu actions

## [0.8.0] - 2026-03-07

### Added
- **Manual photo scheduling**: Items can now be scheduled for a specific upload time within the current queue
- **Enhanced visual feedback**: Added toast notifications and confirmation dialogs for user actions
- **Improved queue management**: Better UI/UX for group management and batch operations
- Automatically reorder manually scheduled items to their correct position when modified

## [0.7.9] - 2026-03-06

### Security
- **Encrypted credential storage**: Sensitive credentials (API Secret, OAuth tokens) now encrypted using Electron's `safeStorage` API
  - Windows: DPAPI encryption
  - macOS: System Keychain
  - Linux: User credential store

### Added
- **System tray support**: Minimize to system tray on Windows
- **Menu bar support**: Verified status menu bar on macOS

## Earlier versions

See [WISHLIST.md](WISHLIST.md) for completed features from earlier versions.
