/**
 * Structural and behavioural assertions for the three surfaces the reference
 * design pins down:
 *   1. the dock row holds the branch pill and, beside it as a peer control, the
 *      worktree checkbox — and the branch menu contains no worktree control,
 *   2. the branch menu is the shipped `Menu` with a search field, a section
 *      header, checkmarked rows and the create footer,
 *   3. a right-click anywhere on a Session row opens that row's "..." menu.
 *
 * Not part of the shipped package.
 *
 * Usage: node verify-layout.mjs
 */

import { readFileSync } from 'node:fs'

/** Rendered element tree, as the stub React builds it. */
const React = {
  createElement(type, props, ...children) {
    // `children` may arrive as rest arguments or as a prop; never drop either.
    const merged = children.length > 0 ? { ...(props ?? {}), children } : { ...(props ?? {}) }
    // A `forwardRef` is an object, not a function; React unwraps it before
    // calling through, so the harness must too.
    if (typeof type === 'object' && type !== null && typeof type.$$typeof === 'symbol' && typeof type.render === 'function') {
      return type.render(merged)
    }
    if (typeof type === 'function') return type(merged)
    const element = { type, props: merged, children: children.flat() }
    if (typeof merged.ref === 'object' && merged.ref !== null) merged.ref.current = element
    return element
  },
  Fragment: 'Fragment',
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  // Effects are deferred so a test can wire the DOM a ref points at first,
  // exactly as React does after the commit.
  useEffect: (fn) => {
    pendingEffects.push(fn)
  },
  useSyncExternalStore: (subscribe, getSnapshot) => {
    if (typeof subscribe === 'function') subscribe(() => {})
    return typeof getSnapshot === 'function' ? getSnapshot() : undefined
  },
}

const pendingEffects = []
const registrations = []
const dictionary = { ns: null, dicts: {} }

/** The Host answers this stub returns, keyed by action. */
const answers = {
  status: {
    ok: true,
    cwd: '/work/repo',
    repositoryRoot: '/work/repo',
    branch: 'feature/topic-a',
    detached: false,
    branches: ['feature/topic-a', 'main', 'release', 'fix/typo'],
    branchTotal: 4,
    worktrees: [
      { path: '/work/repo', branch: 'main', bare: false, current: false },
      { path: '/work/repo/.worktrees/topic-b', branch: 'feature/topic-b', bare: false, current: true },
    ],
    dirtyCount: 9,
    linkedWorktree: false,
    worktreeMode: true,
    worktreeLocked: false,
    worktree: {
      path: '/work/repo/.worktrees/topic-b',
      branch: 'feature/topic-b',
      baseCommit: '0000000',
      repositoryRoot: '/work/repo',
      originalCwd: '/work/repo',
      createdAt: '2026-01-01T00:00:00.000Z',
      managedBy: 'service',
      entered: true,
    },
  },
}

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const answer = body.action === 'set-worktree-mode' ? { ...answers.status, worktreeMode: body.enabled === true } : (answers[body.action] ?? { ok: true })
  return { ok: true, status: 200, json: async () => answer }
}

const ctx = {
  locale: {
    register(ns, dicts) {
      dictionary.ns = ns
      Object.assign(dictionary.dicts, dicts)
      return () => {}
    },
  },
  effect(factory) {
    const cleanup = factory()
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  },
  slots: {
    inject(slotName, factory) {
      factory()
      return () => {}
    },
    register(options, Component) {
      registrations.push({ ...options, Component })
      return () => {}
    },
  },
}

/** The primitives lane: each export is a leaf tagged with its own name. */
const primitives = Object.fromEntries(
  [
    'Button',
    'Checkbox',
    'IconBranchOutlineRegular',
    'IconCheckOutlineRegular',
    'IconPlusOutlineRegular',
    'IconSearchOutlineRegular',
    'IconTrashOutlineRegular',
    'Input',
    'Menu',
    'MenuGroup',
    'MenuItemButton',
    'Modal',
    'Pill',
    'RiskConfirmation',
    'Tag',
  ].map((name) => [
    name,
    function Primitive(props) {
      return { type: name, props: props ?? {}, children: [].concat(props?.children ?? []) }
    },
  ]),
)
// `Input` ships as a `forwardRef`: React hands back an object with a `$$typeof`
// symbol, not a function. That shape is what a naive `typeof === 'function'`
// test rejects, dropping the field to a raw `<input>` with browser chrome.
primitives.Input = { $$typeof: Symbol.for('react.forward_ref'), render: primitives.Input }
// Not a component: the group-observer the Menu leaves to its caller.
primitives.observeStickyMenuGroups = () => () => {}

