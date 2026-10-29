/**
 * DSH Interaction Kit — Client half.
 *
 * Four surfaces over one shared store, all built from the shipped UI
 * primitives so the plugin looks and behaves like the first-party chrome:
 *   - a dock row under the composer card holding the branch pill and, beside
 *     it as a peer control, the worktree checkbox (`conversation.composer.dock`),
 *   - a native `Menu` above that pill listing branches
 *     (`shell.overlay`),
 *   - a permanent-delete row in each Session's "..." menu
 *     (`sidebar.workspaces.session.menu.item`),
 *   - a hidden cell in the Session row that opens that same menu on
 *     right-click (`sidebar.workspaces.session.row.action`).
 *
 * Everything that touches the repository or the Session log goes through this
 * package's own Host route, so the page never runs git itself.
 *
 * @module dsh-interaction-kit/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-interaction-kit',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Namespace shared by the dictionaries and every slot registration. */
    const NS = 'interaction-kit'

    /** Authenticated Host route, relative to the page origin. */
    const ROUTE = 'api/interaction-kit'

    /** How many branch rows the menu paints before the search must narrow it. */
    const BRANCH_RENDER_LIMIT = 60

    /**
     * The shipped primitives. Resolved once; a lane that cannot see them falls
     * back to plain elements so the plugin still mounts.
     * @returns the primitive module, or undefined.
     */
    function loadPrimitives() {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives')
      } catch {
        return undefined
      }
    }

    /** @type {Record<string, string>} */
    const EN = {
      'dock.open': 'Switch branch',
      'dock.detached': 'detached HEAD',
      'dock.worktree': 'worktree',
      'dock.worktreeOff': 'Worktree off: code is written in the main checkout.',
      'dock.worktreeOn': 'Worktree on: the next file write creates a worktree first.',
      'dock.worktreeOnNamed': 'Worktree on: writes go to {branch}.',
      'menu.search': 'Search {repo} branches',
      'menu.section': 'Branches',
      'menu.count': '{matched} / {total}',
      'menu.dirty': '{count} uncommitted',
      'menu.create': 'Create and check out a new branch…',
      'menu.empty': 'No branches found.',
      'menu.noMatches': 'No branch matches that search.',
      'menu.loading': 'Reading the repository…',
      'menu.notRepository': 'This directory is not a Git repository.',
      'menu.noWorkspace': 'This Session has no working directory.',
      'menu.switchFailed': 'Could not switch branches.',
      'menu.worktreeFailed': 'Could not change the worktree option.',
      'create.title': 'Create a branch',
      'create.description': 'The new branch starts at the current commit and is checked out in this Session.',
      'create.label': 'New branch name',
      'create.placeholder': 'feature/my-change',
      'create.confirm': 'Create and check out',
      'create.cancel': 'Cancel',
      'create.failed': 'Could not create that branch.',
      'delete.menu': 'Delete permanently',
      'delete.title': 'Delete permanently',
      'delete.target': 'Session: {title}',
      'delete.description': 'This removes the Session log from disk and detaches it from every workspace. Other Sessions keep their own logs.',
      'delete.acknowledge': 'I understand this cannot be undone',
      'delete.confirm': 'Delete permanently',
      'delete.cancel': 'Cancel',
      'delete.failed': 'Could not delete the Session.',
      'close': 'Close',
      'error.generic': 'The Host rejected that request.',
    }

    /** @type {Record<string, string>} */
    const ZH = {
      'dock.open': '切换分支',
      'dock.detached': '游离 HEAD',
      'dock.worktree': 'worktree',
      'dock.worktreeOff': '未启用 worktree：代码写在主检出中。',
      'dock.worktreeOn': '已启用 worktree：下次写入代码前会自动切出工作树。',
      'dock.worktreeOnNamed': '已启用 worktree：代码写入 {branch}。',
      'menu.search': '搜索{repo}分支',
      'menu.section': '分支',
      'menu.count': '{matched} / {total}',
      'menu.dirty': '{count} 项未提交',
      'menu.create': '创建并检出 新分支…',
      'menu.empty': '未找到分支。',
      'menu.noMatches': '没有匹配的分支。',
      'menu.loading': '正在读取仓库…',
      'menu.notRepository': '当前目录不是 Git 仓库。',
      'menu.noWorkspace': '该会话没有工作目录。',
      'menu.switchFailed': '切换分支失败。',
      'menu.worktreeFailed': '无法更改 worktree 选项。',
      'create.title': '创建分支',
      'create.description': '新分支从当前提交开始，并在本会话中检出。',
      'create.label': '新分支名',
      'create.placeholder': 'feature/my-change',
      'create.confirm': '创建并检出',
      'create.cancel': '取消',
      'create.failed': '创建分支失败。',
      'delete.menu': '永久删除',
      'delete.title': '永久删除',
      'delete.target': '会话：{title}',
      'delete.description': '这会把该会话的日志从磁盘删除，并从所有工作区解绑。其它会话的日志不受影响。',
      'delete.acknowledge': '我明白此操作不可撤销',
      'delete.confirm': '永久删除',
      'delete.cancel': '取消',
      'delete.failed': '删除会话失败。',
      'close': '关闭',
      'error.generic': 'Host 拒绝了这次请求。',
    }

    /**
     * Only what the primitives do not already style. Every value here mirrors a
     * shipped rule — the menu list's 4px padding and 13px/20px item text, the
     * 11px tertiary label, the 14px check glyph — so the plugin's chrome is
     * indistinguishable from the first-party menu it appears in.
     */
    const CSS = `
.dsh-ik-dock{display:inline-flex;align-items:center;gap:8px;min-width:0}
.dsh-ik-dock>label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ik-dock-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px}
.dsh-ik-menu.dsh-ik-menu{width:max-content;min-width:min(240px,100vw - 32px);max-width:min(360px,100vw - 32px);max-height:min(360px,100vh - 96px);overflow:hidden;display:flex;flex-direction:column}
.dsh-ik-search-row{position:sticky;top:0;z-index:1;flex:none;display:flex;margin:2px 0 3px;background:var(--dsw-alias-menu-group-header-fill)}
.dsh-ik-search-row .dsh-ik-search{flex:1 1 auto;width:100%;min-width:0;box-sizing:border-box;border:0;outline:none;background:transparent;height:auto;padding:5px 7px;border-radius:var(--dsw-radius-md)}
.dsh-ik-search-row .dsh-ik-search:focus-within,.dsh-ik-search-row .dsh-ik-search:has(input:focus-visible){border-color:transparent;outline:none}
.dsh-ik-search-row .dsh-ik-search input{padding:0;font-size:12px;line-height:normal;outline:none}
.dsh-ik-search-row .dsh-ik-search input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-ik-branch{display:flex;align-items:center;gap:8px;min-width:0;width:100%}
.dsh-ik-branch-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ik-branch-dirty{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.dsh-ik-branch-check{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-primary)}
.dsh-ik-form{display:flex;flex-direction:column;gap:10px}
.dsh-ik-form-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.dsh-ik-menu-status{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px;word-break:break-word}
.dsh-ik-hidden{display:none}
`

    /** @returns whether `value` is a plain JSON object. */
    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /**
     * Fill `{name}` slots.
     * @param template - the translated text.
     * @param values - replacement values.
     * @returns the interpolated text.
     */
    function fill(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match))
    }

    /** The hover strip at the end of a Session row, matched by class suffix. */
    const ROW_ACTIONS_SELECTOR = '[class*="rowActions"]'

    /**
     * Resolve a Session row's "..." menu trigger.
     *
     * The strip is `[the "..." Menu anchor, ...slot buttons]`, but the shipped
     * hover buttons there are *destructive* (`archive` is order 100, `pin` 200),
     * so pressing the wrong one archives the Session. The trigger therefore has
     * to be identified by its own contract rather than by position: its
     * accessible name is the row's menu label, `会话"{title}"的操作`, which
     * carries the Session title. No hover button ever names the title.
     *
     * @param row - the `role="treeitem"` row.
     * @param displayTitle - the row's title, as the owner passed it.
     * @returns the trigger button, or null when the row offers none safely.
     */
    function findSessionMenuTrigger(row, displayTitle) {
      const strip = row.querySelector(ROW_ACTIONS_SELECTOR)
      const scope = strip ?? row
      const buttons = Array.from(scope.querySelectorAll('button'))
      if (buttons.length === 0) return null
      const title = typeof displayTitle === 'string' ? displayTitle.trim() : ''
      if (title.length > 0) {
        const named = buttons.find((button) => (button.getAttribute('aria-label') ?? '').includes(title))
        if (named !== undefined) return named
        // A titled row whose menu label cannot be found is not this row's menu;
        // refuse rather than press whichever destructive button comes first.
        return null
      }
      // Untitled rows have no accessible-name discriminator, but the shipped
      // contract still puts the menu trigger first in the strip.
      return buttons[0] ?? null
    }

    /**
     * Call this package's Host route; never throws.
     * @param action - Host action name.
     * @param sessionId - addressed Session.
     * @param extra - additional fields.
     * @returns the decoded answer.
     */
    async function callHost(action, sessionId, extra) {
      let response
      try {
        response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, sessionId, ...(extra ?? {}) }),
        })
      } catch (error) {
        return { ok: false, code: 'network', message: String(error) }
      }
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      if (!isRecord(body)) return { ok: false, code: 'http', message: `HTTP ${response.status}` }
      return body
    }

    /**
     * The branch menu's visibility plus every watched Session's Git status.
     * @returns the store.
     */
    function createStore() {
      let state = {
        menuOpen: false,
        menuSessionId: null,
        menuAnchor: null,
        statuses: {},
        loading: false,
        busy: false,
        error: '',
        branchFilter: '',
        createOpen: false,
        createSessionId: null,
        createDraft: '',
        createError: '',
        createBusy: false,
        deleteOpen: false,
        deleteSessionId: null,
        deleteTitle: '',
        deleteError: '',
        deleteBusy: false,
        deleteAcknowledged: false,
      }
      const listeners = new Set()
      const watched = new Set()

      /** @returns the current state reference. */
      const get = () => state

      /** @param fn - change listener. @returns the unsubscribe function. */
      const subscribe = (fn) => {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      }

      /** @param patch - fields to replace. */
      const set = (patch) => {
        state = { ...state, ...patch }
        for (const fn of Array.from(listeners)) fn()
      }

      /**
       * Cache one Session's status.
       * @param sessionId - addressed Session.
       * @param status - the Host answer.
       */
      const putStatus = (sessionId, status) => {
        set({ statuses: { ...state.statuses, [sessionId]: status } })
      }

      /**
       * Re-read one Session's repository facts.
       * @param sessionId - addressed Session.
       * @param options - `quiet` keeps the current values visible while reading.
       */
      const refresh = async (sessionId, options) => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        if (options?.quiet !== true) set({ loading: true })
        const answer = await callHost('status', sessionId)
        putStatus(sessionId, answer)
        set({ loading: false })
      }

      /** Re-read every Session a mounted dock tracks. */
      const refreshAll = () => {
        for (const sessionId of Array.from(watched)) void refresh(sessionId, { quiet: true })
      }

      /**
       * Track one Session while its dock entry is mounted.
       * @param sessionId - Session to track.
       * @returns the unregister function.
       */
      const watch = (sessionId) => {
        watched.add(sessionId)
        return () => {
          watched.delete(sessionId)
        }
      }

      /**
       * Adopt an answer: cache the status it carries, or re-read one.
       * @param sessionId - addressed Session.
       * @param answer - the Host answer.
       * @param fallbackMessage - shown when the Host sends no message.
       * @returns the answer.
       */
      const settle = async (sessionId, answer, fallbackMessage) => {
        const message = answer.ok === true ? '' : typeof answer.message === 'string' ? answer.message : fallbackMessage
        set({ busy: false, error: message })
        if (answer.ok === true) {
          if (Array.isArray(answer.branches)) putStatus(sessionId, answer)
          else await refresh(sessionId, { quiet: true })
        }
        return answer
      }

      return {
        get,
        subscribe,
        set,
        refresh,
        refreshAll,
        watch,
        /**
         * Open the branch menu above one Session's pill.
         * @param sessionId - addressed Session.
         * @param rect - the pill's viewport rectangle, used as the menu anchor.
         */
        openMenu: (sessionId, rect) => {
          set({ menuOpen: true, menuSessionId: sessionId, menuAnchor: rect, branchFilter: '', error: '', busy: false })
          void refresh(sessionId, { quiet: true })
        },
        closeMenu: () => set({ menuOpen: false, branchFilter: '', error: '' }),
        /**
         * Switch this Session's checkout to one branch, then dismiss the menu.
         * @param branch - branch name from the menu row.
         * @param fallbackMessage - shown when the Host sends no message.
         */
        switchBranch: async (branch, fallbackMessage) => {
          const sessionId = state.menuSessionId
          if (typeof sessionId !== 'string') return
          set({ busy: true, error: '' })
          const answer = await callHost('switch', sessionId, { branch })
          await settle(sessionId, answer, fallbackMessage)
          if (answer.ok === true) set({ menuOpen: false, branchFilter: '' })
        },
        /**
         * Flip the worktree checkbox. Turning it off while this Session sits in
         * a checkout the plugin created also returns it to the checkout it
         * started in, so the box never claims a state the cwd contradicts.
         * @param sessionId - addressed Session.
         * @param enabled - the requested state.
         * @param fallbackMessage - shown when the Host sends no message.
         */
        setWorktreeMode: async (sessionId, enabled, fallbackMessage) => {
          const status = state.statuses[sessionId] ?? null
          const hadWorktree = isRecord(status) && isRecord(status.worktree)
          set({ busy: true, error: '' })
          const answer = await callHost('set-worktree-mode', sessionId, { enabled })
          await settle(sessionId, answer, fallbackMessage)
          if (answer.ok === true && !enabled && hadWorktree) {
            await callHost('restore-cwd', sessionId)
            await refresh(sessionId, { quiet: true })
          }
        },
        /** Open the create-branch modal for the menu's Session. */
        openCreate: () => set({ createOpen: true, createSessionId: state.menuSessionId, createDraft: '', createError: '' }),
        closeCreate: () => set({ createOpen: false, createDraft: '', createError: '', createBusy: false }),
        /**
         * Create a branch from the current commit and check it out.
         * @param fallbackMessage - shown when the Host sends no message.
         */
        createBranch: async (fallbackMessage) => {
          const sessionId = state.createSessionId
          const branch = state.createDraft.trim()
          if (typeof sessionId !== 'string' || branch.length === 0) return
          set({ createBusy: true, createError: '' })
          const answer = await callHost('create-branch', sessionId, { branch })
          if (answer.ok === true) {
            if (Array.isArray(answer.branches)) putStatus(sessionId, answer)
            else await refresh(sessionId, { quiet: true })
            set({ createOpen: false, createBusy: false, createDraft: '', menuOpen: false })
            return
          }
          const message = typeof answer.message === 'string' ? answer.message : fallbackMessage
          set({ createBusy: false, createError: message })
        },
        /**
         * Open the acknowledgement for a permanent delete.
         * @param sessionId - Session to delete.
         * @param title - Session title.
         */
        openDelete: (sessionId, title) => {
          set({
            deleteOpen: true,
            deleteSessionId: sessionId,
            deleteTitle: title,
            deleteError: '',
            deleteBusy: false,
            deleteAcknowledged: false,
          })
        },
        closeDelete: () => set({ deleteOpen: false, deleteError: '', deleteBusy: false, deleteAcknowledged: false }),
        /**
         * Delete the Session's log for good.
         * @param fallbackMessage - shown when the Host sends no message.
         */
        deleteSession: async (fallbackMessage) => {
          const sessionId = state.deleteSessionId
          if (typeof sessionId !== 'string') return
          set({ deleteBusy: true, deleteError: '' })
          const answer = await callHost('delete-session', sessionId)
          if (answer.ok === true) {
            set({ deleteOpen: false, deleteBusy: false, deleteAcknowledged: false })
            return
          }
          const message = typeof answer.message === 'string' ? answer.message : fallbackMessage
          set({ deleteBusy: false, deleteError: message })
        },
      }
    }

    /**
     * Build the slot components over one store.
     * @param store - shared panel store.
     * @param primitives - the shipped primitive module, or undefined.
     * @returns the components, keyed by the slot they fill.
     */
    function createUi(store, primitives) {
      const p = primitives ?? {}

      /**
       * Whether a primitive can be rendered.
       *
       * Not every export is a plain function: `Input` is a `forwardRef`, which
       * React returns as an object with a `$$typeof` symbol. A `typeof ===
       * 'function'` test therefore rejects real components and silently drops
       * to the plain-element fallback, which is how a raw `<input>` ended up in
       * the branch menu. Accept anything React itself would accept.
       *
       * @param value - a candidate primitive.
       * @returns true when `createElement` can take it.
       */
      function canRender(value) {
        if (typeof value === 'function') return true
        return typeof value === 'object' && value !== null && typeof value['$$typeof'] === 'symbol'
      }

      /** @returns the stylesheet element; per-instance elements are harmless. */
      function StyleTag() {
        return h('style', { 'data-interaction-kit': 'styles' }, CSS)
      }

      /** @returns the search glyph, or null when primitives are unavailable. */
      function SearchIcon() {
        return canRender(p.IconSearchOutlineRegular) ? h(p.IconSearchOutlineRegular) : null
      }

      /** @returns the plus glyph used by the create row. */
      function PlusIcon() {
        return canRender(p.IconPlusOutlineRegular) ? h(p.IconPlusOutlineRegular) : null
      }

      /** @returns the branch glyph shared by the pill and the menu rows. */
      function BranchIcon() {
        return canRender(p.IconBranchOutlineRegular) ? h(p.IconBranchOutlineRegular) : null
      }

      /**
       * The menu's own check glyph, drawn from the same path the shipped
       * `Menu` paints for a selected item: a 16×16 box with a `strokeWidth`
       * of 1 over `M2.25 8.5L5.49732 11.7473…`. The primitives expose no check
       * icon — only that internal path — so it is reproduced here verbatim
       * rather than substituted with a different-looking tick.
       * @returns the check glyph.
       */
      function CheckIcon() {
        return h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg',
            'aria-hidden': 'true',
            strokeWidth: 1,
            className: 'dsh-ik-branch-check',
          },
          h('path', {
            d: 'M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4',
            stroke: 'currentColor',
          }),
        )
      }

      /** @returns the trash glyph for the delete row. */
      function TrashIcon() {
        return canRender(p.IconTrashOutlineRegular) ? h(p.IconTrashOutlineRegular) : null
      }

      /**
       * One branch row: a single native menu line — glyph, ellipsised name, the
       * uncommitted count in the muted trailing position the shipped shortcuts
       * occupy, and the check on the current row.
       * @param props - the row's data.
       * @returns the menu item.
       */
      function BranchRow(props) {
        const current = props.current
        const label = h(
          'span',
          { className: 'dsh-ik-branch' },
          h('span', { className: 'dsh-ik-branch-name' }, props.name),
          current && props.dirtyCount > 0
            ? h('span', { className: 'dsh-ik-branch-dirty' }, fill(props.t('menu.dirty'), { count: props.dirtyCount }))
            : null,
          current ? h(CheckIcon) : null,
        )
        return h(
          p.MenuItemButton ?? 'button',
          {
            icon: props.icon,
            current,
            disabled: props.disabled,
            onSelect: props.onSelect,
          },
          label,
        )
      }

      /**
       * The dock row: the branch pill with the worktree checkbox beside it.
       * Both come from the primitives, so they carry the first-party styling;
       * the checkbox is a peer of the pill, never a section of the menu.
       */
      function BranchDock(props) {
        const t = props.t
        const sessionId = props.sessionId
        const snapshot = React.useSyncExternalStore(store.subscribe, store.get)
        const status = snapshot.statuses[sessionId]

        React.useEffect(() => {
          const unwatch = store.watch(sessionId)
          void store.refresh(sessionId, { quiet: true })
          return () => unwatch()
        }, [sessionId])

        if (!isRecord(status) || status.ok !== true) return h(StyleTag)

        const branch = typeof status.branch === 'string' && status.branch.length > 0 ? status.branch : t('dock.detached')
        const on = status.worktreeMode === true
        const worktree = isRecord(status.worktree) ? status.worktree : null
        let checkTitle = t('dock.worktreeOn')
        if (on === false) checkTitle = t('dock.worktreeOff')
        else if (worktree !== null && typeof worktree['branch'] === 'string') checkTitle = fill(t('dock.worktreeOnNamed'), { branch: worktree['branch'] })

        // `git worktree list` always reports the main checkout first, so every
        // entry after it is a worktree someone switched out. Counting by position
        // rather than by path keeps the number right inside a linked worktree
        // too, where the Session's own root is not the main one.
        const listings = Array.isArray(status.worktrees) ? status.worktrees : []
        const worktreeCount = Math.max(0, listings.length - 1)

        // The Menu closes itself on any outside pointerdown, so a second press
        // on the pill has to toggle. The rect comes from the event rather than
        // a ref: `Pill` is a plain function component and cannot take one.
        const openMenu = (event) => {
          if (snapshot.menuOpen && snapshot.menuSessionId === sessionId) {
            store.closeMenu()
            return
          }
          const node = event?.currentTarget
          if (typeof node?.getBoundingClientRect !== 'function') return
          const rect = node.getBoundingClientRect()
          store.openMenu(sessionId, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height })
        }

        const pillContent = h(
          React.Fragment,
          null,
          h(BranchIcon),
          h('span', { className: 'dsh-ik-dock-label' }, branch),
        )
        const expanded = snapshot.menuOpen && snapshot.menuSessionId === sessionId

        return h(
          React.Fragment,
          null,
          h(StyleTag),
          h(
            'span',
            { className: 'dsh-ik-dock' },
            canRender(p.Pill)
              ? h(
                  p.Pill,
                  {
                    onClick: openMenu,
                    title: t('dock.open'),
                    'aria-haspopup': 'menu',
                    'aria-expanded': expanded ? 'true' : 'false',
                  },
                  pillContent,
                )
              : h('button', { type: 'button', onClick: openMenu, title: t('dock.open'), 'aria-haspopup': 'menu' }, pillContent),
            canRender(p.Checkbox)
              ? h(p.Checkbox, {
                  checked: on,
                  disabled: snapshot.busy,
                  // The count rides inside the label so it sits against the word:
                  // a separate chip would be pushed out by the row's own gap.
                  label: `${t('dock.worktree')}(${worktreeCount})`,
                  title: checkTitle,
                  onChange: (next) => {
                    void store.setWorktreeMode(sessionId, next, t('menu.worktreeFailed'))
                  },
                })
              : h(
                  'label',
                  null,
                  h('input', { type: 'checkbox', checked: on, onChange: () => store.setWorktreeMode(sessionId, !on, t('menu.worktreeFailed')) }),
                  `${t('dock.worktree')}(${worktreeCount})`,
                ),
          ),
        )
      }

      /** The create-branch modal, opened from the menu's last row. */
      function CreateBranchModal(props) {
        const t = props.t
        const snapshot = React.useSyncExternalStore(store.subscribe, store.get)
        if (!canRender(p.Modal)) return null
        const draft = snapshot.createDraft
        /** Create the typed branch. */
        const submit = () => {
          if (draft.trim() === '' || snapshot.createBusy) return
          void store.createBranch(t('create.failed'))
        }
        return h(p.Modal, {
          open: snapshot.createOpen,
          onClose: () => store.closeCreate(),
          closeLabel: t('close'),
          title: t('create.title'),
          description: t('create.description'),
          footer: h(
            React.Fragment,
            null,
            h(p.Button, { variant: 'outline', onClick: () => store.closeCreate() }, t('create.cancel')),
            h(p.Button, { variant: 'primary', disabled: snapshot.createBusy || draft.trim() === '', onClick: submit }, t('create.confirm')),
          ),
          children: h(
            'div',
            { className: 'dsh-ik-form' },
            canRender(p.Input)
              ? h(p.Input, {
                  value: draft,
                  placeholder: t('create.placeholder'),
                  'aria-label': t('create.label'),
                  autoFocus: true,
                  spellCheck: false,
                  onChange: (event) => store.set({ createDraft: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') submit()
                  },
                })
              : h('input', {
                  value: draft,
                  'aria-label': t('create.label'),
                  onChange: (event) => store.set({ createDraft: event.target.value }),
                }),
            snapshot.createError.length > 0 ? h('div', { className: 'dsh-ik-form-error', role: 'alert' }, snapshot.createError) : null,
          ),
        })
      }

      /**
       * Everything that floats: the branch menu and the create-branch modal.
       * Both portal themselves to the document body.
       */
      function GitOverlay(props) {
        const t = props.t
        const snapshot = React.useSyncExternalStore(store.subscribe, store.get)
        const sessionId = snapshot.menuSessionId
        const status = typeof sessionId === 'string' ? (snapshot.statuses[sessionId] ?? null) : null
        const ready = isRecord(status) && status.ok === true

        // A group heading only earns its fill once it pins against the scrolling
        // viewport; the shipped observer is the code that decides that.
        React.useEffect(() => {
          if (snapshot.menuOpen !== true || typeof p.observeStickyMenuGroups !== 'function') return undefined
          let dispose = null
          let frame = 0
          const attach = () => {
            const list = document.querySelector('[role="menu"].dsh-ik-menu')
            if (list === null) return
            // The list pads itself; its own child carries the scroll.
            const viewport = list.querySelector('[role="presentation"]') ?? list
            const cleanup = p.observeStickyMenuGroups(viewport)
            dispose = typeof cleanup === 'function' ? cleanup : null
          }
          // The Menu mounts its portal and then fills the anchor rect, so wait for
          // the first painted frame before measuring.
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(attach)
          })
          return () => {
            cancelAnimationFrame(frame)
            if (dispose !== null) dispose()
          }
        }, [snapshot.menuOpen])

        if (!canRender(p.Menu)) {
          return h(
            React.Fragment,
            null,
            h(StyleTag),
            h(CreateBranchModal, { t }),
          )
        }

        const repositoryRoot = isRecord(status) && typeof status.repositoryRoot === 'string' ? status.repositoryRoot : ''
        const repoName = repositoryRoot.length > 0 ? (repositoryRoot.split('/').filter(Boolean).pop() ?? repositoryRoot) : ''
        const branches = isRecord(status) && Array.isArray(status.branches) ? status.branches : []
        const total = isRecord(status) && typeof status.branchTotal === 'number' ? status.branchTotal : branches.length
        const needle = snapshot.branchFilter.trim().toLowerCase()
        const matched = needle === '' ? branches : branches.filter((name) => String(name).toLowerCase().includes(needle))
        const shown = matched.slice(0, BRANCH_RENDER_LIMIT)
        const dirtyCount = isRecord(status) && typeof status.dirtyCount === 'number' ? status.dirtyCount : 0

        /** @returns the copy explaining why no rows are shown. */
        const failureText = () => {
          if (isRecord(status) && typeof status.message === 'string' && status.message.length > 0) return status.message
          if (isRecord(status) && status.code === 'not-a-repository') return t('menu.notRepository')
          if (isRecord(status) && status.code === 'no-workspace') return t('menu.noWorkspace')
          return snapshot.loading ? t('menu.loading') : t('error.generic')
        }

        // One text for the placeholder and the accessible name, so neither can
        // leak the template's `{repo}` hole when the repository is unknown.
        const searchText = repoName.length > 0 ? fill(t('menu.search'), { repo: repoName }) : t('menu.section')
        const search =
          canRender(p.Input)
            ? h(p.Input, {
                className: 'dsh-ik-search',
                icon: h(SearchIcon),
                type: 'search',
                value: snapshot.branchFilter,
                placeholder: searchText,
                'aria-label': searchText,
                spellCheck: false,
                onChange: (event) => store.set({ branchFilter: event.target.value }),
                // The menu walks buttons on arrow keys; keep them with the caret.
                onKeyDown: (event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
                    event.stopPropagation()
                  }
                },
              })
            : h('input', {
                className: 'dsh-ik-search',
                value: snapshot.branchFilter,
                placeholder: searchText,
                'aria-label': searchText,
                onChange: (event) => store.set({ branchFilter: event.target.value }),
              })

        // A searchable shipped menu rows its field above the scrolling list and
        // pins it there, so the field stays put while the branches scroll under.
        const head = h('div', { className: 'dsh-ik-search-row' }, search)

        // The section label is the shipped `MenuGroup`: its own heading element,
        // native 11px tertiary type, sticky inside the scrolling viewport, and the
        // `data-stuck` fill once it pins.
        const headingText = ready && matched.length !== total
          ? `${t('menu.section')} · ${fill(t('menu.count'), { matched: matched.length, total })}`
          : t('menu.section')
        const group = (content) =>
          canRender(p.MenuGroup) ? h(p.MenuGroup, { label: headingText }, content) : content

        /** @returns the branch rows, or the reason there are none. */
        const rows = () => {
          if (!ready) return h('div', { className: 'dsh-ik-menu-status', role: 'status' }, failureText())
          if (branches.length === 0) return h('div', { className: 'dsh-ik-menu-status', role: 'status' }, t('menu.empty'))
          if (matched.length === 0) return h('div', { className: 'dsh-ik-menu-status', role: 'status' }, t('menu.noMatches'))
          return shown.map((name) =>
            h(BranchRow, {
              key: name,
              t,
              name: String(name),
              icon: h(BranchIcon),
              current: status.branch === name,
              dirtyCount,
              disabled: snapshot.busy,
              onSelect: () => {
                if (status.branch === name) {
                  store.closeMenu()
                  return
                }
                void store.switchBranch(name, t('menu.switchFailed'))
              },
            }),
          )
        }

        const footer = ready
          ? [
              {
                id: 'create-branch',
                label: t('menu.create'),
                icon: h(PlusIcon),
              },
            ]
          : []

        return h(
          React.Fragment,
          null,
          h(StyleTag),
          h(p.Menu, {
            open: snapshot.menuOpen,
            onClose: () => store.closeMenu(),
            anchor: null,
            getAnchorRect: () => (isRecord(snapshot.menuAnchor) ? snapshot.menuAnchor : null),
            portal: true,
            side: 'top',
            align: 'start',
            listClassName: 'dsh-ik-menu',
            footer,
            onSelect: (id) => {
              if (id === 'create-branch') store.openCreate()
            },
            children: h(
              React.Fragment,
              null,
              head,
              snapshot.error.length > 0 ? h('div', { className: 'dsh-ik-menu-status', role: 'alert' }, snapshot.error) : null,
              group(rows()),
            ),
          }),
          h(CreateBranchModal, { t }),
        )
      }

      /** A hook for a lane that does not inject the menu's open state. */
      function useNoMenuOpenState() {
        return [false, () => {}]
      }

      /** One Session menu row that deletes the Session for good. */
      function PermanentDeleteMenuItem(props) {
        const t = props.t
        // The owner shares its open-state pair through this Hook, so choosing
        // the row can dismiss the menu before the dialog takes over.
        const useMenuOpenState = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState : useNoMenuOpenState
        const openState = useMenuOpenState()
        const setMenuOpen = Array.isArray(openState) && typeof openState[1] === 'function' ? openState[1] : () => {}
        const displayTitle = typeof props.displayTitle === 'string' ? props.displayTitle : ''

        const select = () => {
          try {
            setMenuOpen(false)
          } catch {
            /* A menu that already closed needs no second close. */
          }
          store.openDelete(props.sessionId, displayTitle)
        }

        if (canRender(p.MenuItemButton)) {
          return h(p.MenuItemButton, { icon: h(TrashIcon), danger: true, onSelect: select }, t('delete.menu'))
        }
        return h(
          React.Fragment,
          null,
          h(StyleTag),
          h('button', { type: 'button', role: 'menuitem', onClick: select }, h(TrashIcon), h('span', null, t('delete.menu'))),
        )
      }

      /**
       * A hidden cell inside one Session row. It gives the plugin a node whose
       * ancestors are that row, so a right-click on the row can open the same
       * "..." menu the trigger button opens — the row itself exposes no Slot.
       * @param props - the row's Session and title.
       * @returns an invisible marker.
       */
      function SessionRowContextAction(props) {
        const marker = React.useRef(null)

        React.useEffect(() => {
          const node = marker.current
          if (node === null) return undefined
          const row = node.closest('[role="treeitem"]')
          if (row === null) return undefined
          const trigger = findSessionMenuTrigger(row, props.displayTitle)
          if (trigger === null) return undefined

          const onContextMenu = (event) => {
            event.preventDefault()
            event.stopPropagation()
            trigger.click()
          }
          row.addEventListener('contextmenu', onContextMenu)
          return () => row.removeEventListener('contextmenu', onContextMenu)
        }, [props.sessionId, props.displayTitle])

        return h('span', { ref: marker, className: 'dsh-ik-hidden', 'data-interaction-kit-row': props.sessionId })
      }

      /** The acknowledgement required before a permanent delete. */
      function DeleteConfirmation(props) {
        const t = props.t
        const snapshot = React.useSyncExternalStore(store.subscribe, store.get)

        if (snapshot.deleteOpen !== true) return null

        // The target has to be unmistakable, and a failed attempt has to say so
        // without discarding the acknowledgement the user already gave.
        const target = snapshot.deleteTitle.length > 0 ? fill(t('delete.target'), { title: snapshot.deleteTitle }) : ''
        const description = [target, t('delete.description'), snapshot.deleteError].filter((part) => part.length > 0).join(' ')

        /** @param acknowledged - current acknowledgement state. */
        const setAcknowledged = (acknowledged) => store.set({ deleteAcknowledged: acknowledged })

        if (canRender(p.RiskConfirmation)) {
          return h(p.RiskConfirmation, {
            open: true,
            title: t('delete.title'),
            description,
            acknowledgeLabel: t('delete.acknowledge'),
            cancelLabel: t('delete.cancel'),
            confirmLabel: t('delete.confirm'),
            closeLabel: t('close'),
            acknowledged: snapshot.deleteAcknowledged,
            disabled: snapshot.deleteBusy,
            onAcknowledgedChange: setAcknowledged,
            onCancel: () => store.closeDelete(),
            onConfirm: () => {
              void store.deleteSession(t('delete.failed'))
            },
          })
        }

        if (!canRender(p.Modal)) return null
        return h(p.Modal, {
          open: true,
          onClose: () => store.closeDelete(),
          closeLabel: t('close'),
          title: t('delete.title'),
          description,
          footer: h(
            React.Fragment,
            null,
            h(p.Button, { variant: 'outline', onClick: () => store.closeDelete() }, t('delete.cancel')),
            h(p.Button, { variant: 'primary', disabled: snapshot.deleteBusy || !snapshot.deleteAcknowledged, onClick: () => store.deleteSession(t('delete.failed')) }, t('delete.confirm')),
          ),
          children: canRender(p.Checkbox)
            ? h(p.Checkbox, { checked: snapshot.deleteAcknowledged, label: t('delete.acknowledge'), onChange: setAcknowledged })
            : null,
        })
      }

      return { BranchDock, GitOverlay, PermanentDeleteMenuItem, SessionRowContextAction, DeleteConfirmation }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'interaction-kit: dictionaries')

        const primitives = loadPrimitives()
        const store = createStore()
        const { BranchDock, GitOverlay, PermanentDeleteMenuItem, SessionRowContextAction, DeleteConfirmation } = createUi(store, primitives)

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'interaction-kit-branch',
              order: -10,
              locale: NS,
            },
            BranchDock,
          ),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'interaction-kit-dialog',
              order: 40,
              locale: NS,
            },
            GitOverlay,
          ),
        )

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'interaction-kit-delete',
              order: 900,
              locale: NS,
            },
            PermanentDeleteMenuItem,
          ),
        )

        ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.row.action',
              id: 'interaction-kit-context',
              order: 900,
              locale: NS,
            },
            SessionRowContextAction,
          ),
        )

        // The delete confirmation is mounted from the menu row's own area: it
        // must survive the Session menu closing as soon as the row is chosen.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'interaction-kit-delete-dialog',
              order: 41,
              locale: NS,
            },
            DeleteConfirmation,
          ),
        )

        ctx.effect(() => {
          const onFocus = () => store.refreshAll()
          window.addEventListener('focus', onFocus)
          document.addEventListener('visibilitychange', onFocus)
          return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onFocus)
          }
        }, 'interaction-kit: refresh on focus')
      },
    }
  },
})
