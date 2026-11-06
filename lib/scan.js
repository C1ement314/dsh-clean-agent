/**
 * `clean_scan` and `clean_dupes` — read-only reconnaissance tools for the
 * Cleanup Mode preset.
 *
 * Both are zero-dependency and deliberately conservative:
 * - symlinks, junctions and reparse points are never followed (they are counted
 *   and skipped), so a scan cannot walk out of the requested tree;
 * - every walk has an entry budget and a deadline, and reports when it stopped
 *   early instead of pretending the result is complete;
 * - permission errors are collected per path, not thrown, so a scan of a system
 *   directory still returns the part it could read;
 * - nothing is written, moved or deleted.
 *
 * They read through Node's filesystem directly (the tools run in the host
 * process). The preset requires full filesystem access anyway, and the read path
 * never mutates.
 */
import { createReadStream } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

/** Cordis plugin identity. */
const name = 'clean-scan-tools'

/** Services this plugin needs. */
const inject = ['tools', 'systemPrompt']

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_ENTRIES = 200_000
const DEFAULT_TOP = 10
const DEFAULT_MAX_DEPTH = 8
const DEFAULT_MAX_FILES = 200_000
const DEFAULT_MIN_BYTES = 1024
const DEFAULT_MAX_HASH_BYTES = 512 * 1024 * 1024

const SCAN_DESCRIPTION = [
  'Measure a directory tree and return its size distribution: total bytes/files/directories,',
  'the largest immediate subdirectories, and the largest individual files with mtimes.',
  'Read-only. Symlinks and junctions are counted but never followed. The walk has an entry',
  'budget and a deadline; `truncated` says whether the numbers cover only part of the tree.',
  'Use it before building a cleanup manifest and once more after executing to compare.',
].join(' ')

const DUPES_DESCRIPTION = [
  'Find duplicate files under a directory: group by size, then hash only the size-collision',
  'groups with SHA-256, and return the groups that waste the most bytes first.',
  'Read-only. Symlinks and junctions are never followed. Files above `maxHashBytes` are',
  'reported as unhashed instead of being read fully.',
].join(' ')

