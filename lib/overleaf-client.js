// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 dsh-ustc-latex-agent contributors

/**
 * dsh-ustc-latex-agent — Overleaf transport client
 *
 * Vendored and adapted from `olcli-ustc` 0.7.0 `dist/client.js`
 * (https://github.com/aloth/olcli), MIT License,
 * Copyright (c) 2026 Alexander Loth.
 *
 * The full upstream license text and the list of modifications are in
 * `latex-plugin/THIRD_PARTY_NOTICES.md`.
 *
 * Adaptations for dsh-ustc-latex-agent 0.1.0:
 *   - Zero npm dependencies. `cheerio` HTML parsing was replaced with small
 *     raw-HTML helpers (tag scanner, attribute parser, entity decoder), the
 *     `readFileSync(package.json)` version lookup and `fileURLToPath` were
 *     removed (static USER_AGENT), and the `adm-zip` fallback in
 *     `downloadByPath()` was replaced with a minimal `node:zlib` ZIP reader.
 *   - Kept olcli's proven HTTP, Socket.IO 0.9 xhr-polling, `joinDoc`,
 *     `applyOtUpdate`, compile and comments behaviour.
 *   - Added high-level document helpers `readDoc()`, `setDocumentText()` and
 *     `replaceText()` with live OT updates (version-conflict retry), plus the
 *     pure helpers `encodeOverleafUtf8` / `decodeOverleafUtf8`,
 *     `buildReplaceOp`, `applyShareJsTextOp` and `parseProjectId`.
 *   - OT text ops follow Overleaf's vendored ShareJS `text` type:
 *     components are `{ p, i }` (insert) and `{ p, d }` where **`d` is the
 *     deleted text string** (not a length); components are applied in order
 *     and each `p` is relative to the document after the previous component.
 *     See `services/document-updater/app/js/sharejs/types/text.js` (Overleaf).
 *   - Overleaf stores document lines as UTF-8 bytes in a "binary string"
 *     (olcli decodes them with `Buffer.from(line, 'binary').toString('utf8')`).
 *     The write helpers therefore decode joined content for humans and encode
 *     `d`/`i` back into that binary-string space, refusing to send an op when
 *     the document does not round-trip (e.g. a server that stores plain
 *     Unicode), and never writing `history-ot` documents.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import { inflateRawSync } from 'node:zlib';

export const DEFAULT_BASE_URL = 'https://latex.ustc.edu.cn';
export const USER_AGENT = 'dsh-ustc-latex-agent/0.1.0';

/* ------------------------------------------------------------------------- */
/* UTF-8 <-> Overleaf binary-string helpers                                  */
/* ------------------------------------------------------------------------- */

/**
 * Convert a normal JavaScript/Unicode string into the "binary string" form
 * Overleaf uses for document content (each JS char is one UTF-8 byte).
 */
export function encodeOverleafUtf8(text) {
  if (typeof text !== 'string') {
    throw new TypeError('encodeOverleafUtf8 expects a string');
  }
  return Buffer.from(text, 'utf-8').toString('binary');
}

/**
 * Inverse of {@link encodeOverleafUtf8}: recover normal Unicode text from the
 * byte-per-char strings carried by Overleaf's real-time protocol.
 */
export function decodeOverleafUtf8(text) {
  if (typeof text !== 'string') {
    throw new TypeError('decodeOverleafUtf8 expects a string');
  }
  return Buffer.from(text, 'binary').toString('utf-8');
}

/* ------------------------------------------------------------------------- */
/* ShareJS text op helpers                                                   */
/* ------------------------------------------------------------------------- */

const isUtf8Continuation = (code) => (code & 0xc0) === 0x80;

const commonPrefixLength = (a, b) => {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) {
    index += 1;
  }
  return index;
};

const commonSuffixLength = (a, b, prefix) => {
  const limit = Math.min(a.length - prefix, b.length - prefix);
  let length = 0;
  while (
    length < limit &&
    a.charCodeAt(a.length - 1 - length) === b.charCodeAt(b.length - 1 - length)
  ) {
    length += 1;
  }
  return length;
};

// Shrink a common prefix until it ends on a UTF-8 character boundary.
const safePrefixLength = (encoded, prefix) => {
  let length = prefix;
  while (length > 0 && length < encoded.length && isUtf8Continuation(encoded.charCodeAt(length))) {
    length -= 1;
  }
  return length;
};

// Shrink a common suffix until the remaining suffix starts on a UTF-8
// character boundary.
const safeSuffixLength = (encoded, suffix) => {
  let length = suffix;
  while (length > 0 && isUtf8Continuation(encoded.charCodeAt(encoded.length - length))) {
    length -= 1;
  }
  return length;
};

/**
 * Build a ShareJS text op replacing `currentText` with `nextText`.
 *
 * The returned op is a list of components in Overleaf's wire shape:
 *   [{ p, d: '<deleted text>' }, { p, i: '<inserted text>' }]
 * where `d`/`i` are in Overleaf's UTF-8 binary-string space and `p` is a
 * position in that space. The common prefix/suffix are left untouched so
 * unrelated text (and any comment anchors / remote cursors in it) survives;
 * the changed middle is a single delete + insert pair.
 *
 * @param {string} currentText human-readable (decoded) current document text
 * @param {string} nextText    human-readable (decoded) desired document text
 * @returns {Array<{p:number,i?:string,d?:string}>}
 */
export function buildReplaceOp(currentText, nextText) {
  if (typeof currentText !== 'string' || typeof nextText !== 'string') {
    throw new TypeError('buildReplaceOp expects two strings');
  }
  if (currentText === nextText) {
    return [];
  }
  // Live-verified against latex.ustc.edu.cn (Overleaf 2025, ol-otMigrationStage 0):
  // applyOtUpdate op positions and d/i text are decoded Unicode, not the
  // UTF-8-binary form the joinDoc payload uses. ASCII hid the difference; a
  // non-ASCII document proved it (encoded offsets were rejected, decoded ones
  // applied).
  const before = currentText;
  const after = nextText;

  const prefix = safePrefixLength(before, commonPrefixLength(before, after));
  let suffix = commonSuffixLength(before, after, prefix);
  suffix = Math.min(safeSuffixLength(before, suffix), safeSuffixLength(after, suffix));

  const deleted = before.slice(prefix, before.length - suffix);
  const inserted = after.slice(prefix, after.length - suffix);

  const op = [];
  if (deleted.length > 0) {
    op.push({ p: prefix, d: deleted });
  }
  if (inserted.length > 0) {
    op.push({ p: prefix, i: inserted });
  }
  return op;
}

/**
 * Apply a ShareJS text op to a snapshot using Overleaf's `text.apply`
 * semantics (delete components must match the text they delete). Used to
 * validate an op locally before sending it to the server, and by the probe's
 * offline self-test.
 *
 * @param {string} snapshot snapshot in Overleaf binary-string space
 * @param {Array<{p:number,i?:string,d?:string}>} op
 * @returns {string}
 */
export function applyShareJsTextOp(snapshot, op) {
  if (typeof snapshot !== 'string') {
    throw new TypeError('applyShareJsTextOp expects a string snapshot');
  }
  if (!Array.isArray(op)) {
    throw new TypeError('applyShareJsTextOp expects an array of components');
  }
  let result = snapshot;
  for (const component of op) {
    if (!component || typeof component.p !== 'number' || !Number.isInteger(component.p) || component.p < 0) {
      throw new Error('Invalid OT component: missing non-negative integer position');
    }
    if (typeof component.i === 'string' && component.i.length > 0) {
      result = result.slice(0, component.p) + component.i + result.slice(component.p);
    } else if (typeof component.d === 'string' && component.d.length > 0) {
      const deleted = result.slice(component.p, component.p + component.d.length);
      if (deleted !== component.d) {
        throw new Error(
          "Delete component does not match deleted text: expected " +
            JSON.stringify(deleted) +
            ', got ' +
            JSON.stringify(component.d),
        );
      }
      result = result.slice(0, component.p) + result.slice(component.p + component.d.length);
    } else {
      throw new Error('Invalid OT component: needs a non-empty i or d string');
    }
  }
  return result;
}

