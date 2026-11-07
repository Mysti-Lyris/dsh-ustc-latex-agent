#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 dsh-ustc-latex-agent contributors
/**
 * dsh-ustc-latex-agent — standalone probe for the vendored Overleaf client.
 *
 * Run with the bundled Node runtime, e.g.:
 *   C:\Users\Lithium\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe probe.mjs ...
 *
 * Commands:
 *   auth <token> | auth --token <token>
 *   list
 *   info <projectId|url>
 *   tree <projectId|url>
 *   read <projectId|url> <docId>
 *   write <projectId|url> <docId> <localFile>
 *   edit <projectId|url> <docId> <find> <replace> [--all]
 *   compile <projectId|url>
 *   --selftest   (fully offline)
 *
 * Prints one compact JSON value per run. Credentials are stored in
 * `probe-state.json` next to this file with owner-only permissions.
 */

import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_BASE_URL,
  OverleafClient,
  applyShareJsTextOp,
  buildReplaceOp,
  decodeOverleafUtf8,
  encodeOverleafUtf8,
  parseProjectId,
} from './lib/overleaf-client.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(HERE, 'probe-state.json');

const USAGE = `dsh-ustc-latex-agent probe

Usage:
  node probe.mjs auth <token> | auth --token <token>
  node probe.mjs list
  node probe.mjs info <projectId|url>
  node probe.mjs tree <projectId|url>
  node probe.mjs read <projectId|url> <docId>
  node probe.mjs write <projectId|url> <docId> <localFile>
  node probe.mjs edit <projectId|url> <docId> <find> <replace> [--all]
  node probe.mjs compile <projectId|url>
  node probe.mjs --selftest

Project links such as https://latex.ustc.edu.cn/exampleShareToken0000#abc123
are accepted anywhere a <projectId|url> is expected.
Credentials are kept in ${STATE_PATH} (owner-only).
`;

const printJson = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

/* ------------------------------------------------------------------------- */
/* Credential state                                                          */
/* ------------------------------------------------------------------------- */

function writeState(state) {
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  writeFileSync(STATE_PATH, serialized, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(STATE_PATH, 0o600);
  } catch {
    // Windows does not implement POSIX modes; best effort only.
  }
}

