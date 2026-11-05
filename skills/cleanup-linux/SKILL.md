---
name: cleanup-linux
description: Linux-specific cleanup knowledge — freedesktop Trash behavior with and without a desktop session, safe cache and package-cache locations, root-only paths, and the Linux locations that must never be touched.
whenToUse: When the target machine is Linux (process.platform === 'linux') and a cleanup task is starting.
---

# Linux cleanup knowledge

## Trash

Linux has no built-in trash; the freedesktop.org Trash specification is an agreement between
desktop environments and tools:

- Home trash: `${XDG_DATA_HOME:-$HOME/.local/share}/Trash`
  (files in `files/`, metadata in `info/`).
- Other volumes: `<mountpoint>/.Trash/<uid>` or `<mountpoint>/.Trash-<uid>`.
- Implemented by `gio trash` (GLib), `trash-cli` (`trash-put`), and file managers. A terminal-only
  server without GLib/`gio` or `trash-cli` has **no trash at all**.

The user's standing decision for this agent: **when the machine has no desktop environment or no
usable trash, direct deletion is the normal path** — but it still needs the manifest, the
"不可恢复" warning in the question, and an explicit confirmation for those rows. Do not refuse a
worker server just because it has no trash; do refuse to delete without confirmation.

Probe:

```bash
command -v gio && gio trash --help >/dev/null 2>&1 && echo gio-trash
command -v trash-put && echo trash-cli
test -d "${XDG_DATA_HOME:-$HOME/.local/share}/Trash" && echo home-trash-present
printf '%s\n' "${XDG_CURRENT_DESKTOP:-none}"          # empty/none: no desktop session
df -P "/path/in/scope" | awk 'NR==2 {print $2, $6}'    # same filesystem as home?
findmnt -no FSTYPE,SOURCE "/path/in/scope"
```

`gio trash` cannot trash items on a different mount point than the home trash unless the volume
has its own `.Trash-<uid>`; it will error rather than silently cop. Copying into the home trash is
not what the spec wants and wastes space — report instead.

Preferred commands:

```bash
gio trash -- "/full/path/with spaces"      # may print a warning and still succeed
trash-put -- "/full/path"                  # when trash-cli is installed
```

Permanent deletion, only after an explicit per-item confirmation:

```bash
rm -rf -- "/full/path"                     # never with a glob, never a bare directory you did not enumerate
```

Never empty `~/.local/share/Trash`, never delete `Trash/files` or `Trash/info` as a "cleanup",
and never run `rm -rf ~/.cache` wholesale — enumerate the children instead.

## Safe candidates (L1)

- `~/.cache/*` — per-app caches. Enumerate children; some apps keep state there
  (`~/.cache/thumbnails` is safe, `~/.cache/mozilla` holds profile bits — prefer the specific
  `cache2` folder).
- `~/.local/share/Trash/expunged`, `~/.cache/thumbnails`
- `/tmp` and `/var/tmp` — only user-owned stale items (older than a few days); both may be shared
  between users, and `/tmp` is often tmpfs, so deleting frees memory rather than disk.
- Journal: `journalctl --disk-usage`, then `journalctl --vacuum-size=200M` or
  `--vacuum-time=7d` (needs root; it is a documented command, not a file delete).
- `/var/log/*.gz`, `/var/log/*.1`, rotated logs — root needed; do not touch live logs
  (`syslog`, `journal`, files still held open).
- `/var/crash/*`, `~/.local/share/systemd/coredump` (or `/var/lib/systemd/coredump`, root).
- Package caches:
  - Debian/Ubuntu: `/var/cache/apt/archives/*.deb` (root), `apt-get clean` / `apt-get autoclean`
  - Fedora/RHEL: `/var/cache/dnf`, `dnf clean all`
  - Arch: `/var/cache/pacman/pkg` (root), `paccache -r` keeps the last 3 versions
  - openSUSE: `/var/cache/zypp/packages`, `zypper clean`
