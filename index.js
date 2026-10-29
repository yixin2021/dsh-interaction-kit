/**
 * DSH Interaction Kit — Host half.
 *
 * Owns one authenticated JSON route (`POST /api/interaction-kit`) that the Client
 * half calls for everything the page cannot do itself: repository status,
 * branch switching and creation, Git worktree creation, the per-Session
 * worktree switch, and permanent Session deletion.
 *
 * It also watches each Agent's file-writing tool calls so an enabled worktree
 * exists — and is the current checkout — before a write lands.
 *
 * @module dsh-interaction-kit
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The authenticated Fetch route the Client half posts to. */
const ROUTE = '/api/interaction-kit'

/** Wall-clock ceiling of one git invocation. */
const GIT_TIMEOUT_MS = 20_000

/** A name this plugin is willing to hand to git. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** Tool names that create or modify files on disk. */
const WRITE_TOOL_NAMES = new Set([
  'write',
  'edit',
  'multi_edit',
  'apply_patch',
  'str_replace_editor',
  'notebook_edit',
  'create_file',
  'write_file',
])

/** Connection owns the transport this plugin answers on. */
export const inject = ['connection']

/** @returns the DSH home directory, honouring the environment override. */
function dshHome() {
  const configured = process.env['DSH_HOME']
  return typeof configured === 'string' && configured.length > 0 ? configured : path.join(os.homedir(), '.dsh')
}

/** Per-profile plugin state: which Sessions asked for a worktree, and what was made. */
const STATE_PATH = path.join(dshHome(), 'storages', 'interaction-kit-toolkit.json')

/** @returns an empty state document. */
function emptyState() {
  return { version: 1, worktreeMode: {}, worktrees: {} }
}

/** @returns whether `value` is a plain JSON object. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns the trimmed output of a git result, or the fallback text. */
function textOf(result, fallback) {
  const text = `${result.stdout}${result.stderr}`.trim()
  return text.length > 0 ? text : fallback
}

/**
 * Run one git command and always resolve.
 * @param cwd - directory git runs in.
 * @param args - git arguments after the executable.
 * @returns the exit outcome plus both streams.
 */
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null || error === undefined,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        })
      },
    )
  })
}

/** Serialize state mutations so two presses cannot interleave writes. */
let stateQueue = Promise.resolve()

/** @returns the state document, read once per process. */
let stateCache
function loadState() {
  if (stateCache === undefined) {
    stateCache = fs
      .readFile(STATE_PATH, 'utf8')
      .then((raw) => {
        const parsed = JSON.parse(raw)
        if (!isRecord(parsed)) return emptyState()
        return {
          version: 1,
          worktreeMode: isRecord(parsed.worktreeMode) ? parsed.worktreeMode : {},
          worktrees: isRecord(parsed.worktrees) ? parsed.worktrees : {},
        }
      })
      .catch(() => emptyState())
  }
  return stateCache
}

