---
name: cleanup-windows
description: Windows-specific cleanup knowledge — safe leftover locations, Recycle Bin behavior and probe, elevation and lock pitfalls, and the Windows locations that must never be touched.
whenToUse: When the target machine is Windows (process.platform === 'win32') and a cleanup task is starting.
---

# Windows cleanup knowledge

Path notation: `%VAR%` is an environment variable; always resolve it to a real path in the manifest.

## Recycle Bin

Windows' Recycle Bin is per-volume (`<volume>:\$Recycle.Bin\<SID>`), backed by the Shell API.
Every modern Windows volume gets one automatically, but it silently fails in these cases:

- The volume is FAT32, exFAT, or a network/UNC path → **no recycle bin**, deletion is permanent.
- The volume is removable (USB) → the bin exists only if the user enabled it for that drive.
- The bin's quota is exceeded or the item is larger than the quota → the Shell may bypass the
  bin and delete permanently. Never assume; check.
- The file is locked or in use, or the path exceeds the Shell's limit (roughly 260 chars) → the
  operation fails, it does not silently delete.
- The path contains a reparse point/junction pointing to another volume → the bin follows the
  target volume's rules.

Preferred command (works for files and directories, real trash, no GUI):

```powershell
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('C:\full\path\to\file', 'OnlyErrorDialogs', 'SendToRecycleBin')
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('C:\full\path\to\dir', 'OnlyErrorDialogs', 'SendToRecycleBin')
```

`OnlyErrorDialogs` still raises an exception/returns a dialog in some cases; catch it and report.
Prefer one call per explicit path. Do **not** use `Remove-Item -Recurse -Force` for anything that
should be recoverable, and never use `cmd /c del /s /q`.

Permanent deletion (only after an explicit, per-item confirmation):

```powershell
Remove-Item -LiteralPath 'C:\full\path' -Recurse -Force -ErrorAction Stop
```

`-LiteralPath` matters: `[` and `]` in paths are wildcards to `-Path`.

Probe before promising:

```powershell
# Filesystem type of the target volume (NTFS/ReFS can have a bin, FAT32/exFAT cannot)
Get-Volume -DriveLetter C | Select-Object FileSystem, FileSystemType, DriveType, SizeRemaining
# Is the per-volume bin present and writable?
Test-Path 'C:\$Recycle.Bin'
```

Canary test (recommended once per session, on the target volume): create a tiny file in the
target directory, send it to the bin with the command above, and check the item appeared in
`C:\$Recycle.Bin` (newest subfolder). If the canary disappears but nothing appears in the bin,
the bin is not usable — treat the volume as permanent-delete territory and say so.

Never empty the bin, never touch `C:\$Recycle.Bin\*` directly, and never disable the bin.

## Safe candidates (L1 — regenerates itself)

- `%TEMP%` (usually `C:\Users\<user>\AppData\Local\Temp`) — user temp; skip files in use.
- `C:\Windows\Temp` — the one allowed directory under `C:\Windows`; system temp, needs elevation
  for some items, skip locked files, list it explicitly.
- `%LOCALAPPDATA%\CrashDumps`
- `%LOCALAPPDATA%\Microsoft\Windows\WER\ReportQueue` and `...\ReportArchive`
- `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db` — usually locked; report as skipped.
- `%LOCALAPPDATA%\Microsoft\Windows\INetCache`
- `%LOCALAPPDATA%\Packages\<package>\LocalCache` and `...\TempState` — UWP app caches; some apps
  log out or re-download content, so treat as L1 with a note.