/* ------------------------------------------------------------------------- */
/* Tiny raw-HTML helpers (cheerio replacement)                               */
/* ------------------------------------------------------------------------- */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/** Decode the HTML entities that can occur in attribute values. */
function decodeHtmlEntities(value) {
  if (typeof value !== 'string' || value.indexOf('&') === -1) {
    return value;
  }
  return value.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const digits = isHex ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Find every `<tag ...>` open tag in raw HTML, respecting quoted attribute
 * values (which may themselves contain `>`).
 */
function findTags(html, tagName) {
  const tags = [];
  if (typeof html !== 'string' || html.length === 0) {
    return tags;
  }
  const lower = html.toLowerCase();
  const needle = `<${tagName.toLowerCase()}`;
  let index = 0;
  while ((index = lower.indexOf(needle, index)) !== -1) {
    const boundary = lower[index + needle.length];
    if (boundary && !/[\s/>]/.test(boundary)) {
      index += needle.length;
      continue;
    }
    let cursor = index + needle.length;
    let quote = null;
    while (cursor < html.length) {
      const character = html[cursor];
      if (quote) {
        if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    tags.push(html.slice(index, cursor));
    index = cursor;
  }
  return tags;
}

/** Parse the attributes of a single open tag. */
function getAttributes(tagHtml) {
  const attributes = {};
  const nameEnd = tagHtml.search(/[\s/>]/);
  const body = nameEnd === -1 ? '' : tagHtml.slice(nameEnd);
  const attributePattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attributePattern.exec(body)) !== null) {
    const name = match[1].toLowerCase();
    const raw = match[2] !== undefined
      ? match[2]
      : match[3] !== undefined
        ? match[3]
        : match[4] !== undefined
          ? match[4]
          : '';
    attributes[name] = decodeHtmlEntities(raw);
  }
  return attributes;
}

/** Return the `content` of the first `<meta name="...">` tag, or undefined. */
function getMetaContent(html, metaName) {
  const wanted = metaName.toLowerCase();
  for (const tag of findTags(html, 'meta')) {
    const attributes = getAttributes(tag);
    if (typeof attributes.name === 'string' && attributes.name.toLowerCase() === wanted) {
      return attributes.content;
    }
  }
  return undefined;
}

/** Return the `value` of the first `<input name="...">` tag, or undefined. */
function getInputValue(html, inputName) {
  const wanted = inputName.toLowerCase();
  for (const tag of findTags(html, 'input')) {
    const attributes = getAttributes(tag);
    if (typeof attributes.name === 'string' && attributes.name.toLowerCase() === wanted) {
      return attributes.value;
    }
  }
  return undefined;
}

/** Return all inline `<script>` bodies from raw HTML. */
function getScriptContents(html) {
  const contents = [];
  if (typeof html !== 'string' || html.length === 0) {
    return contents;
  }
  const lower = html.toLowerCase();
  let index = 0;
  while ((index = lower.indexOf('<script', index)) !== -1) {
    const boundary = lower[index + 7];
    if (boundary && !/[\s/>]/.test(boundary)) {
      index += 7;
      continue;
    }
    let cursor = index + 7;
    let quote = null;
    while (cursor < html.length) {
      const character = html[cursor];
      if (quote) {
        if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    const bodyStart = cursor;
    const closeIndex = lower.indexOf('</script', bodyStart);
    if (closeIndex === -1) {
      break;
    }
    contents.push(html.slice(bodyStart, closeIndex));
    index = closeIndex + 8;
  }
  return contents;
}

/* ------------------------------------------------------------------------- */
/* Minimal ZIP reader (replaces the adm-zip fallback)                        */
/* ------------------------------------------------------------------------- */

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

const findEndOfCentralDirectory = (buffer) => {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
};

/**
 * Extract one entry from an in-memory ZIP archive (stored or deflate).
 * Only what `downloadByPath()` needs: no extraction to disk, no ZIP64.
 */
function extractZipEntry(buffer, entryPath) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('extractZipEntry expects a Buffer');
  }
  const wanted = String(entryPath).replace(/^\/+/, '').replace(/\\/g, '/');
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) {
    throw new Error('Downloaded archive is not a valid ZIP file');
  }
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('Malformed ZIP central directory');
    }
    const flags = buffer.readUInt16LE(pointer + 8);
    const compressionMethod = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localHeaderOffset = buffer.readUInt32LE(pointer + 42);
    const rawName = buffer.subarray(pointer + 46, pointer + 46 + nameLength);
    const name = (flags & 0x0800) === 0 ? rawName.toString('latin1') : rawName.toString('utf8');
    if (name === wanted || name.replace(/^\.\//, '') === wanted) {
      if (
        localHeaderOffset + 30 > buffer.length ||
        buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_SIGNATURE
      ) {
        throw new Error('Malformed ZIP local file header');
      }
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        return Buffer.from(data);
      }
      if (compressionMethod === 8) {
        return inflateRawSync(data);
      }
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${name}`);
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`File not found in archive: ${entryPath}`);
}

/* ------------------------------------------------------------------------- */
/* Project id parsing                                                        */
/* ------------------------------------------------------------------------- */

const decodeUrlSegment = (segment) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * Accepts an Overleaf project id or a deep link such as
 * `https://latex.ustc.edu.cn/exampleShareToken0000#abc123` and returns the
 * project id (`exampleShareToken0000`). Doc ids in the hash are ignored.
 */
export function parseProjectId(input) {
  if (input === undefined || input === null) {
    throw new Error('Missing project id or URL');
  }
  let value = String(input).trim();
  if (value.length === 0) {
    throw new Error('Missing project id or URL');
  }

  let segments;
  if (/^https?:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid project URL: ${value}`);
    }
    segments = url.pathname.split('/').filter(Boolean).map(decodeUrlSegment);
  } else {
    value = value.split('#')[0].split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');
    segments = value.split('/').filter(Boolean).map(decodeUrlSegment);
  }

  if (segments.length === 0) {
    throw new Error(`Could not find a project id in: ${String(input)}`);
  }
  const projectIndex = segments.lastIndexOf('project');
  const candidate = projectIndex !== -1 && segments[projectIndex + 1]
    ? segments[projectIndex + 1]
    : segments[0];
  if (!candidate) {
    throw new Error(`Could not find a project id in: ${String(input)}`);
  }
  return candidate;
}

/* ------------------------------------------------------------------------- */
/* Client                                                                    */
/* ------------------------------------------------------------------------- */

export class OverleafClient {
  cookies;
  csrf;
  baseUrl;
  verbose = false;
  timeoutMs = 10000;
  onCookieUpdate;
  // Cache per-project folder trees so repeated uploads in sync/upload calls
  // don't re-fetch the tree via Socket.IO on every file.
  folderTreeCache = new Map();

  constructor(credentials) {
    if (!credentials || typeof credentials !== 'object') {
      throw new TypeError('OverleafClient requires credentials');
    }
    this.cookies = credentials.cookies || {};
    this.csrf = credentials.csrf || '';
    this.baseUrl = credentials.baseUrl || DEFAULT_BASE_URL;
  }

  setOnCookieUpdate(callback) {
    this.onCookieUpdate = callback;
  }

  /** Enable or disable verbose request/response logging to stderr. */
  setVerbose(v) {
    this.verbose = v;
  }

  /** Set the global HTTP request timeout in milliseconds. */
  setGlobalTimeout(ms) {
    this.timeoutMs = ms;
  }

  getCookie(name) {
    return this.cookies[name];
  }

  setCookie(name, value) {
    this.cookies[name] = value;
  }

  getSessionCookiePair(preferredCookieName = 'overleaf.sid') {
    const preferredNames = [
      preferredCookieName,
      'overleaf_session2',
      'overleaf.sid',
      'sharelatex.sid',
    ];
    const seen = new Set();
    for (const name of preferredNames) {
      if (seen.has(name)) continue;
      seen.add(name);
      const value = this.cookies[name];
      if (value) return { name, value };
    }
    const fallback = Object.entries(this.cookies).find(
      ([name]) => name.toLowerCase().includes('session') || name.toLowerCase().endsWith('.sid'),
    );
    if (fallback) return { name: fallback[0], value: fallback[1] };
    const first = Object.entries(this.cookies)[0];
    return first ? { name: first[0], value: first[1] } : undefined;
  }

  /**
   * Resolve (and cache) the folder tree for a project. Falls back to a
   * minimal tree containing only the root folder when the Socket.IO probe
   * fails (e.g. self-hosted Overleaf without that endpoint).
   */
  async getOrLoadFolderTree(projectId) {
    const cached = this.folderTreeCache.get(projectId);
    if (cached) return cached;
    let tree = await this.getFolderTreeFromSocket(projectId);
    if (!tree) {
      const rootId = await this.getRootFolderId(projectId);
      tree = { '': rootId };
    }
    this.folderTreeCache.set(projectId, tree);
    return tree;
  }

  /** Drop the cached folder tree for a project (e.g. after rename/delete). */
  invalidateFolderTree(projectId) {
    this.folderTreeCache.delete(projectId);
  }

  projectUrl() {
    return `${this.baseUrl}/project`;
  }

  downloadUrl(projectId) {
    return `${this.baseUrl}/project/${projectId}/download/zip`;
  }

  uploadUrl(projectId) {
    return `${this.baseUrl}/project/${projectId}/upload`;
  }

  folderUrl(projectId) {
    return `${this.baseUrl}/project/${projectId}/folder`;
  }

  deleteUrl(projectId, entityType, entityId) {
    return `${this.baseUrl}/project/${projectId}/${entityType}/${entityId}`;
  }

  compileUrl(projectId) {
    return `${this.baseUrl}/project/${projectId}/compile?enable_pdf_caching=true`;
  }

  /**
   * Create client from session cookie string.
   *
   * `sessionCookie` is the raw cookie VALUE (not `name=value`).
   */
  static async fromSessionCookie(
    sessionCookie,
    baseUrl = DEFAULT_BASE_URL,
    cookieName = 'overleaf.sid',
    extraCookies,
  ) {
    const cookies = {
      [cookieName]: sessionCookie,
      ...extraCookies,
    };
    // Fetch CSRF token from project page
    const initialHeaders = {
      Cookie: Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; '),
      'User-Agent': USER_AGENT,
    };
    const bootstrapClient = new OverleafClient({ cookies, csrf: 'bootstrap', baseUrl });
    const response = await bootstrapClient.httpRequest(`${baseUrl}/project`, {
      headers: initialHeaders,
      expect: 'text',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch projects page: ${response.status}`);
    }
    bootstrapClient.applySetCookieHeaders(response.headers['set-cookie']);
    const html = response.body;
    if (OverleafClient.isLoginPage(html)) {
      throw new Error('Authentication required. Session may have expired.');
    }
    const csrf = OverleafClient.extractCsrfToken(html);
    if (!csrf) {
      throw new Error('Could not find CSRF token. Session may have expired.');
    }
    // Update cookies if the bootstrap request added anything
    return new OverleafClient({ cookies: bootstrapClient.cookies, csrf, baseUrl });
  }

  /**
   * Create client by submitting Overleaf's email/password login form.
   * Kept from olcli for completeness; the plugin itself only uses one-time
   * tokens.
   */
  static async fromPasswordLogin(email, password, baseUrl = DEFAULT_BASE_URL) {
    const bootstrapClient = new OverleafClient({ cookies: {}, csrf: 'bootstrap', baseUrl });
    const loginPage = await bootstrapClient.httpRequest(`${baseUrl}/login`, {
      headers: { 'User-Agent': USER_AGENT },
      expect: 'text',
    });
    if (!loginPage.ok) {
      throw new Error(`Failed to fetch login page: ${loginPage.status}`);
    }
    bootstrapClient.applySetCookieHeaders(loginPage.headers['set-cookie']);
    const csrf = OverleafClient.extractCsrfToken(loginPage.body);
    if (!csrf) {
      throw new Error('Could not find CSRF token on login page.');
    }
    const form = new URLSearchParams();
    form.set('_csrf', csrf);
    form.set('email', email);
    form.set('password', password);
    const body = form.toString();
    const loginResponse = await bootstrapClient.httpRequest(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        Cookie: bootstrapClient.getCookieHeader(),
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
      expect: 'text',
      maxRedirects: 0,
    });
    bootstrapClient.applySetCookieHeaders(loginResponse.headers['set-cookie']);
    if (![302, 303].includes(loginResponse.status)) {
      const loginFailure =
        typeof loginResponse.body === 'string' &&
        OverleafClient.isLoginPage(loginResponse.body);
      if (loginFailure) {
        throw new Error('Password login failed. Email or password may be incorrect.');
      }
      throw new Error(`Password login failed: ${loginResponse.status}`);
    }
    const projectUrl = new URL(loginResponse.headers.location || '/project', baseUrl).toString();
    const projectPage = await bootstrapClient.httpRequest(projectUrl, {
      headers: {
        Cookie: bootstrapClient.getCookieHeader(),
        'User-Agent': USER_AGENT,
      },
      expect: 'text',
    });
    if (!projectPage.ok) {
      throw new Error(`Failed to fetch projects page after login: ${projectPage.status}`);
    }
    bootstrapClient.applySetCookieHeaders(projectPage.headers['set-cookie']);
    if (OverleafClient.isLoginPage(projectPage.body)) {
      throw new Error('Password login failed. Still on login page after submitting credentials.');
    }
    const projectCsrf = OverleafClient.extractCsrfToken(projectPage.body);
    if (!projectCsrf) {
      throw new Error('Could not find CSRF token after password login.');
    }
    return new OverleafClient({ cookies: bootstrapClient.cookies, csrf: projectCsrf, baseUrl });
  }

  /**
   * Exchange a one-time token for a session cookie via the agent service.
   * 404 = invalid token, 410 = expired/used.
   */
  static async exchangeToken(token, agentUrl) {
    const baseUrl = DEFAULT_BASE_URL;
    const url = agentUrl || `${baseUrl}/agent/exchange`;
    const bootstrapClient = new OverleafClient({ cookies: {}, csrf: 'bootstrap', baseUrl });
    const body = JSON.stringify({ token });
    const response = await bootstrapClient.httpRequest(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
      expect: 'json',
      maxRedirects: 0,
    });
    if (response.status === 404) {
      throw new Error('Token not found. It may be invalid.');
    }
    if (response.status === 410) {
      const errorBody = typeof response.body === 'object' ? response.body : {};
      const detail = errorBody?.detail || 'expired or already used';
      throw new Error(`Token ${detail}.`);
    }
    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }
    const data = response.body;
    return {
      cookie: data.cookie,
      lb_srv_id: data.lb_srv_id || undefined,
      base_url: data.base_url,
      cookie_name: data.cookie_name,
    };
  }

  /**
   * Extract the CSRF token from raw HTML.
   *
   * Three fallbacks, matching olcli's cheerio implementation:
   *   a) `<meta name="ol-csrfToken" content="...">`
   *   b) `<input name="_csrf" value="...">`
   *   c) script text matching `csrfToken[...] [:|=] "..."` (modern Overleaf
   *      usually only has this form: `window.csrfToken = "..."`).
   */
  static extractCsrfToken(html) {
    const meta = getMetaContent(html, 'ol-csrfToken');
    if (meta) return meta;
    const input = getInputValue(html, '_csrf');
    if (input) return input;
    for (const script of getScriptContents(html)) {
      const match = script.match(/csrfToken["']?\s*[:=]\s*["']([^"']+)["']/);
      if (match) return match[1];
    }
    return undefined;
  }

  /** True when raw HTML looks like Overleaf's login page. */
  static isLoginPage(html) {
    for (const tag of findTags(html, 'form')) {
      const attributes = getAttributes(tag);
      if (typeof attributes.name === 'string' && attributes.name.toLowerCase() === 'loginform') {
        return true;
      }
    }
    for (const tag of findTags(html, 'input')) {
      const attributes = getAttributes(tag);
      if (typeof attributes.name === 'string' && attributes.name.toLowerCase() === 'password') {
        return true;
      }
    }
    return false;
  }

  /**
   * Parse the project array out of the `/project` dashboard HTML, trying the
   * three discovery methods olcli used, in the same order. Meta attribute
   * values are HTML-entity decoded before JSON.parse, as cheerio did.
   */
  static extractProjectsFromHtml(html) {
    let projects = [];

    // Method 1: ol-prefetchedProjectsBlob (newest Overleaf)
    const prefetchedBlob = getMetaContent(html, 'ol-prefetchedProjectsBlob');
    if (prefetchedBlob) {
      try {
        const data = JSON.parse(prefetchedBlob);
        projects = data.projects || data;
      } catch {
        // Try next method
      }
    }

    // Method 2: any meta tag whose content includes "projects" (PR #73)
    if (!Array.isArray(projects) || projects.length === 0) {
      for (const tag of findTags(html, 'meta')) {
        const attributes = getAttributes(tag);
        const content = attributes.content;
        if (typeof content !== 'string' || !content.includes('"projects"')) continue;
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data.projects)) {
            projects = data.projects;
            break;
          }
        } catch {
          // Continue
        }
      }
    }

    // Method 3: ol-projects meta tag (legacy)
    if (!Array.isArray(projects) || projects.length === 0) {
      const projectsMeta = getMetaContent(html, 'ol-projects');
      if (projectsMeta) {
        try {
          const data = JSON.parse(projectsMeta);
          if (Array.isArray(data)) projects = data;
        } catch {
          // Continue
        }
      }
    }

    return Array.isArray(projects) ? projects : [];
  }

  /** Parse legacy project-info JSON out of the project page HTML. */
  static extractProjectInfoFromHtml(html) {
    const projectMeta = getMetaContent(html, 'ol-project');
    if (projectMeta) {
      try {
        return JSON.parse(projectMeta);
      } catch {
        // Continue
      }
    }
    for (const tag of findTags(html, 'meta')) {
      const attributes = getAttributes(tag);
      const content = attributes.content;
      if (typeof content !== 'string' || !content.includes('rootFolder')) continue;
      try {
        return JSON.parse(content);
      } catch {
        // Continue
      }
    }
    return undefined;
  }

  getCookieHeader() {
    const header = Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
    this.logVerbose('Cookie header:', header);
    return header;
  }

  getHeaders(includeContentType = false) {
    const headers = {
      Cookie: this.getCookieHeader(),
      'User-Agent': USER_AGENT,
      'X-Csrf-Token': this.csrf,
    };
    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  normalizeHeaders(headers) {
    const normalized = {};
    if (!headers) return normalized;
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        normalized[key] = value;
      }
    }
    return normalized;
  }

  applySetCookieHeaders(setCookie) {
    if (!setCookie) return;
    let changed = false;
    for (const setCookieHeader of setCookie) {
      const match = setCookieHeader.match(/^([^=]+)=([^;]+)/);
      if (match) {
        const value = match[2];
        let decoded = value;
        try {
          decoded = decodeURIComponent(value);
        } catch {
          // value is not URL-encoded, use as-is
        }
        this.logVerbose('Set-Cookie raw:', value, '→ decoded:', decoded);
        this.cookies[match[1]] = decoded;
        changed = true;
      }
    }
    if (changed && this.onCookieUpdate) {
      this.onCookieUpdate(this.cookies);
    }
  }

  logVerbose(...args) {
    if (this.verbose) {
      // eslint-disable-next-line no-console
      console.error('[dsh-ustc-latex-agent]', ...args);
    }
  }

  async httpRequest(url, options = {}) {
    const method = options.method || 'GET';
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxRedirects = options.maxRedirects ?? 5;
    const expect = options.expect ?? 'text';

    // Normalize FormData bodies into a multipart Buffer + headers using Node's
    // built-in Web Fetch primitives. Keeps every code path on httpRequest
    // (no fetch() reintroduction) while properly serializing multipart uploads.
    let bodyBuffer;
    const extraHeaders = {};
    if (options.body instanceof FormData) {
      const request = new Request('http://x/', { method: 'POST', body: options.body });
      const arrayBuffer = await request.arrayBuffer();
      bodyBuffer = Buffer.from(arrayBuffer);
      const contentType = request.headers.get('content-type');
      if (contentType) extraHeaders['Content-Type'] = contentType;
      extraHeaders['Content-Length'] = String(bodyBuffer.length);
    } else if (options.body !== undefined) {
      bodyBuffer = options.body;
    }

    const doRequest = (reqUrl, redirectsLeft) => {
      return new Promise((resolve, reject) => {
        const parsedUrl = new URL(reqUrl);
        const transport = parsedUrl.protocol === 'https:' ? https : http;
        const headers = this.normalizeHeaders({ ...extraHeaders, ...options.headers });
        const req = transport.request(reqUrl, { method, headers }, (res) => {
          const status = res.statusCode || 0;
          const resHeaders = res.headers;
          if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
            this.logVerbose(`${method} ${reqUrl} -> ${status} redirect -> ${res.headers.location}`);
            const redirectUrl = new URL(res.headers.location, reqUrl).toString();
            res.resume();
            doRequest(redirectUrl, redirectsLeft - 1).then(resolve, reject);
            return;
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            let body = buffer;
            if (expect === 'text') {
              body = buffer.toString('utf-8');
            } else if (expect === 'json') {
              try {
                body = JSON.parse(buffer.toString('utf-8'));
              } catch {
                this.logVerbose(`${method} ${reqUrl} -> ${status} (invalid JSON, ${buffer.length} bytes)`);
                return reject(new Error(`Failed to parse JSON response from ${reqUrl}`));
              }
            }
            const ok = status >= 200 && status < 300;
            if (this.verbose) {
              const contentType = resHeaders['content-type'] || '';
              let snippet = '';
              if (!ok) {
                const text =
                  expect === 'buffer' ? '' : typeof body === 'string' ? body : JSON.stringify(body);
                snippet = text ? ` body=${text.slice(0, 200).replace(/\s+/g, ' ')}` : '';
              }
              this.logVerbose(`${method} ${reqUrl} -> ${status} (${buffer.length}B ${contentType})${snippet}`);
            }
            resolve({ status, ok, headers: resHeaders, body });
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        if (timeoutMs) {
          req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
          });
        }
        if (bodyBuffer !== undefined) {
          req.write(bodyBuffer);
        }
        req.end();
      });
    };
    return doRequest(url, maxRedirects);
  }

  /**
   * Get all projects (not archived, not trashed)
   */
  async listProjects() {
    const response = await this.httpRequest(this.projectUrl(), {
      headers: this.getHeaders(),
      expect: 'text',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    const projectsData = OverleafClient.extractProjectsFromHtml(response.body);
    // Filter out archived and trashed
    return projectsData
      .filter((project) => !project.archived && !project.trashed)
      .map((project) => ({
        id: project.id || project._id,
        name: project.name,
        lastUpdated: project.lastUpdated,
        lastUpdatedBy: project.lastUpdatedBy,
        owner: project.owner,
        archived: project.archived,
        trashed: project.trashed,
      }));
  }

  /**
   * Get project by name
   */
  async getProject(name) {
    const projects = await this.listProjects();
    return projects.find((project) => project.name === name);
  }

  /**
   * Get project by ID
   */
  async getProjectById(id) {
    const projects = await this.listProjects();
    return projects.find((project) => project.id === id);
  }

  /**
   * Get detailed project info including file tree
   */
  async getProjectInfo(projectId) {
    const response = await this.httpRequest(`${this.projectUrl()}/${projectId}`, {
      headers: this.getHeaders(),
      expect: 'text',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch project info: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    const html = response.body;

    // Legacy meta-tag paths first (what olcli did with cheerio)...
    let projectInfo = OverleafClient.extractProjectInfoFromHtml(html);

    // ...then the Socket.IO joinProjectResponse payload, which is the
    // authoritative source on modern Overleaf (no tree in meta tags).
    if (!projectInfo) {
      const socketProject = await this.getProjectFromSocket(projectId);
      if (socketProject) {
        projectInfo = socketProject;
      }
    }
    if (!projectInfo) {
      throw new Error('Could not parse project info');
    }
    return projectInfo;
  }

  /**
   * Fetch the full project object via the collaboration socket.
   * Returns the `project` field of the joinProjectResponse, which contains
   * the rootFolder tree and other metadata that used to live in ol-project.
   */
  async getProjectFromSocket(projectId) {
    let sid = null;
    try {
      const handshakeUrl = `${this.baseUrl}/socket.io/1/?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
      const handshakeResponse = await this.httpRequest(handshakeUrl, {
        headers: { Cookie: this.getCookieHeader(), 'User-Agent': USER_AGENT },
        expect: 'text',
        timeoutMs: 5000,
      });
      if (!handshakeResponse.ok) return null;
      this.applySetCookieHeaders(handshakeResponse.headers['set-cookie']);
      const handshakeBody = handshakeResponse.body.trim();
      sid = handshakeBody.split(':')[0];
      if (!sid) return null;
      const buildPollUrl = () =>
        `${this.baseUrl}/socket.io/1/xhr-polling/${sid}?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const pollResponse = await this.httpRequest(buildPollUrl(), {
          headers: { Cookie: this.getCookieHeader(), 'User-Agent': USER_AGENT },
          expect: 'text',
          timeoutMs: 5000,
        });
        if (!pollResponse.ok) return null;
        this.applySetCookieHeaders(pollResponse.headers['set-cookie']);
        const packets = this.decodeSocketIoPayload(pollResponse.body);
        for (const packet of packets) {
          if (packet.startsWith('5:::')) {
            try {
              const payload = JSON.parse(packet.slice(4));
              if (payload?.name === 'joinProjectResponse' && payload?.args?.[0]?.project) {
                return payload.args[0].project;
              }
            } catch {
              /* ignore */
            }
          }
          if (packet.startsWith('2::')) {
            const heartbeatResponse = await this.httpRequest(buildPollUrl(), {
              method: 'POST',
              headers: {
                Cookie: this.getCookieHeader(),
                'User-Agent': USER_AGENT,
                'Content-Type': 'text/plain;charset=UTF-8',
              },
              body: '2::',
              expect: 'text',
              timeoutMs: 5000,
            });
            this.applySetCookieHeaders(heartbeatResponse.headers['set-cookie']);
          }
        }
      }
    } catch {
      // fall through
    } finally {
      if (sid) {
        try {
          const disconnectUrl = `${this.baseUrl}/socket.io/1/xhr-polling/${sid}?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
          const disconnectResponse = await this.httpRequest(disconnectUrl, {
            method: 'POST',
            headers: {
              Cookie: this.getCookieHeader(),
              'User-Agent': USER_AGENT,
              'Content-Type': 'text/plain;charset=UTF-8',
            },
            body: '0::',
            expect: 'text',
            timeoutMs: 5000,
          });
          this.applySetCookieHeaders(disconnectResponse.headers['set-cookie']);
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  }

  /**
   * Download a URL as a Buffer using Node.js http/https modules.
   *
   * This avoids fetch's strict header validation which rejects non-Latin1
   * characters in response headers (e.g. Content-Disposition with Unicode
   * project names). See: https://github.com/aloth/olcli/issues/2
   */
  async downloadBuffer(url, timeoutMs) {
    const response = await this.httpRequest(url, {
      headers: this.getHeaders(),
      expect: 'buffer',
      timeoutMs,
    });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    return response.body;
  }

  /**
   * Download project as zip
   *
   * Uses downloadBuffer to avoid ByteString errors from non-Latin1
   * Content-Disposition headers. See: https://github.com/aloth/olcli/issues/2
   */
  async downloadProject(projectId, timeoutMs) {
    return this.downloadBuffer(this.downloadUrl(projectId), timeoutMs);
  }

  /**
   * Compile project and get PDF
   */
  async compileProject(projectId) {
    const response = await this.httpRequest(this.compileUrl(projectId), {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({
        rootDoc_id: null,
        draft: false,
        check: 'silent',
        incrementalCompilesEnabled: true,
      }),
      expect: 'json',
    });
    if (!response.ok) {
      throw new Error(`Failed to compile project: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    const data = response.body;
    if (data.status !== 'success') {
      throw new Error(`Compilation failed: ${data.status}`);
    }
    // Match by path 'output.pdf' — Overleaf's CLSI always names the main
    // compile output 'output.pdf'. Matching only on type === 'pdf' can pick up
    // figure PDFs or *-eps-converted-to.pdf intermediates. See #26.
    const pdfFile =
      data.outputFiles?.find((file) => file.path === 'output.pdf') ||
      data.outputFiles?.find((file) => file.type === 'pdf');
    if (!pdfFile) {
      throw new Error('No PDF output found');
    }
    // Overleaf's CDN requires ?clsiserverid=<id> for build-output downloads.
    // Without it the build URL 404s. See: https://github.com/aloth/olcli/issues/22
    const query = data.clsiServerId
      ? `?clsiserverid=${encodeURIComponent(data.clsiServerId)}`
      : '';
    return {
      pdfUrl: `${this.baseUrl}${pdfFile.url}${query}`,
      logs: data.compileGroup ? [`Compile group: ${data.compileGroup}`] : [],
    };
  }

  /**
   * Download compiled PDF
   */
  async downloadPdf(projectId, timeoutMs) {
    const { pdfUrl } = await this.compileProject(projectId);
    return this.downloadBuffer(pdfUrl, timeoutMs);
  }

  /**
   * Create a folder in a project
   */
  async createFolder(projectId, parentFolderId, name) {
    const response = await this.httpRequest(this.folderUrl(projectId), {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({
        parent_folder_id: parentFolderId,
        name,
      }),
      expect: 'json',
    });
    if (response.status === 400) {
      // Folder already exists
      throw new Error('Folder already exists');
    }
    if (!response.ok) {
      throw new Error(`Failed to create folder: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    return response.body._id;
  }

  /**
   * Compute root folder ID from project ID
   * MongoDB ObjectIDs are 24 hex chars. The root folder ID is typically projectId - 1
   */
  computeRootFolderId(projectId) {
    // Parse the last 8 chars as a hex number (the counter portion)
    const prefix = projectId.slice(0, 16);
    const suffix = projectId.slice(16);
    const counter = Number.parseInt(suffix, 16);
    const newCounter = (counter - 1).toString(16).padStart(8, '0');
    return prefix + newCounter;
  }

  /**
   * Decode Socket.IO 0.9 payloads. Frames may be a single packet or \ufffd-length framed packets.
   */
  decodeSocketIoPayload(payload) {
    if (!payload) return [];
    if (!payload.startsWith('\ufffd')) return [payload];
    const packets = [];
    let index = 0;
    while (index < payload.length) {
      if (payload[index] !== '\ufffd') break;
      index += 1;
      let length = '';
      while (index < payload.length && payload[index] !== '\ufffd') {
        length += payload[index];
        index += 1;
      }
      if (index >= payload.length || payload[index] !== '\ufffd') break;
      index += 1;
      const packetLength = Number.parseInt(length, 10);
      if (!Number.isFinite(packetLength) || packetLength < 0) break;
      packets.push(payload.slice(index, index + packetLength));
      index += packetLength;
    }
    return packets;
  }

  encodeSocketIoEvent(id, name, args) {
    return `5:${id}+::${JSON.stringify({ name, args })}`;
  }

  parseSocketIoAck(packet, id) {
    const match = packet.match(/^6:::(\d+)(.*)$/);
    if (!match || Number.parseInt(match[1], 10) !== id) {
      return null;
    }
    let payload = match[2] || '';
    if (payload.startsWith('+')) {
      payload = payload.slice(1);
    }
    if (!payload) return [];
    const args = JSON.parse(payload);
    return Array.isArray(args) ? args : [args];
  }

  decodeOverleafUtf8(text) {
    return decodeOverleafUtf8(text);
  }

  encodeOverleafUtf8(text) {
    return encodeOverleafUtf8(text);
  }

  generateCommentThreadId() {
    const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
    const machine = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    const pid = Math.floor(Math.random() * 0x7fff).toString(16).padStart(4, '0');
    return `${timestamp}${machine}${pid}000001`;
  }

  /**
   * Convert an offset in Overleaf's UTF-8 binary-string document space to an
   * offset in the decoded (human-readable) string.
   */
  encodedOffsetToDecodedOffset(rawContent, encodedOffset) {
    if (
      typeof rawContent !== 'string' ||
      typeof encodedOffset !== 'number' ||
      !Number.isFinite(encodedOffset) ||
      encodedOffset <= 0
    ) {
      return 0;
    }
    const clamped = Math.min(Math.trunc(encodedOffset), rawContent.length);
    return decodeOverleafUtf8(rawContent.slice(0, clamped)).length;
  }

  positionToLineColumn(content, position) {
    const prefix = content.slice(0, position);
    const lines = prefix.split('\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    };
  }

  buildCommentContext(content, line, contextLines = 0) {
    if (contextLines <= 0) return undefined;
    const lines = content.split('\n');
    const lineIndex = line - 1;
    const beforeStart = Math.max(0, lineIndex - contextLines);
    const afterEnd = Math.min(lines.length, lineIndex + contextLines + 1);
    return {
      startLine: beforeStart + 1,
      endLine: afterEnd,
      before: lines.slice(beforeStart, lineIndex),
      line: lines[lineIndex] || '',
      after: lines.slice(lineIndex + 1, afterEnd),
    };
  }

  collectProjectDocs(projectInfo) {
    const docs = [];
    function walk(folder, folderPath) {
      for (const doc of folder.docs || []) {
        docs.push({
          id: doc._id,
          path: folderPath ? `${folderPath}/${doc.name}` : doc.name,
        });
      }
      for (const child of folder.folders || []) {
        const childPath = folderPath ? `${folderPath}/${child.name}` : child.name;
        walk(child, childPath);
      }
    }
    for (const folder of projectInfo.rootFolder || []) {
      walk(folder, '');
    }
    return docs;
  }

  async openProjectSocket(projectId) {
    const handshakeUrl = `${this.baseUrl}/socket.io/1/?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
    const handshakeResponse = await this.httpRequest(handshakeUrl, {
      headers: { Cookie: this.getCookieHeader(), 'User-Agent': USER_AGENT },
      expect: 'text',
      timeoutMs: 5000,
    });
    if (!handshakeResponse.ok) {
      throw new Error(`Failed to open project socket: ${handshakeResponse.status}`);
    }
    this.applySetCookieHeaders(handshakeResponse.headers['set-cookie']);
    const sid = handshakeResponse.body.trim().split(':')[0];
    if (!sid) {
      throw new Error('Failed to open project socket: missing session id');
    }
    const session = {
      sid,
      projectId,
      pollUrl: () =>
        `${this.baseUrl}/socket.io/1/xhr-polling/${sid}?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`,
    };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const packets = await this.pollProjectSocket(session);
      if (
        packets.some((packet) => {
          if (!packet.startsWith('5:::')) return false;
          try {
            return JSON.parse(packet.slice(4))?.name === 'joinProjectResponse';
          } catch {
            return false;
          }
        })
      ) {
        return session;
      }
    }
    throw new Error('Project socket did not return joinProjectResponse');
  }

  async pollProjectSocket(session) {
    let response;
    try {
      response = await this.httpRequest(session.pollUrl(), {
        headers: { Cookie: this.getCookieHeader(), 'User-Agent': USER_AGENT },
        expect: 'text',
        timeoutMs: 7000,
      });
    } catch (error) {
      // A long-poll with nothing to deliver ends in a client-side timeout on
      // this deployment. That is not a socket failure: treat it as "no packets
      // this round" so an ack that arrives on the next poll is still seen.
      if (/timeout/i.test(String(error?.message ?? error))) return [];
      throw error;
    }
    if (!response.ok) {
      throw new Error(`Socket poll failed: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    const packets = this.decodeSocketIoPayload(response.body);
    for (const packet of packets) {
      if (packet.startsWith('2::')) {
        const heartbeatResponse = await this.httpRequest(session.pollUrl(), {
          method: 'POST',
          headers: {
            Cookie: this.getCookieHeader(),
            'User-Agent': USER_AGENT,
            'Content-Type': 'text/plain;charset=UTF-8',
          },
          body: '2::',
          expect: 'text',
          timeoutMs: 5000,
        });
        this.applySetCookieHeaders(heartbeatResponse.headers['set-cookie']);
      }
    }
    return packets;
  }

  async postProjectSocketPacket(session, packet) {
    const response = await this.httpRequest(session.pollUrl(), {
      method: 'POST',
      headers: {
        Cookie: this.getCookieHeader(),
        'User-Agent': USER_AGENT,
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body: packet,
      expect: 'text',
      timeoutMs: 5000,
    });
    if (!response.ok) {
      throw new Error(`Socket post failed: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
  }

  async socketRpc(session, name, args) {
    const id = Math.floor(Math.random() * 0x7fffffff);
    await this.postProjectSocketPacket(session, this.encodeSocketIoEvent(id, name, args));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const packets = await this.pollProjectSocket(session);
      for (const packet of packets) {
        const ackArgs = this.parseSocketIoAck(packet, id);
        if (ackArgs) {
          const [error, ...result] = ackArgs;
          if (error) {
            const message =
              typeof error === 'string' ? error : error.message || JSON.stringify(error);
            throw new Error(`${name} failed: ${message}`);
          }
          return result;
        }
      }
    }
    throw new Error(`${name} did not return an acknowledgement`);
  }

  async closeProjectSocket(session) {
    try {
      await this.postProjectSocketPacket(session, '0::');
    } catch {
      // Best-effort socket cleanup only.
    }
  }

  normalizeJoinedDocument(docId, args) {
    const [lines, version, _updates, ranges, type = 'sharejs-text-ot'] = args;
    // If the server does not label the document type but `lines` is not an
    // array, this is a history-ot document. Never treat it as an empty
    // sharejs doc: writing an insert-only op against an unknown snapshot
    // would duplicate or corrupt content.
    const inferredType =
      type === 'history-ot' || (!Array.isArray(lines) && lines !== null && typeof lines === 'object')
        ? 'history-ot'
        : type;
    if (inferredType === 'history-ot') {
      if (typeof lines?.content !== 'string') {
        throw new Error(
          `joinDoc for ${docId} returned an unsupported history-ot payload; ` +
            'refusing to guess its shape.',
        );
      }
      const content = lines.content;
      return {
        docId,
        lines: content.split('\n'),
        rawContent: content,
        content,
        version,
        ranges: lines,
        type: 'history-ot',
      };
    }
    if (!Array.isArray(lines)) {
      throw new Error(
        `joinDoc for ${docId} returned an unexpected payload (type: ${String(type)}); ` +
          'refusing to treat it as a document.',
      );
    }
    const rawLines = lines.map((line) => String(line));
    const decodedLines = rawLines.map((line) => this.decodeOverleafUtf8(line));
    const decodedRanges = ranges || {};
    for (const comment of decodedRanges.comments || []) {
      if (comment?.op?.c) {
        comment.op.c = this.decodeOverleafUtf8(comment.op.c);
      }
    }
    return {
      docId,
      lines: decodedLines,
      rawContent: rawLines.join('\n'),
      content: decodedLines.join('\n'),
      version,
      ranges: decodedRanges,
      type,
    };
  }

  async joinDocument(session, docId) {
    const args = await this.socketRpc(session, 'joinDoc', [
      docId,
      {
        encodeRanges: true,
        supportsHistoryOT: true,
      },
    ]);
    return this.normalizeJoinedDocument(docId, args);
  }

  /**
   * Extract root folder ID from a Socket.IO event packet (joinProjectResponse).
   */
  extractRootFolderIdFromSocketPacket(packet) {
    if (!packet.startsWith('5:::')) return null;
    try {
      const payload = JSON.parse(packet.slice(4));
      if (payload?.name !== 'joinProjectResponse') return null;
      const rootFolderId = payload?.args?.[0]?.project?.rootFolder?.[0]?._id;
      return typeof rootFolderId === 'string' ? rootFolderId : null;
    } catch {
      return null;
    }
  }

  /**
   * Extract full folder tree from a Socket.IO joinProjectResponse packet.
   * Returns a map of folder path -> folder ID, e.g. { '': rootId, 'figures': figuresId }
   */
  extractFolderTreeFromSocketPacket(packet) {
    if (!packet.startsWith('5:::')) return null;
    try {
      const payload = JSON.parse(packet.slice(4));
      if (payload?.name !== 'joinProjectResponse') return null;
      const rootFolder = payload?.args?.[0]?.project?.rootFolder?.[0];
      if (!rootFolder?._id) return null;
      const folderMap = {};
      function walkFolders(folder, currentPath) {
        folderMap[currentPath] = folder._id;
        for (const sub of folder.folders || []) {
          const subPath = currentPath ? `${currentPath}/${sub.name}` : sub.name;
          walkFolders(sub, subPath);
        }
      }
      walkFolders(rootFolder, '');
      return folderMap;
    } catch {
      return null;
    }
  }

  /**
   * main problem to resolve root folder ID from Overleaf's collaboration join payload
   * authoritative for projects where ObjectID arithmetic does not apply
   */
  async getRootFolderIdFromSocket(projectId) {
    let sid = null;
    try {
      const handshakeUrl = `${this.baseUrl}/socket.io/1/?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
      const handshakeResponse = await this.httpRequest(handshakeUrl, {
        headers: {
          Cookie: this.getCookieHeader(),
          'User-Agent': USER_AGENT,
        },
        expect: 'text',
        timeoutMs: 5000,
      });
      if (!handshakeResponse.ok) return null;
      this.applySetCookieHeaders(handshakeResponse.headers['set-cookie']);
      const handshakeBody = handshakeResponse.body.trim();
      sid = handshakeBody.split(':')[0];
      if (!sid) return null;
      const buildPollUrl = () =>
        `${this.baseUrl}/socket.io/1/xhr-polling/${sid}?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
      let discoveredRootFolderId = null;
      // poll a few frames, first is usually connect ack, next includes joinProjectResponse
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const pollResponse = await this.httpRequest(buildPollUrl(), {
          headers: {
            Cookie: this.getCookieHeader(),
            'User-Agent': USER_AGENT,
          },
          expect: 'text',
          timeoutMs: 5000,
        });
        if (!pollResponse.ok) return null;
        this.applySetCookieHeaders(pollResponse.headers['set-cookie']);
        const packets = this.decodeSocketIoPayload(pollResponse.body);
        for (const packet of packets) {
          const rootFolderId = this.extractRootFolderIdFromSocketPacket(packet);
          if (rootFolderId) {
            discoveredRootFolderId = rootFolderId;
            break;
          }
          if (packet.startsWith('2::')) {
            // reply to heartbeat to keep polling transport alive
            const heartbeatResponse = await this.httpRequest(buildPollUrl(), {
              method: 'POST',
              headers: {
                Cookie: this.getCookieHeader(),
                'User-Agent': USER_AGENT,
                'Content-Type': 'text/plain;charset=UTF-8',
              },
              body: '2::',
              expect: 'text',
              timeoutMs: 5000,
            });
            this.applySetCookieHeaders(heartbeatResponse.headers['set-cookie']);
          }
        }
        if (discoveredRootFolderId) {
          return discoveredRootFolderId;
        }
      }
    } catch {
      // Fall back to non-socket methods.
    } finally {
      if (sid) {
        try {
          const disconnectUrl = `${this.baseUrl}/socket.io/1/xhr-polling/${sid}?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
          const disconnectResponse = await this.httpRequest(disconnectUrl, {
            method: 'POST',
            headers: {
              Cookie: this.getCookieHeader(),
              'User-Agent': USER_AGENT,
              'Content-Type': 'text/plain;charset=UTF-8',
            },
            body: '0::',
            expect: 'text',
            timeoutMs: 5000,
          });
          this.applySetCookieHeaders(disconnectResponse.headers['set-cookie']);
        } catch {
          // Ignore cleanup failures.
        }
      }
    }
    return null;
  }

  /**
   * Get full folder tree for a project via Socket.IO.
   * Returns a map of folder path -> folder ID, e.g. { '': rootId, 'figures': figuresId }
   */
  async getFolderTreeFromSocket(projectId) {
    let sid = null;
    try {
      const handshakeUrl = `${this.baseUrl}/socket.io/1/?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
      const handshakeResponse = await this.httpRequest(handshakeUrl, {
        headers: {
          Cookie: this.getCookieHeader(),
          'User-Agent': USER_AGENT,
        },
        expect: 'text',
        timeoutMs: 5000,
      });
      if (!handshakeResponse.ok) return null;
      this.applySetCookieHeaders(handshakeResponse.headers['set-cookie']);
      const handshakeBody = handshakeResponse.body.trim();
      sid = handshakeBody.split(':')[0];
      if (!sid) return null;
      const buildPollUrl = () =>
        `${this.baseUrl}/socket.io/1/xhr-polling/${sid}?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const pollResponse = await this.httpRequest(buildPollUrl(), {
          headers: {
            Cookie: this.getCookieHeader(),
            'User-Agent': USER_AGENT,
          },
          expect: 'text',
          timeoutMs: 5000,
        });
        if (!pollResponse.ok) return null;
        this.applySetCookieHeaders(pollResponse.headers['set-cookie']);
        const packets = this.decodeSocketIoPayload(pollResponse.body);
        for (const packet of packets) {
          const folderTree = this.extractFolderTreeFromSocketPacket(packet);
          if (folderTree) return folderTree;
          if (packet.startsWith('2::')) {
            const heartbeatResponse = await this.httpRequest(buildPollUrl(), {
              method: 'POST',
              headers: {
                Cookie: this.getCookieHeader(),
                'User-Agent': USER_AGENT,
                'Content-Type': 'text/plain;charset=UTF-8',
              },
              body: '2::',
              expect: 'text',
              timeoutMs: 5000,
            });
            this.applySetCookieHeaders(heartbeatResponse.headers['set-cookie']);
          }
        }
      }
    } catch {
      // Fall back
    } finally {
      if (sid) {
        try {
          const disconnectUrl = `${this.baseUrl}/socket.io/1/xhr-polling/${sid}?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
          await this.httpRequest(disconnectUrl, {
            method: 'POST',
            headers: {
              Cookie: this.getCookieHeader(),
              'User-Agent': USER_AGENT,
              'Content-Type': 'text/plain;charset=UTF-8',
            },
            body: '0::',
            expect: 'text',
            timeoutMs: 5000,
          });
        } catch {
          // Ignore cleanup failures.
        }
      }
    }
    return null;
  }

  /**
   * Resolve a folder path to a folder ID, creating missing folders as needed.
   * folderTree is a map of path -> ID (fetched once per push session).
   * folderPath is e.g. 'figures' or 'a/b/c'.
   */
  async resolveFolderId(projectId, folderTree, folderPath) {
    if (!folderPath || folderPath === '') return folderTree[''];
    if (folderTree[folderPath]) return folderTree[folderPath];
    // Create each missing segment
    const segments = folderPath.split('/');
    let currentPath = '';
    for (const segment of segments) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (folderTree[currentPath]) continue;
      const parentId = folderTree[parentPath];
      if (!parentId) {
        throw new Error(`Cannot resolve parent folder for: ${currentPath}`);
      }
      try {
        const newId = await this.createFolder(projectId, parentId, segment);
        folderTree[currentPath] = newId;
      } catch (error) {
        if (error.message === 'Folder already exists') {
          // Folder exists but we don't have its ID - re-fetch tree
          const freshTree = await this.getFolderTreeFromSocket(projectId);
          if (freshTree?.[currentPath]) {
            folderTree[currentPath] = freshTree[currentPath];
          } else {
            throw new Error(`Folder '${currentPath}' exists but could not resolve its ID`);
          }
        } else {
          throw error;
        }
      }
    }
    return folderTree[folderPath];
  }

  /**
   * Get root folder ID for a project (tries multiple methods)
   */
  async getRootFolderId(projectId) {
    // Method 1: Try to get from project page meta tags
    try {
      const projectInfo = await this.getProjectInfo(projectId);
      if (projectInfo.rootFolder?.[0]?._id) {
        return projectInfo.rootFolder[0]._id;
      }
    } catch {
      // Fall through to computed method
    }
    // Method 2: Ask collaboration socket (authoritative project tree)
    const socketRootFolderId = await this.getRootFolderIdFromSocket(projectId);
    if (socketRootFolderId) {
      return socketRootFolderId;
    }
    // Method 3: Compute from project ID (projectId - 1)
    return this.computeRootFolderId(projectId);
  }

  /**
   * Find root folder ID by probing multiple candidates
   * This handles cases where projectId - 1 doesn't work
   */
  async probeRootFolderId(projectId) {
    const candidates = [];
    // Method 1: Try projectId - 1 (most common)
    candidates.push(this.computeRootFolderId(projectId));
    const prefix = projectId.slice(0, 16);
    const suffix = Number.parseInt(projectId.slice(16), 16);
    // Method 2: Try a wide range around the project ID
    // Some projects have root folder created with different offsets
    for (let index = 2; index <= 50; index += 1) {
      if (suffix - index >= 0) {
        candidates.push(prefix + (suffix - index).toString(16).padStart(8, '0'));
      }
    }
    for (let index = 1; index <= 50; index += 1) {
      candidates.push(prefix + (suffix + index).toString(16).padStart(8, '0'));
    }
    // Test each candidate with a minimal probe request
    for (const folderId of candidates) {
      try {
        // Try to create a temp file to probe the folder
        const testFileName = `.dsh-ustc-latex-agent-probe-${Date.now()}.tmp`;
        const formData = new FormData();
        formData.append('targetFolderId', folderId);
        formData.append('name', testFileName);
        formData.append('type', 'text/plain');
        formData.append('qqfile', new Blob(['probe']), testFileName);
        const response = await this.httpRequest(
          `${this.uploadUrl(projectId)}?folder_id=${folderId}`,
          {
            method: 'POST',
            headers: {
              Cookie: this.getCookieHeader(),
              'User-Agent': USER_AGENT,
              'X-Csrf-Token': this.csrf,
            },
            body: formData,
            expect: 'json',
          },
        );
        if (!response.ok) {
          continue;
        }
        this.applySetCookieHeaders(response.headers['set-cookie']);
        const data = response.body;
        if (data.success !== false && data.entity_id) {
          // Success! Delete the probe file and return this folder ID
          try {
            await this.deleteEntity(projectId, data.entity_id, 'doc');
          } catch {
            // Ignore delete errors for probe file
          }
          return folderId;
        }
      } catch {
        // Continue to next candidate
      }
    }
    return null;
  }

  /**
   * Upload a file to a project.
   * If folderTree is provided and fileName contains a path (e.g. 'figures/img.png'),
   * the file will be uploaded into the correct subfolder, creating it if needed.
   */
  async uploadFile(projectId, folderId, fileName, content, folderTree) {
    // Extract just the filename without path
    const baseName = fileName.split('/').pop() || fileName;
    // Resolve target folder: if fileName has a directory part, place the file there.
    // Lazy-load + cache the folder tree when caller didn't supply one, so external
    // callers (and our own `upload`/`sync` paths) don't silently dump files into root.
    // See: https://github.com/aloth/olcli/issues/22 follow-up + 0.3.1 upload-fix.
    const dirPart = fileName.includes('/') ? fileName.split('/').slice(0, -1).join('/') : '';
    let targetFolderId;
    if (dirPart) {
      const tree = folderTree || (await this.getOrLoadFolderTree(projectId));
      targetFolderId = await this.resolveFolderId(projectId, tree, dirPart);
    } else {
      targetFolderId = folderId || (await this.getRootFolderId(projectId));
    }
    // Determine MIME type
    const extension = baseName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes = {
      tex: 'text/x-tex',
      bib: 'text/x-bibtex',
      cls: 'text/x-tex',
      sty: 'text/x-tex',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      pdf: 'application/pdf',
      svg: 'image/svg+xml',
      eps: 'application/postscript',
    };
    const mimeType = mimeTypes[extension] || 'application/octet-stream';
    // Helper function to attempt upload with a specific folder ID
    const tryUpload = async (fid) => {
      const formData = new FormData();
      formData.append('targetFolderId', fid);
      formData.append('name', baseName);
      formData.append('type', mimeType);
      formData.append('qqfile', new Blob([content]), baseName);
      const response = await this.httpRequest(
        `${this.uploadUrl(projectId)}?folder_id=${encodeURIComponent(fid)}`,
        {
          method: 'POST',
          headers: {
            Cookie: this.getCookieHeader(),
            'User-Agent': USER_AGENT,
            'X-Csrf-Token': this.csrf,
          },
          body: formData,
          expect: 'text',
        },
      );
      if (!response.ok) {
        const text = response.body;
        // Overleaf returns folder_not_found as HTTP 422 JSON.
        // Parse the body first so caller can trigger folder probing fallback.
        try {
          const data = JSON.parse(text);
          if (data?.error === 'folder_not_found') {
            return { success: false, error: 'folder_not_found' };
          }
        } catch {
          // Ignore non-JSON responses and return generic HTTP error below.
        }
        return { success: false, error: `${response.status} - ${text}` };
      }
      this.applySetCookieHeaders(response.headers['set-cookie']);
      const data = JSON.parse(response.body);
      if (data.success === false && data.error === 'folder_not_found') {
        return { success: false, error: 'folder_not_found' };
      }
      return {
        success: data.success !== false,
        entityId: data.entity_id,
        entityType: data.entity_type,
      };
    };
    // First attempt with computed/cached folder ID
    let result = await tryUpload(targetFolderId);
    // If cached folder ID is stale, re-resolve root folder ID and retry once.
    if (!result.success && result.error === 'folder_not_found') {
      const refreshedRootFolderId = await this.getRootFolderId(projectId);
      if (refreshedRootFolderId !== targetFolderId) {
        targetFolderId = refreshedRootFolderId;
        result = await tryUpload(targetFolderId);
      }
    }
    // If folder is still unresolved, probe for a valid root folder ID
    if (!result.success && result.error === 'folder_not_found') {
      const probedFolderId = await this.probeRootFolderId(projectId);
      if (probedFolderId && probedFolderId !== targetFolderId) {
        targetFolderId = probedFolderId;
        result = await tryUpload(targetFolderId);
      }
    }
    if (!result.success) {
      throw new Error(`Failed to upload file: ${result.error || 'unknown error'}`);
    }
    return {
      success: result.success,
      entityId: result.entityId,
      entityType: result.entityType,
    };
  }

  /**
   * Delete a file or folder
   */
  async deleteEntity(projectId, entityId, entityType) {
    const url = this.deleteUrl(projectId, entityType, entityId);
    const response = await this.httpRequest(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      expect: 'text',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete entity: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
  }

  /**
   * Get list of entities (files/docs) with paths
   */
  async getEntities(projectId) {
    const response = await this.httpRequest(`${this.baseUrl}/project/${projectId}/entities`, {
      headers: this.getHeaders(),
      expect: 'json',
    });
    if (!response.ok) {
      throw new Error(`Failed to get entities: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    return response.body.entities || [];
  }

  /**
   * Find entity ID by path (searches through project file tree)
   */
  async findEntityByPath(projectId, targetPath) {
    const projectInfo = await this.getProjectInfo(projectId);
    const normalizedTarget = targetPath.replace(/^\//, '');
    function searchFolder(folder, currentPath) {
      // Check docs
      for (const doc of folder.docs || []) {
        const docPath = currentPath ? `${currentPath}/${doc.name}` : doc.name;
        if (docPath === normalizedTarget || doc.name === normalizedTarget) {
          return { id: doc._id, type: 'doc', name: doc.name };
        }
      }
      // Check files
      for (const file of folder.fileRefs || []) {
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        if (filePath === normalizedTarget || file.name === normalizedTarget) {
          return { id: file._id, type: 'file', name: file.name };
        }
      }
      // Check subfolders
      for (const subfolder of folder.folders || []) {
        const folderPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name;
        if (folderPath === normalizedTarget || subfolder.name === normalizedTarget) {
          return { id: subfolder._id, type: 'folder', name: subfolder.name };
        }
        const found = searchFolder(subfolder, folderPath);
        if (found) return found;
      }
      return null;
    }
    if (projectInfo.rootFolder?.[0]) {
      return searchFolder(projectInfo.rootFolder[0], '');
    }
    return null;
  }

  /**
   * Download a single file by ID
   */
  async downloadFile(projectId, fileId, fileType) {
    const endpoint = fileType === 'doc' ? 'doc' : 'file';
    const response = await this.httpRequest(
      `${this.baseUrl}/project/${projectId}/${endpoint}/${fileId}`,
      {
        headers: this.getHeaders(),
        expect: fileType === 'doc' ? 'json' : 'buffer',
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    if (fileType === 'doc') {
      // Docs return JSON with lines array
      const data = response.body;
      const content = (data.lines || []).join('\n');
      return Buffer.from(content, 'utf-8');
    }
    return response.body;
  }

  /**
   * Rename a file, doc, or folder
   */
  async renameEntity(projectId, entityId, entityType, newName) {
    const response = await this.httpRequest(
      `${this.baseUrl}/project/${projectId}/${entityType}/${entityId}/rename`,
      {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify({ name: newName }),
        expect: 'text',
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to rename entity: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
  }

  /**
   * Delete a file by path
   */
  async deleteByPath(projectId, path) {
    const entity = await this.findEntityByPath(projectId, path);
    if (!entity) {
      throw new Error(`File not found: ${path}`);
    }
    await this.deleteEntity(projectId, entity.id, entity.type);
  }

  /**
   * Rename a file by path
   */
  async renameByPath(projectId, oldPath, newName) {
    const entity = await this.findEntityByPath(projectId, oldPath);
    if (!entity) {
      throw new Error(`File not found: ${oldPath}`);
    }
    await this.renameEntity(projectId, entity.id, entity.type, newName);
  }

  /**
   * Download a file by path (uses zip as fallback if ID not available).
   *
   * The zip fallback uses the built-in node:zlib reader instead of olcli's
   * `adm-zip` dependency, keeping this module zero-dependency.
   */
  async downloadByPath(projectId, path) {
    const normalizedPath = path.replace(/^\//, '');
    // First check if file exists
    const entities = await this.getEntities(projectId);
    const entityExists = entities.find(
      (entity) =>
        entity.path.replace(/^\//, '') === normalizedPath ||
        entity.path === `/${normalizedPath}`,
    );
    if (!entityExists) {
      throw new Error(`File not found: ${path}`);
    }
    // Try to find entity with ID for direct download
    try {
      const entity = await this.findEntityByPath(projectId, path);
      if (entity && entity.type !== 'folder') {
        return await this.downloadFile(projectId, entity.id, entity.type);
      }
    } catch {
      // Fall through to zip method
    }
    // Fallback: download zip and extract the file
    const zipBuffer = await this.downloadProject(projectId);
    return extractZipEntry(zipBuffer, normalizedPath);
  }

  async getCommentThreads(projectId) {
    const response = await this.httpRequest(`${this.baseUrl}/project/${projectId}/threads`, {
      headers: this.getHeaders(),
      expect: 'json',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch comment threads: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    return response.body;
  }

  async listComments(projectId, options = {}) {
    const status = options.status || 'all';
    const contextLines = options.contextLines || 0;
    const projectInfo = await this.getProjectInfo(projectId);
    const docs = this.collectProjectDocs(projectInfo);
    const threads = await this.getCommentThreads(projectId);
    const comments = [];
    const session = await this.openProjectSocket(projectId);
    try {
      for (const doc of docs) {
        const joinedDoc = await this.joinDocument(session, doc.id);
        if (joinedDoc.type === 'history-ot') {
          for (const comment of joinedDoc.ranges.comments || []) {
            const ranges = comment.ranges || [];
            const firstRange = ranges[0];
            if (!firstRange) continue;
            const selectedText = ranges
              .map((range) => joinedDoc.content.slice(range.pos, range.pos + range.length))
              .join('');
            const location = this.positionToLineColumn(joinedDoc.content, firstRange.pos);
            const thread = threads[comment.id] || { messages: [] };
            const resolved = Boolean(comment.resolved || thread.resolved);
            comments.push({
              threadId: comment.id,
              docId: doc.id,
              path: doc.path,
              position: firstRange.pos,
              line: location.line,
              column: location.column,
              selectedText,
              resolved,
              messages: thread.messages || [],
              context: this.buildCommentContext(joinedDoc.content, location.line, contextLines),
            });
          }
          continue;
        }
        for (const comment of joinedDoc.ranges.comments || []) {
          const op = comment.op || {};
          const threadId = op.t || comment.id;
          if (!threadId || typeof op.p !== 'number') continue;
          // Comment anchors store positions in the server's binary-string
          // space; convert them once for the decoded content we expose.
          const decodedPosition = this.encodedOffsetToDecodedOffset(joinedDoc.rawContent, op.p);
          const selectedText =
            typeof op.c === 'string'
              ? op.c
              : joinedDoc.content.slice(decodedPosition, decodedPosition + (op.c?.length || 0));
          const location = this.positionToLineColumn(joinedDoc.content, decodedPosition);
          const thread = threads[threadId] || { messages: [] };
          const resolved = Boolean(comment.resolved || op.resolved || thread.resolved);
          comments.push({
            threadId,
            docId: doc.id,
            path: doc.path,
            position: decodedPosition,
            line: location.line,
            column: location.column,
            selectedText,
            resolved,
            messages: thread.messages || [],
            context: this.buildCommentContext(joinedDoc.content, location.line, contextLines),
          });
        }
      }
    } finally {
      await this.closeProjectSocket(session);
    }
    return comments
      .filter((comment) => {
        if (status === 'all') return true;
        return status === 'resolved' ? comment.resolved : !comment.resolved;
      })
      .sort((a, b) => a.path.localeCompare(b.path) || a.position - b.position);
  }

  async resolveComment(projectId, threadId) {
    const comment = await this.findComment(projectId, threadId);
    const response = await this.httpRequest(
      `${this.baseUrl}/project/${projectId}/doc/${comment.docId}/thread/${threadId}/resolve`,
      {
        method: 'POST',
        headers: this.getHeaders(true),
        body: '',
        expect: 'text',
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to resolve comment: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    return comment;
  }

  async reopenComment(projectId, threadId) {
    const comment = await this.findComment(projectId, threadId);
    const response = await this.httpRequest(
      `${this.baseUrl}/project/${projectId}/doc/${comment.docId}/thread/${threadId}/reopen`,
      {
        method: 'POST',
        headers: this.getHeaders(true),
        body: '',
        expect: 'text',
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to reopen comment: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    return comment;
  }

  async deleteComment(projectId, threadId) {
    const comment = await this.findComment(projectId, threadId);
    const response = await this.httpRequest(
      `${this.baseUrl}/project/${projectId}/doc/${comment.docId}/thread/${threadId}`,
      {
        method: 'DELETE',
        headers: this.getHeaders(true),
        body: '',
        expect: 'text',
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to delete comment: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    return comment;
  }

  async findComment(projectId, threadId) {
    const comments = await this.listComments(projectId);
    const comment = comments.find((item) => item.threadId === threadId);
    if (!comment) {
      throw new Error(`Comment thread not found: ${threadId}`);
    }
    return comment;
  }

  resolveCommentSelection(doc, options) {
    if (options.selectedText) {
      const occurrence = options.occurrence || 1;
      let fromIndex = 0;
      let position = -1;
      for (let index = 0; index < occurrence; index += 1) {
        position = doc.content.indexOf(options.selectedText, fromIndex);
        if (position === -1) break;
        fromIndex = position + options.selectedText.length;
      }
      if (position === -1) {
        throw new Error(`Selected text not found in ${options.filePath}`);
      }
      return { position, selectedText: options.selectedText };
    }
    let position = options.position;
    if (position == null) {
      if (options.line == null || options.column == null) {
        throw new Error(
          'Add comment requires either --text, --position, or both --line and --column',
        );
      }
      const lines = doc.content.split('\n');
      if (options.line < 1 || options.line > lines.length) {
        throw new Error(`Line out of range: ${options.line}`);
      }
      if (options.column < 1 || options.column > lines[options.line - 1].length + 1) {
        throw new Error(`Column out of range: ${options.column}`);
      }
      position =
        lines
          .slice(0, options.line - 1)
          .reduce((sum, line) => sum + line.length + 1, 0) +
        options.column -
        1;
    }
    const length = options.length || 1;
    if (position < 0 || position + length > doc.content.length) {
      throw new Error('Comment selection is outside the document');
    }
    return {
      position,
      selectedText: doc.content.slice(position, position + length),
    };
  }

  async addComment(projectId, options) {
    const projectInfo = await this.getProjectInfo(projectId);
    const docs = this.collectProjectDocs(projectInfo);
    const normalizedPath = options.filePath.replace(/^\//, '');
    const doc = docs.find(
      (item) => item.path === normalizedPath || item.path.replace(/^\//, '') === normalizedPath,
    );
    if (!doc) {
      throw new Error(`Doc not found: ${options.filePath}`);
    }
    const session = await this.openProjectSocket(projectId);
    try {
      const joinedDoc = await this.joinDocument(session, doc.id);
      const selection = this.resolveCommentSelection(joinedDoc, options);
      const threadId = this.generateCommentThreadId();
      await this.postCommentMessage(projectId, threadId, options.content);
      const op =
        joinedDoc.type === 'history-ot'
          ? {
              commentId: threadId,
              ranges: [{ pos: selection.position, length: selection.selectedText.length }],
            }
          : {
              // Live-verified: op text and positions are decoded Unicode on
              // this deployment (see buildReplaceOp).
              c: selection.selectedText,
              p: selection.position,
              t: threadId,
            };
      await this.socketRpc(session, 'applyOtUpdate', [
        doc.id,
        {
          doc: doc.id,
          op: [op],
          v: joinedDoc.version,
        },
      ]);
      const location = this.positionToLineColumn(joinedDoc.content, selection.position);
      return {
        threadId,
        docId: doc.id,
        path: doc.path,
        position: selection.position,
        line: location.line,
        column: location.column,
        selectedText: selection.selectedText,
        resolved: false,
        messages: [],
      };
    } finally {
      await this.closeProjectSocket(session);
    }
  }

  async postCommentMessage(projectId, threadId, content) {
    const response = await this.httpRequest(
      `${this.baseUrl}/project/${projectId}/thread/${threadId}/messages`,
      {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify({ content }),
        expect: 'text',
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to post comment message: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    if (!response.body) return null;
    try {
      return JSON.parse(response.body);
    } catch {
      return null;
    }
  }

  /**
   * Compile project and get all output files
   */
  async compileWithOutputs(projectId) {
    const response = await this.httpRequest(this.compileUrl(projectId), {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({
        rootDoc_id: null,
        draft: false,
        check: 'silent',
        incrementalCompilesEnabled: true,
      }),
      expect: 'json',
    });
    if (!response.ok) {
      throw new Error(`Failed to compile project: ${response.status}`);
    }
    this.applySetCookieHeaders(response.headers['set-cookie']);
    const data = response.body;
    // Prefer 'output.pdf' (the main compile output) over any other PDF.
    // See #26 — projects with figure PDFs could return the wrong file.
    const pdfFile =
      data.outputFiles?.find((file) => file.path === 'output.pdf') ||
      data.outputFiles?.find((file) => file.type === 'pdf');
    // Overleaf's CDN requires ?clsiserverid=<id> for build-output downloads.
    // Without it every output (pdf/log/bbl/...) 404s. See issue #22.
    const query = data.clsiServerId
      ? `?clsiserverid=${encodeURIComponent(data.clsiServerId)}`
      : '';
    return {
      status: data.status,
      pdfUrl: pdfFile ? `${this.baseUrl}${pdfFile.url}${query}` : undefined,
      outputFiles: (data.outputFiles || []).map((file) => ({
        path: file.path,
        type: file.type,
        url: `${this.baseUrl}${file.url}${query}`,
      })),
    };
  }

  /**
   * Download a compile output file (logs, bbl, aux, etc.)
   */
  async downloadOutputFile(url, timeoutMs) {
    return this.downloadBuffer(url, timeoutMs);
  }

  /* ----------------------------------------------------------------------- */
  /* High-level document API (dsh-ustc-latex-agent addition)                       */
  /* ----------------------------------------------------------------------- */

  /** Run `fn` with a freshly opened project collaboration socket. */
  async withProjectSocket(projectId, fn) {
    const session = await this.openProjectSocket(projectId);
    try {
      return await fn(session);
    } finally {
      await this.closeProjectSocket(session);
    }
  }

  /**
   * Read one document via the collaboration socket.
   *
   * @returns {Promise<{text: string, version: number, docId: string, type: string}>}
   */
  async readDoc(projectId, docId) {
    if (!docId) throw new TypeError('readDoc: docId is required');
    return this.withProjectSocket(projectId, async (session) => {
      const joined = await this.joinDocument(session, docId);
      if (!Number.isFinite(joined.version)) {
        throw new Error(`joinDoc for ${docId} did not return a version`);
      }
      return {
        text: joined.content,
        version: joined.version,
        docId,
        type: joined.type,
      };
    });
  }

  /**
   * Replace the whole contents of a document with `text` through a live OT
   * update. No-op when the document already matches.
   *
   * @returns {Promise<{ok: true, version: number}>}
   */
  async setDocumentText(projectId, docId, text) {
    if (typeof text !== 'string') {
      throw new TypeError('setDocumentText: text must be a string');
    }
    const result = await this.applyTextEdit(projectId, docId, () => ({
      nextText: text,
      replacements: 0,
    }));
    return { ok: true, version: result.version };
  }

  /**
   * Replace `find` with `replace` in one document through a live OT update.
   * Throws when `find` is empty, not found, or ambiguous without `all`.
   *
   * @returns {Promise<{ok: true, version: number, replacements: number}>}
   */
  async replaceText(projectId, docId, find, replace, all = false) {
    if (typeof find !== 'string' || find.length === 0) {
      throw new Error('replaceText: find must be a non-empty string');
    }
    if (typeof replace !== 'string') {
      throw new Error('replaceText: replace must be a string');
    }
    const result = await this.applyTextEdit(projectId, docId, (currentText) => {
      let count = 0;
      let fromIndex = 0;
      let firstIndex = -1;
      while (true) {
        const index = currentText.indexOf(find, fromIndex);
        if (index === -1) break;
        if (firstIndex === -1) firstIndex = index;
        count += 1;
        fromIndex = index + find.length;
      }
      if (count === 0) {
        throw new Error(
          `replaceText: find text not found in doc ${docId}: ${JSON.stringify(previewText(find))}`,
        );
      }
      if (!all && count > 1) {
        throw new Error(
          `replaceText: find text occurs ${count} times in doc ${docId}; ` +
            'pass all=true to replace every occurrence',
        );
      }
      const nextText = all
        ? currentText.split(find).join(replace)
        : currentText.slice(0, firstIndex) +
          replace +
          currentText.slice(firstIndex + find.length);
      return { nextText, replacements: all ? count : 1 };
    });
    return { ok: true, version: result.version, replacements: result.replacements };
  }

  /**
   * Shared write pipeline: join the freshest version, build + validate a
   * single-span replace op, send `applyOtUpdate`, and retry on version/stale
   * errors (up to 2 retries) by closing the socket and re-joining.
   */
  async applyTextEdit(projectId, docId, plan) {
    if (!projectId) throw new TypeError('applyTextEdit: projectId is required');
    if (!docId) throw new TypeError('applyTextEdit: docId is required');
    const maxRetries = 2;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const session = await this.openProjectSocket(projectId);
      try {
        const joined = await this.joinDocument(session, docId);
        if (joined.type === 'history-ot') {
          throw new Error(
            `Doc ${docId} uses Overleaf document type 'history-ot'. ` +
              'dsh-ustc-latex-agent only writes sharejs-text-ot documents and will not ' +
              'guess a history-ot op shape.',
          );
        }
        if (!Number.isFinite(joined.version)) {
          throw new Error(`joinDoc for ${docId} did not return a numeric version`);
        }

        const decision = plan(joined.content);
        const replacements = decision.replacements || 0;
        if (decision.nextText === joined.content) {
          return { ok: true, version: joined.version, replacements };
        }

        const op = buildReplaceOp(joined.content, decision.nextText);
        if (op.length === 0) {
          return { ok: true, version: joined.version, replacements };
        }

        // Defense in depth: never send an op that would not reproduce the
        // intended text locally.
        const applied = applyShareJsTextOp(joined.content, op);
        if (applied !== decision.nextText) {
          throw new Error(
            'Internal error: built OT op does not reproduce the target document text; refusing to send.',
          );
        }

        try {
          const ack = await this.socketRpc(session, 'applyOtUpdate', [
            docId,
            { doc: docId, op, v: joined.version },
          ]);
          return {
            ok: true,
            version: OverleafClient.versionFromApplyAck(ack, joined.version),
            replacements,
          };
        } catch (error) {
          lastError = error;
          // The document-updater sometimes applies the op but the ack is lost
          // or delayed past the poll window (this deployment long-polls and can
          // time out first). Confirm against a fresh join before deciding.
          let confirmed;
          try {
            confirmed = await this.readDoc(projectId, docId);
          } catch {
            confirmed = undefined;
          }
          if (confirmed !== undefined && confirmed.text === decision.nextText) {
            return { ok: true, version: confirmed.version, replacements };
          }
          if (attempt < maxRetries && confirmed !== undefined && confirmed.text === joined.content) {
            this.logVerbose(
              `applyOtUpdate retry ${attempt + 1}/${maxRetries} for ${docId}:`,
              error.message,
            );
            // Nothing landed; close the socket in `finally`, reopen and retry.
            continue;
          }
          throw editError(docId, attempt + 1, error);
        }
      } finally {
        await this.closeProjectSocket(session);
      }
    }
    throw editError(docId, maxRetries + 1, lastError);
  }

  /**
   * The socket joinDoc payload is decoded for humans, but Overleaf stores
   * UTF-8 bytes as a binary string. Refuse to write unless re-encoding the
   * decoded content reproduces the raw joined content byte for byte. This
   * turns a wrong encoding assumption into a clear error instead of a
   * corrupted document.
   */
  assertBinaryRoundTrip(joined) {
    if (encodeOverleafUtf8(joined.content) !== joined.rawContent) {
      throw new Error(
        `Refusing to edit doc ${joined.docId}: its content does not round-trip ` +
          "through Overleaf's UTF-8 binary-string encoding (the server may store " +
          'plain Unicode instead). No update was sent.',
      );
    }
  }

  /**
   * The ShareJS model acks `applyOtUpdate` with the version the op was
   * applied at; the document version afterwards is that value + 1. Older
   * controllers may ack with no args, in which case we optimistically report
   * `baseVersion + 1`.
   */
  static versionFromApplyAck(ackArgs, baseVersion) {
    const values = Array.isArray(ackArgs) ? ackArgs : [ackArgs];
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value + 1;
      }
      if (value && typeof value === 'object') {
        if (typeof value.version === 'number' && Number.isFinite(value.version)) {
          return value.version;
        }
        if (typeof value.v === 'number' && Number.isFinite(value.v)) {
          return value.v + 1;
        }
      }
    }
    return baseVersion + 1;
  }
}

const previewText = (text) => (text.length > 80 ? `${text.slice(0, 77)}...` : text);

const VERSION_CONFLICT_PATTERN =
  /(?:version|op too old|future version|delete component|deleted text|does not match|conflict|stale|hash)/i;

const isVersionConflictError = (error) => {
  const message = String(error?.message || error || '');
  return VERSION_CONFLICT_PATTERN.test(message);
};

const editError = (docId, attempts, cause) => {
  const causeMessage = cause?.message || String(cause);
  const error = new Error(
    `Failed to apply OT update to doc ${docId} after ${attempts} attempt(s): ${causeMessage}`,
  );
  error.name = 'OverleafEditError';
  error.code = 'OT_APPLY_FAILED';
  error.cause = cause;
  return error;
};

export default OverleafClient;
