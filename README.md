# dsh-ustc-latex-agent

[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) bundle that turns the
conversation agent into a **live co-editor of [USTC Overleaf](https://latex.ustc.edu.cn) projects**:
one-time-token sign-in, real-time OT edits that appear in your open editor, compile + PDF preview,
anchored review comments, and automatic wake-ups when you leave a new comment.

> This is an independent plugin. It is **not** a fork of `agentero-dsh`; it follows the same
> bundle shape (Host half + Web Client half in one package) and adapts the Overleaf transport from
> [`olcli`](https://github.com/aloth/olcli) (MIT). Not affiliated with USTC or Overleaf.

---

## Features

- **One-time token auth** — paste the token from `https://latex.ustc.edu.cn/agent/setup`; the Host
  exchanges it for the `overleaf.sid` session cookie and stores it in dsh's credential store
  (record key `dsh-ustc-latex-agent/session`), never in `cordis.patch.yml`.
- **Shared links just work** — a link like `https://latex.ustc.edu.cn/<token>#<docId>` is a
  link-sharing token, not a project id; the plugin performs the `/<token>/grant` exchange and
  resolves the real project.
- **Real-time co-editing** — `latex_edit` / `latex_write` submit ShareJS OT updates through the
  collaboration socket, so changes show up in your open editor as live typing (with version-conflict
  retry and post-write verification).
- **Read / compile** — `latex_read` returns the server's freshest text (including unsaved typing);
  `latex_compile` returns the PDF URL and log tail.
- **Review comments** — list threads with the anchored quote, line, surrounding context and the full
  conversation; add / reply / resolve / reopen / delete. The agent can also create anchored comments
  itself (`selected_text` + `content`).
- **In-panel review** — a read-only document preview with passage selection, a comment composer, and
  a **PDF preview** iframe served by the Host (same-origin, no third-party cookie problem).
- **Automatic comment reminder** — when a new unresolved thread appears, the panel asks the Host to
  wake the session's agent (`agent.followup`) with the file, line, quote and comment text. Once per
  thread, at most once per 30 s, and agent-authored threads are ignored.

## Requirements

- dsh `0.2.x` (verified on `0.2.2-rc.1`)
- Node.js `>= 20`
- A USTC Overleaf account (the token setup page requires CAS login)

## Install

### 1. Get the package

Clone this repository somewhere local, or install it from GitHub with dsh's plugin manager.

### 2. Register the bundle in your profile

The package is published on npm as **`dsh-ustc-latex-agent`**:

```sh
dsh plugin --profile <profile> add dsh-ustc-latex-agent
```

From a local checkout or GitHub, dsh's plugin manager is also supported. Ask the agent in any
session:

> install the bundle from `/absolute/path/to/dsh-ustc-latex-agent`

or call the tool directly:

```jsonc
{ "action": "install_bundle", "target": "/absolute/path/to/dsh-ustc-latex-agent" }
```

From the CLI, a local checkout can also be added as a profile dependency:

```sh
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-ustc-latex-agent
```

### 3. Restart dsh once

A newly added bundle's modules are loaded at startup. Restart DeepSeek Harness, reopen your session,
and the **LaTeX** tab appears in the right sidebar (or use the `LaTeX` pill under the composer).

## Usage

1. Log in at `https://latex.ustc.edu.cn`, open `https://latex.ustc.edu.cn/agent/setup`, copy the
   one-time token (single use, expires quickly).
2. In the LaTeX panel paste the token → **Connect**; or tell the agent
   "connect with this token: `<token>`" (`latex_auth`).
3. Open a project: paste its link (including shared links) → **Open**, or call `latex_open`.
4. Work in natural language, for example:

   > read `main.tex`, tighten the contribution paragraph.

   > wrap the long equation in `paper.tex` and compile.

   > check the open review comments, apply them, and reply in each thread.

### Review workflow

- **On the site**: select a passage → *Add comment* → write your revision note. The panel lists the
  thread within ~10 s and the agent can be woken automatically.
- **Inside the panel**: click **Preview** on a document row, select a passage, write the note, and
  click **Add comment** — it creates the same anchored thread on Overleaf.
- The agent applies changes with `latex_edit`, then replies in the same thread with
  `latex_comments` (`reply`), so the answer appears in the site's comment area.

## Agent tools

| Tool | Purpose |
|---|---|
| `latex_status` | Connection state and the open project |
| `latex_auth` | Connect with a one-time token |
| `latex_projects` | List accessible projects |
| `latex_open` | Open a project by link or id (handles share-link grant) |
| `latex_tree` | File tree with document ids |
| `latex_read` | Read the live document (optional line range) |
| `latex_edit` | Unique-string replacement (`all` allowed) |
| `latex_write` | Replace a whole document |
| `latex_compile` | Compile, return PDF URL and log tail |
| `latex_comments` | list / add / reply / resolve / reopen / delete threads |

## How it works

```
Host half (index.js)                         Web Client half (client.js)
├─ /latex/api/*  (same-origin routes)        ├─ "LaTeX" right-sidebar tab
├─ latex_* tools (ctx.tools.register)        ├─ token / project / file-tree UI
├─ credential store (ctx.credentials)        ├─ document preview + passage comment
├─ compiled-PDF proxy (cookie stays here)    ├─ PDF iframe (/latex/api/pdf)
└─ comment watcher → agent.followup()        └─ 3 s activity poll, 10 s comment poll
        │
        ▼
lib/overleaf-client.js  — zero-dependency Overleaf transport
  REST: projects, files, compile, comments
  Socket.IO 0.9 xhr-polling: joinProject / joinDoc / applyOtUpdate
```

No npm dependencies: the Host imports only `node:` builtins and the vendored client; the Web Client
uses the module-loader `require('react')` and same-origin `fetch`.

## Security and privacy

- The session cookie lives in dsh's local credential store; the one-time token is used only for the
  exchange and is not persisted by the plugin.
- The plugin talks only to `latex.ustc.edu.cn`, from your machine; there is no telemetry.
- The PDF proxy serves the compiled output through the dsh Web server so the browser does not need a
  cross-site Overleaf session.

## FAQ

**Does it need a USTC token?**
Yes. Every user authenticates as themselves: log in at `https://latex.ustc.edu.cn`, open
`https://latex.ustc.edu.cn/agent/setup`, and paste the one-time token shown there into the panel (or
give it to the agent for `latex_auth`). The token is single-use and short-lived; the plugin
exchanges it for a session cookie stored in **your own** local dsh credential store.

**Does the repository contain any credentials?**
No. There is no token, session cookie, project content, or share link in this repository. The
standalone probe writes `probe-state.json` locally, and that file is git-ignored.

**Can users without a USTC account use it?**
Only if they have a USTC Overleaf account (including an invited external collaborator account). The
authentication flow relies on USTC's `/agent/exchange` service; a stock Overleaf deployment does not
provide it, so supporting another instance would need a different login flow.

**Does the agent see my token?**
The token is submitted once (panel or tool call) and used only for the exchange; the plugin does not
store it. The resulting session cookie is kept in dsh's local credential store, readable by your OS
user, and is never written to `cordis.patch.yml` or tool results.

## Known limitations

- The panel does not embed the Overleaf editor; **Open** (or a document row) opens the site, and the
  in-panel preview is read-only.
- Edits from the agent appear as the same account's changes; Overleaf does not show a separate
  "agent" avatar.
- Activity feed records the agent's own actions; other people's edits require a fresh read.
- OT text encoding was verified against the current `latex.ustc.edu.cn` deployment (decoded Unicode
  op space). A different Overleaf build may need the encoding switch in
  `lib/overleaf-client.js` revisited.
- Compilation latency depends on the project and the server queue (tens of seconds).
- The `/<token>` grant flow is specific to Overleaf's link-sharing; private projects still require
  access for the account that owns the token session.

## Development

```
index.js               Host half: routes, tools, credentials, PDF proxy, comment watcher
client.js              Web Client half: sidebar tab, launcher, panel UI
lib/overleaf-client.js Overleaf transport (adapted from olcli 0.7.0, MIT)
lib/share-link.js      Link-sharing token → project id
locale/{en,zh}.json    UI dictionaries + plugin metadata
probe.mjs              Standalone CLI probe (auth/list/read/write/edit/compile + offline --selftest)
test/smoke-client.mjs  Offline client test (stubbed loader/React/fetch; renders every panel state)
CONTRACT.md            Host/Client API contract used during the build
```

```sh
node test/smoke-client.mjs     # client UI smoke test
node probe.mjs --selftest      # offline transport self-test
node probe.mjs auth <token>    # live probe (writes probe-state.json, git-ignored)
```

## License

GPL-3.0-only — see [LICENSE](LICENSE). Every source file carries
`SPDX-License-Identifier: GPL-3.0-only`.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, version 3. It is distributed in
the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
details.

The plugin code is Copyright (c) 2026 dsh-ustc-latex-agent contributors. The Overleaf transport in
`lib/overleaf-client.js` is adapted from [`olcli`](https://github.com/aloth/olcli) by Alexander Loth
(MIT). MIT is compatible with GPLv3, so the combined work is distributed under GPL-3.0-only while the
upstream MIT copyright and permission notice are retained; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the attribution and the list of modifications.

---

## 中文说明

把 DeepSeek Harness 对话里的 Agent 变成中科大 Overleaf 项目的**合作编辑者**：
一次性 token 接入、实时 OT 改稿（你打开的编辑器里直接出现）、编译与 PDF 预览、
锚定批注的读取/回复/解决，以及「你一留批注，Agent 自动被唤醒处理」。

- **安装**：把本目录加入 dsh profile（`plugin_manager` 的 `install_bundle`，或
  `dsh plugin --profile <profile> add link:<绝对路径>`），**重启一次** dsh。
- **接入**：`https://latex.ustc.edu.cn/agent/setup` 生成一次性 token → 面板粘贴连接；
  或直接对 Agent 说「用这个 token 连接：…」。
- **选段提意见**：网站里选中段落加评论，或在面板里点文档「预览」→ 选段 → 写意见 → 添加批注。
- **审阅闭环**：对 Agent 说「看下批注并按意见改」，它会改稿并在同一线程回复你。
- **限制**：面板不内嵌编辑器；同一账号的改动不会显示为独立头像；编译耗时取决于项目大小。
- **凭据**：每位使用者都需要自己的 USTC 账号与一次性 token（`/agent/setup` 生成，单次、短时有效）；
  仓库里不含任何 token、cookie 或项目数据，插件只把交换来的会话 cookie 存在本机 dsh 凭据库。

GPL-3.0 许可；Overleaf 传输层改编自 `olcli`（MIT，与 GPLv3 兼容，见 THIRD_PARTY_NOTICES.md）。
