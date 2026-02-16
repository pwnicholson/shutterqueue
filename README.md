# ShutterQueue — A paced uploader for Flickr (Electron MVP v0.6b)

## Fixes in v0.6b (based on your latest test)
1. ✅ **API Secret no longer gets wiped on launch** (we were overwriting it with blank when the UI refreshed).
   - Secret stays stored, but is not displayed.
   - “Start Authorization” is enabled if a secret is already stored.
2. ✅ **OAuth should persist** (previously looked “lost” because secret was cleared, making `authed=false`).
3. ✅ **Last Error clears on new app launch** and the app does **not** auto-start uploading.
   - Scheduler will only resume on launch if you enable “Automatically resume scheduler when app restarts”.
4. ✅ **Upload HTTP 401 signature_invalid fixed** by signing Flickr upload request with the correct POST params (excluding the file itself).
5. ✅ Scheduler scheduling options:
   - “Only upload during these times” (supports overnight windows)
   - OR “Only upload on selected days” (disabled when time-window is on)

## Run
```bash
rm -rf node_modules package-lock.json
npm install
npm run dev
```

## v0.6c
- Prevents duplicate uploads: scheduler only uploads items with status `pending`.
- If group/album add fails after a successful upload, item is marked `done (warnings)` and will **not** re-upload.
- Adds Activity Log tab (last 500 events).
- Adds “Clear uploaded” button to remove items that are `done` with no errors.


## Packaging / Distributable Builds (icons included)

This repo includes production icon files in `assets/`:
- `assets/icon.ico` (Windows)
- `assets/icon.icns` (macOS)
- `assets/icon.png` (Linux/dev)

### One-time install for packaging

```bash
npm install
```

### Build a distributable

```bash
npm run dist
```

Outputs go to `release/`.

### Build an unpacked directory (for testing)

```bash
npm run pack
```


## Licenses

Third-party licenses are generated automatically during `npm run dist` / `npm run pack` via `npm run generate-licenses`.
The generated file is `THIRD_PARTY_LICENSES.txt` and is bundled into release artifacts.

The app includes a **View Third-Party Licenses** button in the Setup tab.
