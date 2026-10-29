/**
 * Verification harness: mounts the plugin's Host half against a stub Cordis
 * context and drives its authenticated route, so the git/session logic can be
 * exercised without the page. Not part of the shipped package.
 *
 * Usage: node verify-host.mjs <sessionId>
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sessionId = process.argv[2]
if (typeof sessionId !== 'string') {
  console.error('usage: node verify-host.mjs <sessionId>')
  process.exit(2)
}

/** Keep this harness out of the real profile's state file. */
const sandboxHome = await fs.mkdtemp(path.join(os.tmpdir(), 'interaction-kit-verify-'))
process.env['DSH_HOME'] = sandboxHome

const { apply } = await import('./index.js')

/** Everything the plugin registered, by kind. */
const registered = { fetch: null, listeners: new Map(), cleanups: [] }

const workspace = {
  id: 'ws-test',
  path: process.cwd(),
  title: 'workspace',
  sessionIds: [sessionId],
  detachSession: async () => {},
}

// `started` models a Session that has exchanged a message. The Host reads it
// through `deriveMessages`, so the stub answers that shape rather than a flag.
const session = {
  id: sessionId,
  workspaceId: workspace.id,
  started: false,
  deriveMessages() {
    return this.started ? [{ role: 'user', content: 'hello' }] : []
  },
}

const ctx = {
  effect(factory, label) {
    const cleanup = factory()
    registered.cleanups.push({ label, cleanup })
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  },
  on(event, handler) {
    registered.listeners.set(event, handler)
    return () => registered.listeners.delete(event)
  },
  emit() {},
  get(key) {
    if (key === 'sessions') return { get: (id) => (id === sessionId ? session : undefined) }
    if (key === 'agents') return { get: () => undefined }
    if (key === 'workingDirectory') {
      return {
        get: () => process.cwd(),
        set: async () => {},
        defaultDirectory: process.cwd(),
      }
    }
    if (key === 'workspaceRegistry') {
      return {
        list: () => [workspace],
        archiveSession: async () => {},
        unarchiveSession: async () => {},
        unpinSession: async () => {},
      }
    }
    if (key === 'worktrees') return undefined
    return undefined
  },
  connection: {
    fetch: {
      register(config) {
        registered.fetch = config
        return () => {
          registered.fetch = null
        }
      },
    },
  },
}

apply(ctx)

if (registered.fetch === null) {
  console.error('FAIL the plugin registered no route')
  process.exit(1)
}
console.log(`route  ${registered.fetch.path} ${JSON.stringify(registered.fetch.methods)} body=${registered.fetch.requestBody}`)
console.log(`events ${JSON.stringify(Array.from(registered.listeners.keys()))}`)

/**
 * Issue one request the way the browser would.
 * @param action - Host action.
 * @param extra - extra body fields.
 * @returns the decoded answer.
 */
async function call(action, extra) {
  const request = new Request('http://127.0.0.1/api/interaction-kit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, sessionId, ...(extra ?? {}) }),
  })
  const response = await registered.fetch.fetch(request)
  return { status: response.status, body: await response.json() }
}

/** Print one answer compactly. */
function show(label, answer) {
  const body = answer.body
  const shape = {}
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) shape[key] = `<${value.length} items>`
    else if (key === 'branches') shape[key] = value
    else shape[key] = value
  }
  console.log(`\n### ${label} (HTTP ${answer.status})`)
  console.log(JSON.stringify(shape, null, 2).slice(0, 1400))
}

show('status', await call('status'))

// The dock turns from a checkbox into a read-only name on this flag, so the Host
// must report it before the Session has any message at all.
const freshStatus = await call('status')
console.log('\n### started flag')
console.log('fresh Session started:', freshStatus.body.started)
if (freshStatus.body.started !== false) {
  console.error('FAIL a Session with no messages reported started')
  process.exitCode = 1
}

show('bad request', await call('nonsense'))
show('unknown action', await call('do-the-thing'))
show('invalid branch name', await call('switch', { branch: '--upload-pack=evil' }))
show('switch to a missing branch', await call('switch', { branch: 'definitely-no-such-branch-xyz' }))

