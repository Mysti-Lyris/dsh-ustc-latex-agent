// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 dsh-ustc-latex-agent contributors
// Offline smoke test for client.js: stubs the Web module loader, React, fetch and a
// Cordis-like ctx, then checks the registrations and renders every panel state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const clientPath = path.join(root, 'client.js');
const source = fs.readFileSync(clientPath, 'utf8');

// ---------------------------------------------------------------------------
// Minimal document stub (stylesheet injection path only)
// ---------------------------------------------------------------------------
const head = {
  children: [],
  appendChild(element) {
    element.parentNode = head;
    head.children.push(element);
  },
  removeChild(element) {
    const index = head.children.indexOf(element);
    if (index >= 0) head.children.splice(index, 1);
    element.parentNode = null;
  },
};
globalThis.document = {
  head,
  visibilityState: 'visible',
  createElement(tag) {
    return {
      tagName: tag,
      textContent: '',
      attrs: {},
      parentNode: null,
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
    };
  },
  querySelector() {
    const hit = head.children.find((element) => element.attrs && element.attrs['data-dsh-ustc-latex-agent'] === 'styles');
    return hit || null;
  },
  addEventListener() {},
  removeEventListener() {},
};

// ---------------------------------------------------------------------------
// Module loader + React stubs
// ---------------------------------------------------------------------------
let definition = null;
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      definition = def;
    },
  },
};

let scripted = [];
let effectCalls = 0;
let setters = [];

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const next = props ? Object.assign({}, props) : {};
    if (children.length === 1) next.children = children[0];
    else if (children.length > 1) next.children = children;
    return { type, props: next };
  },
  useState(initial) {
    const index = setters.length;
    setters.push([]);
    const setter = (next) => {
      setters[index].push(next);
    };
    if (scripted.length > 0) return [scripted.shift(), setter];
    return [typeof initial === 'function' ? initial() : initial, setter];
  },
  useEffect() {
    effectCalls += 1;
  },
  useRef(value) {
    return { current: value };
  },
  useMemo(factory) {
    return factory();
  },
  useCallback(fn) {
    return fn;
  },
};

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------
const requests = [];
const PROJECT = { id: 'abc123', name: 'Thesis', rootDocId: 'root', url: 'https://latex.ustc.edu.cn/abc123' };
const TREE = [
  { path: 'chapters/intro.tex', type: 'doc', id: 'doc-intro', name: 'intro.tex' },
  { path: 'main.tex', type: 'doc', id: 'doc-main', name: 'main.tex' },
  { path: 'figures/plot.png', type: 'file', id: 'file-plot', name: 'plot.png' },
];

function bodyFor(url) {
  if (/\/status$/.test(url)) {
    return {
      connected: true,
      baseUrl: 'https://latex.ustc.edu.cn',
      project: PROJECT,
      user: { name: 'Li Ming', email: 'li@example.com' },
    };
  }
  if (/\/projects$/.test(url)) {
    return { projects: [{ id: 'p1', name: 'Paper', lastUpdated: 1762300000000, lastUpdatedBy: 'A. Author' }] };
  }
  if (/\/tree$/.test(url)) return { project: PROJECT, tree: TREE };
  if (/\/comments$/.test(url)) {
    return {
      threads: [
        {
          threadId: 't1',
          path: 'main.tex',
          line: 3,
          selectedText: 'a wrong claim',
          resolved: false,
          messages: [{ id: 'm1', content: 'Please soften this.', user: 'Reviewer' }],
        },
      ],
    };
  }
  if (/\/events\?since=/.test(url)) {
    return { cursor: 7, events: [{ at: 1762300000000, kind: 'edit', path: 'main.tex', summary: 'Edited main.tex' }] };
  }
  if (/\/compile$/.test(url)) return { status: 'success', pdfUrl: '/build/out.pdf', log: 'Output written on main.pdf' };
  if (/\/auth$/.test(url)) return { connected: true, user: { name: 'Li Ming' } };
  if (/\/open$/.test(url)) return { project: PROJECT, tree: TREE };
  if (/\/logout$/.test(url)) return { connected: false };
  return {};
}

globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init: init || {} });
  const body = bodyFor(String(url));
  return { ok: true, status: 200, json: async () => body };
};

// ---------------------------------------------------------------------------
// Load and apply
// ---------------------------------------------------------------------------
await import(pathToFileURL(clientPath).href);
assert.ok(definition, 'window.__ModuleLoader__.load received the definition');
assert.equal(definition.id, 'dsh-ustc-latex-agent');

