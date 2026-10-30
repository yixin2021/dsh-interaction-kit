# dsh-interaction-kit

English | [中文](README.zh.md)

Interaction and convenience upgrades for the DSH Web UI. One plugin, three surfaces, all built from
the shipped UI primitives so nothing looks bolted on.

- **Right-click a Session** — the same menu the `⋯` button opens (fork, rename, archive, pin,
  permanent delete, …), instead of having to hunt for the three dots.
- **Branch chip under the composer** — the workspace's current Git branch, click to switch. The menu
  is the native searchable menu: pinned search field, sticky section heading, branch list.
- **Worktree option** — opt in per Session before the first message. On the first file write, a
  worktree is created and the Session moves into it, so parallel work stops colliding in one
  checkout. Once the conversation has started the option becomes the worktree's name, and disappears
  when the Session never opted in.

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

The chip sits in `conversation.input.left` — the composer's tool row, immediately beside the mode
selector — and shows the branch of the Session's workspace, with a warning tone when the checkout is
detached, plus an uncommitted-file count.

That seat is deliberate. `conversation.composer.dock` is below the card, but the shipped `InputBar`
renders it only for `variant: "composer"`, and a Session with no messages yet is rendered as the
`hero` variant — so that seat is empty for exactly as long as the repository is still being chosen.
`conversation.input.left` is mounted in both variants, which is why the branch and the worktree
option are available before the first message rather than after it.

Clicking it opens a list of local branches. A repository with a thousand branches is normal, so
the list renders at most 60 rows and the pinned search field narrows the rest; the heading states
the matched/total count while a filter is active. Creating a new branch (and checking it out) is
the last row.

Switching never discards work: a checkout that Git refuses is reported in place, and the menu stays
open with the error rather than closing on a half-applied change.

### Worktree mode

A control on the same row as the branch chip, deliberately **not** inside the branch menu. Before the
Session has exchanged a message it is a checkbox: turning it on and writing the first file creates a
worktree:

```
<repository>/.worktrees/<branch>      branch: <session>-<slug>
```

and relocates the Session's working directory into it. Subsequent writes stay there. Turning the
checkbox off returns the Session to the repository root.

Creation prefers the host's own `worktrees` service, so it honours whatever sandbox and policy the
profile applies; it falls back to `git worktree add` only when no live Agent exists to create one.

Once the conversation has started the choice is spent, so the checkbox goes away and the row reports
instead: with the worktree on it shows `worktree(feature/topic-b)` — the label names the checkout this
Session writes to, not how many exist, and a checkout created without a branch falls back to its
directory name — and with it off it shows nothing at all, because the branch pill already says which
checkout that is. One rule, two reasons: turning the option off after the first message would not undo
anything (the writes that already ran in the worktree would stay there while later ones reopened the
main checkout), and a permanently disabled checkbox would only advertise a state nobody can change.
The Host refuses that transition with `worktree-locked` and reports `started` and `worktreeLocked` in
`status`.

## Install

Published on npm as [`dsh-interaction-kit`](https://www.npmjs.com/package/dsh-interaction-kit):

```bash
dsh plugin --profile web add dsh-interaction-kit
```

Or install it by name from the **Plugins** page in the desktop app. The plugin manager reads the npm
registry (falling back to npmmirror when the package or registry is unreachable), records the version
in the profile, and enables the bundle. Then reload the page.

Pin an exact release when you want one:

```bash
dsh plugin --profile web add dsh-interaction-kit@0.1.0
```

Removing it:

```bash
dsh plugin --profile web rm dsh-interaction-kit
```

From a local checkout, install the directory instead:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-interaction-kit
```

Version `0.1.0` is the first npm release. The earlier `v1.0.0` / `v1.1.0` tags belonged to the
GitHub-install era and were retired; npm is the supported install path from here on.

## Updating

The profile records the spec it installed with (`^0.1.0` for a plain `add`, the exact version when
you pin one), and the lockfile pins the resolved tarball. New releases are published to npm, so
updating means asking for the newer version:

```bash
dsh plugin --profile web add dsh-interaction-kit@0.1.1
```

That installs over the current copy and resolves the new tarball. Installing the bare name again
when it is already installed is refused as `already-installed` — the manager cannot tell that you
meant "latest" this time. In the desktop app, use the plugin's **Remove** and install it again.

After any update, **restart DSH**: the Host half is imported once at profile start, so reloading the
page alone leaves the old Host code running.

### Two install modes, one tradeoff

| Spec | Editing the source… | Use it when |
| --- | --- | --- |
| `/local/path` or `link:/local/path` | takes effect immediately (plus the reload rules below) | you are developing the plugin |
| `dsh-interaction-kit` (npm) | has no effect until you `npm publish` a new version | you want the installed copy to be exactly what is published |

A `link:` install is a symlink into your checkout, so the running plugin sees your working tree. An
npm install is a real directory unpacked from the published tarball — read-only in practice, and
identical to what everyone else gets. Switching between them is just `rm` + `add`.

### What needs a reload and what needs a restart

| Change | Takes effect |
| --- | --- |
| `client.js` | Client bytes are snapshotted when the plugin activates — disable/enable the plugin (or restart), then reload the page |
| `index.js` | Imported once at profile start — **restart DSH** |

## How it works

| Half | File | Responsibility |
| --- | --- | --- |
| Host | `index.js` | One authenticated route, `POST /api/interaction-kit`, plus a `tools/pre-execute` hook for auto-worktree. All `git` and filesystem work happens here. |
| Client | `client.js` | Five slot registrations: composer tool row, branch menu overlay, Session menu row, Session row right-click, delete dialog. |

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
| `conversation.input.left` | Branch chip + worktree option, beside the mode selector |
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
archive click, no viewport-wide listener). The harnesses are development-only: `files` in
`package.json` keeps them out of the published tarball.

### Releasing

```bash
# 1. bump "version" in package.json, then commit and tag
git commit -am "chore: release v0.1.1"
git tag -a v0.1.1 -m "v0.1.1"
git push origin main --follow-tags

# 2. publish to npm (prepublishOnly runs node --check and the test harnesses)
npm publish
```

`publishConfig.registry` points `npm publish` at the official registry even when your local `npm`
default is a mirror. Publishing needs a token that can write `dsh-interaction-kit`; run `npm login`
once per machine. Consumers pin `dsh-interaction-kit@0.1.1`, while a plain `add` follows the `0.1.x`
range recorded in the profile.

## License

MIT
