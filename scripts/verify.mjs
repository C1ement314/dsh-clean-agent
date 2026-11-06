/**
 * Local pre-install check for this bundle: no dependencies, no network.
 *
 * Verifies the parts that can be checked without the harness:
 * - the skill provider registers four skills with sane metadata and content;
 * - the scan plugin registers both tools with registry-shaped definitions;
 * - the shell plugin exports the Cordis plugin contract;
 * - package.json exports and the patch file contain the rows the preset needs.
 *
 * Run with `node scripts/verify.mjs` (or `npm run verify`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let failures = 0
const fail = (message) => {
  failures += 1
  console.error(`FAIL: ${message}`)
}
const ok = (message) => console.log(`ok: ${message}`)

// --- package manifest ------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package.json dsh.bundle.patch')
for (const exported of ['./shell', './scan', './icon', './package.json']) {
  if (pkg.exports?.[exported] === undefined) fail(`package.json exports missing ${exported}`)
}
for (const included of ['lib', 'skills', 'locale', 'docs', 'cordis.patch.yml', 'icon.svg']) {
  if (!pkg.files?.includes(included)) fail(`package.json files missing ${included}`)
}

// --- skills ----------------------------------------------------------------
const skillPlugin = await import(new URL('../lib/index.js', import.meta.url).href)
let provider = null
skillPlugin.apply({
  skills: { registerProvider(factory) { provider = factory(); return () => {} } },
})
if (provider === null) fail('skill provider was not registered')
const candidates = await provider.list()
const names = candidates.map((candidate) => candidate.name).sort()
console.log(`ok: skills ${names.join(', ')}`)
if (names.length !== 4) fail(`expected 4 skills, got ${names.length}`)
for (const candidate of candidates) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(candidate.name)) fail(`bad skill name ${candidate.name}`)
  if (!candidate.description || candidate.description.length < 20) fail(`thin description ${candidate.name}`)
  const skill = await provider.get(candidate, {})
  if (!skill.content || skill.content.length < 500) fail(`thin content ${candidate.name}`)
}
ok('skill bodies load without frontmatter')

// --- scan plugin -----------------------------------------------------------
const scanPlugin = await import(new URL('../lib/scan.js', import.meta.url).href)
const tools = []
scanPlugin.apply({
  systemPrompt: { section() {}, getSectionOrder() { return 0 } },
  tools: { register(definition) { tools.push(definition) } },
})
const toolNames = tools.map((tool) => tool.name).sort()
if (toolNames.join(',') !== 'clean_dupes,clean_scan') fail(`unexpected tools: ${toolNames.join(',')}`)
for (const tool of tools) {
  if (typeof tool.output?.render !== 'function') fail(`${tool.name}: missing output.render`)
  if (tool.output?.schema?.type !== 'object') fail(`${tool.name}: bad output schema`)
  if (tool.parameters?.type !== 'object') fail(`${tool.name}: bad parameters schema`)
}
ok('clean_scan and clean_dupes definitions are registry-shaped')

// --- shell plugin ----------------------------------------------------------
const shellPlugin = await import(new URL('../lib/shell.js', import.meta.url).href)
if (typeof shellPlugin.apply !== 'function') fail('shell plugin has no apply')
if (shellPlugin.name !== 'clean-shell-tool') fail('shell plugin name changed')
ok('clean_shell plugin exports apply/inject/name')

// --- patch rows ------------------------------------------------------------
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
for (const row of ['preset-cleanup', 'clean-shell', 'clean-scan', 'clean-skills', 'tool-pwsh', 'tool-ask-user']) {
  if (!patch.includes(row)) fail(`cordis.patch.yml missing row ${row}`)
}
ok('patch declares the preset and its tool rows')

console.log(failures === 0 ? 'verify: ok' : `verify: ${failures} failure(s)`)
process.exitCode = failures === 0 ? 0 : 1
