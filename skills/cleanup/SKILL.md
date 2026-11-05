---
name: cleanup
description: Core workflow for the Cleanup Mode agent — discovery, risk tiers, manifest format, confirmation script, trash-first deletion, audit layout, and the final report. Read this first in any cleanup task.
whenToUse: Any task that inspects or reclaims disk space, removes leftovers, or reports what is safe to delete.
---

# Cleanup workflow

Read this skill before touching disk. Then read exactly one platform skill:
`cleanup-windows`, `cleanup-macos`, or `cleanup-linux`. The platform skill carries the
location list, the trash command, and the traps for that OS; this file carries the process
that applies everywhere.

## 1. Interview (short)

Ask only what you cannot infer:

- What should be reclaimed: free space on a specific volume, a specific folder, or general tidiness?
- Which volume(s) are in scope? One volume per manifest.
- Is there anything that must be preserved? (First run of a session — always ask; record the answer.)
- Is a re-login acceptable for browser caches, and is a reboot acceptable for locked files?

Then establish facts with read-only commands: OS and version, filesystem type per volume,
free space, and whether the volume has a usable trash.

## 2. Discover (read-only)

Use the filesystem tools to enumerate candidates from the platform skill's list. Rules:

- No deletion, no "clean" command, no uninstaller during discovery.
- Measure what you find: total bytes and file count per candidate directory.
- Record the producing application and its version when the path encodes it.
- If a candidate is missing, say so and move on — never create it to "check".

## 3. Classify

| Tier | Meaning | Examples | Confirmation |
| --- | --- | --- | --- |
| L0 | Forbidden | OS and boot files, DSH install/profile, this project | Refuse; explain; never ask twice |
| L1 | Regenerates itself | temp, cache, logs, thumbnails, crash dumps, browser cache | One confirmation for the whole manifest |
| L2 | Safe but visible | uninstall leftovers, old installers, old drivers, orphaned app data, update leftovers | Grouped confirmation, consequence stated |
| L3 | User data / high-risk | documents, media, source, keys, anything user-authored, anything uncertain | Only if named by the user, item by item |

Anything you cannot justify as a leftover is L3, not L1. Uncertainty lowers the tier, never raises it.

For every L2 item, state the visible consequence in the manifest: a re-login, a re-download,
a lost recent-files list, a driver rollback that needs the vendor page, and so on.

## 4. Trash availability (probe before you promise)

Probe the trash for the *target volume*, not for the OS. The platform skill has the exact
command. Record the result in the manifest:

- `trash: usable` — the default disposition is 回收站.
- `trash: unusable (<reason>)` — the default disposition is 永久删除, which requires the
  user to confirm those specific rows and to be told the item cannot be recovered.
- `trash: full` — the OS may silently fall back to permanent deletion; stop and ask.

Never promise reclaimed space from trashed files. In the report say
「预计释放（清空回收站后生效）」.

## 5. Manifest

Show a markdown table in the conversation and write the same data to `manifest.json` in the
audit directory:

| Tier | Path | Size | Items | What it is | Why it is a leftover | If deleted | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |

Sort by tier (L1 first), then by size descending. End with a totals block:

```
L1 合计：3.2 GB / 1,240 项（回收站）
L2 合计：1.1 GB / 18 项（回收站，需重新登录一次）
L3 合计：0 项
预计释放（清空回收站后生效）：4.3 GB
永久删除：0 B
```

`manifest.json` shape (one file per session):

```json
{
  "session": "2026-11-05T20-30-00+08-00",
  "platform": "win32 | darwin | linux",
  "volume": "C:",
  "trash": "usable | unusable:reason | full",
  "estimatedBytes": 4300000000,
  "permanentBytes": 0,
  "items": [
    {
      "tier": "L1",
      "path": "C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Temp\\\\foo",
      "bytes": 1234567,
      "files": 42,
      "what": "…",
      "why": "…",
      "loss": "…",
      "disposition": "trash | permanent | keep",
      "protection": "none | conflict"
    }
  ]
}
```

## 6. Confirm

Use the ask-user tool with concrete options, not a rhetorical question. Put the numbers in
the question. Examples:

- L1: 「清单共 1,240 项 / 3.2 GB，全部进回收站。确认执行？」 options: 全部执行 / 只执行前 N 项 / 取消
- L2: 「第 2 组：Chrome 缓存 1.1 GB，进回收站，代价是重新登录一次。确认？」 options: 执行 / 跳过
- L3: 逐项确认，每项单独提问，包含「这是用户数据，我不建议删除」。
- 永久删除：单独一组，问题里必须出现「不可恢复」四个字。

If the user answers "你自己决定", do not delete. Reply that you need an explicit choice and
offer to shrink the manifest to L1 only.

## 7. Execute

For each item, immediately before removing it:

1. Re-stat: exists, same size (within tolerance for logs), same type (file vs directory).
2. Resolve links: if the path is a symlink, junction, or reparse point, resolve the target and
   require it to stay inside the scope; otherwise skip and report.
3. Check the protected list again.
4. Remove with the trash command from the platform skill (explicit path, no globs).
5. Append the row to `deleted.csv` with result and any error.

Batches of at most 200 items; after each batch, sample free space and report progress only
if the batch was long. Stop on the first unexpected error and report it.

Locked or in-use files: skip, keep them in the manifest as 未删除（被占用）, and tell the user
what to close or that a reboot is required. Never force-unlock.

## 8. Audit

Base directory per OS (create with the session's own permissions):

- Windows: `%LOCALAPPDATA%\dsh-clean\`
- macOS: `~/Library/Application Support/dsh-clean/`
- Linux: `${XDG_STATE_HOME:-$HOME/.local/state}/dsh-clean/`

Layout:

```
dsh-clean/
  config.json                  # protected paths + preferences
  audit/
    sessions/<timestamp>/
      manifest.json
      deleted.csv
      protected.json           # snapshot of the protected list used for this run
      report.md
```

`deleted.csv` header:
`timestamp,tier,path,bytes,files,disposition,result,error`

Rotation: when `audit/sessions/` holds more than 30 session folders, delete the oldest ones
(after telling the user) — those are audit records, not junk, so never touch a session folder
the user asked to keep.

Privacy: paths are recorded as-is locally. If the user asks for redaction, replace the user's
home directory prefix with `~` in every file of the session. Never upload anything.

## 9. Report

```
## 清理报告
- 执行时间 / 平台 / 卷
- 已进回收站：X GB / Y 项
- 永久删除：X MB / Y 项
- 跳过：Y 项（原因）
- 需要重新登录 / 重新下载 / 重启：…
- 预计释放（清空回收站后生效）：X GB；当前可用：A GB → 清空后约 B GB
- 审计：<audit path>
- 最可能让你意外的一项：…
- 下一步建议（1–3 条，不做则已）
```

Then remind: 回收站里的东西还没真正释放空间；建议复查审计清单后再清空。

## 10. Pre-flight checklist (all must be yes)

- [ ] Protected list asked and persisted for this session
- [ ] One volume only, scope confirmed
- [ ] Every manifest row stat'ed in this session
- [ ] Trash state probed, permanent rows explicitly flagged
- [ ] Tier granularity matches the confirmation given
- [ ] `manifest.json` written before the first deletion
- [ ] No wildcard, no drive-wide command in the batch
- [ ] Audit directory is writable
