/**
 * Skill provider for the Cleanup Mode bundle.
 *
 * A preset cannot point `skill-filesystem` at a directory it does not know the
 * absolute path of, so this bundle ships the knowledge base itself: the plugin
 * registers every `skills/<name>/SKILL.md` as a skill, resolved from its own
 * module URL. That keeps the skills preset-scoped (they only exist where the
 * preset mounts this plugin) and makes the path correct for both a registry
 * install and a `link:` development install.
 *
 * No dependencies outside Node builtins on purpose: a plugin that imports
 * `@deepseek-ai/*` at runtime cannot load from a linked workspace package.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Provider name registered on `ctx.skills`. */
const PROVIDER = 'dsh-cleanup'

/** Rank of a bundled skill root; see `@deepseek-ai/dsh-skill`. */
const BUNDLED_SKILL_RANK = 600

/** Cordis plugin identity. */
const name = 'skill-cleanup'

/** Registry used by this provider. */
const inject = ['skills']

/**
 * Parse the small subset of YAML frontmatter a skill file needs: scalar keys,
 * quoted scalars, and folded indented continuations. Keeping this in-tree
 * avoids a runtime `yaml` dependency; skill files are authored here, so the
 * supported subset is known.
 *
 * @param {string} raw - whole file
 * @param {string} path - file path, for diagnostics
 * @returns {{ fields: Record<string, string>, content: string }}
 */
function parseSkill(raw, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match === null) throw new Error(`skill-cleanup: ${path} has no YAML frontmatter`)
  const fields = {}
  let currentKey = null
  for (const line of match[1].split(/\r?\n/)) {
    if (currentKey !== null && /^\s+\S/u.test(line)) {
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim()
      continue
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
    if (pair === null) {
      currentKey = null
      continue
    }
    currentKey = pair[1]
    const rawValue = pair[2]
    if (rawValue === '|' || rawValue === '>' || rawValue === '|-' || rawValue === '>-') {
      fields[currentKey] = ''
      continue
    }
    fields[currentKey] =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue
  }
  return { fields, content: raw.slice(match[0].length).trim() }
}

/** Load one skill directory into a catalog candidate. */
function readCandidate(directory) {
  const locator = join(directory, 'SKILL.md')
  const { fields } = parseSkill(readFileSync(locator, 'utf8'), locator)
  const skillName = fields.name
  const description = fields.description
  if (skillName === undefined || skillName.length === 0) throw new Error(`skill-cleanup: ${locator} has no name`)
  if (description === undefined || description.length === 0) {
    throw new Error(`skill-cleanup: ${locator} has no description`)
  }
  return {
    name: skillName,
    description,
    ...(fields.whenToUse === undefined ? {} : { whenToUse: fields.whenToUse }),
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER,
    source: 'bundled',
    rank: BUNDLED_SKILL_RANK,
    resourceBase: { kind: 'directory', path: directory.split(sep).join('/') },
    locator,
  }
}

/**
 * Register the bundled cleanup knowledge base.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - context carrying `ctx.skills`
 */
function apply(ctx) {
  const root = fileURLToPath(new URL('../skills/', import.meta.url))
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readCandidate(join(root, entry.name)))

  const provider = {
    name: PROVIDER,
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const { content } = parseSkill(
        await readFile(locator, { encoding: 'utf8', signal: options.signal }),
        locator,
      )
      return { ...summary, content }
    },
  }

  ctx.skills.registerProvider(() => provider)
}

export { apply, inject, name }