- Flatpak: unused runtimes — `flatpak uninstall --unused` (interactive; needs the user's yes).
- Snap: old revisions — `snap list --all` then `snap remove <name> --revision=<rev>`.
  Never delete `/snap` contents by path.
- Tool caches: `~/.npm/_cacache`, `~/.cache/pnpm`, `~/.cache/yarn`, `~/.cache/pip`,
  `~/.cargo/registry/cache`, `~/.cache/go-build`, `~/.gradle/caches`, `~/.m2/repository`
  (the last three L2 — re-download on next build).
- X11/Wayland session leftovers: `~/.cache/<app>` from crashed apps, old `~/.Xauthority` copies
  (only when no session is running).

## Safe but visible (L2)

- Uninstall leftovers: `~/.config/<app>`, `~/.local/share/<app>`, `/etc/<app>` (root),
  `~/.config/systemd/user/<app>.service` — only after confirming the package is gone
  (`command -v <app>`, `dpkg -l | grep <app>`, `rpm -q <app>`, `pacman -Q <app>`).
  Consequence: settings, sessions, and local state for that app are lost.
- Old kernels: `dpkg --list | grep linux-image` / `dnf repoquery --installonly`. Only through the
  package manager, only with the user's confirmation, and always keep the running kernel plus one
  fallback. Never `rm` kernel files in `/boot` — that can make the machine unbootable.
- `/var/lib/docker`, `/var/lib/containerd` — never deleted as files. Use
  `docker system prune` / `docker image prune` only on explicit request; it removes images the
  user may need offline.
- `/opt/<vendor>` leftovers — only when the product is gone and the user names it.
- `~/Downloads` installers (`.deb`, `.rpm`, `.AppImage`, tarballs) — Downloads is user data: only
  when named, only clearly-installed-and-no-longer-needed rows.
- `/var/tmp` items older than 30 days — L2 when they look like build leftovers.
- Swap files (`/swapfile`) — OS configuration, not a cleanup target.

## Never touch (L0)

- `/boot`, `/efi`, `/lib/modules` (kernels/modules), `/etc` system configuration (except a
  confirmed app config directory), `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/opt` OS parts.
- `/var/lib/dpkg`, `/var/lib/rpm`, `/var/lib/pacman`, `/var/lib/flatpak` metadata.
- `/proc`, `/sys`, `/dev`, `/sysroot`, `/run` live state.
- `/etc/fstab`, `/etc/passwd`, `/etc/shadow`, `/etc/ssh`, `/root/.ssh`.
- `.ssh`, `.gnupg`, password manager vaults, license/activation files.
- The DSH install tree and `~/.dsh` (any DSH directory).

## Pitfalls

- **Deleted-but-open files.** `lsof +L1` shows files whose space is still held by a process;
  deleting the path does not free space. Report them and suggest restarting the service.
- **Symlinks.** `/tmp` is full of symlinks; never follow one out of scope. Use `-P`/`--no-dereference`
  where relevant, and `realpath` to check the resolved target before deleting.
- **Mount points inside the tree.** A directory under a candidate may be another filesystem;
  `findmnt -R /path` first, and never cross it without saying so.
- **Immutable files.** `lsattr` shows `i`; `rm` fails with "Operation not permitted" even for
  root. Report; do not `chattr -i` unless asked.
- **Snap/Flatpak mounts.** `/snap/core*`, `/var/lib/snapd/snap`, `/var/lib/flatpak` appear as
  directories owned by the system; deleting them breaks the package manager.
- **tmpfs.** `/tmp`, `/run` may be RAM; deleting frees memory, not disk — do not count them as
  disk reclaimed.
- **Root versus user.** Deleting under `/var`, `/etc`, `/opt` needs root; if the session is not
  privileged, list those items as "需要管理员权限" and stop rather than escalating silently.
- **Case-sensitive filesystems.** Assume case-sensitive on Linux; do not "fix" paths by case.