function readState() {
  if (!existsSync(STATE_PATH)) {
    return undefined;
  }
  let raw;
  try {
    raw = readFileSync(STATE_PATH, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${STATE_PATH}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Corrupt probe state at ${STATE_PATH}; delete it and run auth again.`);
  }
}

function persistClient(previousState, client, cookies) {
  const cookieName = previousState.cookieName || 'overleaf.sid';
  const jar = cookies || client.cookies || {};
  const pair = client.getSessionCookiePair(cookieName);
  writeState({
    cookie: pair?.value || jar[cookieName] || previousState.cookie,
    cookieName,
    baseUrl: previousState.baseUrl || client.baseUrl,
    csrf: client.csrf,
    lb_srv_id: jar.lb_srv_id || previousState.lb_srv_id,
    savedAt: new Date().toISOString(),
  });
}

function clientFromState(state) {
  const cookieName = state.cookieName || 'overleaf.sid';
  const cookies = { [cookieName]: state.cookie };
  if (state.lb_srv_id) {
    cookies.lb_srv_id = state.lb_srv_id;
  }
  const client = new OverleafClient({
    cookies,
    csrf: state.csrf || '',
    baseUrl: state.baseUrl || DEFAULT_BASE_URL,
  });
  const timeout = Number(process.env.OVERLEAF_TIMEOUT_MS || state.timeoutMs || 0);
  if (Number.isFinite(timeout) && timeout > 0) {
    client.setGlobalTimeout(timeout);
  }
  return client;
}

async function loadClient() {
  const state = readState();
  if (!state || !state.cookie) {
    throw new Error(`Not authenticated. Run: node probe.mjs auth <token> (state file: ${STATE_PATH})`);
  }
  let client;
  if (state.csrf) {
    client = clientFromState(state);
  } else {
    const cookieName = state.cookieName || 'overleaf.sid';
    const extraCookies = state.lb_srv_id ? { lb_srv_id: state.lb_srv_id } : undefined;
    client = await OverleafClient.fromSessionCookie(
      state.cookie,
      state.baseUrl || DEFAULT_BASE_URL,
      cookieName,
      extraCookies,
    );
    persistClient(state, client);
  }
  client.setOnCookieUpdate((cookies) => {
    try {
      persistClient(state, client, cookies);
    } catch {
      // Best effort: a failed state refresh must not break the command.
    }
  });
  return client;
}

/* ------------------------------------------------------------------------- */
/* Command helpers                                                           */
/* ------------------------------------------------------------------------- */

function requireArg(args, index, what) {
  const value = args[index];
  if (value === undefined || value === '') {
    throw new Error(`Missing ${what}`);
  }
  return value;
}

function parseDocIdArg(input, docId) {
  if (docId !== undefined && docId !== '') {
    return docId;
  }
  const hashMatch = String(input).match(/#([^/?]+)/);
  if (hashMatch) {
    return hashMatch[1];
  }
  throw new Error('Missing docId (pass it explicitly or include #<docId> in the URL)');
}

const rootFoldersOf = (projectInfo) => {
  const roots = projectInfo?.rootFolder;
  if (Array.isArray(roots)) {
    return roots;
  }
  return roots && typeof roots === 'object' ? [roots] : [];
};

function flattenProjectTree(projectInfo) {
  const nodes = [];
  const walk = (folder, folderPath) => {
    for (const doc of folder.docs || []) {
      nodes.push({
        path: folderPath ? `${folderPath}/${doc.name}` : doc.name,
        type: 'doc',
        id: doc._id,
        name: doc.name,
      });
    }
    for (const file of folder.fileRefs || []) {
      nodes.push({
        path: folderPath ? `${folderPath}/${file.name}` : file.name,
        type: 'file',
        id: file._id,
        name: file.name,
      });
    }
    for (const subfolder of folder.folders || []) {
      walk(subfolder, folderPath ? `${folderPath}/${subfolder.name}` : subfolder.name);
    }
  };
  for (const root of rootFoldersOf(projectInfo)) {
    walk(root, '');
  }
  nodes.sort((a, b) => a.path.localeCompare(b.path));
  return nodes;
}

async function projectSummary(client, projectId) {
  const [projects, info] = await Promise.all([
    client.listProjects().catch(() => []),
    client.getProjectInfo(projectId),
  ]);
  const listed = projects.find((project) => project.id === projectId);
  return {
    listed,
    info,
    summary: {
      id: projectId,
      name: info.name || listed?.name,
      rootDocId: info.rootDoc_id || info.rootDocId || listed?.rootDocId,
      rootFolderId: rootFoldersOf(info)[0]?._id,
      url: `${client.baseUrl}/${projectId}`,
      lastUpdated: listed?.lastUpdated,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Commands                                                                  */
/* ------------------------------------------------------------------------- */

function parseAuthToken(args) {
  let token;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--token') {
      token = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--token=')) {
      token = arg.slice('--token='.length);
    } else if (!arg.startsWith('-')) {
      token = arg;
    }
  }
  if (!token || token.trim() === '') {
    throw new Error('auth requires a one-time token: node probe.mjs auth <token>');
  }
  return token.trim();
}

async function cmdAuth(args) {
  const token = parseAuthToken(args);
  const requestedBaseUrl = (process.env.OVERLEAF_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const agentUrl = process.env.OVERLEAF_AGENT_URL || `${requestedBaseUrl}/agent/exchange`;

  const result = await OverleafClient.exchangeToken(token, agentUrl);
  if (!result.cookie) {
    throw new Error('Token exchange succeeded but returned no session cookie');
  }
  const baseUrl = (result.base_url || requestedBaseUrl).replace(/\/+$/, '');
  const cookieName = result.cookie_name || 'overleaf.sid';
  const extraCookies = result.lb_srv_id ? { lb_srv_id: result.lb_srv_id } : undefined;

  const client = await OverleafClient.fromSessionCookie(
    result.cookie,
    baseUrl,
    cookieName,
    extraCookies,
  );
  const projects = await client.listProjects();
  const pair = client.getSessionCookiePair(cookieName);

  writeState({
    cookie: pair?.value || result.cookie,
    cookieName,
    baseUrl,
    csrf: client.csrf,
    lb_srv_id: client.getCookie('lb_srv_id') || result.lb_srv_id,
    savedAt: new Date().toISOString(),
  });

  return { connected: true, baseUrl, projectCount: projects.length };
}

async function cmdList() {
  const client = await loadClient();
  const projects = await client.listProjects();
  return {
    baseUrl: client.baseUrl,
    count: projects.length,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      lastUpdated: project.lastUpdated,
      lastUpdatedBy: project.lastUpdatedBy,
    })),
  };
}

async function cmdInfo(args) {
  const projectId = parseProjectId(requireArg(args, 0, 'project id or URL'));
  const client = await loadClient();
  const { summary } = await projectSummary(client, projectId);
  return summary;
}

async function cmdTree(args) {
  const projectId = parseProjectId(requireArg(args, 0, 'project id or URL'));
  const client = await loadClient();
  const { info, summary } = await projectSummary(client, projectId);
  const tree = flattenProjectTree(info);
  return {
    project: summary,
    count: tree.length,
    tree,
  };
}

async function cmdRead(args) {
  const input = requireArg(args, 0, 'project id or URL');
  const projectId = parseProjectId(input);
  const docId = parseDocIdArg(input, args[1]);
  const client = await loadClient();
  const result = await client.readDoc(projectId, docId);
  return {
    projectId,
    docId: result.docId,
    version: result.version,
    type: result.type,
    length: result.text.length,
    text: result.text,
  };
}

async function cmdWrite(args) {
  const input = requireArg(args, 0, 'project id or URL');
  const projectId = parseProjectId(input);
  const docId = parseDocIdArg(input, args[1]);
  const localFile = requireArg(args, 2, 'local file');
  const text = readFileSync(localFile, 'utf8');
  const client = await loadClient();
  const result = await client.setDocumentText(projectId, docId, text);
  return {
    projectId,
    docId,
    localFile,
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: text.split('\n').length,
    ...result,
  };
}

async function cmdEdit(args) {
  const all = args.includes('--all');
  const positional = args.filter((arg) => arg !== '--all');
  const input = requireArg(positional, 0, 'project id or URL');
  const projectId = parseProjectId(input);
  const docId = parseDocIdArg(input, positional[1]);
  const find = requireArg(positional, 2, 'find text');
  const replace = positional[3];
  if (replace === undefined) {
    throw new Error('Missing replacement text');
  }
  const client = await loadClient();
  const result = await client.replaceText(projectId, docId, find, replace, all);
  return { projectId, docId, ...result };
}

async function cmdCompile(args) {
  const projectId = parseProjectId(requireArg(args, 0, 'project id or URL'));
  const client = await loadClient();
  const result = await client.compileProject(projectId);
  return { projectId, ...result };
}

/* ------------------------------------------------------------------------- */
/* Offline self-test                                                         */
/* ------------------------------------------------------------------------- */

async function runSelfTest() {
  let checks = 0;
  const failures = [];

  const test = (name, fn) => {
    try {
      const result = fn();
      checks += 1;
      return result;
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      return undefined;
    }
  };
  const testAsync = async (name, fn) => {
    try {
      await fn();
      checks += 1;
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  };

  test('project id parsing', () => {
    assert.equal(
      parseProjectId('https://latex.ustc.edu.cn/exampleShareToken0000#abc123'),
      'exampleShareToken0000',
    );
    assert.equal(
      parseProjectId('  https://latex.ustc.edu.cn/exampleShareToken0000  '),
      'exampleShareToken0000',
    );
    assert.equal(parseProjectId('exampleShareToken0000'), 'exampleShareToken0000');
    assert.equal(
      parseProjectId('https://latex.ustc.edu.cn/project/exampleShareToken0000?x=1#d1'),
      'exampleShareToken0000',
    );
    assert.equal(parseProjectId('/exampleShareToken0000/'), 'exampleShareToken0000');
    assert.throws(() => parseProjectId(''), /Missing project id or URL/);
    assert.throws(() => parseProjectId('https://latex.ustc.edu.cn/'), /Could not find a project id/);
  });

  test('UTF-8 binary-string round trip', () => {
    const sample = '中文 $x^2$ \\section{引言}\n第二行 🚀 café';
    assert.equal(decodeOverleafUtf8(encodeOverleafUtf8(sample)), sample);
    assert.equal(encodeOverleafUtf8('abc'), 'abc');
  });

  test('OT full replace reproduces Chinese document (decoded op space)', () => {
    const cases = [
      ['', '中文 $x^2$ \\section{引言}'],
      ['中文 $x^2$ \\section{引言}', ''],
      ['中文 $x^2$ \\section{引言}\n第二行', '中文 $y^2$ \\section{引言}\n第二行改'],
      ['前文\n中文内容\n后文', '前文\n中文新内容\n后文'],
      ['abc', 'abc'],
      ['a', 'b'],
    ];
    for (const [currentText, nextText] of cases) {
      const op = buildReplaceOp(currentText, nextText);
      assert.ok(Array.isArray(op), 'op must be an array of components');
      // Live-verified on latex.ustc.edu.cn: applyOtUpdate positions and d/i text
      // are decoded Unicode, not the UTF-8 binary form of the joinDoc payload.
      const applied = applyShareJsTextOp(currentText, op);
      assert.equal(
        applied,
        nextText,
        `op did not reproduce target text for ${JSON.stringify(currentText)} -> ${JSON.stringify(nextText)}`,
      );
    }

    // A delete component carries the deleted text (Overleaf text type), not a length.
    const simple = buildReplaceOp('abc', 'abd');
    assert.deepEqual(simple, [{ p: 2, d: 'c' }, { p: 2, i: 'd' }]);
    assert.equal(typeof simple[0].d, 'string');
    assert.equal(typeof simple[0].p, 'number');

    // Suffix-only change keeps the common prefix (a non-zero decoded offset).
    const suffixed = buildReplaceOp('前文\n中文内容\n后文', '前文\n中文内容\n结尾');
    assert.ok(suffixed[0].p > 0, 'expected a non-zero position for a suffix-only edit');
    assert.equal(
      applyShareJsTextOp('前文\n中文内容\n后文', suffixed),
      '前文\n中文内容\n结尾',
    );

    // Deleting text that does not match must be rejected by the simulated apply.
    assert.throws(
      () => applyShareJsTextOp('abc', [{ p: 0, d: 'xyz' }]),
      /Delete component does not match deleted text/,
    );
  });

  test('CSRF extraction (two HTML samples + input fallback)', () => {
    const metaHtml =
      '<html><head><meta name="ol-csrfToken" content="csrf-meta-123" /></head><body>ok</body></html>';
    const scriptHtml =
      '<html><body><script>window.csrfToken = "csrf-script-456";</script></body></html>';
    const inputHtml = '<form><input type="hidden" name="_csrf" value="csrf-input-789"></form>';
    assert.equal(OverleafClient.extractCsrfToken(metaHtml), 'csrf-meta-123');
    assert.equal(OverleafClient.extractCsrfToken(scriptHtml), 'csrf-script-456');
    assert.equal(OverleafClient.extractCsrfToken(inputHtml), 'csrf-input-789');
    assert.equal(OverleafClient.isLoginPage('<form name="loginForm" action="/login"></form>'), true);
    assert.equal(OverleafClient.isLoginPage(scriptHtml), false);
  });

  test('dashboard project parsing with HTML-escaped JSON', () => {
    const fixture = [
      '<!doctype html><html><head>',
      '<meta name="ol-prefetchedProjectsBlob" content="',
      '{&quot;projects&quot;:[',
      '{&quot;id&quot;:&quot;aaaaaaaaaaaaaaaaaaaaaaaa&quot;,&quot;name&quot;:&quot;Paper One&quot;,',
      '&quot;lastUpdated&quot;:&quot;2026-01-01T00:00:00.000Z&quot;},',
      '{&quot;id&quot;:&quot;bbbbbbbbbbbbbbbbbbbbbbbb&quot;,&quot;name&quot;:&quot;第二篇 LaTeX ^_^&quot;}',
      ']}" />',
      '</head><body></body></html>',
    ].join('');
    const projects = OverleafClient.extractProjectsFromHtml(fixture);
    assert.equal(projects.length, 2);
    assert.equal(projects[0].name, 'Paper One');
    assert.equal(projects[1].name, '第二篇 LaTeX ^_^');
    assert.equal(projects[1].id, 'bbbbbbbbbbbbbbbbbbbbbbbb');

    // Legacy ol-projects fallback.
    const legacy = OverleafClient.extractProjectsFromHtml(
      '<meta name="ol-projects" content="[{&quot;id&quot;:&quot;cccc&quot;,&quot;name&quot;:&quot;Legacy&quot;}]">',
    );
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].name, 'Legacy');
  });

  await testAsync('token exchange error mapping on a local server', async () => {
    const requests = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        const respond = (status, payload) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (req.url === '/agent/exchange/invalid') return respond(404, { detail: 'not found' });
        if (req.url === '/agent/exchange/expired') {
          return respond(410, { detail: 'expired or already used' });
        }
        if (req.url === '/agent/exchange/ok') {
          return respond(200, {
            cookie: 's%3Aabc.def',
            lb_srv_id: 'lb-7',
            base_url: 'https://latex.example.test',
            cookie_name: 'overleaf.sid',
          });
        }
        return respond(500, {});
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}/agent/exchange`;

      await assert.rejects(
        () => OverleafClient.exchangeToken('bad', `${base}/invalid`),
        /Token not found/,
      );
      await assert.rejects(
        () => OverleafClient.exchangeToken('old', `${base}/expired`),
        /Token expired or already used\./,
      );
      await assert.rejects(
        () => OverleafClient.exchangeToken('boom', `${base}/broken`),
        /Token exchange failed: 500/,
      );

      const ok = await OverleafClient.exchangeToken('good', `${base}/ok`);
      assert.deepEqual(ok, {
        cookie: 's%3Aabc.def',
        lb_srv_id: 'lb-7',
        base_url: 'https://latex.example.test',
        cookie_name: 'overleaf.sid',
      });

      const post = requests.find((request) => request.url === '/agent/exchange/ok');
      assert.ok(post, 'expected a POST to the exchange endpoint');
      assert.equal(post.method, 'POST');
      assert.deepEqual(JSON.parse(post.body), { token: 'good' });
      assert.equal(post.headers['content-type'], 'application/json');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  if (failures.length > 0) {
    throw new Error(`selftest failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  }
  return { selftest: 'ok', checks };
}

/* ------------------------------------------------------------------------- */
/* Entrypoint                                                                */
/* ------------------------------------------------------------------------- */

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  if (command === '--selftest') {
    const result = await runSelfTest();
    printJson(result);
    return;
  }

  let result;
  switch (command) {
    case 'auth':
      result = await cmdAuth(args);
      break;
    case 'list':
      result = await cmdList();
      break;
    case 'info':
      result = await cmdInfo(args);
      break;
    case 'tree':
      result = await cmdTree(args);
      break;
    case 'read':
      result = await cmdRead(args);
      break;
    case 'write':
      result = await cmdWrite(args);
      break;
    case 'edit':
      result = await cmdEdit(args);
      break;
    case 'compile':
      result = await cmdCompile(args);
      break;
    default:
      throw new Error(`Unknown command: ${command}\n${USAGE}`);
  }
  printJson(result);
}

main().catch((error) => {
  process.stderr.write(`error: ${error?.message || error}\n`);
  if (process.env.PROBE_DEBUG === '1' && error?.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
