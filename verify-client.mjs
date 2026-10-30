/**
 * Verification harness: loads the Client half under a stub Module Loader and a
 * stub React, then reports the Slot registrations, locale dictionary, render
 * results and effect cleanups it produces. Runs twice — once with the shipped
 * primitives resolvable and once without — so both the native path and the
 * plain-element fallback are exercised. Not part of the shipped package.
 *
 * Usage: node verify-client.mjs
 */

import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

/** Names the Client half takes from the primitives module. */
const PRIMITIVE_NAMES = [
  'Button',
  'Checkbox',
  'IconBranchOutlineRegular',
  'IconCheckOutlineRegular',
  'IconCopyOutlineRegular',
  'IconFolderOpenOutlineRegular',
  'IconPlusOutlineRegular',
  'IconRightUpOutlineRegular',
  'IconSearchOutlineRegular',
  'IconTrashOutlineRegular',
  'Input',
  'Menu',
  'MenuItemButton',
  'Modal',
  'PathLabel',
  'Pill',
  'RiskConfirmation',
]

/**
 * Run the whole harness.
 * @param withPrimitives - whether require() resolves the primitives module.
 * @returns the number of failures.
 */
async function run(withPrimitives) {
  const registrations = []
  const cleanups = []
  const renderEffects = []

  /** A stub React good enough to build element trees. */
  const React = {
    createElement(type, props, ...children) {
      // `children` may arrive as rest arguments or as a prop; never drop either.
      const merged = children.length > 0 ? { ...(props ?? {}), children } : { ...(props ?? {}) }
      if (typeof type === 'function') return type(merged)
      return { type, props: merged, children: children.flat() }
    },
    Fragment: Symbol('Fragment'),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
    useEffect: (fn) => {
      renderEffects.push(fn)
    },
    useSyncExternalStore: (subscribe, getSnapshot) => {
      if (typeof subscribe === 'function') subscribe(() => {})
      return typeof getSnapshot === 'function' ? getSnapshot() : undefined
    },
  }

  /** A primitive stub: each export renders a leaf tagged with its own name. */
  const primitives = Object.fromEntries(
    PRIMITIVE_NAMES.map((name) => [
      name,
      function Primitive(props) {
        return { type: name, props: props ?? {}, children: [].concat(props?.children ?? []) }
      },
    ]),
  )

  const dictionary = { namespace: null, dicts: {} }
  const locale = {
    register(namespace, dicts) {
      dictionary.namespace = namespace
      Object.assign(dictionary.dicts, dicts)
      return () => {}
    },
    getSnapshot: () => ({ active: 'zh', locales: [], revision: 1 }),
    subscribe: () => () => {},
    bind: (namespace) => (key) => dictionary.dicts.en?.[key] ?? key,
  }

  const ctx = {
    locale,
    effect(factory, label) {
      const cleanup = factory()
      cleanups.push({ label, cleanup })
      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    },
    // `remote` is another plugin's service, and this composition leaves it out:
    // the dock must still mount, only without its event-driven refresh.
    inject(deps, callback) {
      if (deps.some((name) => this[name] === undefined)) return { dispose() {} }
      callback(this)
      return { dispose() {} }
    },
    slots: {
      inject(slotName, factory) {
        const result = factory()
        return () => {
          if (typeof result === 'function') result()
        }
      },
      register(options, Component) {
        registrations.push({ ...options, Component })
        return () => {}
      },
    },
  }

  let plugin = null
  const windowStub = {
    __ModuleLoader__: {
      load({ id, factory }) {
        plugin = {
          id,
          face: factory((specifier) => {
            if (specifier === 'react') return React
            if (specifier === '@deepseek-ai/dsh-client-ui-primitives' && withPrimitives) return primitives
            return undefined
          }),
        }
      },
    },
    addEventListener() {},
    removeEventListener() {},
  }
  const documentStub = { addEventListener() {}, removeEventListener() {} }

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  new Function('window', 'document', 'fetch', 'console', source)(windowStub, documentStub, globalThis.fetch, console)

  if (plugin === null) {
    console.error('FAIL the plugin never called __ModuleLoader__.load')
    return 1
  }

  const label = withPrimitives ? 'with primitives' : 'without primitives'
  console.log(`\n=== ${label}`)
  console.log('module id     ', plugin.id)
  console.log('module inject ', JSON.stringify(plugin.face.inject))

  // `remote` is another plugin's service: `apply` must survive a composition
  // that does not provide it, because the dock is the point of this plugin and
  // the event-driven refresh is only an optimisation on top of it.
  console.log('no remote dep ', ctx.remote === undefined ? 'tolerated (this stub omits it)' : 'present in stub')

  plugin.face.apply(ctx)

  const enKeys = Object.keys(dictionary.dicts.en ?? {}).sort()
  const zhKeys = Object.keys(dictionary.dicts.zh ?? {}).sort()
  const missingZh = enKeys.filter((key) => !zhKeys.includes(key))
  const missingEn = zhKeys.filter((key) => !enKeys.includes(key))
  console.log('dictionary ns ', dictionary.namespace)
  console.log('en keys       ', enKeys.length, '| zh keys', zhKeys.length)
  console.log('en/zh parity  ', missingZh.length === 0 && missingEn.length === 0 ? 'ok' : `missing zh: ${missingZh} / missing en: ${missingEn}`)

  console.log('registrations:')
  for (const entry of registrations) {
    console.log(`  ${entry.name.padEnd(40)} id=${String(entry.id).padEnd(26)} order=${entry.order}`)
  }

  const t = (key) => dictionary.dicts.en?.[key] ?? key
  const props = {
    sessionId: 'session-probe',
    displayTitle: 'Probe session',
    t,
    useMenuOpenState: () => [false, () => {}],
  }

  console.log('render probe:')
  let failed = missingZh.length + missingEn.length
  for (const entry of registrations) {
    try {
      const tree = entry.Component(props)
      const bytes = JSON.stringify(tree, (key, value) => (typeof value === 'symbol' ? String(value) : value)).length
      console.log(`  ${String(entry.id).padEnd(26)} ok, ${bytes} bytes of tree`)
    } catch (error) {
      failed += 1
      console.log(`  ${String(entry.id).padEnd(26)} THREW ${error.message}`)
    }
  }

  // Drain the render effects, then their cleanups, exactly as a mount and
  // unmount would.
  console.log('cleanup probe:')
  const effects = renderEffects.splice(0, renderEffects.length)
  for (const effect of effects) {
    try {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push({ label: 'component effect', cleanup })
    } catch (error) {
      failed += 1
      console.log(`  component effect THREW ${error.message}`)
    }
  }
  for (const entry of cleanups) {
    if (typeof entry.cleanup === 'function') {
      try {
        entry.cleanup()
      } catch (error) {
        failed += 1
        console.log(`  ${entry.label} THREW ${error.message}`)
      }
    }
  }
  console.log(`  ran ${cleanups.length} cleanups and ${effects.length} component effects`)
  return failed
}

const failures = (await run(true)) + (await run(false))
console.log(failures === 0 ? '\nRESULT ok' : `\nRESULT ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
