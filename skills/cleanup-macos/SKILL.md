---
name: cleanup-macos
description: macOS-specific cleanup knowledge — Trash behavior per volume, safe cache locations, SIP and Time Machine pitfalls, and the macOS paths that must never be touched.
whenToUse: When the target machine is macOS (process.platform === 'darwin') and a cleanup task is starting.
---

# macOS cleanup knowledge

## Trash

- The boot volume's Trash is `~/.Trash` (per user, same filesystem as `/Users`).
- Every other volume gets `<volume>/.Trashes/<uid>`; it is created on first use and needs
  ownership of the volume root.
- Network volumes, read-only volumes, and volumes mounted without a Trash have **no** Trash:
  deletion there is permanent.
- Moving a file into `~/.Trash` with `mv` is only recovery-equivalent when the file is on the
  same volume as `/Users`; a cross-volume `mv` is a copy+delete and can lose metadata.
- Prefer the Finder route for correctness (it registers the item properly and can ask for
  permissions):

```bash
osascript -e 'tell application "Finder" to delete (POSIX file "/full/path/with spaces" as alias)'
```

  This requires Automation permission for Finder; if it is denied the command fails loudly —
  report it, do not fall back to `rm` without asking.
- Fallback for same-volume items:

```bash
mv -n "/full/path/with spaces" "$HOME/.Trash/"
```

  `-n` prevents overwriting an existing same-named item; if it refuses, ask the user.

Probe before promising:

```bash
# Is the trash usable for the volume that holds the target path?
df -P "/path/in/scope" | awk 'NR==2 {print $1, $6}'
mount | grep -E '\((ro|.*read-only)'      # read-only mounts
test -w "$HOME/.Trash" && echo trash-writable
test -d "/Volumes/External/.Trashes/$(id -u)" && echo volume-trash-present
```

For a non-boot volume, use `osascript` (the Finder creates/uses `.Trashes`) rather than assuming
`~/.Trash` is reachable.

Never empty `~/.Trash`, never delete `~/.Trash` itself, never run `rm -rf ~/.Trash/*` as a
"cleanup" step.

## Safe candidates (L1)

- `~/Library/Caches/*` — per-app caches. Some apps store more than a cache here; only delete
  subfolders you can identify, and prefer `~/Library/Caches/<app>` over the whole tree.
- `~/Library/Logs`, `~/Library/Logs/DiagnosticReports`
- `~/Library/Application Support/<App>/Cache`, `.../Caches`, `.../GPUCache` (Electron apps)
- `~/Library/Saved Application State` — window state; safe, apps reopen at defaults.
- `~/Library/Containers/<bundle-id>/Data/Library/Caches` — sandboxed app caches.
- `$TMPDIR` (`/var/folders/xx/.../T/`) — per-user temp; the OS cleans it, delete only
  user-owned stale items.
- `~/Library/Developer/Xcode/DerivedData` and `~/Library/Developer/Xcode/iOS DeviceSupport`
  (L1/L2 — the latter re-downloads on the next device connection).
- `~/Library/Developer/CoreSimulator/Caches` — L2, simulators may need a rebuild.
- Homebrew: `~/Library/Caches/Homebrew` (L1) and `brew cleanup` (asks nothing, deletes old
  versions; run only with the user's confirmation).
- Tool caches: `~/.npm/_cacache`, `~/Library/pnpm/store`, `~/Library/Caches/Yarn`,
  `~/Library/Caches/pip`, `~/.cargo/registry/cache`, `~/go/pkg/mod/cache` (L1/L2),
  `~/.gradle/caches`, `~/.m2/repository` (L2 — re-downloads on next build).
- `.DS_Store` files — L1, only when the user is tidying a tree they named.
- Browser caches: `~/Library/Caches/Google/Chrome`, `~/Library/Caches/com.apple.Safari`,
  `~/Library/Caches/Firefox/Profiles/*/cache2` — never the profile roots
  (`~/Library/Application Support/Google/Chrome`), those are user data.

## Safe but visible (L2)

- Uninstall leftovers: `~/Library/Application Support/<App>`, `~/Library/Preferences/<bundle-id>.plist`,
  `~/Library/Saved Application State/<bundle-id>.savedState`, `~/Library/Containers/<bundle-id>`,
  `~/Library/Group Containers/<group>` — only after confirming the app is gone. Consequence:
  settings and local data for that app are lost.
- `~/Library/Application Support/MobileSync/Backup/*` — iOS device backups. **User data**: only
  on explicit request, never proposed. Consider stating the date of each backup.
- `~/Library/Developer/Xcode/Archives` — build archives for App Store submission. User data, L3.
- `~/Downloads` installers (`.dmg`, `.pkg`, `.zip` from a vendor) — only when named.
- `~/Movies/*.imovielibrary` fragments, Final Cut render files — user data, L3.
- `~/Library/Application Support/Steam/steamapps/shadercache`,
  `~/Library/Application Support/Steam/appcache` — L2, re-downloaded.
- Time Machine local snapshots — **not files**: `tmutil listlocalsnapshots /` and
  `tmutil deletelocalsnapshots <date>`. Needs the user's confirmation, and space reporting is
  "purgeable", not free. Do not attempt to delete snapshot files by path.
- `/Library/Caches`, `/Library/Logs` — need admin; the shell usually runs unprivileged, so
  report instead of forcing `sudo`.

## Never touch (L0)

- `/System`, `/usr` (except `/usr/local` which is yours/Homebrew), `/bin`, `/sbin`, `/etc`,
  `/private/var/db`, `/private/var/vm`, `/Library/Apple`, `/Library/Extensions`,
  `/System/Library`, `System Integrity Protection` paths (writes fail even as root).
- `/Applications/*.app` bundles — uninstall properly; deleting bundles leaves the app's
  LaunchAgents and receipts behind.
- `~/Library/Keychains`, `~/Library/Mobile Documents` (iCloud Drive), `~/Library/CloudStorage`
  (which contains cloud-only placeholders — deleting can delete the cloud copy).
- `.ssh`, `.gnupg`, password manager vaults, license/activation files.
- The DSH install tree and `~/.dsh` (any DSH directory).

## Pitfalls

- **SIP**: writes to protected paths fail with "Operation not permitted" even with `sudo`.
  Report; do not disable SIP.
- **Filesystem case-insensitivity**: APFS is case-insensitive by default; two paths that differ
  in case are the same file.
- **APFS clones and purgeable space**: reported size can overstate what deletion frees; say
  "预计释放" and verify with `df -h` afterwards.
- **Cloud placeholders**: `~/Library/Mobile Documents`, `~/Library/CloudStorage` — deleting a
  stub deletes the item in the cloud.
- **Symlinks and firmlinks**: `/Users` and `/Applications` are firmlinks into
  `/System/Volumes/Data`; resolve with `readlink`/`realpath` before deleting.
- **Locked files**: `chflags uchg` items need an unlock; in-use files cannot be trashed. Report.
- **Automation permissions**: the first `osascript` call may need user approval in System
  Settings → Privacy & Security → Automation. If it is denied, ask the user to allow it or use
  the same-volume `mv` fallback with their consent.