/** Format bytes for the text rendering. */
function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(2)} ${units[unit]}`
}

/** Clamp an optional numeric argument. */
function clampInt(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * Walk one tree: totals, per-immediate-child buckets and the largest files.
 * Never follows links; per-path failures are collected, not thrown.
 */
async function walkTree(root, options) {
  const started = Date.now()
  const deadline = started + options.timeoutMs
  let bytes = 0
  let files = 0
  let dirs = 0
  let links = 0
  let errors = 0
  let entries = 0
  let truncated = false
  const errorSamples = []
  const largest = []
  const buckets = new Map()

  const noteError = (path, error) => {
    errors += 1
    if (errorSamples.length < 20) errorSamples.push({ path, error: String(error?.message ?? error) })
  }
  const pushLargest = (file) => {
    largest.push(file)
    largest.sort((a, b) => b.bytes - a.bytes)
    if (largest.length > options.top) largest.length = options.top
  }

  const visit = async (directory, depth, bucket) => {
    if (truncated) return
    if (Date.now() > deadline) {
      truncated = true
      return
    }
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      noteError(directory, error)
      return
    }
    dirs += 1
    for (const entry of children) {
      if (truncated) return
      entries += 1
      if (entries > options.maxEntries) {
        truncated = true
        return
      }
      const full = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        links += 1
        continue
      }
      if (entry.isDirectory()) {
        if (depth >= options.maxDepth) {
          truncated = true
          continue
        }
        await visit(full, depth + 1, bucket)
        continue
      }
      if (!entry.isFile()) continue
      let info
      try {
        info = await lstat(full)
      } catch (error) {
        noteError(full, error)
        continue
      }
      files += 1
      bytes += info.size
      if (bucket !== undefined) {
        bucket.bytes += info.size
        bucket.files += 1
      }
      pushLargest({ path: full, bytes: info.size, modified: info.mtime.toISOString() })
    }
  }

  let rootEntries
  try {
    rootEntries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    noteError(root, error)
    rootEntries = []
  }
  dirs += 1
  const rootFiles = { path: root, bytes: 0, files: 0 }
  for (const entry of rootEntries) {
    if (truncated) break
    entries += 1
    if (entries > options.maxEntries) {
      truncated = true
      break
    }
    const full = join(root, entry.name)
    if (entry.isSymbolicLink()) {
      links += 1
      continue
    }
    if (entry.isDirectory()) {
      if (options.maxDepth < 1) continue
      const bucket = { path: full, bytes: 0, files: 0 }
      buckets.set(entry.name, bucket)
      await visit(full, 1, bucket)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const info = await lstat(full)
      files += 1
      bytes += info.size
      rootFiles.bytes += info.size
      rootFiles.files += 1
      pushLargest({ path: full, bytes: info.size, modified: info.mtime.toISOString() })
    } catch (error) {
      noteError(full, error)
    }
  }

  const topDirs = [...buckets.values()].sort((a, b) => b.bytes - a.bytes).slice(0, options.top)
  return {
    root,
    bytes,
    files,
    dirs,
    links,
    errors,
    truncated,
    elapsedMs: Date.now() - started,
    topDirs,
    largestFiles: largest.slice(0, options.top),
    errorSamples,
  }
}

/** Resolve a user path to an absolute directory, refusing non-directories. */
async function resolveDirectory(path) {
  const absolute = resolve(path)
  const info = await stat(absolute)
  if (!info.isDirectory()) throw new Error(`clean_scan: ${absolute} is not a directory`)
  return absolute
}

/** Tool definition: directory size distribution. */
const scanTool = {
  name: 'clean_scan',
  description: SCAN_DESCRIPTION,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', description: 'Absolute or relative directory to measure.' },
      top: { type: 'number', description: `How many largest children/files to return (default ${DEFAULT_TOP}).` },
      maxDepth: { type: 'number', description: `Maximum directory depth (default ${DEFAULT_MAX_DEPTH}).` },
      maxEntries: { type: 'number', description: `Entry budget before stopping early (default ${DEFAULT_MAX_ENTRIES}).` },
      timeoutMs: { type: 'number', description: `Deadline in milliseconds (default ${DEFAULT_TIMEOUT_MS}).` },
    },
    required: ['path'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        root: { type: 'string' },
        bytes: { type: 'number' },
        files: { type: 'number' },
        dirs: { type: 'number' },
        links: { type: 'number' },
        errors: { type: 'number' },
        truncated: { type: 'boolean' },
        elapsedMs: { type: 'number' },
        topDirs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              bytes: { type: 'number' },
              files: { type: 'number' },
            },
            required: ['path', 'bytes', 'files'],
          },
        },
        largestFiles: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              bytes: { type: 'number' },
              modified: { type: 'string' },
            },
            required: ['path', 'bytes', 'modified'],
          },
        },
        errorSamples: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              error: { type: 'string' },
            },
            required: ['path', 'error'],
          },
        },
      },
      required: ['root', 'bytes', 'files', 'dirs', 'links', 'errors', 'truncated', 'elapsedMs', 'topDirs', 'largestFiles', 'errorSamples'],
    },
    render(_args, value) {
      const lines = [
        `root: ${value.root}`,
        `total: ${formatBytes(value.bytes)} / ${value.files} files / ${value.dirs} dirs${value.truncated ? ' (TRUNCATED: partial result)' : ''}`,
        `links skipped: ${value.links}; read errors: ${value.errors}; elapsed: ${value.elapsedMs}ms`,
      ]
      if (value.topDirs.length > 0) {
        lines.push('', 'largest directories (immediate children):')
        for (const dir of value.topDirs) {
          lines.push(`  ${formatBytes(dir.bytes).padStart(10)}  ${String(dir.files).padStart(7)} files  ${dir.path}`)
        }
      }
      if (value.largestFiles.length > 0) {
        lines.push('', 'largest files:')
        for (const file of value.largestFiles) {
          lines.push(`  ${formatBytes(file.bytes).padStart(10)}  ${file.modified}  ${file.path}`)
        }
      }
      if (value.errorSamples.length > 0) {
        lines.push('', 'read errors (sample):')
        for (const sample of value.errorSamples) lines.push(`  ${sample.path}: ${sample.error}`)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args) {
    const root = await resolveDirectory(args.path)
    const result = await walkTree(root, {
      top: clampInt(args.top, DEFAULT_TOP, 1, 100),
      maxDepth: clampInt(args.maxDepth, DEFAULT_MAX_DEPTH, 1, 64),
      maxEntries: clampInt(args.maxEntries, DEFAULT_MAX_ENTRIES, 1000, 5_000_000),
      timeoutMs: clampInt(args.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 600_000),
    })
    return result
  },
}

/** Hash one file with SHA-256, streaming so large files do not need the heap. */
function hashFile(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectPromise)
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}

/** Recursively collect candidate files without following links. */
async function collectFiles(root, options) {
  const files = []
  const errors = []
  const deadline = Date.now() + options.timeoutMs
  let entries = 0
  let truncated = false
  let links = 0

  const visit = async (directory, depth) => {
    if (truncated) return
    if (Date.now() > deadline) {
      truncated = true
      return
    }
    let dirEntries
    try {
      dirEntries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (errors.length < 20) errors.push({ path: directory, error: String(error.message ?? error) })
      return
    }
    for (const entry of dirEntries) {
      if (truncated) return
      entries += 1
      if (entries > options.maxEntries) {
        truncated = true
        return
      }
      const full = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        links += 1
        continue
      }
      if (entry.isDirectory()) {
        if (depth >= options.maxDepth) {
          truncated = true
          continue
        }
        await visit(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await lstat(full)
        if (info.size >= options.minBytes) files.push({ path: full, bytes: info.size })
      } catch (error) {
        if (errors.length < 20) errors.push({ path: full, error: String(error.message ?? error) })
      }
      if (files.length >= options.maxFiles) {
        truncated = true
        return
      }
    }
  }

  await visit(root, 0)
  return { files, errors, truncated, links, entries }
}

/** Tool definition: duplicate-file groups. */
const dupesTool = {
  name: 'clean_dupes',
  description: DUPES_DESCRIPTION,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', description: 'Directory to search.' },
      minBytes: { type: 'number', description: `Ignore files smaller than this (default ${DEFAULT_MIN_BYTES}).` },
      topGroups: { type: 'number', description: 'How many duplicate groups to return (default 20).' },
      maxHashBytes: { type: 'number', description: `Skip hashing files larger than this (default ${DEFAULT_MAX_HASH_BYTES}).` },
      timeoutMs: { type: 'number', description: `Deadline in milliseconds (default ${DEFAULT_TIMEOUT_MS}).` },
    },
    required: ['path'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        root: { type: 'string' },
        scannedFiles: { type: 'number' },
        duplicateGroups: { type: 'number' },
        wastedBytes: { type: 'number' },
        unhashedLargeFiles: { type: 'number' },
        truncated: { type: 'boolean' },
        elapsedMs: { type: 'number' },
        groups: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              hash: { type: 'string' },
              bytes: { type: 'number' },
              count: { type: 'number' },
              wastedBytes: { type: 'number' },
              files: { type: 'array', items: { type: 'string' } },
            },
            required: ['hash', 'bytes', 'count', 'wastedBytes', 'files'],
          },
        },
      },
      required: ['root', 'scannedFiles', 'duplicateGroups', 'wastedBytes', 'unhashedLargeFiles', 'truncated', 'elapsedMs', 'groups'],
    },
    render(_args, value) {
      const lines = [
        `root: ${value.root}`,
        `scanned files: ${value.scannedFiles}; duplicate groups: ${value.duplicateGroups}; reclaimable: ${formatBytes(value.wastedBytes)}${value.truncated ? ' (TRUNCATED)' : ''}`,
        `elapsed: ${value.elapsedMs}ms; large files not hashed: ${value.unhashedLargeFiles}`,
      ]
      for (const group of value.groups) {
        lines.push('', `${formatBytes(group.bytes)} × ${group.count} (reclaim ${formatBytes(group.wastedBytes)}):`)
        for (const file of group.files) lines.push(`  ${file}`)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args) {
    const root = await resolveDirectory(args.path)
    const started = Date.now()
    const collected = await collectFiles(root, {
      minBytes: clampInt(args.minBytes, DEFAULT_MIN_BYTES, 1, 1024 * 1024 * 1024),
      maxDepth: DEFAULT_MAX_DEPTH,
      maxEntries: DEFAULT_MAX_ENTRIES,
      maxFiles: DEFAULT_MAX_FILES,
      timeoutMs: clampInt(args.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 600_000),
    })
    const bySize = new Map()
    for (const file of collected.files) {
      const bucket = bySize.get(file.bytes)
      if (bucket === undefined) bySize.set(file.bytes, [file])
      else bucket.push(file)
    }
    const maxHashBytes = clampInt(args.maxHashBytes, DEFAULT_MAX_HASH_BYTES, 1, 64 * 1024 * 1024 * 1024)
    let unhashedLargeFiles = 0
    const groups = []
    for (const [bytes, files] of bySize) {
      if (files.length < 2) continue
      if (bytes > maxHashBytes) {
        unhashedLargeFiles += files.length
        continue
      }
      const byHash = new Map()
      for (const file of files) {
        try {
          const hash = await hashFile(file.path)
          const bucket = byHash.get(hash)
          if (bucket === undefined) byHash.set(hash, [file.path])
          else bucket.push(file.path)
        } catch {
          unhashedLargeFiles += 1
        }
      }
      for (const [hash, paths] of byHash) {
        if (paths.length < 2) continue
        groups.push({
          hash,
          bytes,
          count: paths.length,
          wastedBytes: bytes * (paths.length - 1),
          files: paths.sort(),
        })
      }
    }
    groups.sort((a, b) => b.wastedBytes - a.wastedBytes)
    return {
      root,
      scannedFiles: collected.files.length,
      duplicateGroups: groups.length,
      wastedBytes: groups.reduce((sum, group) => sum + group.wastedBytes, 0),
      unhashedLargeFiles,
      truncated: collected.truncated,
      elapsedMs: Date.now() - started,
      groups: groups.slice(0, clampInt(args.topGroups, 20, 1, 100)),
    }
  },
}

/**
 * Register both tools.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:clean_scan',
    order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'),
    text: '`clean_scan` measures a directory tree (totals, largest subdirectories, largest files) and `clean_dupes` finds duplicate files by size and hash. Both are read-only, never follow links, and report `truncated` when they hit their budget or deadline — treat a truncated scan as a partial answer, never as a complete one.',
  })
  ctx.tools.register(scanTool)
  ctx.tools.register(dupesTool)
}

export { apply, inject, name }
