# dsh-ustc-latex-agent — build contract

A DSH (DeepSeek Harness) bundle that makes the conversation Agent a live co-editor of a
USTC Overleaf project (`https://latex.ustc.edu.cn`). Modelled on the installed
`agentero-dsh-*` bundles (host half + Web Client half in one package).

## Product shape

- Right-sidebar tab "LaTeX" inside the DSH Web GUI: connect with a one-time token, pick or
  paste a project link, browse the file tree, open any doc on the real site, watch live
  activity, compile, and read/reply to review comments.
- Agent tools (`latex_*`) let the model pull/read/edit docs, compile, and handle comments.
  Edits are applied through Overleaf's collaboration socket as OT updates, so they appear
  in the user's open editor in real time — the Agent behaves like a second collaborator.
- The one-time token from `https://latex.ustc.edu.cn/agent/setup` is the only credential the
  user gives; the host exchanges it for the `overleaf.sid` session cookie and stores the
  record through DSH's credentials service.

## Package layout (all under `latex-plugin/`)

```
package.json            manifest: dsh.bundle.patch + dsh.client          [Lead]
cordis.patch.yml        one inserted row: id/name dsh-ustc-latex-agent         [Lead]
index.js                Host half (apply, Config, routes, tools)         [Lead]
lib/overleaf-client.js  vendored Overleaf client (zero npm deps)         [A]
lib/session.js          project session / OT application helpers         [Lead + A]
client.js               Client half, Web module-loader format            [B]
locale/en.json, locale/zh.json                                           [B]
icon.svg                                                                 [B]
README.md, THIRD_PARTY_NOTICES.md                                        [Lead/A]
probe.mjs               standalone CLI probe for the Overleaf client     [A]
```

Do not edit files outside your ownership column. The Lead owns `index.js`,
`package.json`, `cordis.patch.yml`, `lib/session.js`, `README.md`.

## Host HTTP API (authoritative; the client half codes against this)

All routes are same-origin under `/latex/api`; JSON in/out; errors are
`{ "error": "<human readable>" }` with a 4xx/5xx status.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/latex/api/status` | – | `{ connected, baseUrl, project?: { id, name, rootDocId, url }, user?: { name, email } }` |
| POST | `/latex/api/auth` | `{ token }` or `{ cookie }` | `{ connected: true, user }` |
| POST | `/latex/api/logout` | – | `{ connected: false }` |
| GET | `/latex/api/projects` | – | `{ projects: [{ id, name, lastUpdated, lastUpdatedBy? }] }` |
| POST | `/latex/api/open` | `{ url? , projectId? }` | `{ project: { id, name, rootDocId, url }, tree: TreeNode[] }` |
| GET | `/latex/api/tree` | – | `{ project, tree: TreeNode[] }` |
| GET | `/latex/api/doc?path=main.tex` | – | `{ path, docId, text, version }` |
| POST | `/latex/api/doc` | `{ path, text }` | `{ ok: true, version, replacements: "replace" }` |
| POST | `/latex/api/edit` | `{ path, find, replace, all? }` | `{ ok: true, version, replacements: n }` |
| POST | `/latex/api/compile` | – | `{ status, pdfUrl?, log?, compileId? }` |
| GET | `/latex/api/comments` | – | `{ threads: CommentThread[] }` |
| POST | `/latex/api/comments` | `{ action: 'add'\|'reply'\|'resolve'\|'reopen', path?, content?, threadId? }` | `{ ok, thread? }` |
| GET | `/latex/api/events?since=<cursor>` | – | `{ cursor, events: ActivityEvent[] }` |

```ts
type TreeNode = { path: string; type: 'doc' | 'file'; id: string; name: string }
type ActivityEvent = {
  at: number                     // epoch ms
  kind: 'auth'|'open'|'read'|'edit'|'compile'|'comment'|'user-edit'|'error'
  path?: string
  summary: string                // already localized-enough, plain text, <= 160 chars
}
type CommentThread = {
  threadId: string; path: string; line: number; selectedText: string
  resolved: boolean; messages: { id: string; content: string; user?: string }[]
}
```

Deep link for one doc: `https://latex.ustc.edu.cn/<projectId>#<docId>`.

## Client half requirements

- Format: `window.__ModuleLoader__.load({ id: 'dsh-ustc-latex-agent', factory(require) { ... } })`;
  React only through `require('react')`; no imports of `@deepseek-ai/*` modules.
- `factory` returns `{ inject: ['slots','locale','sidebarRight','sidebarRightTabs'], apply(ctx) }`.
- Tab type (page, opened by kind):
  `ctx.sidebarRightTabs.register({ id: 'dsh-ustc-latex-agent', kind: 'dsh-ustc-latex-agent', title: () => t('tab'), guide: [{ id: 'latex', title: t('guideTitle'), description: t('guideDescription') }] })`
  registered inside `ctx.effect(() => ...)`; body via
  `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-ustc-latex-agent', locale: NS }, Panel))`.
- Discoverable launcher: a small "LaTeX" pill in `conversation.composer.dock`
  (`ctx.slots.inject` + `ctx.slots.register({ name, id, order }, Launcher)`) that calls
  `ctx.sidebarRight.openTab('dsh-ustc-latex-agent')`.
- Panel states: (1) not connected → explanation, link to `https://latex.ustc.edu.cn/agent/setup`,
  token paste field, Connect button; (2) connected, no project → project list + paste-link
  field; (3) open project → header (name, live dot, "Open on site", refresh), file tree with
  doc rows (click = open on site at deep link), compile button + PDF link, activity feed,
  comments section (list, reply box, resolve).
- All UI text through `ctx.locale` dictionaries (`locale/en.json`, `locale/zh.json`,
  namespace `dsh-ustc-latex-agent`). Meta title/description required in both.
- Style: inline styles + one `<style>` injected with `styles.insert`, using `--dsw-alias-*`
  theme tokens only (no literal colors except the icon artwork). Match host density/typography.
- Poll `/latex/api/events?since=` every 3s while the panel is visible; no polling when the
  tab is not visible (use `document.visibilityState` + the tab's mount state).
- Every request shows a failure inline; never leave a button stuck.

## Host half requirements

- `export const name = 'dsh-ustc-latex-agent'`, `export const inject = ['webServer','tools','settings']`,
  `export const Config = z.object({ baseUrl: z.string().default('https://latex.ustc.edu.cn'), autoOpenProject: z.string().default('') })`.
- Credentials through optional `ctx.get('credentials')`; record key `dsh-ustc-latex-agent.ustc`,
  `{ kind:'api-key', key: JSON.stringify({ cookie, csrf, baseUrl, cookieName, savedAt }) }`.
- Tools: `latex_status`, `latex_auth`, `latex_projects`, `latex_open`, `latex_tree`,
  `latex_read`, `latex_edit`, `latex_write`, `latex_compile`, `latex_comments`.
  Every tool returns compact JSON; file text is capped (12k chars) with an explicit
  `truncated` flag; `latex_edit` refuses a `find` that matches 0 or >1 times unless `all`.
- Live edits: join the project's collaboration socket, `joinDoc` for the freshest
  `{ lines, version }`, compute a sharejs text op, `applyOtUpdate` with that version, retry
  once on version conflict by re-joining. Record an `edit` activity event.
- `GET /latex/api/events` serves a bounded in-memory ring (200) with a monotonic cursor.

## Verification

- `node --check` every `.js`.
- A's `probe.mjs` must authenticate with a real token, list projects, read and write one
  doc, and compile — run by the Lead once the user supplies a token.
- After install: `cordis_inspect_query` shows the new rows/tools; the tab renders in the GUI.
