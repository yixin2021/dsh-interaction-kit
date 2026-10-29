# dsh-interaction-kit

DSH Web 交互增强套件：一个插件，三处改进，全部用原生 UI 组件实现，不做生硬的样式改造。

- **右键会话** —— 直接弹出与 `⋯` 按钮完全相同的菜单（分叉、重命名、归档、置顶、永久删除……），
  不必再去瞄准那三个点。
- **对话框下方的分支胶囊** —— 显示当前工作区的 Git 分支，点击即可切换。菜单本身就是原生可搜索菜单：
  吸顶搜索框、吸顶分组标题、分支列表。
- **工作树选项** —— 按会话开启，先勾选再写代码，首次写文件时自动创建 worktree 并把会话迁入，并行开发
  不再挤在同一个检出里。对话开始后选项变成 worktree 名称；没开启则整项不再显示。

## 功能

### 会话右键菜单

在会话行任意位置右键，都会打开与 `⋯` 触发器**同一个**菜单——它驱动的是真实触发器而不是复制一份，
所以其他插件加进去的菜单项也一并存在。

触发器通过无障碍名称（`会话"{标题}"的操作`）识别，**不按位置取**。这一点很关键：旁边悬停区里还放着
**归档**和**置顶**，按位置取会把会话直接归档。识别不到触发器时，插件不安装任何监听，保持原生行为。

### 永久删除

追加在菜单末尾的一行危险操作。系统自带的菜单只能归档，这一项才是真正删除：

1. 带 `stopActivity` 归档（先停掉正在跑的回合），
2. 取消归档、再取消置顶（清掉钉住该记录的标记），
3. 从**每一个**列出它的工作区中解绑，
4. 删除 `$DSH_HOME/sessions/` 下的会话日志目录，
5. 删除该会话对应的单个投影缓存文件，
6. 清理插件自己的按会话状态，
7. 广播 `api-session/removed`，让已打开的视图同步移除。

确认框是危险操作对话框，不是普通 OK 框。

> 已知残留：`storages/session_projcache.json` 里会留下一条该会话的派生索引。它是缓存索引、从不展示，
> 这里刻意不动它，避免手改应用共享文件。

### 分支胶囊与切换

胶囊挂在 `conversation.input.left`——对话框的工具行，紧挨模式选择——显示会话所在工作区的分支；
处于游离 HEAD 时用警示色提示，另外显示未提交文件数。

这个位置是刻意选的。`conversation.composer.dock` 在输入框卡片下方，但原生 `InputBar` 只在
`variant: "composer"` 时渲染它，而还没发过消息的会话走的是 `hero` 变体——也就是说，正好在「还在选
目录」的阶段，那个座位是空的。`conversation.input.left` 两种变体都会挂载，所以分支和工作树选项在
第一条消息之前就可用，而不是之后才冒出来。

点击展开本地分支列表。仓库有上千个分支是常态，所以列表最多渲染 60 行，其余靠吸顶搜索框筛；
筛选时分组标题会显示「命中/总数」。新建并检出分支是最后一行。

切换不会丢工作：Git 拒绝的检出会就地报错，菜单保持打开并显示原因，不会在半应用的状态下关闭。

### 工作树模式

工作树选项与分支胶囊同行，刻意**不放进分支菜单**。会话还没交换过消息时它是一个勾选框：勾选后第一次
写文件会创建：

```
<仓库>/.worktrees/<分支>      分支: <session>-<slug>
```

并把会话的工作目录迁进去，后续写入都落在那里。取消勾选则把会话退回仓库根目录。

创建时优先调用宿主自己的 `worktrees` 服务，以遵守 profile 的沙箱与策略；只有在没有存活 Agent
可调用时才回退到 `git worktree add`。

会话一旦开始，选择就用完了，勾选框随之消失，改成「报告」而不是「询问」：开着 worktree 时显示
`worktree(feature/topic-b)`——标签说的是这个会话写入的检出，不是工作树数量，没有分支的检出退回用
目录名；没开则**什么都不显示**，因为旁边的分支胶囊已经说明了它在哪个检出里。一条规则，两个理由：
第一条消息之后再取消并不能撤销任何事（已经跑在 worktree 里的写入会留在那里，而之后的写入会重开主
检出），而一个永久禁用的勾选框只会展示一个谁都无法改变的状态。Host 用 `worktree-locked` 拒绝这个
转换，并在 `status` 里回报 `started` 与 `worktreeLocked`。

## 安装

```bash
dsh plugin --profile web add github:yixin2021/dsh-interaction-kit
```

刷新页面即可。卸载：

