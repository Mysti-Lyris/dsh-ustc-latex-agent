// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 dsh-ustc-latex-agent contributors

/**
 * USTC Overleaf link-sharing support.
 *
 * A shared link looks like `https://latex.ustc.edu.cn/exampleShareToken0000`
 * (a token-access route, not a project id). Opening it with a logged-in session
 * renders a "join project" page whose POST target is advertised in the
 * `ol-postUrl` meta tag. Posting the session CSRF token there answers
 * `{ "redirect": "/project/<projectId>", "higherAccess": true }`.
 *
 * This module performs that exchange with the saved session cookie so the Agent
 * can open exactly the link the user pasted.
 */
import http from 'node:http';
import https from 'node:https';

const TIMEOUT_MS = 20_000;

/** A 24-hex string is a real Overleaf/Mongo project id. */
export function isProjectId(value) {
    return /^[0-9a-f]{24}$/i.test(String(value ?? ''));
}

/** Anything else in the id position is treated as a link-sharing token. */
export function looksLikeShareToken(value) {
    const text = String(value ?? '');
    return !isProjectId(text) && /^[0-9a-zA-Z_-]{8,80}$/.test(text);
}

function request(url, { method = 'GET', cookie, headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === 'http:' ? http : https;
        const outgoing = transport.request(target, {
            method,
            headers: {
                cookie,
                'user-agent': 'dsh-ustc-latex-agent/0.1.0',
                ...headers,
            },
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        outgoing.setTimeout(TIMEOUT_MS, () => outgoing.destroy(new Error('Overleaf request timed out')));
        outgoing.on('error', reject);
        if (body !== undefined)
            outgoing.write(body);
        outgoing.end();
    });
}

function metaContent(html, name) {
    const pattern = new RegExp(`<meta name="${name}"[^>]*content="([^"]*)"`, 'i');
    const match = html.match(pattern);
    if (match === null)
        return null;
    return match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'");
}

function projectIdFromLocation(location) {
    if (typeof location !== 'string' || location === '')
        return null;
    const match = location.match(/\/project\/([0-9a-f]{24})/i) ?? location.match(/^\/([0-9a-f]{24})$/i);
    return match === null ? null : match[1];
}

/**
 * Exchange a link-sharing token for the real project id.
 *
 * @param {{baseUrl: string, cookie: string, token: string}} input
 * @returns {Promise<{projectId: string, redirect: string}>}
 */
export async function resolveShareToken({ baseUrl, cookie, token }) {
    const origin = String(baseUrl ?? '').replace(/\/+$/, '');
    const link = `${origin}/${encodeURIComponent(token)}`;
    const page = await request(link, { cookie });
    const redirected = projectIdFromLocation(page.headers.location);
    if (redirected !== null)
        return { projectId: redirected, redirect: page.headers.location };
    if (page.status !== 200)
        throw new Error(`The shared link returned HTTP ${page.status}. It may have been revoked.`);
    if (metaContent(page.body, 'ol-user_id') === null) {
        throw new Error('The shared link page is not signed in. Reconnect the Overleaf session first.');
    }
    const csrf = metaContent(page.body, 'ol-csrfToken');
    if (csrf === null)
        throw new Error('The shared link page did not expose a CSRF token.');
    const postUrl = metaContent(page.body, 'ol-postUrl') ?? `/${encodeURIComponent(token)}/grant`;
    const grant = await request(postUrl.startsWith('http') ? postUrl : `${origin}${postUrl}`, {
        method: 'POST',
        cookie,
        headers: {
            'x-csrf-token': csrf,
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
        },
        body: `_csrf=${encodeURIComponent(csrf)}`,
    });
    let payload;
    try {
        payload = JSON.parse(grant.body);
    }
    catch {
        throw new Error(`Joining the shared project failed (HTTP ${grant.status}).`);
    }
    const target = projectIdFromLocation(payload?.redirect);
    if (target === null) {
        throw new Error(`Joining the shared project did not return a project id (HTTP ${grant.status}).`);
    }
    if (payload?.higherAccess === false) {
        throw new Error('The shared link grants only view access, so editing is not possible.');
    }
    return { projectId: target, redirect: String(payload.redirect) };
}