- `%LOCALAPPDATA%\D3DSCache`, `%LOCALAPPDATA%\NVIDIA\DXCache`, `%LOCALAPPDATA%\NVIDIA\GLCache`
- Browser caches, only the cache subfolders (never the profile root):
  - Chrome/Edge: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cache`, `...\Code Cache`,
    `...\GPUCache`, `...\Service Worker\CacheStorage`
  - Firefox: `%LOCALAPPDATA%\Mozilla\Firefox\Profiles\<profile>\cache2`
- Developer/tool caches (all L1): `%LOCALAPPDATA%\npm-cache`, `%LOCALAPPDATA%\pnpm\store`,
  `%LOCALAPPDATA%\Yarn\Cache`, `%LOCALAPPDATA%\pip\Cache`, `%USERPROFILE%\.cargo\registry\cache`,
  `%LOCALAPPDATA%\go-build`, `%LOCALAPPDATA%\Temp\chocolatey`, `%USERPROFILE%\.gradle\caches`,
  `%USERPROFILE%\.m2\repository` (L2 — re-downloads on next build).
- `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cache` etc. — same shape as Chrome.

## Safe but visible (L2)

- Uninstall leftovers: `%LOCALAPPDATA%\<Vendor>\<App>`, `%APPDATA%\<Vendor>\<App>`,
  `%PROGRAMDATA%\<Vendor>\<App>` when the app is no longer installed. Confirm the app really is
  gone (`Get-Package`, `winget list`, the uninstall registry keys first). Consequence: settings,
  recent files, and login sessions for that app are gone for good.
- Old installers in `%USERPROFILE%\Downloads` — but Downloads is user data: only when the user
  named it, and only rows that are clearly installers (`*setup*.exe`, `*.msi`, `*.msix`).
- `C:\Windows.old` — previous Windows installation. Huge, L2, and cannot go to the bin in one
  piece; permanent delete after an explicit confirmation that the rollback is no longer needed.
  Prefer the documented path: `cleanmgr` / Settings → System → Storage, or
  `Dism /Online /Cleanup-Image /StartComponentCleanup` for the component store (asks first).
- `C:\Windows\SoftwareDistribution\Download` — Windows Update downloads; stop the service first
  (`Stop-Service wuauserv`), delete the contents (not the folder), restart it. L2.
- `C:\Windows\Prefetch` — safe but costs cold-start time; L2 and never propose it by default.
- Memory dumps: `C:\Windows\MEMORY.DMP`, `C:\Windows\Minidump\*` — L2, and mention that they are
  useful if the machine is being debugged.
- `C:\ProgramData\Package Cache` — installer cache for Visual C++ redistributables and Visual
  Studio. L2 **only with a warning**: deleting it breaks repair/uninstall of those products.
- Old drivers: `pnputil /enum-drivers` then `pnputil /delete-driver oemXX.inf` for old versions.
  Never bulk-delete; L2 with a per-driver confirmation and a note about rollback.
- `%LOCALAPPDATA%\Microsoft\Windows\ActionCenterCache`, `...\Notifications` — L1/L2.

## Never touch (L0)

- Anything under `C:\Windows` except `C:\Windows\Temp` (and `C:\Windows.old` as an explicit L2).
- `System32`, `SysWOW64`, `WinSxS` (hard links — deleting breaks the component store),
  `C:\Windows\Installer` (MSI cache: deleting breaks repair and uninstall),
  `C:\Windows\assembly`, `C:\Windows\servicing`, `$WinREAgent`, `Recovery`.
- `C:\Program Files`, `C:\Program Files (x86)` contents (uninstall properly instead).
- `pagefile.sys`, `hiberfil.sys`, `swapfile.sys` (configure the OS instead of deleting).
- `C:\ProgramData\Microsoft\*` OS data, `C:\Boot`, `C:\EFI`, `System Volume Information`.
- The DSH install tree and `%USERPROFILE%\.dsh` (any DSH directory).
- Any `C:\$Recycle.Bin\*` content (emptying the bin is the user's decision).

## Pitfalls

- **Junctions and reparse points.** `C:\Users\All Users` → `C:\ProgramData`,
  `C:\Users\Default` and app-data links are junctions. Resolve with
  `Get-Item -Force | Select-Object LinkType, Target` before deleting anything that might be one.
  Deleting a junction's *contents* by mistake hits the real target.
- **Long paths.** Over ~260 characters, `Remove-Item` fails unless long-path support is on. Use
  the `\\?\` prefix (`\\?\C:\very\long\...`) and report rather than truncate.
- **Locked files.** Antivirus, indexer, browsers, and running installers hold handles. Skip and
  report; never force with `handle`/`procexp` style tools unless the user asks.
- **Elevation.** `C:\Windows\Temp`, `C:\ProgramData`, and `C:\Windows.old` need an elevated
  shell; if the session is not elevated, say so and keep to the user-writable locations.
- **OneDrive placeholders.** Files in a synced folder may be cloud-only stubs; deleting them
  deletes the cloud copy. Never touch a synced folder as "local cache".
- **Duplicate space reporting.** Hard links and junctions make naive totals lie; sum with
  `Get-ChildItem -Recurse -Force -File | Measure-Object Length -Sum` and state that it is an
  upper bound.
- **PowerShell version.** `Get-Volume` needs Windows 8+; on older hosts fall back to
  `Get-WmiObject Win32_LogicalDisk`.