let required = [];
const mod = definition.factory((name) => {
  required.push(name);
  assert.equal(name, 'react', 'client only requires react');
  return React;
});
assert.deepEqual(required, ['react']);
assert.deepEqual(mod.inject, ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']);

const regs = { locale: null, slots: [], injects: [], tab: null, opened: [], disposers: [] };
const ctx = {
  effect(fn) {
    const dispose = fn();
    regs.disposers.push(dispose);
    return dispose;
  },
  slots: {
    inject(slot, factory) {
      regs.injects.push(slot);
      return factory();
    },
    register(options, Component) {
      regs.slots.push({ options, Component });
      return () => {};
    },
  },
  locale: {
    register(ns, dicts) {
      regs.locale = { ns, dicts };
      return () => {};
    },
    bind(ns) {
      const dict = () => (ns === 'dsh-ustc-latex-agent' && regs.locale ? regs.locale.dicts.en : {});
      return (key, params) => {
        const table = dict();
        if (!(key in table)) throw new Error('missing locale key: ' + key);
        let text = table[key];
        if (params) {
          Object.keys(params).forEach((name) => {
            text = text.split('{' + name + '}').join(String(params[name]));
          });
        }
        return text;
      };
    },
  },
  sidebarRight: {
    openTab(kind) {
      regs.opened.push(kind);
    },
  },
  sidebarRightTabs: {
    register(def) {
      regs.tab = def;
      return () => {};
    },
  },
};

mod.apply(ctx);

// ---------------------------------------------------------------------------
// Registration assertions
// ---------------------------------------------------------------------------
assert.equal(regs.locale.ns, 'dsh-ustc-latex-agent');
assert.ok(regs.locale.dicts.en && regs.locale.dicts.zh, 'both dictionaries registered');

const tab = regs.tab;
assert.equal(tab.id, 'dsh-ustc-latex-agent');
assert.equal(tab.kind, 'dsh-ustc-latex-agent');
assert.equal(tab.title(), 'LaTeX');
assert.equal(tab.guide.length, 1);
assert.equal(tab.guide[0].id, 'latex');
assert.equal(tab.guide[0].title, 'LaTeX');
assert.ok(tab.guide[0].description.length > 10);

const pane = regs.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
const dock = regs.slots.find((entry) => entry.options.name === 'conversation.composer.dock');
assert.ok(pane, 'sidebar.right.pane.tab body registered');
assert.equal(pane.options.key, 'dsh-ustc-latex-agent');
assert.equal(pane.options.locale, 'dsh-ustc-latex-agent');
assert.equal(typeof pane.Component, 'function');
assert.ok(dock, 'conversation.composer.dock launcher registered');
assert.equal(dock.options.id, 'dsh-ustc-latex-agent');
assert.equal(dock.options.order, 60);
assert.ok(regs.injects.includes('sidebar.right.pane.tab'));
assert.ok(regs.injects.includes('conversation.composer.dock'));

// One stylesheet injected through the documented DOM effect, cleaned up on dispose.
assert.equal(head.children.length, 1, 'exactly one stylesheet injected');
const styleTag = head.children[0];
assert.equal(styleTag.attrs['data-dsh-ustc-latex-agent'], 'styles');
assert.ok(styleTag.textContent.includes('--dsw-alias-state-business-primary'), 'stylesheet uses theme tokens');
assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(styleTag.textContent), false, 'stylesheet has no literal hex colors');

// ---------------------------------------------------------------------------
// Locale resources: completeness and key parity
// ---------------------------------------------------------------------------
const en = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'en.json'), 'utf8'));
const zh = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'zh.json'), 'utf8'));
const enKeys = Object.keys(en).filter((key) => key !== 'meta').sort();
const zhKeys = Object.keys(zh).filter((key) => key !== 'meta').sort();
assert.deepEqual(zhKeys, enKeys, 'en.json and zh.json key sets match');
assert.ok(en.meta && en.meta.title && en.meta.description, 'en meta.title/meta.description');
assert.ok(zh.meta && zh.meta.title && zh.meta.description, 'zh meta.title/meta.description');
assert.deepEqual(Object.keys(regs.locale.dicts.en).sort(), enKeys, 'registered EN dictionary matches en.json');
assert.deepEqual(Object.keys(regs.locale.dicts.zh).sort(), zhKeys, 'registered ZH dictionary matches zh.json');

function inlineKeys(name) {
  const start = source.indexOf('const ' + name + ' = {');
  const end = source.indexOf('\n    };', start);
  assert.ok(start >= 0 && end > start, name + ' dictionary block found');
  const block = source.slice(start, end);
  return Array.from(block.matchAll(/^      ([A-Za-z0-9_]+):/gm), (match) => match[1]).sort();
}
assert.deepEqual(inlineKeys('EN'), enKeys, 'inline EN dictionary matches en.json');
assert.deepEqual(inlineKeys('ZH'), zhKeys, 'inline ZH dictionary matches zh.json');

