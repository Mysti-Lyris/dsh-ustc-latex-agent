// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 dsh-ustc-latex-agent contributors

/**
 * dsh-ustc-latex-agent — Host half.
 *
 * Makes the conversation Agent a live co-editor of a USTC Overleaf project:
 *  - exchanges the site's one-time token for the `overleaf.sid` session cookie
 *    and keeps it in the profile credential store;
 *  - serves the `/latex/api` routes the Web Client panel calls;
 *  - registers the `latex_*` tools the model calls;
 *  - applies edits through Overleaf's collaboration socket, so they show up in
 *    the user's open editor as another collaborator's typing.
 *
 * No npm dependencies beyond Node built-ins and the vendored client.
 */
import { OverleafClient } from './lib/overleaf-client.js';
import { looksLikeShareToken, resolveShareToken } from './lib/share-link.js';

export const name = 'dsh-ustc-latex-agent';
export const inject = ['webServer', 'tools', 'agents'];

/** Prefix owned by this plugin on the composed Web server. */
const API = '/latex/api';
/** The only supported deployment. */
const DEFAULT_BASE_URL = 'https://latex.ustc.edu.cn';
/** Credential record key in the profile credential store (`<owner>/<id>`). */
const CREDENTIAL_KEY = 'dsh-ustc-latex-agent/session';
/** Cap on document text returned by a tool. */
const TEXT_CAP = 12_000;
/** Cap on file-tree rows returned by a tool. */
const TREE_CAP = 400;
/** Cap on project rows returned by a tool. */
const PROJECT_CAP = 40;
/** Cap on activity rows kept in memory. */
const ACTIVITY_CAP = 200;
/** Compile log tail returned to the model. */
const LOG_CAP = 4_000;

/** A usable error for an expired/absent Overleaf session. */
function unauthenticated(message) {
    const error = new Error(message);
    error.code = 'unauthenticated';
    return error;
}

function clip(text, cap) {
    return text.length > cap ? text.slice(0, cap) : text;
}

/**
 * Flatten an Overleaf project tree into path rows. `rootFolder` is either one
 * folder record or an array of them, and each folder holds `folders`, `docs`
 * and `fileRefs`.
 */
