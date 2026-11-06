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
3. **Measure** — `clean_scan` (tree totals, largest subdirectories, largest files) and
   `clean_dupes` (duplicate groups by size + SHA-256) turn "this folder looks big" into numbers;
   both never follow links and both report when a walk was truncated.
4. **Classify** — L1 (regenerates itself), L2 (safe but visible consequence), L3 (user data).
   Uninstall residue is L2 only with evidence that the product is gone (uninstall keys, package
   database, receipts); otherwise it stays L3.
5. **Manifest** — a table with every path, size, why it is a leftover, and what you lose.
6. **Confirm** — one confirmation for L1, grouped confirmations for L2, item by item for L3.
7. **Delete** — trash first; permanent deletion only where no trash exists, and only after a
   separate "cannot be recovered" confirmation.
8. **Audit** — `manifest.json`, `deleted.csv` and `protected.json` in a per-OS audit directory.
9. **Report with real numbers** — free space is measured before the first deletion and after the
   last one, so the report separates measured delta from estimated reclaim; it also lists what was
   skipped, what needs a re-login or a reboot, and reminds you that trashed files free nothing until
   the trash is emptied.

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

### Shell tool preference

The agent uses one shell tool, preferring `ops_bash` (the OPS bundle's Bash terminal) when the
profile publishes it, then `pwsh` on Windows or `bash` elsewhere. The skills are written for
PowerShell on Windows and bash on POSIX, so the agent adapts the command syntax to whichever tool
it actually has.

The bundle also ships `clean_shell`, its own tool row, as the last resort. It is a **wrapper over
the same host shell executor** the official tool uses — PowerShell on Windows (pwsh 7 when present,
otherwise Windows PowerShell 5.1), bash elsewhere — so sandbox policy, timeouts, output limits and
the session working directory still come from DSH. Nothing is installed and no second shell
implementation is involved; only the model-facing tool name is ours, which is why profile policies
that hide `pwsh`/`bash` by name do not hide it.

### Known incompatibility: profiles that deny host shell tools

A profile can hide the official shell tools on purpose. The `dsh-ops` bundle offers this through
its `dsh-ops/shell` component with `shellPolicy: deny-host-shell`, which denies `pwsh`, `bash` and
`pwsh_persistent` for every agent. A preset that mounts `@deepseek-ai/dsh-tool-pwsh` then has the
tool registered but filtered out of the model's tool list. Cleanup Mode needs a shell to measure
sizes, probe the trash and delete, so it stops at step one and tells you what is missing.

Fix it on the profile side: remove `pwsh` from that component's `deniedHostTools`, or do not enable
the deny policy. Another option is to enable the OPS `shell` component in `advise` mode, which
publishes `ops_bash` for every session — the agent then prefers it automatically.

Note that the `dsh-ops` **mode rows** (`dsh-ops/mode-standard` and friends) only serve their own
four built-in presets: `ops_bash` is gated by preset id, so a custom preset such as this one does
not receive it from a mode row. The component form above is not gated that way.

## Install

```bash
# from npm (recommended)
dsh plugin --profile <profile> add dsh-clean-agent@0.2.1

# or from the prebuilt tarball (same version, no npm account needed)
dsh plugin --profile <profile> add https://github.com/C1ement314/dsh-clean-agent/releases/download/v0.2.1/dsh-clean-agent-0.2.1.tgz

# from a checkout (development): point the manager at this directory
plugin_manager → action: install_bundle, target: <absolute path to this directory>

# or from the CLI against a profile
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-clean-agent
```

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
