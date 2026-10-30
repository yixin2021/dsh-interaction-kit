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

/**
 * Issue one request for an arbitrary Session.
 * @param action - Host action.
 * @param id - Session id to claim.
 * @param extra - extra body fields.
 * @returns the decoded answer.
 */
async function call2(action, id, extra) {
  const request = new Request('http://127.0.0.1/api/interaction-kit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, sessionId: id, ...(extra ?? {}) }),
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

// ------------------------------------------------ file references --
// The launch itself is not exercised: it would put a window on the user's
// desktop. Everything the route decides before launching is, and the command
// matrix is asserted directly against the pure resolver.
console.log('\n--- file references ---')
const refusals = [
  ['an empty path', { path: '', mode: 'open' }, 'bad-path'],
  ['a control character', { path: 'src/\u0000.ts', mode: 'open' }, 'bad-path'],
  ['a missing target', { path: 'definitely-no-such-file-xyz.ts', mode: 'open' }, 'missing-path'],
  ['a missing absolute target', { path: '/definitely/no/such/file-xyz.ts', mode: 'reveal' }, 'missing-path'],
]
for (const [label, extra, expected] of refusals) {
  const answer = await call('open-path', extra)
  console.log(`${answer.body.code === expected ? 'ok  ' : 'FAIL'} ${label} is refused with "${expected}" (got ${answer.body.code})`)
  if (answer.body.code !== expected) process.exitCode = 1
  if (answer.body.ok !== false) {
    console.error(`FAIL ${label} did not report failure`)
    process.exitCode = 1
  }
}

// A reference is resolved against the Session's own directory, never the Host's
// process directory, so a relative path cannot escape to another checkout.
const relative = await call('open-path', { path: 'no-such-file-in-workspace.ts', mode: 'open' })
const resolved = String(relative.body.path ?? '')
const insideSession = path.isAbsolute(resolved) && resolved.endsWith(path.sep + 'no-such-file-in-workspace.ts')
console.log(`${insideSession ? 'ok  ' : 'FAIL'} the reference is resolved to an absolute path inside a Session (${resolved})`)
if (!insideSession) process.exitCode = 1

// A Session the Host cannot place resolves against the Host's own fallback
// directory rather than the process directory of whoever asked.
const orphan = await call2('open-path', 'not-a-session-at-all', { path: 'no-such-orphan-file.ts', mode: 'open' })
const orphanPath = String(orphan.body.path ?? '')
console.log(`${orphanPath.startsWith(process.cwd()) ? 'ok  ' : 'FAIL'} an unplaceable Session still resolves against a known directory (${orphanPath})`)
if (!orphanPath.startsWith(process.cwd())) process.exitCode = 1
if (orphan.body.code !== 'missing-path') {
  console.error('FAIL the orphan reference did not report its missing target:', orphan.body.code)
  process.exitCode = 1
}

const { desktopInvocation, explorerTarget } = await import('./index.js')
const mac = desktopInvocation('/work/a b.ts', false, 'reveal', 'darwin')
console.log(`ok   macOS reveals with a single -R argument (${JSON.stringify(mac)})`)
if (mac?.command !== 'open' || mac.args.length !== 2 || mac.args[0] !== '-R' || mac.args[1] !== '/work/a b.ts') process.exitCode = 1
const macOpen = desktopInvocation('/work/a b.ts', false, 'open', 'darwin')
if (macOpen?.command !== 'open' || macOpen.args.length !== 1) {
  console.error('FAIL macOS open passed more than the path')
  process.exitCode = 1
}
const linux = desktopInvocation('/work/src/a.ts', false, 'reveal', 'linux')
console.log(`${linux?.args[0] === '/work/src' ? 'ok  ' : 'FAIL'} Linux reveals the containing directory (${linux?.args[0]})`)
if (linux?.args[0] !== '/work/src') process.exitCode = 1
const linuxDir = desktopInvocation('/work/src', true, 'reveal', 'linux')
if (linuxDir?.args[0] !== '/work/src') {
  console.error('FAIL Linux revealed the parent of a directory')
  process.exitCode = 1
}
const windows = desktopInvocation('C:\\work\\a,b=c.ts', false, 'reveal', 'win32')
console.log(`${windows?.args[0].startsWith('/select,') ? 'ok  ' : 'FAIL'} Windows selects the file (${windows?.args[0]})`)
if (!String(windows?.args[0]).startsWith('/select,')) process.exitCode = 1
if (windows.args[0].includes(',', 8) || windows.args[0].includes('=')) {
  console.error('FAIL the Explorer separators were not escaped:', windows.args[0])
  process.exitCode = 1
}
const windowsOpen = desktopInvocation('C:\\work\\a.ts', false, 'open', 'win32')
if (windowsOpen?.command !== 'cmd' || windowsOpen.args.join(' ') !== '/c start  C:\\work\\a.ts') {
  console.error('FAIL the Windows open keeps the empty title argument:', JSON.stringify(windowsOpen))
  process.exitCode = 1
}
if (desktopInvocation('/work/a.ts', false, 'open', 'aix') !== undefined) {
  console.error('FAIL a Host with no opener resolved to a command')
  process.exitCode = 1
}
console.log('ok   a Host with no opener resolves to nothing')
// A path with a separator in it must survive as one argument, never be split.
for (const [windowsPath, expected] of [
  ['C:\\work\\a b.ts', 'file:///C:/work/a%20b.ts'],
  ['C:\\work\\a,b=c.ts', 'file:///C:/work/a%2Cb%3Dc.ts'],
  ['C:\\工作\\文件.ts', 'file:///C:/工作/文件.ts'],
]) {
  const actual = explorerTarget(windowsPath)
  console.log(`${actual === expected ? 'ok  ' : 'FAIL'} Explorer receives ${expected} (got ${actual})`)
  if (actual !== expected) process.exitCode = 1
}

for (const entry of registered.cleanups) {
  if (typeof entry.cleanup === 'function') entry.cleanup()
}
console.log('\ncleanups ran:', registered.cleanups.length, 'route now:', registered.fetch)