function flattenProject(project) {
    const roots = Array.isArray(project?.rootFolder)
        ? project.rootFolder
        : project?.rootFolder
            ? [project.rootFolder]
            : [];
    const rows = [];
    const walk = (folder, prefix) => {
        if (folder === null || typeof folder !== 'object')
            return;
        for (const sub of Array.isArray(folder.folders) ? folder.folders : []) {
            walk(sub, `${prefix}${sub.name ?? ''}/`);
        }
        for (const doc of Array.isArray(folder.docs) ? folder.docs : []) {
            rows.push({ path: `${prefix}${doc.name ?? ''}`, type: 'doc', id: String(doc._id ?? ''), name: String(doc.name ?? '') });
        }
        for (const file of Array.isArray(folder.fileRefs) ? folder.fileRefs : []) {
            rows.push({ path: `${prefix}${file.name ?? ''}`, type: 'file', id: String(file._id ?? ''), name: String(file.name ?? '') });
        }
    };
    for (const root of roots)
        walk(root, '');
    return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** Parse a project link (`https://latex.ustc.edu.cn/<id>#<docId>`) or a bare id. */
function parseProjectRef(ref) {
    const raw = String(ref ?? '').trim();
    if (raw === '')
        throw new Error('A project link or project id is required.');
    let projectId = '';
    let docId = '';
    if (/^https?:\/\//i.test(raw)) {
        const url = new URL(raw);
        const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
        if (hash !== '')
            docId = hash;
        const segments = url.pathname.split('/').filter((segment) => segment !== '');
        projectId = segments[0] === 'project' ? (segments[1] ?? '') : (segments[segments.length - 1] ?? '');
    }
    else {
        const hashAt = raw.indexOf('#');
        projectId = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
        docId = hashAt >= 0 ? raw.slice(hashAt + 1) : '';
        projectId = projectId.replace(/\/+$/, '');
    }
    if (!/^[0-9a-zA-Z_-]{8,64}$/.test(projectId))
        throw new Error(`Could not read a project id from "${raw}". Paste the project link shown in the browser.`);
    return { projectId, docId };
}

function rootDocOf(project, tree) {
    const fromInfo = project?.rootDoc_id ?? project?.rootDocId;
    if (typeof fromInfo === 'string' && fromInfo !== '')
        return fromInfo;
    const main = tree.find((row) => row.type === 'doc' && row.path === 'main.tex');
    if (main !== undefined)
        return main.id;
    const first = tree.find((row) => row.type === 'doc');
    return first?.id ?? '';
}

function normalizeTreePath(path) {
    return String(path ?? '').replace(/^\/+/, '').trim();
}

/**
 * Register routes and tools. Everything is an effect so unload leaves no
 * listener, timer, or route behind.
 */
export function apply(ctx) {
    const state = {
        client: null,
        clientCookie: '',
        project: null,
        tree: null,
        activity: [],
        cursor: 0,
        lock: Promise.resolve(),
        pdf: null,
        pdfBytes: null,
        notifiedThreads: new Set(),
        agentThreads: new Set(),
        lastNotifyAt: 0,
    };

    /** Run mutating Overleaf operations one at a time. */
    function serialized(operation) {
        const run = state.lock.then(operation, operation);
        state.lock = run.then(() => undefined, () => undefined);
        return run;
    }

    function record(kind, summary, path) {
        state.cursor += 1;
        state.activity.push({
            id: String(state.cursor),
            at: Date.now(),
            kind,
            summary: clip(String(summary ?? ''), 160),
            path: typeof path === 'string' && path !== '' ? path : undefined,
        });
        if (state.activity.length > ACTIVITY_CAP)
            state.activity.shift();
    }

    const credentials = () => ctx.get('credentials');

    /** Older credential keys, kept so a plugin rename does not sign the user out. */
    const LEGACY_CREDENTIAL_KEYS = ['agentero-latex/session'];

    function parseStoredRecord(stored) {
        if (stored === undefined || stored === null || stored.kind !== 'api-key' || typeof stored.key !== 'string')
            return null;
        try {
            const parsed = JSON.parse(stored.key);
            if (parsed === null || typeof parsed !== 'object' || typeof parsed.cookie !== 'string' || parsed.cookie === '')
                return null;
            return parsed;
        }
        catch {
            return null;
        }
    }

    async function loadRecord() {
        const service = credentials();
        if (service === undefined)
            return null;
        const current = parseStoredRecord(await service.readRecord(CREDENTIAL_KEY));
        if (current !== null)
            return current;
        for (const legacyKey of LEGACY_CREDENTIAL_KEYS) {
            const legacy = parseStoredRecord(await service.readRecord(legacyKey));
            if (legacy === null)
                continue;
            try {
                await saveRecord(legacy);
                await service.deleteRecord(legacyKey);
            }
            catch {
                // Keep using the legacy record if migration cannot be saved.
            }
            return legacy;
        }
        return null;
    }

    async function saveRecord(next) {
        const service = credentials();
        if (service === undefined)
            throw new Error('This profile has no credential store, so the Overleaf session cannot be saved.');
        await service.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: JSON.stringify(next) }));
    }

    async function clearRecord() {
        const service = credentials();
        if (service === undefined)
            return;
        await service.deleteRecord(CREDENTIAL_KEY);
        for (const legacyKey of LEGACY_CREDENTIAL_KEYS)
            await service.deleteRecord(legacyKey);
    }

    async function ensureClient() {
        const stored = await loadRecord();
        if (stored === null)
            throw unauthenticated('No Overleaf session is saved yet. Connect with a one-time token from https://latex.ustc.edu.cn/agent/setup first.');
        if (state.client !== null && state.clientCookie === stored.cookie)
            return state.client;
        let client;
        try {
            client = await OverleafClient.fromSessionCookie(
                stored.cookie,
                stored.baseUrl || DEFAULT_BASE_URL,
                stored.cookieName || 'overleaf.sid',
                stored.lbSrvId ? { lb_srv_id: stored.lbSrvId } : undefined,
            );
        }
        catch (error) {
            state.client = null;
            state.clientCookie = '';
            throw unauthenticated(`The saved Overleaf session is not usable. Generate a fresh one-time token and connect again. (${error instanceof Error ? error.message : String(error)})`);
        }
        client.setOnCookieUpdate(async (cookies) => {
            const value = cookies?.[stored.cookieName || 'overleaf.sid'];
            if (typeof value === 'string' && value !== '' && value !== stored.cookie) {
                stored.cookie = value;
                await saveRecord(stored).catch(() => undefined);
                state.clientCookie = value;
            }
        });
        client.setGlobalTimeout(45_000);
        state.client = client;
        state.clientCookie = stored.cookie;
        return client;
    }

    async function connectWithToken(token) {
        const trimmed = String(token ?? '').trim();
        if (trimmed === '')
            throw new Error('The one-time token is empty.');
        let exchanged;
        try {
            exchanged = await OverleafClient.exchangeToken(trimmed);
        }
        catch (error) {
            record('error', 'One-time token was rejected');
            throw new Error(`Token exchange failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const baseUrl = typeof exchanged.base_url === 'string' && exchanged.base_url !== '' ? exchanged.base_url : DEFAULT_BASE_URL;
        const cookieName = typeof exchanged.cookie_name === 'string' && exchanged.cookie_name !== '' ? exchanged.cookie_name : 'overleaf.sid';
        let client;
        try {
            client = await OverleafClient.fromSessionCookie(
                exchanged.cookie,
                baseUrl,
                cookieName,
                exchanged.lb_srv_id ? { lb_srv_id: exchanged.lb_srv_id } : undefined,
            );
        }
        catch (error) {
            record('error', 'Session verification failed after token exchange');
            throw new Error(`Token was accepted but the session did not verify: ${error instanceof Error ? error.message : String(error)}`);
        }
        client.setOnCookieUpdate(async (cookies) => {
            const value = cookies?.[cookieName];
            if (typeof value === 'string' && value !== '' && value !== exchanged.cookie) {
                exchanged.cookie = value;
                await saveRecord({
                    cookie: value, cookieName, baseUrl, lbSrvId: exchanged.lb_srv_id, savedAt: Date.now(),
                }).catch(() => undefined);
                state.clientCookie = value;
            }
        });
        client.setGlobalTimeout(45_000);
        await saveRecord({
            cookie: exchanged.cookie,
            cookieName,
            baseUrl,
            lbSrvId: exchanged.lb_srv_id,
            savedAt: Date.now(),
        });
        state.client = client;
        state.clientCookie = exchanged.cookie;
        state.project = null;
        state.tree = null;
        record('auth', 'Connected to USTC Overleaf');
        return { connected: true, baseUrl };
    }

    async function connectWithCookie(cookie, cookieName, baseUrl) {
        const value = String(cookie ?? '').trim();
        if (value === '')
            throw new Error('The session cookie is empty.');
        const name = typeof cookieName === 'string' && cookieName !== '' ? cookieName : 'overleaf.sid';
        const base = typeof baseUrl === 'string' && baseUrl !== '' ? baseUrl : DEFAULT_BASE_URL;
        const client = await OverleafClient.fromSessionCookie(value, base, name);
        await saveRecord({ cookie: value, cookieName: name, baseUrl: base, savedAt: Date.now() });
        state.client = client;
        state.clientCookie = value;
        state.project = null;
        state.tree = null;
        record('auth', 'Connected with a session cookie');
        return { connected: true, baseUrl: base };
    }

    async function openProject(ref) {
        const parsed = parseProjectRef(ref);
        let projectId = parsed.projectId;
        const docId = parsed.docId;
        let viaShareLink = false;
        if (looksLikeShareToken(projectId)) {
            // The user pasted a link-sharing URL (`https://latex.ustc.edu.cn/<token>`),
            // which is not a project id. Join through the token grant first.
            const stored = await loadRecord();
            if (stored === null)
                throw unauthenticated('Connect a USTC Overleaf session before opening a shared link.');
            try {
                const resolved = await resolveShareToken({
                    baseUrl: stored.baseUrl || DEFAULT_BASE_URL,
                    cookie: `${stored.cookieName || 'overleaf.sid'}=${stored.cookie}`,
                    token: projectId,
                });
                projectId = resolved.projectId;
                viaShareLink = true;
            }
            catch (error) {
                record('error', 'Could not join the shared project link');
                throw new Error(`Could not resolve the shared link: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const client = await ensureClient();
        let project;
        try {
            project = await client.getProjectInfo(projectId);
        }
        catch (error) {
            record('error', `Could not open project ${projectId}`);
            throw new Error(`Could not open project ${projectId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const tree = flattenProject(project);
        const base = String(client.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
        state.project = {
            id: projectId,
            name: typeof project?.name === 'string' && project.name !== '' ? project.name : projectId,
            rootDocId: rootDocOf(project, tree),
            url: `${base}/project/${projectId}`,
            docId: docId || '',
            viaShareLink,
        };
        state.tree = tree;
        record('open', `Opened ${state.project.name}${viaShareLink ? ' (shared link)' : ''}`, '');
        return { project: state.project, tree };
    }

    function requireProject() {
        if (state.project === null)
            throw new Error('No LaTeX project is open. Call latex_open with the project link first.');
        return state.project;
    }

    async function refreshTree() {
        const project = requireProject();
        const client = await ensureClient();
        const info = await client.getProjectInfo(project.id);
        state.tree = flattenProject(info);
        project.rootDocId = rootDocOf(info, state.tree) || project.rootDocId;
        return { project, tree: state.tree };
    }

    async function ensureTree() {
        if (state.tree !== null)
            return state.tree;
        const refreshed = await refreshTree();
        return refreshed.tree;
    }

    async function resolveDoc(path) {
        const clean = normalizeTreePath(path);
        if (clean === '')
            throw new Error('path is required');
        const tree = await ensureTree();
        const hit = tree.find((row) => row.type === 'doc' && row.path === clean)
            ?? tree.find((row) => row.type === 'doc' && row.name === clean)
            ?? tree.find((row) => row.type === 'doc' && row.path.endsWith(`/${clean}`));
        if (hit === undefined) {
            const sample = tree.slice(0, 12).map((row) => row.path).join(', ');
            throw new Error(`No document "${clean}" in this project. Known paths include: ${sample}`);
        }
        return hit;
    }

    async function readDoc(path) {
        const project = requireProject();
        const client = await ensureClient();
        const doc = await resolveDoc(path);
        const joined = await client.readDoc(project.id, doc.id);
        return { path: doc.path, docId: doc.id, text: joined.text, version: joined.version };
    }

    async function writeDoc(path, text) {
        const project = requireProject();
        const client = await ensureClient();
        const doc = await resolveDoc(path);
        const result = await serialized(() => client.setDocumentText(project.id, doc.id, String(text)));
        if (state.pdf !== null)
            state.pdf = { ...state.pdf, stale: true };
        record('edit', `Replaced ${doc.path} (${result?.version ?? '?'})`, doc.path);
        return { ok: true, path: doc.path, docId: doc.id, version: result?.version };
    }

    async function editDoc(path, find, replace, all) {
        const project = requireProject();
        const client = await ensureClient();
        const doc = await resolveDoc(path);
        const needle = String(find ?? '');
        if (needle === '')
            throw new Error('find is required');
        const result = await serialized(() => client.replaceText(project.id, doc.id, needle, String(replace ?? ''), all === true));
        if (state.pdf !== null)
            state.pdf = { ...state.pdf, stale: true };
        record('edit', `Edited ${doc.path}: ${result?.replacements ?? '?'} replacement(s)`, doc.path);
        return { ok: true, path: doc.path, docId: doc.id, replacements: result?.replacements ?? 0, version: result?.version };
    }

    async function compileProject() {
        const project = requireProject();
        const client = await ensureClient();
        const result = await client.compileProject(project.id);
        const base = String(client.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
        const rawUrl = typeof result?.pdfUrl === 'string' ? result.pdfUrl : '';
        const pdfUrl = rawUrl === ''
            ? ''
            : /^https?:\/\//i.test(rawUrl)
                ? rawUrl
                : `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        const log = Array.isArray(result?.logs) ? result.logs.join('\n') : '';
        state.pdf = pdfUrl === '' ? null : { url: pdfUrl, at: Date.now() };
        state.pdfBytes = null;
        record('compile', pdfUrl === '' ? 'Compile finished without a PDF' : 'Compiled the project', '');
        return { status: pdfUrl === '' ? 'failure' : 'success', pdfUrl, log: clip(log, LOG_CAP) };
    }

    async function listComments(status = 'all') {
        const project = requireProject();
        const client = await ensureClient();
        const threads = await client.listComments(project.id, { status, contextLines: 2 });
        return threads.map((thread) => {
            const context = thread.context !== null && typeof thread.context === 'object'
                ? {
                    before: Array.isArray(thread.context.before) ? thread.context.before.slice(-2) : [],
                    line: typeof thread.context.line === 'string' ? thread.context.line : '',
                    after: Array.isArray(thread.context.after) ? thread.context.after.slice(0, 2) : [],
                }
                : undefined;
            return {
                threadId: String(thread.threadId ?? ''),
                path: String(thread.path ?? ''),
                docId: String(thread.docId ?? ''),
                line: Number(thread.line ?? 0),
                column: Number(thread.column ?? 0),
                selectedText: String(thread.selectedText ?? ''),
                resolved: thread.resolved === true,
                context,
                messages: Array.isArray(thread.messages)
                    ? thread.messages.map((message) => ({
                        id: String(message.id ?? ''),
                        content: String(message.content ?? ''),
                        user: message.user?.name ?? message.user?.email ?? '',
                        at: message.timestamp ?? message.edited_at ?? '',
                    }))
                    : [],
            };
        });
    }

    async function commentAction(body) {
        const project = requireProject();
        const client = await ensureClient();
        const action = String(body.action ?? 'list');
        if (action === 'list') {
            const status = body.status === 'open' ? 'open' : 'all';
            const threads = await listComments(status);
            return { ok: true, pending: threads.filter((thread) => !thread.resolved).length, threads };
        }
        if (action === 'add') {
            const path = String(body.path ?? '');
            const content = String(body.content ?? '').trim();
            if (path === '')
                throw new Error('path is required to add a comment');
            if (content === '')
                throw new Error('content is required to add a comment');
            const selectedText = typeof body.selectedText === 'string' && body.selectedText !== '' ? body.selectedText : undefined;
            const thread = await client.addComment(project.id, {
                filePath: path,
                content,
                selectedText,
                line: Number.isFinite(body.line) && body.line > 0 ? Math.floor(body.line) : undefined,
                column: Number.isFinite(body.column) && body.column > 0 ? Math.floor(body.column) : undefined,
            });
            record('comment', `Commented on ${path}${selectedText ? ` at "${clip(selectedText, 40)}"` : ''}`, path);
            if (typeof thread?.threadId === 'string')
                state.agentThreads.add(thread.threadId);
            return { ok: true, threadId: thread?.threadId, path, line: thread?.line, column: thread?.column, selectedText: thread?.selectedText };
        }
        const threadId = String(body.threadId ?? '');
        if (threadId === '')
            throw new Error('threadId is required for this action');
        if (action === 'reply') {
            const content = String(body.content ?? '').trim();
            if (content === '')
                throw new Error('content is required to reply');
            await client.postCommentMessage(project.id, threadId, content);
            record('comment', 'Replied to a review comment', '');
            return { ok: true, threadId };
        }
        if (action === 'resolve') {
            await client.resolveComment(project.id, threadId);
            record('comment', 'Resolved a review comment', '');
            return { ok: true, threadId };
        }
        if (action === 'reopen') {
            await client.reopenComment(project.id, threadId);
            record('comment', 'Reopened a review comment', '');
            return { ok: true, threadId };
        }
        if (action === 'delete') {
            await client.deleteComment(project.id, threadId);
            record('comment', 'Deleted a review comment', '');
            return { ok: true, threadId };
        }
        throw new Error(`Unknown comment action "${action}".`);
    }

    /**
     * Wake the session's Agent when the panel reports newly appeared review
     * comments. Only unresolved threads the Agent did not create itself are
     * announced, at most once per thread and at most once per 30 seconds.
     */
    async function watchComments(body) {
        const sessionId = String(body.sessionId ?? '');
        if (sessionId === '')
            throw new Error('sessionId is required');
        const incoming = Array.isArray(body.threads) ? body.threads : [];
        const fresh = incoming.filter((thread) => {
            const id = String(thread?.threadId ?? '');
            return id !== '' && !state.notifiedThreads.has(id) && !state.agentThreads.has(id);
        });
        if (fresh.length === 0)
            return { ok: true, notified: 0 };
        const now = Date.now();
        if (now - state.lastNotifyAt < 30_000)
            return { ok: true, notified: 0, throttled: true };
        const registry = ctx.agents;
        const agent = registry !== undefined && typeof registry.get === 'function' ? registry.get(sessionId) : undefined;
        if (agent === undefined || typeof agent.followup !== 'function')
            return { ok: false, notified: 0, reason: 'session-not-live' };
        const lines = fresh.slice(0, 3).map((thread) => {
            const path = String(thread.path ?? '');
            const line = Number(thread.line ?? 0);
            const quote = clip(String(thread.quote ?? ''), 80);
            const message = clip(String(thread.message ?? ''), 200);
            return `- ${path}${line > 0 ? ` 第 ${line} 行` : ''}${quote !== '' ? `「${quote}」` : ''}：${message}`;
        });
        const text = `【Overleaf 批注提醒】用户在共享 LaTeX 项目里新增了 ${fresh.length} 条批注：\n${lines.join('\n')}\n请用 latex_comments 读取完整线程，按意见用 latex_edit 修改，再用 latex_comments 的 reply 在同一线程回复用户。`;
        try {
            await agent.followup({ content: [{ type: 'text', text }], source: { kind: 'user' } });
        }
        catch (error) {
            return { ok: false, notified: 0, reason: error instanceof Error ? error.message : String(error) };
        }
        for (const thread of fresh)
            state.notifiedThreads.add(String(thread.threadId));
        state.lastNotifyAt = now;
        record('comment', `新批注提醒：${fresh.length} 条`, '');
        return { ok: true, notified: fresh.length };
    }

    /** Serve the compiled PDF (compiling if needed) so the panel can render it. */
    async function sendPdf(res) {
        const project = requireProject();
        const client = await ensureClient();
        if (state.pdf === null) {
            try {
                await compileProject();
            }
            catch {
                // report below
            }
        }
        const pdf = state.pdf;
        if (pdf === null || typeof pdf.url !== 'string' || pdf.url === '') {
            sendJson(res, 404, { error: 'No compiled PDF yet. Compile the project first.' });
            return;
        }
        let cached = state.pdfBytes;
        if (cached === null || cached.url !== pdf.url || Date.now() - cached.at > 300_000) {
            const data = await client.downloadOutputFile(pdf.url);
            cached = { url: pdf.url, at: Date.now(), data };
            state.pdfBytes = cached;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/pdf');
        res.setHeader('content-disposition', 'inline; filename="dsh-ustc-latex-agent.pdf"');
        res.setHeader('cache-control', 'no-store');
        res.end(cached.data);
    }

    async function statusPayload() {
        const stored = await loadRecord();
        return {
            connected: stored !== null,
            baseUrl: stored?.baseUrl ?? DEFAULT_BASE_URL,
            project: state.project,
            credentialStore: credentials() !== undefined,
        };
    }

    async function readJsonBody(req, limitBytes = 1_000_000) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > limitBytes)
                throw new Error('Request body is too large.');
            chunks.push(chunk);
        }
        if (chunks.length === 0)
            return {};
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.trim() === '')
            return {};
        try {
            const parsed = JSON.parse(text);
            return parsed !== null && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            throw new Error('Request body is not valid JSON.');
        }
    }

    function sendJson(res, status, payload) {
        const body = JSON.stringify(payload);
        res.statusCode = status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(body);
    }

    async function handle(req, res) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        const method = (req.method ?? 'GET').toUpperCase();
        try {
            if (method === 'GET' && path === `${API}/status`)
                return sendJson(res, 200, await statusPayload());
            if (method === 'POST' && path === `${API}/auth`) {
                const body = await readJsonBody(req);
                if (typeof body.token === 'string')
                    return sendJson(res, 200, await connectWithToken(body.token));
                if (typeof body.cookie === 'string')
                    return sendJson(res, 200, await connectWithCookie(body.cookie, body.cookieName, body.baseUrl));
                throw new Error('Provide a one-time token as { "token": "..." }.');
            }
            if (method === 'POST' && path === `${API}/logout`) {
                await clearRecord();
                state.client = null;
                state.clientCookie = '';
                state.project = null;
                state.tree = null;
                return sendJson(res, 200, { connected: false });
            }
            if (method === 'GET' && path === `${API}/projects`) {
                const client = await ensureClient();
                const projects = await client.listProjects();
                return sendJson(res, 200, {
                    projects: projects.slice(0, PROJECT_CAP).map((project) => ({
                        id: String(project.id), name: String(project.name ?? ''), lastUpdated: project.lastUpdated ?? '', lastUpdatedBy: project.lastUpdatedBy ?? '',
                    })),
                    truncated: projects.length > PROJECT_CAP,
                });
            }
            if (method === 'POST' && path === `${API}/open`) {
                const body = await readJsonBody(req);
                const ref = typeof body.url === 'string' ? body.url : typeof body.projectId === 'string' ? body.projectId : '';
                return sendJson(res, 200, await openProject(ref));
            }
            if (method === 'GET' && path === `${API}/tree`) {
                requireProject();
                return sendJson(res, 200, { project: state.project, tree: await ensureTree() });
            }
            if (method === 'GET' && path === `${API}/doc`) {
                const docPath = url.searchParams.get('path') ?? '';
                const doc = await readDoc(docPath);
                return sendJson(res, 200, doc);
            }
            if (method === 'POST' && path === `${API}/doc`) {
                const body = await readJsonBody(req);
                return sendJson(res, 200, await writeDoc(String(body.path ?? ''), String(body.text ?? '')));
            }
            if (method === 'POST' && path === `${API}/edit`) {
                const body = await readJsonBody(req);
                return sendJson(res, 200, await editDoc(String(body.path ?? ''), body.find, body.replace, body.all === true));
            }
            if (method === 'POST' && path === `${API}/compile`)
                return sendJson(res, 200, await compileProject());
            if (method === 'GET' && path === `${API}/pdf`)
                return await sendPdf(res);
            if (method === 'POST' && path === `${API}/watch`)
                return sendJson(res, 200, await watchComments(await readJsonBody(req)));
            if (method === 'GET' && path === `${API}/comments`) {
                const status = url.searchParams.get('status') === 'open' ? 'open' : 'all';
                const threads = await listComments(status);
                return sendJson(res, 200, { pending: threads.filter((thread) => !thread.resolved).length, threads });
            }
            if (method === 'POST' && path === `${API}/comments`)
                return sendJson(res, 200, await commentAction(await readJsonBody(req)));
            if (method === 'GET' && path === `${API}/events`) {
                const since = Number(url.searchParams.get('since') ?? '0');
                const floor = Number.isFinite(since) ? since : 0;
                const events = state.activity.filter((event) => Number(event.id) > floor);
                return sendJson(res, 200, { cursor: state.cursor, events });
            }
            return sendJson(res, 404, { error: `Unknown route ${method} ${path}` });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error?.code !== 'unauthenticated')
                record('error', clip(message, 140));
            return sendJson(res, error?.code === 'unauthenticated' ? 401 : 502, { error: message });
        }
    }

    function textResult(_arguments, value) {
        return [{ type: 'text', text: JSON.stringify(value) }];
    }

    const objectSchema = { type: 'object', additionalProperties: true };

    function registerTools() {
        const disposers = [];
        const register = (definition) => disposers.push(ctx.tools.register(definition));
        const tool = (name, description, parameters, execute) => register({
            name, description, parameters,
            output: { schema: { ...objectSchema }, render: textResult },
            execute,
        });

        tool('latex_status', 'Show whether a USTC Overleaf session is connected and which project is open. Call this first when unsure.', {
            type: 'object', additionalProperties: false, properties: {},
        }, async () => statusPayload());

        tool('latex_auth', 'Connect to USTC Overleaf with the one-time token the user copied from https://latex.ustc.edu.cn/agent/setup. Only use a token the user pasted into this conversation; the token is single-use and expires quickly.', {
            type: 'object', additionalProperties: false, required: ['token'],
            properties: {
                token: { type: 'string', description: 'The one-time token, exactly as the user pasted it.' },
            },
        }, async (args) => connectWithToken(String(args?.token ?? '')));

        tool('latex_projects', 'List the USTC Overleaf projects this session can open, newest first. Needs a connected session; call latex_auth first if disconnected.', {
            type: 'object', additionalProperties: false, properties: {},
        }, async () => {
            const client = await ensureClient();
            const projects = await client.listProjects();
            return {
                projects: projects.slice(0, PROJECT_CAP).map((project) => ({
                    id: String(project.id), name: String(project.name ?? ''), lastUpdated: project.lastUpdated ?? '',
                })),
                truncated: projects.length > PROJECT_CAP,
            };
        });

        tool('latex_open', 'Open the LaTeX project the user shared and make it the active project. Accepts the full link (for example https://latex.ustc.edu.cn/exampleShareToken0000#abc123) or a bare project id, and returns the project name plus its file tree.', {
            type: 'object', additionalProperties: false, required: ['ref'],
            properties: {
                ref: { type: 'string', description: 'Project link or project id.' },
            },
        }, async (args) => {
            const result = await openProject(String(args?.ref ?? ''));
            return { project: result.project, tree: result.tree.slice(0, TREE_CAP), truncated: result.tree.length > TREE_CAP };
        });

        tool('latex_tree', 'List the open project\'s documents and files. Doc rows carry the id used in the site deep link.', {
            type: 'object', additionalProperties: false, properties: {},
        }, async () => {
            requireProject();
            const tree = await ensureTree();
            return { project: state.project, tree: tree.slice(0, TREE_CAP), truncated: tree.length > TREE_CAP };
        });

        tool('latex_read', 'Read one LaTeX document from the open project. Returns the current live text from the collaboration server, so it includes the user\'s unsaved typing. Large documents are truncated with a flag.', {
            type: 'object', additionalProperties: false, required: ['path'],
            properties: {
                path: { type: 'string', description: 'Document path inside the project, such as main.tex or sections/intro.tex.' },
                start_line: { type: 'integer', description: '1-based first line to return. Omit for the start of the document.' },
                max_lines: { type: 'integer', description: 'Maximum number of lines to return. Omit for the whole document.' },
            },
        }, async (args) => {
            const doc = await readDoc(String(args?.path ?? ''));
            const lines = doc.text.split('\n');
            const start = Number.isFinite(args?.start_line) && args.start_line > 0 ? Math.floor(args.start_line) : 1;
            const limit = Number.isFinite(args?.max_lines) && args.max_lines > 0 ? Math.floor(args.max_lines) : lines.length;
            const slice = lines.slice(start - 1, start - 1 + limit).join('\n');
            const truncated = slice.length > TEXT_CAP;
            return {
                path: doc.path,
                doc_id: doc.docId,
                total_lines: lines.length,
                start_line: start,
                text: truncated ? slice.slice(0, TEXT_CAP) : slice,
                truncated,
                version: doc.version,
            };
        });

        tool('latex_edit', 'Replace text in one document of the open project. The edit is applied through the live collaboration socket, so the user sees it in their open editor immediately. Fails when find occurs zero times, or more than once while all is false — read the document first and use a unique snippet.', {
            type: 'object', additionalProperties: false, required: ['path', 'find', 'replace'],
            properties: {
                path: { type: 'string', description: 'Document path inside the project.' },
                find: { type: 'string', description: 'Exact text to replace, including indentation and line breaks.' },
                replace: { type: 'string', description: 'Replacement text.' },
                all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match.' },
            },
        }, async (args) => editDoc(String(args?.path ?? ''), args?.find, args?.replace, args?.all === true));

        tool('latex_write', 'Replace a whole document with new LaTeX text in the open project. Use for new documents or wholesale rewrites; the change appears live in the user\'s editor.', {
            type: 'object', additionalProperties: false, required: ['path', 'text'],
            properties: {
                path: { type: 'string', description: 'Document path inside the project.' },
                text: { type: 'string', description: 'Complete new document content.' },
            },
        }, async (args) => writeDoc(String(args?.path ?? ''), String(args?.text ?? '')));

        tool('latex_compile', 'Compile the open project on the USTC server and return the PDF link plus the tail of the LaTeX log. Slow: expect tens of seconds.', {
            type: 'object', additionalProperties: false, properties: {},
        }, async () => compileProject());

        tool('latex_comments', 'Review comments on the open project. Use this when the user says they left a comment or a revision suggestion on a passage: list returns each thread\'s anchored text, line, surrounding lines, and messages; apply the change with latex_edit, then reply in the same thread so the user sees the answer on the site. add creates a new comment anchored to selected_text (or a line); resolve/reopen/delete manage the thread.', {
            type: 'object', additionalProperties: false, required: ['action'],
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'reply', 'resolve', 'reopen', 'delete'], description: 'Operation to perform.' },
                status: { type: 'string', enum: ['open', 'all'], description: 'For list: only unresolved threads (open, default) or every thread (all).' },
                path: { type: 'string', description: 'Document path for add.' },
                content: { type: 'string', description: 'Comment or reply text for add/reply.' },
                thread_id: { type: 'string', description: 'Thread id for reply/resolve/reopen/delete.' },
                selected_text: { type: 'string', description: 'For add: the exact passage in the document to anchor the comment to. Read the document first so it matches exactly.' },
                line: { type: 'integer', description: 'For add: 1-based line to anchor to when selected_text is omitted or ambiguous.' },
            },
        }, async (args) => commentAction({
            action: args?.action,
            status: args?.status,
            path: args?.path,
            content: args?.content,
            threadId: args?.thread_id,
            selectedText: args?.selected_text,
            line: args?.line,
        }));

        return () => {
            for (const dispose of disposers)
                dispose();
        };
    }

    ctx.effect(() => {
        const disposeTools = registerTools();
        const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: API, handler: (req, res) => { void handle(req, res); } });
        console.log('[dsh-ustc-latex-agent] plugin loaded');
        return () => {
            disposeTools();
            disposeRoute();
            state.client = null;
            console.log('[dsh-ustc-latex-agent] plugin unloaded');
        };
    });
}
