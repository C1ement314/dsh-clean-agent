# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
