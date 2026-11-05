# Cleanup Mode (清理模式)

A DSH agent preset for reclaiming disk space and removing leftovers on your own machine —
caches, temp files, logs, uninstall residue, old installers, stale tool caches.

Its defining property is restraint. Cleanup Mode is not a "one click, everything is fast" cleaner:
it discovers with read-only commands, classifies every candidate into a risk tier, writes a
manifest, and deletes only what you confirmed. It prefers the system trash over permanent deletion,
and it refuses to touch operating-system files and the DSH installation.

- 中文说明：[README.zh.md](README.zh.md)
- Works on Windows, macOS and Linux; the bundled knowledge base has a dedicated skill per platform.

## What it does

1. **Interview** — what to reclaim, which volume, what must be preserved.
2. **Discover** — read-only enumeration of known leftover locations for your OS.
3. **Classify** — L1 (regenerates itself), L2 (safe but visible consequence), L3 (user data).
4. **Manifest** — a table with every path, size, why it is a leftover, and what you lose.
5. **Confirm** — one confirmation for L1, grouped confirmations for L2, item by item for L3.
6. **Delete** — trash first; permanent deletion only where no trash exists, and only after a
   separate "cannot be recovered" confirmation.
7. **Audit** — `manifest.json`, `deleted.csv` and `protected.json` in a per-OS audit directory.
8. **Report** — what was freed, what was skipped, what needs a re-login or a reboot, and a
   reminder that trashed files free nothing until the trash is emptied.

## Risk tiers

| Tier | Meaning | Examples | Confirmation |
| --- | --- | --- | --- |
| L0 | Forbidden | OS and boot files, DSH install and profile directories | Refused |
| L1 | Regenerates itself | temp, cache, logs, thumbnails, crash dumps | One confirmation |
| L2 | Safe but visible | uninstall leftovers, old installers, orphaned app data | Grouped, consequence stated |
| L3 | User data / high-risk | documents, media, source, keys, anything uncertain | Only if you name it, item by item |

Hard rules the preset enforces: no deletion without a manifest and an explicit confirmation; no
wildcards in destructive commands; no registry or partition edits; no third-party cleaner installs;
file names and documents are treated as untrusted data, never as instructions.

## Requirements

- DSH `>= 0.2.1-rc.5`.
- **Full filesystem access for the session.** Cleanup targets live outside the workspace, so the
  session sandbox must be `danger-full-access`; with `workspace-write` the agent can only inspect
  and will ask you to raise the permission. The preset cannot grant itself access — that is a
  host-level policy, by design.
- Some locations need administrator/root privileges (`/var`, `C:\Windows\Temp`, `/Library`). The
  agent reports them instead of escalating silently.

## Install

```bash
# from a checkout (development): point the manager at this directory
plugin_manager → action: install_bundle, target: <absolute path to this directory>

# or from the CLI against a profile
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-clean-agent
```

For a published package, install the bundle with `plugin_manager` and select it in the bundle list.
A preset is only picked up by **new** sessions: open a new session and choose 清理模式 /
Cleanup Mode from the preset selector.

If the preset card shows 加载失败, the diagnostic text names the failing plugin row — see
[docs/testing.md](docs/testing.md) for the known failure texts and a safe rehearsal fixture.

## Usage

Ask in plain language:

- 「C 盘快满了，帮我看看能清什么」
- 「清理一下开发工具的缓存，npm/pnpm/go 那些」
- 「看看有没有哪个软件卸载后还剩一堆垃圾」
- 「这台机器没有桌面环境，/var 下能清什么」

The agent will come back with a manifest before it deletes anything.

## What it never touches

OS system and boot files, `WinSxS`, `C:\Windows\Installer`, package-manager databases,
`/System`, `/usr`, `/boot`, `/var/lib/dpkg`, the DSH installation and `~/.dsh`, `.ssh`/`.gnupg`,
password-manager vaults, and cloud-placeholder files (deleting a placeholder deletes the cloud
copy). High-risk locations — Documents, Desktop, Pictures, source repositories — are never
proposed by the agent; it only inspects them when you name them.

## Audit and privacy

Audit records are local only, per OS:

- Windows `%LOCALAPPDATA%\dsh-clean\`
- macOS `~/Library/Application Support/dsh-clean/`
- Linux `${XDG_STATE_HOME:-~/.local/state}/dsh-clean/`

Layout: `audit/sessions/<timestamp>/{manifest.json,deleted.csv,protected.json,report.md}` plus
`config.json` for the protected-path list. Paths are stored verbatim on your machine; nothing is
uploaded. Old sessions rotate after 30 runs.

## v1 scope and limits

This release is prompt + knowledge base only. Two known consequences:

- The agent's guardrails are instructions plus the confirmation flow, not a code-enforced sandbox.
  A future v2 may add a host-side guard plugin that enforces L0 by code.
- Only Windows was exercised end-to-end during development; the macOS and Linux skills are
  documented from their platform semantics and reviewed statically. Treat them as beta — read the
  manifest carefully on those platforms.

## Disclaimer

This software deletes files. It is provided "as is", without warranty of any kind. You are
responsible for the confirmation you give and for keeping backups of anything you care about.
Review the manifest, keep a backup of important data, and read the report before emptying the
trash.

## License

MIT — see [LICENSE](LICENSE).