const statePath = path.join(sandboxHome, 'storages', 'interaction-kit-toolkit.json')
show('worktree-mode on', await call('set-worktree-mode', { enabled: true }))
console.log('state file exists:', await fs.access(statePath).then(() => true, () => false))

// The auto-worktree hook: a read-only tool must not trigger it, and the first
// file write while the switch is on must produce a checkout before `next()`.
const hook = registered.listeners.get('tools/pre-execute')
const { execFileSync } = await import('node:child_process')

/** Run the hook once with a fake tool call and report what it did. */
async function runHook(toolName) {
  const injected = []
  const exec = { callId: `call-${toolName}`, name: toolName, arguments: {}, agent: { id: sessionId, inject: (message) => injected.push(message) }, signal: undefined }
  let continued = false
  await hook(exec, async () => {
    continued = true
    return { kind: 'allow' }
  })
  const record = JSON.parse(await fs.readFile(statePath, 'utf8')).worktrees[sessionId] ?? null
  console.log(`\n### hook ${toolName}: next()=${continued} worktree=${record === null ? 'none' : record.branch} injected=${injected.length}`)
  return record
}

console.log('\n--- auto worktree ---')
const afterRead = await runHook('read')
console.log('read-tool created nothing:', afterRead === null)
const afterWrite = await runHook('write')
console.log('write-tool created a checkout:', afterWrite !== null, afterWrite?.path)
if (afterWrite !== null) {
  execFileSync('git', ['worktree', 'remove', '--force', afterWrite.path], { cwd: process.cwd() })
  execFileSync('git', ['branch', '-D', afterWrite.branch], { cwd: process.cwd() })
  console.log('cleaned up the hook worktree')
}

const probeBranch = `interaction-kit-probe-${Date.now().toString(36)}`
const created = await call('create-worktree', { name: probeBranch })
console.log('\n### create-worktree', JSON.stringify(created.body.created ?? created.body, null, 2).slice(0, 700))
console.log('persisted mode/branch:', JSON.stringify(await fs.readFile(statePath, 'utf8').then((raw) => JSON.parse(raw).worktrees[sessionId] ?? null)))

if (created.body.created !== undefined) {
  const target = created.body.created.path
  console.log('worktree on disk:', await fs.access(target).then(() => true, () => false))
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['worktree', 'remove', '--force', target], { cwd: process.cwd() })
  execFileSync('git', ['branch', '-D', created.body.created.branch], { cwd: process.cwd() })
  console.log('worktree removed and branch deleted again')
}

show('worktree-mode off (blank Session)', await call('set-worktree-mode', { enabled: false }))

// Once the conversation has started the option sticks: undoing it would leave
// the earlier writes in the checkout and send later ones to the main checkout.
show('worktree-mode on again', await call('set-worktree-mode', { enabled: true }))
session.started = true
const startedStatus = await call('status')
console.log('\n### started status after a message')
console.log('started:', startedStatus.body.started, '| mode:', startedStatus.body.worktreeMode, '| locked:', startedStatus.body.worktreeLocked)
if (startedStatus.body.started !== true) {
  console.error('FAIL a Session with a message did not report started')
  process.exitCode = 1
}
const lockedOff = await call('set-worktree-mode', { enabled: false })
console.log('\n### worktree-mode off refused')
console.log('ok:', lockedOff.body.ok, '| code:', lockedOff.body.code)
console.log('still on:', lockedOff.body.worktreeMode, '| locked:', lockedOff.body.worktreeLocked)
if (lockedOff.body.ok !== false || lockedOff.body.code !== 'worktree-locked') {
  console.error('FAIL the started Session cleared its worktree option')
  process.exitCode = 1
}
if (lockedOff.body.worktreeMode !== true || lockedOff.body.worktreeLocked !== true) {
  console.error('FAIL the refused status does not report the locked mode')
  process.exitCode = 1
}
session.started = false
show('worktree-mode off after starting again', await call('set-worktree-mode', { enabled: false }))

show('delete-session (no such log)', await call('delete-session'))

for (const entry of registered.cleanups) {
  if (typeof entry.cleanup === 'function') entry.cleanup()
}
console.log('\ncleanups ran:', registered.cleanups.length, 'route now:', registered.fetch)
