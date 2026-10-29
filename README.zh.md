# dsh-interaction-kit

DSH Web 交互增强套件：一个插件，三处改进，全部用原生 UI 组件实现，不做生硬的样式改造。

- **右键会话** —— 直接弹出与 `⋯` 按钮完全相同的菜单（分叉、重命名、归档、置顶、永久删除……），
  不必再去瞄准那三个点。
- **对话框下方的分支胶囊** —— 显示当前工作区的 Git 分支，点击即可切换。菜单本身就是原生可搜索菜单：
  吸顶搜索框、吸顶分组标题、分支列表。
- **工作树勾选框** —— 按会话开启。首次写文件时自动创建 worktree 并把会话迁入，并行开发不再挤在同一个检出里。

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

胶囊挂在 `conversation.composer.dock`，显示会话所在工作区的分支；处于游离 HEAD 时用警示色提示，
另外显示未提交文件数。

点击展开本地分支列表。仓库有上千个分支是常态，所以列表最多渲染 60 行，其余靠吸顶搜索框筛；
筛选时分组标题会显示「命中/总数」。新建并检出分支是最后一行。

切换不会丢工作：Git 拒绝的检出会就地报错，菜单保持打开并显示原因，不会在半应用的状态下关闭。

### 工作树模式

勾选框与分支胶囊同行，刻意**不放进分支菜单**。勾选且该会话尚无工作树时，第一次写文件会创建：

```
<仓库>/.worktrees/<分支>      分支: <session>-<slug>
```

并把会话的工作目录迁进去，后续写入都落在那里。取消勾选则把会话退回仓库根目录。

创建时优先调用宿主自己的 `worktrees` 服务，以遵守 profile 的沙箱与策略；只有在没有存活 Agent
可调用时才回退到 `git worktree add`。

`worktree(N)` 里的数字是 `git worktree list` 中主检出之外的工作树数量。

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
| `conversation.composer.dock` | 分支胶囊 + 工作树勾选框 |
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
哪些文案，以及关键安全性质（绝不误触归档、不在整页挂监听）。两个校验脚本仅用于开发，不随包发布。

## 许可证

MIT
