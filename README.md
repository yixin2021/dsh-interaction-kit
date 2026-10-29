# dsh-interaction-kit

English | [中文](README.zh.md)

Interaction and convenience upgrades for the DSH Web UI. One plugin, three surfaces, all built from
the shipped UI primitives so nothing looks bolted on.

- **Right-click a Session** — the same menu the `⋯` button opens (fork, rename, archive, pin,
  permanent delete, …), instead of having to hunt for the three dots.
- **Branch chip under the composer** — the workspace's current Git branch, click to switch. The menu
  is the native searchable menu: pinned search field, sticky section heading, branch list.
- **Worktree checkbox** — opt in per Session. On the first file write, a worktree is created and the
  Session moves into it, so parallel work stops colliding in one checkout.

## Features

### Session right-click menu

Right-clicking anywhere on a Session row opens exactly the menu the `⋯` trigger opens — it drives
the real trigger, not a copy of it, so every item (including ones other plugins add) is present.

The trigger is identified by its accessible name (`会话"{title}"的操作` / `Session "{title}"
actions`), never by position. That matters: the hover strip next to it also holds **archive** and
**pin**, so a positional lookup would archive the Session instead of opening the menu. If the
trigger cannot be identified, the plugin installs no listener and leaves the native behaviour alone.

### Permanent delete

A row appended to that menu, styled as a danger action. Where the built-in menu only archives,
this removes the Session for good:

1. archive with `stopActivity` (so a running turn is stopped first),
2. unarchive, then unpin (clears the flags that pin the record),
3. detach the Session from **every** workspace that lists it,
4. delete the Session log directory under `$DSH_HOME/sessions/`,
5. delete the single projection-cache file for that Session,
6. clear the plugin's own per-Session state,
7. emit `api-session/removed` so open views drop it.

Confirmation is a destructive-action dialog, not a plain OK box.

> Known residue: `storages/session_projcache.json` keeps one stale derived entry for the deleted
> Session. It is a cache index, it is never shown, and it is deliberately left alone rather than
> hand-editing a shared app file.

### Branch chip and switching

The dock sits in `conversation.composer.dock` and shows the branch of the Session's workspace,
with a warning tone when the checkout is detached, plus an uncommitted-file count.

Clicking it opens a list of local branches. A repository with a thousand branches is normal, so
the list renders at most 60 rows and the pinned search field narrows the rest; the heading states
the matched/total count while a filter is active. Creating a new branch (and checking it out) is
the last row.

Switching never discards work: a checkout that Git refuses is reported in place, and the menu stays
open with the error rather than closing on a half-applied change.

### Worktree mode

A checkbox on the same row as the branch chip, deliberately **not** inside the branch menu. When it
is on and the Session has no worktree yet, the first write tool call creates one:

```
<repository>/.worktrees/<branch>      branch: <session>-<slug>
```

and relocates the Session's working directory into it. Subsequent writes stay there. Turning the
checkbox off returns the Session to the repository root.

Creation prefers the host's own `worktrees` service, so it honours whatever sandbox and policy the
profile applies; it falls back to `git worktree add` only when no live Agent exists to create one.

The count in `worktree(N)` is the number of linked worktrees `git worktree list` reports beyond the
main checkout.

## Install

```bash
dsh plugin --profile web add github:ligudian/dsh-interaction-kit
```

Reload the page. Removing it:

```bash
dsh plugin --profile web rm dsh-interaction-kit
```

From a local checkout, install the directory instead:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-interaction-kit
```

### What needs a reload and what needs a restart

| Change | Takes effect |
| --- | --- |
| `client.js` | Client bytes are snapshotted when the plugin activates — disable/enable the plugin (or restart), then reload the page |
| `index.js` | Imported once at profile start — **restart DSH** |

## How it works

| Half | File | Responsibility |
| --- | --- | --- |
| Host | `index.js` | One authenticated route, `POST /api/interaction-kit`, plus a `tools/pre-execute` hook for auto-worktree. All `git` and filesystem work happens here. |
| Client | `client.js` | Five slot registrations: composer dock, branch menu overlay, Session menu row, Session row right-click, delete dialog. |

The page never runs `git` itself. The Client half only sends `{action, sessionId, …}` and renders
the answer, so a repository path or a branch name from the page is validated on the Host
(`NAME_PATTERN`) before it reaches a command line.

State lives in `$DSH_HOME/storages/interaction-kit-toolkit.json`:

```json
{ "version": 1, "worktreeMode": {}, "worktrees": {} }
```

Writes are queued and atomic, so two Sessions toggling at once cannot corrupt it.

### Slots

| Slot | Purpose |
| --- | --- |
| `conversation.composer.dock` | Branch chip + worktree checkbox |
| `shell.overlay` | Branch menu, create-branch dialog, delete confirmation |
| `sidebar.workspaces.session.menu.item` | Permanent delete row |
| `sidebar.workspaces.session.row.action` | Right-click → menu |

## Development

```bash
npm run check   # node --check on both halves
npm test        # client + layout harnesses
node verify-host.mjs <sessionId>   # drives the Host route against a sandboxed $DSH_HOME
```

`verify-layout.mjs` renders the slot components against a stub React and asserts the resulting tree
— which primitive was used, which classes, which locale strings, and the safety properties (no
archive click, no viewport-wide listener). The two harnesses are development-only and are not
shipped.

## License

MIT