```bash
dsh plugin --profile web rm dsh-interaction-kit
```

本地开发目录直接安装：

```bash
dsh plugin --profile web add /绝对路径/dsh-interaction-kit
```

## 更新

profile 的 `package.json` 只记录「声明的 spec」，真正钉住的是 lockfile 里那个**确切 commit**：

```
specifier: github:yixin2021/dsh-interaction-kit#main
version:   https://codeload.github.com/yixin2021/dsh-interaction-kit/tar.gz/3eeee4519883...
```

也就是说，你写的那个 spec 并不是实际在跑的版本——真正生效的是被记录的 commit。由此有两条不同的结论：

**跟分支走（`#main`）需要先移除。** 用完全相同的 spec 再装一次会被拒绝（`already-installed`），
因为从管理器的角度看没有变化：

```bash
dsh plugin --profile web rm  dsh-interaction-kit
dsh plugin --profile web add github:yixin2021/dsh-interaction-kit#main
```

桌面端的等价操作：插件页里先 **移除**，再从来源重新安装。

**切到标签或某个 commit 则不用移除**——spec 变了，直接覆盖安装并重新解析：

```bash
dsh plugin --profile web add github:yixin2021/dsh-interaction-kit#v1.0.0
dsh plugin --profile web add github:yixin2021/dsh-interaction-kit#e4aa663
```

两种方式之后都要**重启 DSH**：Host 半在 profile 启动时只 import 一次，光刷新页面跑的还是旧 Host 代码。

### 两种安装方式，一个取舍

| spec | 改源码的效果 | 什么时候用 |
| --- | --- | --- |
| `/本地路径` 或 `link:/本地路径` | 立即生效（再叠加下面那两条刷新规则） | 你在开发这个插件 |
| `github:owner/repo` | 不生效，必须先 push 再重装 | 你想让装着的就是已发布的那份 |

`link:` 是指向你工作区的软链，跑的就是你正在改的代码；`github:` 是从 tarball 解出来的真实目录，
实际上等同于只读，并且和别人装到的完全一致。两者互转就是 `rm` + `add`。

### 哪些改动需要刷新、哪些需要重启

| 改动 | 生效方式 |
| --- | --- |
| `client.js` | Client 字节在插件激活时快照——停用再启用（或重启），然后刷新页面 |
| `index.js` | profile 启动时只 import 一次——**必须重启 DSH** |

## 实现

| 半 | 文件 | 职责 |
| --- | --- | --- |
| Host | `index.js` | 一条鉴权路由 `POST /api/interaction-kit`，外加用于自动工作树的 `tools/pre-execute` 钩子。所有 `git` 与文件系统操作都在这里。 |
| Client | `client.js` | 五处 Slot 注册：输入区 dock、分支菜单浮层、会话菜单行、会话行右键、删除确认框。 |

页面本身从不执行 `git`。Client 半只发 `{action, sessionId, …}` 并渲染结果，因此来自页面的仓库路径和
分支名都会先在 Host 上用 `NAME_PATTERN` 校验，才会进入命令行。

状态存放在 `$DSH_HOME/storages/interaction-kit-toolkit.json`：

```json
{ "version": 1, "worktreeMode": {}, "worktrees": {} }
```

写入串行化并原子替换，两个会话同时切换也不会写坏。

### Slot 一览

| Slot | 用途 |
| --- | --- |
| `conversation.input.left` | 分支胶囊 + 工作树选项，紧挨模式选择 |
| `shell.overlay` | 分支菜单、新建分支对话框、删除确认 |
| `sidebar.workspaces.session.menu.item` | 永久删除行 |
| `sidebar.workspaces.session.row.action` | 右键 → 菜单 |

## 开发

```bash
npm run check   # 对两个半分别 node --check
npm test        # client + layout 校验
node verify-host.mjs <sessionId>   # 在沙箱 $DSH_HOME 中驱动 Host 路由
```

`verify-layout.mjs` 用桩 React 渲染各 Slot 组件并断言产出的树——用了哪个原生组件、哪些类名、
哪些文案，以及关键安全性质（绝不误触归档、不在整页挂监听）。校验脚本仅用于开发：`package.json` 的 `files`
字段把它们排除在发布的 tarball 之外，所以用 `github:` 装的人不会收到它们。

### 发布新版本

```bash
# 1. 先改 package.json 里的 "version"，然后
git commit -am "chore: release v1.0.1"
git tag -a v1.0.1 -m "v1.0.1"
git push origin main --follow-tags
```

别人用 `#v1.0.1` 钉版本；跟在 `#main` 上的人下次「移除 + 重装」时更新。

## 许可证

MIT