const windowStub = {
  __ModuleLoader__: {
    load({ factory }) {
      windowStub.face = factory((name) => {
        if (name === 'react') return React
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
        return undefined
      })
    },
  },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
}

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
globalThis.window = windowStub
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  // The overlay looks up the portaled menu list to wire its sticky headings.
  querySelector: () => null,
}
// The branch menu measures its sticky group headings on the first painted frame.
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle)
new Function('window', 'document', 'fetch', 'console', source)(windowStub, globalThis.document, globalThis.fetch, console)

windowStub.face.apply(ctx)

/** Translate through the English dictionary. */
const t = (key) => dictionary.dicts.en?.[key] ?? key

/** Walk a rendered tree, visiting every element. */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (node === null || typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** @returns every element the predicate accepts. */
function select(tree, predicate) {
  const found = []
  walk(tree, (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}

/** @returns every element of one primitive type. */
function byType(tree, type) {
  return select(tree, (node) => node.type === type)
}

/** @returns every element whose class list contains `name`. */
function byClass(tree, name) {
  return select(tree, (node) => {
    const className = node.props?.className
    return typeof className === 'string' && className.split(/\s+/).includes(name)
  })
}

/** @returns the plain text a subtree renders. */
function text(tree) {
  const parts = []
  walk(tree, (node) => {
    for (const child of node.children ?? []) if (typeof child === 'string') parts.push(child)
  })
  return parts.join(' ')
}

/** @returns the direct element children of `node`. */
function childElements(node) {
  return (node.children ?? []).filter((child) => child !== null && typeof child === 'object' && !Array.isArray(child))
}

/** Drain deferred effects and report any that throw. */
async function flush() {
  const effects = pendingEffects.splice(0, pendingEffects.length)
  for (const effect of effects) effect()
  await new Promise((resolve) => setTimeout(resolve, 30))
}

const failures = []
/** @param condition - asserted fact. @param message - printed either way. */
function check(condition, message) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}`)
  if (!condition) failures.push(message)
}

const dock = registrations.find((entry) => entry.id === 'interaction-kit-branch')
const overlay = registrations.find((entry) => entry.id === 'interaction-kit-dialog')
const menuRow = registrations.find((entry) => entry.id === 'interaction-kit-delete')
const rowCell = registrations.find((entry) => entry.id === 'interaction-kit-context')
const deleteDialog = registrations.find((entry) => entry.id === 'interaction-kit-delete-dialog')

// ---------------------------------------------------------------- dock row --
/** The untouched Host answer every variant below departs from. */
const baseStatus = answers.status
dock.Component({ t, sessionId: 'session-probe' })
await flush()
const dockTree = dock.Component({ t, sessionId: 'session-probe' })

// The seat decides when the chip is reachable at all: `composer.dock` is skipped
// by the hero composer a fresh Session renders, while `input.left` is mounted by
// the InputBar in both variants and follows the mode selector.
check(dock.name === 'conversation.input.left', `the chip mounts beside the mode selector (${dock.name})`)

const dockRow = byClass(dockTree, 'dsh-ik-dock')[0]
check(dockRow !== undefined, 'dock renders a single .dsh-ik-dock row')
const controls = childElements(dockRow ?? { children: [] }).filter((node) => node.type !== 'style')
check(controls.length === 2, `dock row holds 2 controls (found ${controls.length})`)
check(controls[0]?.type === 'Pill', `first control is the shipped Pill (${controls[0]?.type})`)
check(controls[1]?.type === 'Checkbox', `second control is the shipped Checkbox (${controls[1]?.type})`)
check(controls[1]?.props?.checked === true, 'the checkbox reflects worktreeMode from the Host')
check(controls[1]?.props?.role === undefined, 'the checkbox is not a role="switch" toggle')
check(controls[1]?.props?.className === 'dsh-ik-worktree', 'the checkbox carries the styling hook')

// The count rides inside the checkbox label, in English parentheses, so it sits
// against the word instead of being pushed out by the row's gap.
const worktreeLabel = String(controls[1]?.props?.label ?? '')
check(worktreeLabel === 'worktree(feature/topic-b)', `the label names the worktree (${JSON.stringify(worktreeLabel)})`)
check(!/[（(]\s/.test(worktreeLabel), `the parenthesis is tight and ASCII (${JSON.stringify(worktreeLabel)})`)
check(!/\d/.test(worktreeLabel), `the label counts nothing (${JSON.stringify(worktreeLabel)})`)

// A checkout created without a branch still has a directory worth naming.
const withBranchless = { ...answers.status, worktree: { path: '/work/repo/.worktrees/hotfix', branch: '' } }
answers.status = withBranchless
dock.Component({ t, sessionId: 'session-probe' })
await flush()
const branchlessLabel = String(byType(dock.Component({ t, sessionId: 'session-probe' }), 'Checkbox')[0]?.props?.label ?? '')
check(branchlessLabel === 'worktree(hotfix)', `a branchless checkout falls back to its directory (${JSON.stringify(branchlessLabel)})`)

// No worktree yet: the plain word, no empty parentheses.
answers.status = { ...answers.status, worktreeMode: false, worktree: null }
dock.Component({ t, sessionId: 'session-probe' })
await flush()
const bareLabel = String(byType(dock.Component({ t, sessionId: 'session-probe' }), 'Checkbox')[0]?.props?.label ?? '')
check(bareLabel === 'worktree', `the bare label has no parentheses (${JSON.stringify(bareLabel)})`)
answers.status = baseStatus
dock.Component({ t, sessionId: 'session-probe' })
await flush()

const pillLabel = byClass(dockTree, 'dsh-ik-dock-label')[0]
check(pillLabel?.children?.[0] === 'feature/topic-a', `pill shows the branch (${JSON.stringify(pillLabel?.children?.[0])})`)
check(byType(dockTree, 'IconBranchOutlineRegular').length === 1, 'pill carries the shipped branch glyph')

// A Session that has already exchanged a message keeps its worktree: undoing it
// would leave the earlier writes in the checkout and send later ones elsewhere.
// The Host reports the rule, and the chip both disables itself and says why.
answers.status = { ...baseStatus, worktreeLocked: true }
dock.Component({ t, sessionId: 'session-probe' })
await flush()
const lockedTree = dock.Component({ t, sessionId: 'session-probe' })
const lockedBox = byType(lockedTree, 'Checkbox')[0]
check(lockedBox?.props?.checked === true, 'a locked worktree still reads as on')
check(lockedBox?.props?.disabled === true, 'the started Session cannot clear the checkbox')
check(String(lockedBox?.props?.title ?? '').includes('stays'), `the tooltip states the lock (${JSON.stringify(lockedBox?.props?.title)})`)
answers.status = baseStatus
dock.Component({ t, sessionId: 'session-probe' })
await flush()
const unlockedBox = byType(dock.Component({ t, sessionId: 'session-probe' }), 'Checkbox')[0]
check(unlockedBox?.props?.disabled === false, 'a fresh Session can still clear the checkbox')

// ------------------------------------------------------------- branch menu --
const pill = byType(dockTree, 'Pill')[0]
pill.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 120, right: 260, top: 700, bottom: 726, width: 140, height: 26 }) } })
await flush()
const overlayTree = overlay.Component({ t })

const menu = byType(overlayTree, 'Menu')[0]
check(menu !== undefined, 'overlay renders the shipped Menu')
check(menu?.props?.open === true, 'the Menu is open after the pill is clicked')
check(menu?.props?.portal === true, 'the Menu portals to the document body')
check(menu?.props?.side === 'top', `the Menu opens upwards (side=${menu?.props?.side})`)
check(byType(overlayTree, 'Checkbox').length === 0, 'the Menu holds no worktree checkbox')
check(text(menu).toLowerCase().includes('worktree') === false, 'the Menu never mentions worktree')

const search = byType(overlayTree, 'Input')[0]
check(search !== undefined, 'the Menu has the search field')
const inputText = JSON.stringify(search?.props?.placeholder)
check(inputText.includes('repo'), `search placeholder names the repo (${inputText})`)
check(search?.props?.type === 'search', 'the search field is a search input')

// The section label is the shipped `MenuGroup`, not a hand-rolled heading: that
// is what gives the native 11px tertiary type, the sticky heading and the
// `data-stuck` fill.
const group = byType(overlayTree, 'MenuGroup')[0]
check(group !== undefined, 'the Menu holds a shipped MenuGroup')
check(String(group?.props?.label ?? '') === 'Branches', `the group label reads "Branches" (${JSON.stringify(group?.props?.label)})`)
const grouped = byType(group ?? {}, 'MenuItemButton')
check(grouped.length === 4, `the group holds every branch row (${grouped.length})`)

// The search field rides above the group in a pinned row, styled borderless the
// way a shipped searchable menu styles it.
const head = byClass(overlayTree, 'dsh-ik-search-row')[0]
check(head !== undefined, 'the Menu has a search row')
const headChildren = childElements(head ?? { children: [] })
check(headChildren.length === 1, `the search row holds one field (${headChildren.length})`)
check(headChildren[0]?.type === 'Input', `the search row holds the shipped Input (${headChildren[0]?.type})`)
check(headChildren[0]?.props?.className === 'dsh-ik-search', `the field carries the borderless class (${headChildren[0]?.props?.className})`)
// The accessible name is the same resolved text as the placeholder: a raw
// template would read `搜索{repo}分支` to a screen reader when the repo is unknown.
check(
  String(headChildren[0]?.props?.['aria-label'] ?? '') === String(headChildren[0]?.props?.placeholder ?? ''),
  `the field's name matches its placeholder (${JSON.stringify(headChildren[0]?.props?.['aria-label'])})`,
)
check(!String(headChildren[0]?.props?.placeholder ?? '').includes('{repo}'), 'the placeholder has no unfilled template')

// The field is flattened into the menu: no own border, no own fill, and it spans
// the row. A bordered field would draw a second rounded box inside the menu's.
const css = String(byType(overlayTree, 'style')[0]?.props?.children ?? '')
check(/\.dsh-ik-search-row \.dsh-ik-search\{[^}]*border:0/.test(css), 'the search field drops its own border')
check(/\.dsh-ik-search-row \.dsh-ik-search\{[^}]*background:transparent/.test(css), 'the search field drops its own fill')
check(/\.dsh-ik-search-row \.dsh-ik-search\{[^}]*width:100%/.test(css), 'the search field spans the row')
check(/\.dsh-ik-search-row\{[^}]*display:flex/.test(css), 'the search row stretches its field')

// Typing a filter narrows the rows and states the matched/total count in the
// group heading itself, so no extra chrome appears beside the label.
search.props.onChange({ target: { value: 'fix/' } })
const filtered = overlay.Component({ t })
const filteredRows = byType(filtered, 'MenuItemButton')
check(filteredRows.length === 1, `the search narrows the rows (${filteredRows.length} of 4)`)
const filteredLabel = String(byType(filtered, 'MenuGroup')[0]?.props?.label ?? '')
check(filteredLabel === 'Branches · 1 / 4', `the heading states the match count (${JSON.stringify(filteredLabel)})`)
check(filteredRows.every((row) => text(row).includes('fix/')), 'every remaining row matches the search')
search.props.onChange({ target: { value: '' } })

const footer = menu?.props?.footer ?? []
check(footer.length === 1, `the Menu footer holds one row (${footer.length})`)
check(String(footer[0]?.label).includes('Create and check out'), `footer row is the create action (${JSON.stringify(footer[0]?.label)})`)

const rows = byType(overlayTree, 'MenuItemButton')
check(rows.length === 4, `the Menu lists every branch (${rows.length} rows)`)
const currentRows = rows.filter((row) => row.props.current === true)
check(currentRows.length === 1, 'exactly one row is marked current')
check(text(currentRows[0] ?? {}).includes('feature/topic-a'), 'the current row is the checked-out branch')
check(text(currentRows[0] ?? {}).includes('9 uncommitted'), 'the current row carries the uncommitted hint')
check(byClass(overlayTree, 'dsh-ik-branch-check').length === 1, 'only the current row shows the checkmark')
check(rows.every((row) => row.props.icon?.type === 'IconBranchOutlineRegular'), 'every row carries the branch glyph')

// The rows are single-line, and the check is the menu's own glyph: a 16×16 box
// with a strokeWidth of 1 over the shipped path, sized to 14px like `._check`.
const checkGlyph = byClass(overlayTree, 'dsh-ik-branch-check')[0]
check(checkGlyph?.type === 'svg', `the checkmark is an inline svg (${checkGlyph?.type})`)
check(checkGlyph?.props?.viewBox === '0 0 16 16', `the checkmark uses the 16×16 box (${checkGlyph?.props?.viewBox})`)
check(checkGlyph?.props?.strokeWidth === 1, `the checkmark uses strokeWidth 1 (${checkGlyph?.props?.strokeWidth})`)
const checkPath = [].concat(checkGlyph?.children ?? [])[0]
check(
  String(checkPath?.props?.d ?? '').startsWith('M2.25 8.5L5.49732 11.7473'),
  `the checkmark draws the shipped path (${JSON.stringify(checkPath?.props?.d)})`,
)
check(byClass(overlayTree, 'dsh-ik-branch-text').length === 0, 'the branch rows are single-line')

// Switching a branch goes through the Host and dismisses the menu.
rows[1].props.onSelect()
await flush()
const switched = byType(overlay.Component({ t }), 'Menu')[0]
check(switched?.props?.open === false, 'choosing another branch closes the Menu')

// ----------------------------------------------------------- permanent delete --
const deleteRow = menuRow.Component({ t, sessionId: 'session-probe', displayTitle: 'Probe session', useMenuOpenState: () => [true, (next) => { menuRow.closed = next }] })
check(deleteRow?.type === 'MenuItemButton', `the delete row is a shipped menu item (${deleteRow?.type})`)
check(deleteRow?.props?.danger === true, 'the delete row is marked dangerous')
check(deleteRow?.props?.icon?.type === 'IconTrashOutlineRegular', 'the delete row carries the trash glyph')

deleteRow.props.onSelect()
check(menuRow.closed === false, 'choosing the row dismisses the Session menu first')
const dialogTree = deleteDialog.Component({ t })
const dialog = byType(dialogTree, 'RiskConfirmation')[0]
check(dialog !== undefined, 'the delete flow uses the shipped RiskConfirmation')
check(dialog?.props?.title === 'Delete permanently', `the dialog is titled for the action (${JSON.stringify(dialog?.props?.title)})`)
check(String(dialog?.props?.description).includes('Probe session'), 'the dialog names the target Session')
check(dialog?.props?.acknowledged === false, 'the dialog starts unacknowledged')
check(dialog?.props?.disabled === false, 'the dialog starts enabled but gated on the acknowledgement')

// ----------------------------------------------------------- row right-click --
// Build the row shape the shipped browser renders: an action strip holding the
// "..." trigger (a Menu anchor, named after the Session) followed by the hover
// buttons this package's slots contribute — `archive` at order 100, `pin` at
// order 200, and this plugin's own cell last.
function fakeNode(name) {
  return { name, clicks: 0, listeners: {}, attributes: {} }
}

function fakeButton(name, label) {
  const node = fakeNode(name)
  node.attributes['aria-label'] = label
  node.getAttribute = (key) => node.attributes[key] ?? null
  node.click = () => {
    node.clicks += 1
  }
  return node
}

const TITLE = 'Probe session'
const marker = rowCell.Component({ t, sessionId: 'session-probe', displayTitle: TITLE })
const row = fakeNode('row')
const actions = fakeNode('actions')
// The shipped row's own labels, verbatim: the menu trigger names the Session,
// the hover buttons name only their action.
const trigger = fakeButton('trigger', `会话“${TITLE}”的操作`)
const archive = fakeButton('archive', '归档会话')
const pin = fakeButton('pin', '置顶会话')
actions.querySelectorAll = (selector) => (selector === 'button' ? [trigger, archive, pin] : [])
actions.parentElement = row
row.querySelector = (selector) => (selector === '[class*="rowActions"]' ? actions : null)
// The stub React points the component's ref at the element it rendered.
marker.closest = (selector) => (selector === '[role="treeitem"]' ? row : null)
marker.parentElement = actions
row.addEventListener = (type, fn) => {
  row.listeners[type] = fn
}
row.removeEventListener = (type) => {
  delete row.listeners[type]
}

// The component ran its effect against a null ref during render; run the
// deferred effect now that the element it points at is wired up.
await flush()

const onContextMenu = row.listeners['contextmenu']
check(typeof onContextMenu === 'function', 'right-clicking the row installs a contextmenu listener')
let prevented = false
let stopped = false
onContextMenu?.({ preventDefault: () => { prevented = true }, stopPropagation: () => { stopped = true } })
check(prevented, 'the plugin suppresses the native context menu')
check(stopped, 'the plugin stops the row from also handling the event')
check(trigger.clicks === 1, `right-click opens the shipped "..." menu (trigger clicks=${trigger.clicks})`)
// The one thing that must never happen: a destructive hover button taking the press.
check(archive.clicks === 0, `right-click never presses the archive button (clicks=${archive.clicks})`)
check(pin.clicks === 0, `right-click never presses the pin button (clicks=${pin.clicks})`)

// A row whose menu label cannot be found must leave the native menu alone rather
// than guess at whatever button happens to be first.
row.listeners = {}
archive.clicks = 0
pin.clicks = 0
trigger.attributes['aria-label'] = '无关的按钮'
marker.closest = (selector) => (selector === '[role="treeitem"]' ? row : null)
marker.parentElement = actions
await flush()
const guarded = row.listeners['contextmenu']
check(guarded === undefined, 'an unidentifiable trigger installs no listener')
check(typeof guarded !== 'function', 'an unidentifiable trigger leaves the native menu intact')

console.log(failures.length === 0 ? '\nRESULT ok' : `\nRESULT ${failures.length} failure(s)`)
process.exit(failures.length === 0 ? 0 : 1)
