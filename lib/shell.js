/**
 * `clean_shell` — a model-facing shell tool that runs through DSH's existing
 * shell executor (`ctx.shell`), so sandbox policy, timeouts, output limits and
 * the PowerShell discovery order stay owned by the host.
 *
 * Why this exists: a profile can hide the official `pwsh`/`bash` tools from the
 * model (the `dsh-ops` shell component does this on purpose with
 * `shellPolicy: deny-host-shell`). A preset cannot restore them, but it can
 * register its own tool name, which no such policy denies. The executor behind
 * this tool is the same one the official tool uses — this file is the wrapper,
 * not a second shell implementation.
 *
 * Zero runtime dependencies on purpose: a preset plugin that is `link:`-installed
 * cannot import `@deepseek-ai/*`, so the tool definition is built by hand to the
 * registry's contract (`name`, `description`, `parameters`, `output.render`,
 * `execute`).
 */

/** Cordis plugin identity. */
const name = 'clean-shell-tool'

/** Services this tool needs. */
const inject = ['tools', 'shell', 'sandboxPolicy', 'shellEnv', 'workingDirectory', 'systemPrompt']

/** Default command timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 120_000

/** The model-facing description. */
const DESCRIPTION = [
  'Execute one shell command and return its stdout, stderr and exit code.',
  'On Windows this is PowerShell (pwsh 7 when installed, otherwise Windows PowerShell 5.1);',
  'elsewhere it is bash. It runs through the same host shell executor as the built-in',
  '`pwsh`/`bash` tool, so sandbox policy, timeout and output limits still apply.',
  'Before any delete or move, verify the resolved absolute target path; never run it against a',
  'path you have not checked. Commands run in the session working directory unless `workdir` is',
  'given; use `workdir` instead of `cd`. A blocked file operation is reported as a sandbox denial —',
  'raise the session permission or stop, never retry another way.',
].join(' ')

/** The tool's argument schema, already in the registry's JSON-Schema form. */
const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    command: {
      type: 'string',
      description: 'The command line to run. Non-empty.',
    },
    description: {
      type: 'string',
      description: 'Short active-voice description of what the command does.',
    },
    workdir: {
      type: 'string',
      description: 'Working directory; defaults to the session working directory.',
    },
    timeoutMs: {
      type: 'number',
      description: `Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`,
    },
  },
  required: ['command', 'description'],
}

/** The tool's returned-value schema. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: { type: 'number', description: 'Process exit code; -1 when the process never settled.' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    timedOut: { type: 'boolean' },
    sandboxMode: { type: 'string' },
    sandboxDenied: { type: 'boolean' },
  },
  required: ['exitCode', 'stdout', 'stderr', 'timedOut', 'sandboxDenied'],
}

/**
 * Render one settled shell result for the model.
 *
 * @param {object} value - the value returned by `execute`
 * @returns {Array<{ type: 'string', text: string }>} text content blocks
 */
function renderResult(_args, value) {
  const parts = []
  if (value.stdout.length > 0) parts.push(value.stdout.trimEnd())
  if (value.stderr.length > 0) parts.push(`[stderr]\n${value.stderr.trimEnd()}`)
  if (value.timedOut) parts.push('[timed out]')
  if (value.sandboxDenied) parts.push(`[sandbox: file access denied${value.sandboxMode ? ` under ${value.sandboxMode} mode` : ''}]`)
  parts.push(`[exit code: ${value.exitCode}]`)
  return [{ type: 'text', text: parts.join('\n') }]
}

/**
 * Register the tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - context with the shell executor
 */
function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:clean_shell',
    order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'),
    text: '`clean_shell` is this preset\'s own wrapper over the host shell executor: PowerShell on Windows, bash elsewhere. It is the fallback when a profile hides the official shell tool; prefer `ops_bash` or `pwsh`/`bash` when they are available. Non-zero exits are reported as `[exit code: N]`.',
  })

  ctx.tools.register({
    name: 'clean_shell',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: renderResult,
    },
    async execute(args, exec) {
      const command = typeof args.command === 'string' ? args.command.trim() : ''
      if (command.length === 0) throw new Error('clean_shell: `command` must be a non-empty string')
      if (exec.signal?.aborted === true) throw new Error('clean_shell: call aborted')

      const workdir = typeof args.workdir === 'string' && args.workdir.length > 0
        ? args.workdir
        : ctx.workingDirectory.get(exec.agent.session)
      const timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : DEFAULT_TIMEOUT_MS
      const policy = ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })

      const request = {
        command,
        workdir,
        timeoutMs,
        onExpiry: 'kill',
        dshEnv: ctx.shellEnv.collect(exec),
        ...(policy === undefined ? {} : { sandboxPolicy: policy }),
        ...(exec.signal === undefined ? {} : { signal: exec.signal }),
      }

      const handle = await ctx.shell.execute(ctx.shell.resolve(request))
      const result = await handle.result()

      return {
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : -1,
        stdout: result.stdout?.text ?? '',
        stderr: result.stderr?.text ?? '',
        timedOut: result.timedOut === true,
        sandboxMode: result.sandbox?.mode ?? '',
        sandboxDenied: result.sandbox?.denied === true,
      }
    },
  })
}

export { apply, inject, name }