/** Persist one state document through a temporary sibling and an atomic rename. */
async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true })
  const temporary = `${STATE_PATH}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, STATE_PATH)
}

/**
 * Read-modify-write the state document.
 * @param mutate - synchronous mutation of the loaded document.
 * @returns whatever the mutation returned.
 */
function withState(mutate) {
  const next = stateQueue.then(async () => {
    const state = await loadState()
    const result = mutate(state)
    await saveState(state)
    return result
  })
  stateQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/**
 * Reject names git would mangle or that reach outside the repository.
 * @param name - candidate branch or worktree name.
 * @returns the trimmed name, or undefined when it is unacceptable.
 */
function sanitizeName(name) {
  if (typeof name !== 'string') return undefined
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 120) return undefined
  if (trimmed.startsWith('-') || trimmed.includes('..') || trimmed.endsWith('/')) return undefined
  return NAME_PATTERN.test(trimmed) ? trimmed : undefined
}

/** @returns the live Agent for one Session, when the Host still holds it. */
function liveAgent(ctx, sessionId) {
  const agents = ctx.get('agents')
  return typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
}

/**
 * Resolve the directory a Session's code currently lives in.
 * @param ctx - Host context.
 * @param sessionId - addressed Session.
 * @returns the committed absolute directory, or undefined when nothing owns it.
 */
function resolveCwd(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
  const workingDirectory = ctx.get('workingDirectory')
  if (session !== undefined && typeof workingDirectory?.get === 'function') {
    try {
      const committed = workingDirectory.get(session)
      if (typeof committed === 'string' && committed.length > 0) return committed
    } catch {
      /* Fall through to the registry. */
    }
  }
  const workspaces = ctx.get('workspaceRegistry')?.list?.() ?? []
  for (const workspace of workspaces) {
    if (Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)) return workspace.path
  }
  const fallback = workingDirectory?.defaultDirectory
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined
}

/**
 * Whether this Session has already exchanged a message.
 *
 * A Session that has started is no longer free to abandon its worktree: writes
 * that already ran there would be stranded, and later ones would reopen the main
 * checkout, splitting one conversation across two directories. The check reads
 * derived messages rather than the raw log so a resumed Session answers from its
 * own cache, and an unavailable Session answers `false` instead of throwing — a
 * lock that cannot be justified must not be invented.
 *
 * @param ctx - Host context.
 * @param sessionId - addressed Session.
 * @returns true when a user or assistant message exists.
 */
function sessionStarted(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
  if (session === undefined || typeof session.deriveMessages !== 'function') return false
  try {
    const messages = session.deriveMessages()
    if (!Array.isArray(messages)) return false
    return messages.some((message) => message?.role === 'user' || message?.role === 'assistant')
  } catch {
    return false
  }
}

/**
 * Read everything the composer chip needs for one Session.
 * @param ctx - Host context.
 * @param sessionId - addressed Session.
 * @returns repository facts, or a typed failure.
 */
async function readStatus(ctx, sessionId) {
  const cwd = resolveCwd(ctx, sessionId)
  if (cwd === undefined) {
    return { ok: false, code: 'no-workspace', message: 'This Session has no working directory.' }
  }
  const top = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok) {
    return { ok: false, code: 'not-a-repository', cwd, message: textOf(top, 'Not a Git repository.') }
  }
  const repositoryRoot = top.stdout.trim()
  const [head, listing, porcelain, gitDir, commonDir, dirty] = await Promise.all([
    git(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repositoryRoot, ['branch', '--format=%(refname:short)']),
    git(repositoryRoot, ['worktree', 'list', '--porcelain']),
    git(repositoryRoot, ['rev-parse', '--absolute-git-dir']),
    git(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(repositoryRoot, ['status', '--porcelain']),
  ])
  const branch = head.ok ? head.stdout.trim() : ''
  const listed = listing.ok
    ? listing.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : []
  // The checked-out branch leads the list: a Session's own branch is the one
  // an operator looks for first, and a large repository lists hundreds.
  const branches = branch.length > 0 && listed.includes(branch) ? [branch, ...listed.filter((name) => name !== branch)] : listed
  const worktrees = []
  if (porcelain.ok) {
    for (const block of porcelain.stdout.split('\n\n')) {
      const trimmedBlock = block.trim()
      if (trimmedBlock.length === 0) continue
      const record = {}
      for (const line of trimmedBlock.split('\n')) {
        const index = line.indexOf(' ')
        if (index <= 0) continue
        record[line.slice(0, index).trim()] = line.slice(index + 1).trim()
      }
      if (typeof record['worktree'] !== 'string') continue
      worktrees.push({
        path: record['worktree'],
        branch: (record['branch'] ?? '').replace(/^refs\/heads\//, ''),
        bare: record['bare'] === 'bare',
        current: record['worktree'] === cwd,
      })
    }
  }
  const dirtyCount = dirty.ok
    ? dirty.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0).length
    : 0
  const linkedWorktree = gitDir.ok && commonDir.ok && gitDir.stdout.trim() !== commonDir.stdout.trim()
  const started = sessionStarted(ctx, sessionId)
  const state = await loadState()
  let worktree = isRecord(state.worktrees[sessionId]) ? state.worktrees[sessionId] : null
  if (worktree !== null && typeof worktree['path'] === 'string') {
    // A checkout removed behind this plugin's back must not linger as a badge.
    const present = await fs.access(worktree['path']).then(
      () => true,
      () => false,
    )
    if (!present) {
      await withState((next) => {
        delete next.worktrees[sessionId]
      })
      worktree = null
    }
  }
  return {
    ok: true,
    cwd,
    repositoryRoot,
    branch,
    detached: branch === 'HEAD' || branch.length === 0,
    branches,
    branchTotal: branches.length,
    worktrees,
    dirtyCount,
    linkedWorktree,
    worktreeMode: state.worktreeMode[sessionId] === true,
    worktree,
    // Whether the Session has exchanged a message. The chip turns from an
    // opt-in checkbox into a read-only name once it has: the choice is spent,
    // and a disabled control would only advertise a state nobody can change.
    started,
    // Reported so a caller never has to re-derive the rule. `worktree` alone is
    // not enough: the Session has started as soon as it has a message, which is
    // earlier than the first write that creates the checkout.
    worktreeLocked: state.worktreeMode[sessionId] === true && (worktree !== null || started),
  }
}

/**
 * Create one worktree for a Session and make it current.
 *
 * The shipped `worktrees` service owns the operation and enters the new
 * checkout; a direct `git worktree add` covers a Session whose Agent is not
 * materialized, where nothing can enter it.
 *
 * @param ctx - Host context.
 * @param sessionId - addressed Session.
 * @param requestedName - optional branch name.
 * @returns the created checkout, or a typed failure.
 */
async function createWorktree(ctx, sessionId, requestedName) {
  const wanted = requestedName === undefined || requestedName === null || requestedName === '' ? undefined : sanitizeName(requestedName)
  if (requestedName !== undefined && requestedName !== null && requestedName !== '' && wanted === undefined) {
    return { ok: false, code: 'invalid-name', message: 'That branch name is not usable.' }
  }
  const originalCwd = resolveCwd(ctx, sessionId)
  const agent = liveAgent(ctx, sessionId)
  const service = ctx.get('worktrees')
  if (agent !== undefined && typeof service?.create === 'function') {
    try {
      const created = await service.create(agent, wanted === undefined ? {} : { name: wanted })
      const record = {
        path: created.path,
        branch: created.branch,
        baseCommit: created.baseCommit,
        repositoryRoot: created.repositoryRoot,
        originalCwd: originalCwd ?? null,
        createdAt: new Date().toISOString(),
        managedBy: 'service',
        entered: true,
      }
      await withState((state) => {
        state.worktrees[sessionId] = record
      })
      return { ok: true, worktree: record }
    } catch (error) {
      return { ok: false, code: 'worktree-failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (originalCwd === undefined) return { ok: false, code: 'no-workspace', message: 'This Session has no working directory.' }
  const top = await git(originalCwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { ok: false, code: 'not-a-repository', message: textOf(top, 'Not a Git repository.') }
  const repositoryRoot = top.stdout.trim()
  const branch = wanted ?? `wt-${Date.now().toString(36)}`
  const target = path.join(repositoryRoot, '.worktrees', branch.replace(/[\\/]+/g, '-'))
  const added = await git(repositoryRoot, ['worktree', 'add', '-b', branch, target])
  if (!added.ok) {
    return { ok: false, code: 'worktree-failed', message: textOf(added, 'git worktree add failed.') }
  }
  const head = await git(target, ['rev-parse', 'HEAD'])
  const record = {
    path: target,
    branch,
    baseCommit: head.ok ? head.stdout.trim() : '',
    repositoryRoot,
    originalCwd,
    createdAt: new Date().toISOString(),
    managedBy: 'git',
    entered: false,
  }
  await withState((state) => {
    state.worktrees[sessionId] = record
  })
  return { ok: true, worktree: record }
}

/**
 * Return one Session to the checkout it started in.
 * @param ctx - Host context.
 * @param sessionId - addressed Session.
 * @returns the restored directory, or a typed failure.
 */
async function restoreOriginalCwd(ctx, sessionId) {
  const state = await loadState()
  const record = state.worktrees[sessionId]
  if (!isRecord(record) || typeof record['originalCwd'] !== 'string') {
    return { ok: false, code: 'no-original', message: 'This Session has no saved original checkout.' }
  }
  const agent = liveAgent(ctx, sessionId)
  const workingDirectory = ctx.get('workingDirectory')
  if (agent !== undefined && typeof workingDirectory?.set === 'function') {
    try {
      await workingDirectory.set(agent, record['originalCwd'])
    } catch (error) {
      return { ok: false, code: 'restore-failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  await withState((next) => {
    delete next.worktreeMode[sessionId]
  })
  return { ok: true, cwd: record['originalCwd'] }
}

/**
 * Delete one Session for good: stop its activity, drop its registry rows, then
 * remove its log directory and projection cache from disk.
 * @param ctx - Host context.
 * @param sessionId - addressed Session.
 * @returns the removed paths, the failures, or a typed failure.
 */
async function deleteSessionPermanently(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  try {
    await registry?.archiveSession?.(sessionId, { stopActivity: true })
  } catch {
    /* A Session that never ran has nothing to stop. */
  }
  try {
    await registry?.unarchiveSession?.(sessionId)
  } catch {
    /* Not archived. */
  }
  try {
    await registry?.unpinSession?.(sessionId)
  } catch {
    /* Not pinned. */
  }
  for (const workspace of registry?.list?.() ?? []) {
    if (!Array.isArray(workspace?.sessionIds) || !workspace.sessionIds.includes(sessionId)) continue
    try {
      await workspace.detachSession(sessionId)
    } catch {
      /* The log is being removed anyway. */
    }
  }
  const removed = []
  const failures = []
  const logRoot = path.join(dshHome(), 'sessions')
  let projectDirectories = []
  try {
    projectDirectories = await fs.readdir(logRoot, { withFileTypes: true })
  } catch {
    projectDirectories = []
  }
  for (const entry of projectDirectories) {
    if (!entry.isDirectory()) continue
    const target = path.join(logRoot, entry.name, sessionId)
    if (path.basename(target) !== sessionId) continue
    try {
      await fs.rm(target, { recursive: true, force: true })
      removed.push(target)
    } catch (error) {
      failures.push({ path: target, message: error instanceof Error ? error.message : String(error) })
    }
  }
  const projectionCache = path.join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  try {
    await fs.rm(projectionCache, { force: true })
    removed.push(projectionCache)
  } catch (error) {
    failures.push({ path: projectionCache, message: error instanceof Error ? error.message : String(error) })
  }
  await withState((state) => {
    delete state.worktreeMode[sessionId]
    delete state.worktrees[sessionId]
  })
  try {
    ctx.emit('api-session/removed', sessionId)
  } catch {
    /* Readers that are not mounted simply miss the hint. */
  }
  if (removed.length === 0 && failures.length > 0) {
    return { ok: false, code: 'delete-failed', message: failures[0].message, failures }
  }
  return { ok: true, removed, failures }
}

/**
 * Answer one action.
 * @param ctx - Host context.
 * @param body - the decoded request body.
 * @returns the JSON answer.
 */
async function dispatch(ctx, body) {
  if (!isRecord(body) || typeof body['action'] !== 'string' || typeof body['sessionId'] !== 'string') {
    return { ok: false, code: 'bad-request', message: 'action and sessionId are required.' }
  }
  const sessionId = body['sessionId']
  const action = body['action']
  if (action === 'status') return readStatus(ctx, sessionId)
  if (action === 'switch' || action === 'create-branch') {
    const branch = sanitizeName(body['branch'])
    if (branch === undefined) return { ok: false, code: 'invalid-name', message: 'Unusable branch name.' }
    const cwd = resolveCwd(ctx, sessionId)
    if (cwd === undefined) return { ok: false, code: 'no-workspace', message: 'No working directory.' }
    const from = sanitizeName(body['from'])
    const args =
      action === 'create-branch'
        ? from === undefined
          ? ['checkout', '-b', branch]
          : ['checkout', '-b', branch, from]
        : ['checkout', branch]
    const result = await git(cwd, args)
    if (!result.ok) {
      return {
        ok: false,
        code: action === 'create-branch' ? 'create-failed' : 'checkout-failed',
        message: textOf(result, 'git checkout failed.'),
      }
    }
    return readStatus(ctx, sessionId)
  }
  if (action === 'set-worktree-mode') {
    const enabled = body['enabled'] === true
    if (!enabled) {
      // Turning it off after the conversation moved on would send later writes
      // back to the main checkout while the earlier ones stayed in the worktree.
      // A Session that never started is still free to change its mind.
      const current = await readStatus(ctx, sessionId)
      if (current.ok === true && current['worktreeLocked'] === true) {
        // The refused state travels with the refusal so a caller never has to
        // re-read it to learn what the Session actually looks like.
        return { ...current, ok: false, code: 'worktree-locked', message: 'This Session has already started; its worktree stays.' }
      }
    }
    await withState((state) => {
      if (enabled) state.worktreeMode[sessionId] = true
      else delete state.worktreeMode[sessionId]
    })
    if (enabled && body['createNow'] === true) {
      const state = await loadState()
      if (!isRecord(state.worktrees[sessionId])) {
        const created = await createWorktree(ctx, sessionId, body['name'])
        if (created.ok !== true) return created
        return { ...(await readStatus(ctx, sessionId)), created: created.worktree }
      }
    }
    return readStatus(ctx, sessionId)
  }
  if (action === 'create-worktree') {
    const created = await createWorktree(ctx, sessionId, body['name'])
    if (created.ok !== true) return created
    return { ...(await readStatus(ctx, sessionId)), created: created.worktree }
  }
  if (action === 'restore-cwd') return restoreOriginalCwd(ctx, sessionId)
  if (action === 'delete-session') return deleteSessionPermanently(ctx, sessionId)
  return { ok: false, code: 'unknown-action', message: `Unknown action "${action}".` }
}

/**
 * Make an enabled worktree exist and be current before a write runs.
 * @param ctx - Host context.
 * @param exec - the pending tool call.
 */
async function prepareWorktree(ctx, exec) {
  const sessionId = exec?.agent?.id
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  const toolName = exec?.name
  if (typeof toolName !== 'string' || !WRITE_TOOL_NAMES.has(toolName)) return
  const state = await loadState()
  if (state.worktreeMode[sessionId] !== true) return
  const record = state.worktrees[sessionId]
  const cwd = resolveCwd(ctx, sessionId)
  if (isRecord(record) && typeof record['path'] === 'string') {
    if (cwd === record['path']) return
    const workingDirectory = ctx.get('workingDirectory')
    if (typeof workingDirectory?.set === 'function') {
      try {
        await workingDirectory.set(exec.agent, record['path'])
      } catch (error) {
        console.error('[interaction-kit] could not enter the retained worktree', error)
      }
    }
    return
  }
  const created = await createWorktree(ctx, sessionId, undefined)
  if (created.ok !== true) {
    console.error('[interaction-kit] worktree creation failed', created.code, created.message)
    return
  }
  try {
    exec.agent?.inject?.({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Git worktree ready: this Session now works in \`${created.worktree.path}\` on branch \`${created.worktree.branch}\` (base ${created.worktree.baseCommit.slice(0, 12)}). Write code there; the original checkout is untouched.`,
        },
      ],
    })
  } catch (error) {
    console.error('[interaction-kit] could not inject the worktree notice', error)
  }
}

/**
 * Mount the route and the write-time worktree hook.
 * @param ctx - Host context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body
        try {
          body = await request.json()
        } catch {
          return Response.json({ ok: false, code: 'bad-request', message: 'The body is not JSON.' }, { status: 400 })
        }
        try {
          const answer = await dispatch(ctx, body)
          return Response.json(answer, {
            headers: { 'cache-control': 'no-store' },
          })
        } catch (error) {
          return Response.json(
            { ok: false, code: 'handler-error', message: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          )
        }
      },
    }),
    'interaction-kit: route',
  )

  ctx.effect(
    () =>
      ctx.on('tools/pre-execute', async (exec, next) => {
        try {
          await prepareWorktree(ctx, exec)
        } catch (error) {
          console.error('[interaction-kit] worktree preparation failed', error)
        }
        return next()
      }),
    'interaction-kit: auto worktree',
  )
}
