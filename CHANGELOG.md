# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Known issues
- **Profiles that deny host shell tools.** The `dsh-ops` bundle can hide `pwsh`, `bash` and
  `pwsh_persistent` for every agent through its `dsh-ops/shell` component when
  `shellPolicy: deny-host-shell` is set. The preset's `pwsh` row then registers but the model never
  sees the tool, so the agent stops at step one with an explanation. Fix on the profile side:
  remove `pwsh` from that component's `deniedHostTools`, or do not enable the deny policy.
  Documented in both READMEs.

### Added
- `clean_shell`: a model-facing shell tool that runs through the host shell executor
  (PowerShell on Windows, bash elsewhere), so the preset has a working shell even when a
  profile hides the official `pwsh`/`bash` tools. Zero runtime dependencies; sandbox policy,
  timeouts and output limits still come from DSH.

### Shell preference
- The persona now states the shell tool order explicitly: `ops_bash` (OPS bundle) when the profile
  publishes it, then `pwsh` on Windows or `bash` elsewhere, one tool per step. The `dsh-ops` mode
  rows gate `ops_bash` by preset id and therefore cannot serve this custom preset; its ungated
  `dsh-ops/shell` component can.

### Planned
- Host-side guard plugin that enforces L0 and the protected-path list in code (v2).
- End-to-end validation on macOS and Linux.

## [0.1.0] - 2025-11-05

### Added
- Agent preset `cleanup` (清理模式 / Cleanup Mode) with a safety-first persona prompt:
  manifest before deletion, trash-first, risk tiers L0–L3, prompt-injection resistance,
  and an explicit audit trail.
- Bundled skill provider (`lib/index.js`, no runtime dependencies) that exposes four skills to
  this preset only:
  - `cleanup` — workflow, manifest format, confirmation script, audit layout, report template;
  - `cleanup-windows` — Recycle Bin behavior and probe, safe locations, junction and long-path traps;
  - `cleanup-macos` — Trash per volume, SIP and Time Machine pitfalls, cache locations;
  - `cleanup-linux` — freedesktop Trash with and without a desktop session, package caches,
    root-only paths.
- Bilingual display metadata (`locale/en.json`, `locale/zh.json`) and an original icon.
- Bilingual documentation (`README.md`, `README.zh.md`), MIT license, audit-directory layout and
  protected-path config conventions.
- `docs/testing.md`: bundle-load checks, a safe rehearsal fixture (PowerShell and bash), and
  twelve adversarial cases with expected behaviour.

### Fixed
- The preset failed to mount with `Preset services require isolate realms: compaction`, because
  `compaction-basic` publishes the `compaction` service and the group declaring it carried no
  `isolate`. The compaction group now isolates `compaction` in its own realm, as the shipped
  presets do.