const usedKeys = Array.from(new Set(Array.from(source.matchAll(/\bt\('([A-Za-z0-9_]+)'/g), (match) => match[1]))).sort();
const missing = usedKeys.filter((key) => !enKeys.includes(key));
assert.deepEqual(missing, [], 'every literal t() key exists in the dictionaries');
assert.equal(usedKeys.length, enKeys.length, 'no unused dictionary keys');
assert.ok(usedKeys.length > 30, 'panel uses its dictionary');

// ---------------------------------------------------------------------------
// Element-tree renderer
// ---------------------------------------------------------------------------
function render(element, out) {
  const acc = out || { text: '', anchors: [], buttons: [], links: [] };
  if (element === null || element === undefined || element === false || element === true) return acc;
  if (Array.isArray(element)) {
    element.forEach((child) => render(child, acc));
    return acc;
  }
  if (typeof element === 'string' || typeof element === 'number') {
    acc.text += String(element) + ' ';
    return acc;
  }
  const type = element.type;
  const props = element.props || {};
  if (typeof type === 'function') {
    if (type === React.Fragment) {
      render(props.children, acc);
      return acc;
    }
    render(type(props), acc);
    return acc;
  }
  if (typeof type === 'string') {
    if (type === 'a' && props.href) {
      acc.anchors.push(props.href);
      acc.links.push({ href: props.href, label: textOf(props.children) });
    }
    if (type === 'button') acc.buttons.push({ label: (props['aria-label'] || textOf(props.children)).trim(), props });
    if (type === 'input') acc.inputs = (acc.inputs || []).concat([props]);
    render(props.children, acc);
    return acc;
  }
  throw new Error('unexpected element type: ' + String(type));
}

function textOf(element) {
  const acc = render(element);
  return acc.text;
}

function find(element, predicate) {
  if (!element || typeof element !== 'object') return null;
  if (Array.isArray(element)) {
    for (const child of element) {
      const hit = find(child, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if (predicate(element)) return element;
  return find(element.props && element.props.children, predicate);
}

// Launcher
const launcher = dock.Component;
const launcherOut = render(launcher());
assert.ok(launcherOut.text.includes('LaTeX'), 'launcher shows the LaTeX label');
assert.equal(launcherOut.buttons.length, 1);
assert.equal(requests.length, 0, 'rendering performs no requests');
launcherOut.buttons[0].props.onClick();
assert.deepEqual(regs.opened, ['dsh-ustc-latex-agent'], 'launcher opens the pane tab kind');

// Panel: every state
const Panel = pane.Component;
const BASE = {
  status: { connected: true, baseUrl: 'https://latex.ustc.edu.cn', user: { name: 'Li Ming' } },
  project: null,
  projects: [],
  tree: [],
  events: [],
  comments: [],
  compile: null,
  error: '',
  actionError: '',
  projectsError: '',
  treeError: '',
  commentsError: '',
  eventsError: '',
  busy: '',
  busyThread: '',
};

function renderPanel(view, token, link) {
  setters = [];
  scripted = [view, token || '', link || '', {}];
  const tree = Panel();
  assert.equal(scripted.length, 0, 'panel consumed the scripted hook state');
  return { tree, out: render(tree), setters };
}

function trackedView(start, updates) {
  return updates.reduce((state, update) => (typeof update === 'function' ? update(state) : update), start);
}

// 1. loading
const loading = renderPanel(Object.assign({}, BASE, { phase: 'loading' }));
assert.ok(loading.out.text.includes('Loading'), 'loading state renders');

// 2. fatal error
const failed = renderPanel(Object.assign({}, BASE, { phase: 'error', error: 'HTTP 500' }));
assert.ok(failed.out.text.includes('HTTP 500'), 'error state shows the message');

// 3. not connected
const disconnected = renderPanel(Object.assign({}, BASE, { phase: 'disconnected', status: null }));
assert.ok(disconnected.out.text.includes('Connect to USTC Overleaf'), 'not-connected explains the token');
assert.ok(
  disconnected.out.anchors.includes('https://latex.ustc.edu.cn/agent/setup'),
  'not-connected links the setup page',
);
assert.ok(disconnected.out.text.includes('Connect'), 'not-connected has a Connect button');
assert.ok(disconnected.out.inputs && disconnected.out.inputs.length === 1, 'not-connected has the token field');

// 4. connected, no project
const picker = renderPanel(
  Object.assign({}, BASE, {
    phase: 'picker',
    projects: [{ id: 'p1', name: 'Paper', lastUpdated: 1762300000000, lastUpdatedBy: 'A. Author' }],
  }),
);
assert.ok(picker.out.text.includes('Paper'), 'picker lists projects');
assert.ok(picker.out.text.includes('Open link'), 'picker offers the link field');

// 5. project open
const project = renderPanel(
  Object.assign({}, BASE, {
    phase: 'project',
    project: PROJECT,
    tree: TREE,
    events: [
      { at: 1762300000000, kind: 'edit', path: 'main.tex', summary: 'Edited main.tex' },
      { at: 1762300001000, kind: 'error', summary: 'Compile failed once' },
    ],
    comments: [
      {
        threadId: 't1',
        path: 'main.tex',
        line: 3,
        selectedText: 'a wrong claim',
        resolved: false,
        messages: [{ id: 'm1', content: 'Please soften this.', user: 'Reviewer' }],
      },
      {
        threadId: 't2',
        path: 'chapters/intro.tex',
        line: 1,
        selectedText: 'done',
        resolved: true,
        messages: [],
      },
    ],
    compile: { status: 'success', pdfUrl: '/build/out.pdf', log: 'Output written on main.pdf' },
  }),
);
assert.ok(project.out.text.includes('Thesis'), 'project header shows the name');
assert.ok(project.out.text.includes('Live'), 'project header shows the live badge');
assert.ok(
  project.out.anchors.includes('https://latex.ustc.edu.cn/project/abc123#doc-main'),
  'doc row deep-links the project and doc id',
);
assert.ok(
  project.out.anchors.includes('https://latex.ustc.edu.cn/abc123'),
  'open-on-site uses the project url',
);
assert.ok(
  project.out.anchors.includes('https://latex.ustc.edu.cn/build/out.pdf'),
  'compile result links the PDF',
);
assert.ok(project.out.text.includes('Compile log'), 'compile log is rendered');
assert.ok(project.out.text.includes('Please soften this.'), 'comment messages render');
assert.ok(project.out.text.includes('Resolved'), 'resolved threads are labelled');
assert.equal(requests.length, 0, 'state rendering performs no requests');

// Connect flow: fetches through the same-origin API with cache no-store.
const connectPair = renderPanel(Object.assign({}, BASE, { phase: 'disconnected', status: null }), 'one-time-token');
const connectButton = connectPair.out.buttons.find((entry) => entry.label === 'Connect');
assert.ok(connectButton, 'Connect button is present');
connectButton.props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
const authCall = requests.find((entry) => entry.url.endsWith('/latex/api/auth'));
assert.ok(authCall, 'Connect posts to /latex/api/auth');
assert.equal(authCall.init.method, 'POST');
assert.equal(authCall.init.cache, 'no-store');
assert.deepEqual(JSON.parse(authCall.init.body), { token: 'one-time-token' });

// Defensive: a Host error body is surfaced inline and the button is released.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init: init || {} });
  if (String(url).endsWith('/latex/api/auth')) {
    return { ok: false, status: 401, json: async () => ({ error: 'Token expired' }) };
  }
  return realFetch(url, init);
};
const disconnectedAgain = Object.assign({}, BASE, { phase: 'disconnected', status: null });
const failedConnect = renderPanel(disconnectedAgain, 'expired-token');
const retryButton = failedConnect.out.buttons.find((entry) => entry.label === 'Connect');
retryButton.props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
const failedState = trackedView(disconnectedAgain, failedConnect.setters[0]);
assert.equal(failedState.actionError, 'Token expired', 'Host { error } is shown inline');
assert.equal(failedState.busy, '', 'failed connect clears the busy state');
globalThis.fetch = realFetch;

// ---------------------------------------------------------------------------
// Static hygiene
// ---------------------------------------------------------------------------
assert.equal(/require\(['"]@deepseek-ai\//.test(source), false, 'no @deepseek-ai imports');
assert.equal(/require\(['"](?!react['"])/.test(source), false, 'no imports other than react');
assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(source), false, 'no literal hex colors in the client');
assert.ok(source.includes("window.__ModuleLoader__.load({"), 'module loader format');

regs.disposers.forEach((dispose) => {
  if (typeof dispose === 'function') dispose();
});
assert.equal(head.children.length, 0, 'stylesheet removed when the plugin unloads');

console.log('smoke-client: OK');
console.log('  used locale keys:', usedKeys.length);
console.log('  registrations:', regs.slots.map((entry) => entry.options.name).join(', '));
console.log('  rendered states: loading, error, disconnected, picker, project');
console.log('  requests after renders:', requests.length, '(auth + status + tree + comments)');
process.exit(0);
