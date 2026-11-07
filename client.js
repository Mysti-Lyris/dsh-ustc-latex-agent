// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 dsh-ustc-latex-agent contributors
window.__ModuleLoader__.load({
  id: 'dsh-ustc-latex-agent',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-ustc-latex-agent';
    const TAB_ID = 'dsh-ustc-latex-agent';
    const KIND = 'dsh-ustc-latex-agent';
    const R = '/latex/api';
    const SETUP_URL = 'https://latex.ustc.edu.cn/agent/setup';
    const DEFAULT_BASE = 'https://latex.ustc.edu.cn';
    const POLL_MS = 3000;
    const COMMENTS_POLL_MS = 10000;
    const MAX_EVENTS = 200;

    // ---------------------------------------------------------------------
    // Dictionaries (mirrored in locale/en.json and locale/zh.json)
    // ---------------------------------------------------------------------
    const ZH = {
      tab: 'LaTeX',
      launcher: 'LaTeX',
      guideTitle: 'LaTeX',
      guideDescription: '打开中科大 Overleaf 项目：浏览文件、编译并查看评论。',
      loading: '加载中…',
      retry: '重试',
      errorGeneric: '出了点问题。',
      httpError: '请求失败（{status}）。',
      connectTitle: '连接中科大 Overleaf',
      connectIntro:
        '请先在中科大 Overleaf 网站创建一次性令牌，然后粘贴到此处。令牌会换成会话 Cookie，并通过 Harness 的凭据服务保存。',
      setupLink: '打开设置页面',
      tokenLabel: '一次性令牌',
      tokenPlaceholder: '粘贴一次性令牌',
      connect: '连接',
      connecting: '正在连接…',
      connectedAs: '已连接：{name}',
      disconnect: '断开连接',
      disconnecting: '正在断开…',
      projectsTitle: '我的项目',
      projectsEmpty: '该账号下没有项目。',
      projectOpen: '打开',
      opening: '正在打开…',
      lastUpdated: '更新于 {when}',
      lastUpdatedBy: '由 {name}',
      openProjectLabel: '打开项目 {name}',
      linkLabel: '或粘贴项目链接',
      linkPlaceholder: 'https://latex.ustc.edu.cn/project/…',
      openLink: '打开链接',
      openOnSite: '在网站上打开',
      refresh: '刷新',
      refreshing: '正在刷新…',
      live: '实时',
      filesTitle: '文件',
      filesEmpty: '该项目没有文档。',
      filesCount: '共 {count} 个文件',
      compile: '编译',
      compiling: '正在编译…',
      compileSuccess: '编译成功',
      compileFailure: '编译失败',
      compileStatus: '状态：{status}',
      compileLog: '编译日志',
      openPdf: '打开 PDF',
      compileNoPdf: '未返回 PDF。',
      activityTitle: '动态',
      activityWaiting: '等待事件…',
      commentsTitle: '批注与修改意见',
      commentsEmpty:
        '还没有批注。在网站里选中一段文字 → 添加评论，这里会自动出现；Agent 能读到选中内容、行号与上下文，改完会在同一线程回复你。',
      pendingCount: '{count} 条未解决',
      previewTitle: '文档预览与选段批注',
      preview: '预览',
      previewAria: '预览 {name}',
      close: '关闭',
      selectHint: '在上面的文档里选中一段文字，再写修改意见；提交后会作为锚定批注出现在网站评论区。',
      commentPlaceholder: '写下你对所选段落的修改意见…',
      addComment: '添加批注',
      submitting: '提交中…',
      selectionRequired: '请先在文档里选中一段文字。',
      pdfTitle: 'PDF 渲染预览',
      pdfRender: '渲染 PDF',
      pdfHint: '打开预览时若还没有编译结果，会先编译一次（可能几十秒）。',
      pdfReady: '已渲染上次编译结果；改动后重新编译即可更新。',
      autoNotify: '新批注提醒 Agent',
      autoNotifyHint: '面板发现新批注时唤醒当前会话的 Agent 自动处理（每 30 秒最多一次）。',
      replyPlaceholder: '回复…',
      reply: '回复',
      replying: '正在回复…',
      resolve: '标记已解决',
      reopen: '重新打开',
      resolved: '已解决',
      unresolved: '未解决',
      lineRef: '第 {line} 行',
      kindAuth: '认证',
      kindOpen: '打开',
      kindRead: '读取',
      kindEdit: '编辑',
      kindCompile: '编译',
      kindComment: '评论',
      kindUserEdit: '用户编辑',
      kindError: '错误',
      kindOther: '事件',
      loadFailed: '无法加载 LaTeX 面板。',
      openDocAria: '在 Overleaf 网站上打开 {name}',
      back: '返回',
      projectFallback: '项目',
      panelAria: 'LaTeX 项目面板',
    };

    const EN = {
      tab: 'LaTeX',
      launcher: 'LaTeX',
      guideTitle: 'LaTeX',
      guideDescription: 'Open a USTC Overleaf project: browse files, compile, and review comments.',
      loading: 'Loading…',
      retry: 'Retry',
      errorGeneric: 'Something went wrong.',
      httpError: 'Request failed ({status}).',
      connectTitle: 'Connect to USTC Overleaf',
      connectIntro:
        'Create a one-time token on the USTC Overleaf site, then paste it here. The token is exchanged for a session cookie and stored through the Harness credentials service.',
      setupLink: 'Open the setup page',
      tokenLabel: 'One-time token',
      tokenPlaceholder: 'Paste your one-time token',
      connect: 'Connect',
      connecting: 'Connecting…',
      connectedAs: 'Connected as {name}',
      disconnect: 'Disconnect',
      disconnecting: 'Disconnecting…',
      projectsTitle: 'Your projects',
      projectsEmpty: 'No projects found for this account.',
      projectOpen: 'Open',
      opening: 'Opening…',
      lastUpdated: 'Updated {when}',
      lastUpdatedBy: 'by {name}',
      openProjectLabel: 'Open project {name}',
      linkLabel: 'Or paste a project link',
      linkPlaceholder: 'https://latex.ustc.edu.cn/project/…',
      openLink: 'Open link',
      openOnSite: 'Open on site',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      live: 'Live',
      filesTitle: 'Files',
      filesEmpty: 'This project has no documents.',
      filesCount: '{count} files',
      compile: 'Compile',
      compiling: 'Compiling…',
      compileSuccess: 'Compiled',
      compileFailure: 'Compile failed',
      compileStatus: 'Status: {status}',
      compileLog: 'Compile log',
      openPdf: 'Open PDF',
      compileNoPdf: 'No PDF was returned.',
      activityTitle: 'Activity',
      activityWaiting: 'Waiting for events…',
      commentsTitle: 'Review comments',
      commentsEmpty:
        'No comments yet. On the site, select a passage and add a comment — it appears here automatically. The agent reads the selection, line and surrounding context, then replies in the same thread.',
      pendingCount: '{count} open',
      previewTitle: 'Document preview and passage comment',
      preview: 'Preview',
      previewAria: 'Preview {name}',
      close: 'Close',
      selectHint: 'Select a passage above, then write your revision note; it is posted as an anchored comment on the site.',
      commentPlaceholder: 'What should change in the selected passage?',
      addComment: 'Add comment',
      submitting: 'Submitting…',
      selectionRequired: 'Select a passage in the document first.',
      pdfTitle: 'PDF preview',
      pdfRender: 'Render PDF',
      pdfHint: 'Opening the preview compiles first when no result is cached (may take tens of seconds).',
      pdfReady: 'Showing the last compile; recompile to refresh.',
      autoNotify: 'Notify agent',
      autoNotifyHint: 'Wake this session’s agent when new review comments appear (at most once per 30 seconds).',
      replyPlaceholder: 'Reply…',
      reply: 'Reply',
      replying: 'Replying…',
      resolve: 'Resolve',
      reopen: 'Reopen',
      resolved: 'Resolved',
      unresolved: 'Open',
      lineRef: 'Line {line}',
      kindAuth: 'Auth',
      kindOpen: 'Open',
      kindRead: 'Read',
      kindEdit: 'Edit',
      kindCompile: 'Compile',
      kindComment: 'Comment',
      kindUserEdit: 'User edit',
      kindError: 'Error',
      kindOther: 'Event',
      loadFailed: 'Could not load the LaTeX panel.',
      openDocAria: 'Open {name} on the Overleaf site',
      back: 'Back',
      projectFallback: 'Project',
      panelAria: 'LaTeX project panel',
    };

    // ---------------------------------------------------------------------
    // One stylesheet for interaction states only; all colors come from theme
    // alias tokens. Injected once from apply() and removed on unload.
    // ---------------------------------------------------------------------
    const CSS = [
      '.al-btn{transition:background-color .12s ease,border-color .12s ease}',
      '.al-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.al-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.al-btn:disabled{opacity:.55;cursor:default}',
      '.al-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.al-btn:focus-visible,.al-input:focus-visible,.al-row:focus-visible,.al-link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.al-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,transparent);outline:none}',
      '.al-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.al-row:active{background:var(--dsw-alias-interactive-bg-active)}',
      '.al-link:hover{text-decoration:underline}',
      '.al-panel ::-webkit-scrollbar{width:8px;height:8px}',
      '.al-panel ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3);border-radius:8px}',
      '.al-panel ::-webkit-scrollbar-track{background:transparent}',
      '.al-panel *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l3) transparent}',
      '@keyframes al-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '.al-live-dot{animation:al-pulse 1.8s ease-in-out infinite}',
      '@media (prefers-reduced-motion:reduce){.al-live-dot{animation:none}}',
      '.al-pre{margin:6px 0 0;padding:8px;max-height:180px;overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word}',
      '.al-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    ].join('\n');

    // ---------------------------------------------------------------------
    // Style constants (colors and typography from --dsw-alias-* only)
    // ---------------------------------------------------------------------
    const HAIRLINE = '0.5px solid var(--dsw-alias-border-l2)';
    const S = {
      panel: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '20px',
      },
      scroll: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '0 12px 16px',
      },
      head: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        minHeight: 44,
        flexShrink: 0,
        borderBottom: HAIRLINE,
      },
      section: {
        marginTop: 14,
      },
      sectionHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 6,
      },
      sectionTitle: {
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
      },
      caption: {
        fontSize: 11,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      body: {
        fontSize: 13,
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-primary)',
      },
      card: {
        border: HAIRLINE,
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-1)',
        padding: 10,
        minWidth: 0,
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 30,
        padding: '4px 6px',
        borderRadius: 6,
        color: 'inherit',
        textDecoration: 'none',
        minWidth: 0,
      },
      link: {
        color: 'var(--dsw-alias-state-business-primary)',
        textDecoration: 'none',
        fontSize: 12,
        whiteSpace: 'nowrap',
      },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        height: 30,
        padding: '0 8px',
        borderRadius: 8,
        border: HAIRLINE,
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
        outline: 'none',
      },
      btn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 28,
        padding: '0 10px',
        borderRadius: 8,
        border: HAIRLINE,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        lineHeight: '16px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      btnPrimary: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 28,
        padding: '0 12px',
        borderRadius: 8,
        border: '0.5px solid var(--dsw-alias-button-primary-fill)',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: 'var(--dsw-alias-label-primary-foreground)',
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 6px',
        borderRadius: 999,
        fontSize: 10,
        lineHeight: '14px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        border: '0.5px solid transparent',
        flexShrink: 0,
      },
      error: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginTop: 8,
        padding: '6px 8px',
        borderRadius: 8,
        border: '0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)',
        color: 'var(--dsw-alias-state-error-primary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      errorText: {
        minWidth: 0,
        wordBreak: 'break-word',
      },
      center: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 24,
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        textAlign: 'center',
      },
      empty: {
        padding: '10px 2px',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
      },
    };

    // ---------------------------------------------------------------------
    // Pure helpers
    // ---------------------------------------------------------------------
    function stripSlash(value) {
      return String(value == null ? '' : value).replace(/\/+$/, '');
    }

    function baseOf(baseUrl) {
      const base = stripSlash(baseUrl);
      return base || DEFAULT_BASE;
    }

    function projectHref(project, baseUrl) {
      if (project && typeof project.url === 'string' && project.url) return project.url;
      const id = project && project.id != null ? String(project.id) : '';
      if (!id) return baseOf(baseUrl);
      return baseOf(baseUrl) + '/' + id;
    }

    function docHref(baseUrl, projectId, docId) {
      // Live-verified route on latex.ustc.edu.cn: /project/<id>#<docId>.
      return baseOf(baseUrl) + '/project/' + String(projectId) + '#' + String(docId);
    }

    function pdfHref(pdfUrl, baseUrl) {
      const url = String(pdfUrl == null ? '' : pdfUrl).trim();
      if (!url) return '';
      if (/^https?:\/\//i.test(url)) return url;
      if (url.indexOf('//') === 0) return 'https:' + url;
      return baseOf(baseUrl) + (url.charAt(0) === '/' ? '' : '/') + url;
    }

    function formatTime(at) {
      const value = Number(at);
      if (!isFinite(value) || value <= 0) return '';
      try {
        return new Date(value).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      } catch (err) {
        return '';
      }
    }

    function formatWhen(value) {
      if (value == null || value === '') return '';
      const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
      const time = date.getTime();
      if (!isFinite(time)) return '';
      try {
        return date.toLocaleString();
      } catch (err) {
        return '';
      }
    }

    function errorText(err) {
      if (err && typeof err.message === 'string' && err.message) return err.message;
      if (typeof err === 'string' && err) return err;
      return '';
    }

    function nodeName(node) {
      if (!node) return '';
      if (typeof node.name === 'string' && node.name) return node.name;
      const path = String(node.path || '');
      const index = path.lastIndexOf('/');
      return index >= 0 ? path.slice(index + 1) : path;
    }

    function parentDir(node) {
      const path = String((node && node.path) || '');
      const index = path.lastIndexOf('/');
      return index > 0 ? path.slice(0, index) : '';
    }

    function sortedTree(nodes) {
      const list = objectList(nodes).filter(function (node) {
        return typeof node.path === 'string' && node.path;
      });
      return list.slice().sort(function (a, b) {
        const aDoc = a.type === 'doc' ? 0 : 1;
        const bDoc = b.type === 'doc' ? 0 : 1;
        if (aDoc !== bDoc) return aDoc - bDoc;
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      });
    }

    function objectList(value) {
      return (Array.isArray(value) ? value : []).filter(function (item) {
        return item !== null && item !== undefined && typeof item === 'object';
      });
    }

    function eventKey(event) {
      if (!event) return '';
      if (event.id !== undefined && event.id !== null && event.id !== '') return 'id:' + String(event.id);
      return [
        event.at != null ? event.at : '',
        event.kind ? event.kind : '',
        event.path ? event.path : '',
        event.summary ? event.summary : '',
      ].join('|');
    }

    function mergeEvents(previous, incoming) {
      const list = Array.isArray(previous) ? previous.slice() : [];
      const seen = {};
      list.forEach(function (event) {
        seen[eventKey(event)] = true;
      });
      (Array.isArray(incoming) ? incoming : []).forEach(function (event) {
        if (!event || typeof event !== 'object') return;
        const key = eventKey(event);
        if (seen[key]) return;
        seen[key] = true;
        list.push(event);
      });
      if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
      return list;
    }

    function compileTone(compile) {
      if (!compile) return 'neutral';
      const status = String(compile.status == null ? '' : compile.status).toLowerCase();
      if (status.indexOf('fail') >= 0 || status.indexOf('error') >= 0) return 'error';
      if (
        status.indexOf('success') >= 0 ||
        status.indexOf('complete') >= 0 ||
        status.indexOf('done') >= 0 ||
        compile.pdfUrl
      ) {
        return 'success';
      }
      return 'neutral';
    }

    function initialView() {
      return {
        phase: 'loading',
        autoNotify: true,
        pdfOpen: false,
        pdfNonce: 0,
        status: null,
        project: null,
        projects: [],
        tree: [],
        events: [],
        comments: [],
        compile: null,
        preview: null,
        selection: null,
        newComment: '',
        commentBusy: false,
        compileError: '',
        error: '',
        actionError: '',
        projectsError: '',
        treeError: '',
        commentsError: '',
        eventsError: '',
        busy: '',
        busyThread: '',
        projectsBusy: false,
        treeBusy: false,
        commentsBusy: false,
      };
    }

    // ---------------------------------------------------------------------
    // HTTP (same-origin, JSON, no-store)
    // ---------------------------------------------------------------------
    async function request(path, init) {
      if (typeof fetch !== 'function') throw new Error('');
      const options = Object.assign({ cache: 'no-store', headers: { accept: 'application/json' } }, init || {});
      const response = await fetch(path, options);
      let body = null;
      try {
        body = await response.json();
      } catch (err) {
        body = null;
      }
      if (body && typeof body.error === 'string' && body.error) throw new Error(body.error);
      if (!response.ok) {
        const failure = new Error('');
        failure.httpStatus = response.status;
        throw failure;
      }
      return body || {};
    }

    function postJson(path, payload) {
      return request(path, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload || {}),
      });
    }

    // ---------------------------------------------------------------------
    // apply
    // ---------------------------------------------------------------------
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: ZH, en: EN });
      }, 'dsh-ustc-latex-agent: locale');

      const t = ctx.locale.bind(NS);

      function message(err) {
        if (err && err.httpStatus) return t('httpError', { status: err.httpStatus });
        return errorText(err) || t('errorGeneric');
      }

      // The single stylesheet: injected once, removed when the plugin unloads.
      ctx.effect(function () {
        if (typeof document === 'undefined' || !document.head) return function () {};
        const selector = 'style[data-dsh-ustc-latex-agent="styles"]';
        let element = null;
        try {
          element = document.querySelector(selector);
        } catch (err) {
          element = null;
        }
        if (element) return function () {};
        try {
          element = document.createElement('style');
          element.setAttribute('data-dsh-ustc-latex-agent', 'styles');
          element.textContent = CSS;
          document.head.appendChild(element);
        } catch (err) {
          return function () {};
        }
        return function () {
          try {
            if (element && element.parentNode) element.parentNode.removeChild(element);
          } catch (err) {
            /* already detached */
          }
        };
      }, 'dsh-ustc-latex-agent: styles');

      // -------------------------------------------------------------------
      // Small pieces
      // -------------------------------------------------------------------
      function Badge(props) {
        const tone = props.tone || 'neutral';
        const style = Object.assign({}, S.badge);
        if (tone === 'success') {
          style.color = 'var(--dsw-alias-state-success-primary)';
          style.background = 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)';
        } else if (tone === 'error') {
          style.color = 'var(--dsw-alias-state-error-primary)';
          style.background = 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)';
        } else if (tone === 'accent') {
          style.color = 'var(--dsw-alias-state-business-primary)';
          style.background = 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)';
        } else {
          style.color = 'var(--dsw-alias-label-tertiary)';
          style.background = 'var(--dsw-alias-bg-layer-2)';
          style.borderColor = 'var(--dsw-alias-border-l2)';
        }
        return h('span', { style: style }, props.children);
      }

      function Btn(props) {
        return h(
          'button',
          {
            type: 'button',
            className: 'al-btn' + (props.primary ? ' al-btn-primary' : ''),
            style: props.primary ? S.btnPrimary : S.btn,
            disabled: props.disabled ? true : undefined,
            title: props.title || undefined,
            onClick: props.onClick || undefined,
          },
          props.children,
        );
      }

      function TextInput(props) {
        return h('input', {
          className: 'al-input',
          type: props.password ? 'password' : 'text',
          value: props.value == null ? '' : props.value,
          placeholder: props.placeholder || '',
          'aria-label': props.ariaLabel || props.placeholder || '',
          disabled: props.disabled ? true : undefined,
          spellCheck: false,
          autoComplete: 'off',
          style: S.input,
          onChange: function (event) {
            if (props.onChange) props.onChange(event.target.value);
          },
          onKeyDown: function (event) {
            if (event.key === 'Enter' && props.onEnter) props.onEnter();
          },
        });
      }

      function ErrorLine(props) {
        if (!props.text) return null;
        return h(
          'div',
          { role: 'alert', style: S.error },
          h('span', { style: S.errorText }, props.text),
          props.onRetry
            ? h(
                'button',
                {
                  type: 'button',
                  onClick: props.onRetry,
                  style: {
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                    flexShrink: 0,
                  },
                },
                t('retry'),
              )
            : null,
        );
      }

      function LiveDot() {
        return h('span', {
          className: 'al-live-dot',
          'aria-hidden': true,
          style: {
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--dsw-alias-state-success-primary)',
            flexShrink: 0,
          },
        });
      }

      function FileGlyph(props) {
        return h(
          'span',
          {
            'aria-hidden': true,
            style: {
              display: 'inline-flex',
              color: 'var(--dsw-alias-label-tertiary)',
              flexShrink: 0,
            },
          },
          h(
            'svg',
            { width: 12, height: 12, viewBox: '0 0 16 16', focusable: 'false' },
            h('path', {
              d: 'M4 1.5h5.5L13 5v9.5H4z',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.2,
              strokeLinejoin: 'round',
            }),
            h('path', {
              d: 'M9.5 1.5V5H13',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.2,
              strokeLinejoin: 'round',
            }),
            props.doc
              ? h('path', {
                  d: 'M6 8h5M6 10.5h5M6 13h3',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.2,
                  strokeLinecap: 'round',
                })
              : null,
          ),
        );
      }

      function Section(props) {
        return h(
          'section',
          { style: S.section },
          h(
            'div',
            { style: S.sectionHead },
            h('div', { style: S.sectionTitle }, props.title),
            props.right || null,
          ),
          props.children,
        );
      }

      function kindLabel(kind) {
        switch (kind) {
          case 'auth':
            return t('kindAuth');
          case 'open':
            return t('kindOpen');
          case 'read':
            return t('kindRead');
          case 'edit':
            return t('kindEdit');
          case 'compile':
            return t('kindCompile');
          case 'comment':
            return t('kindComment');
          case 'user-edit':
            return t('kindUserEdit');
          case 'error':
            return t('kindError');
          default:
            return t('kindOther');
        }
      }

      // -------------------------------------------------------------------
      // Launcher pill in conversation.composer.dock
      // -------------------------------------------------------------------
      function Launcher() {
        return h(
          'button',
          {
            type: 'button',
            className: 'al-btn',
            title: t('tab'),
            'aria-label': t('tab'),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 24,
              padding: '0 8px',
              margin: 0,
              borderRadius: 8,
              border: HAIRLINE,
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary)',
              font: 'inherit',
              fontSize: 12,
              lineHeight: '16px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            },
            onClick: function () {
              ctx.sidebarRight.openTab(KIND);
            },
          },
          h(
            'svg',
            {
              width: 12,
              height: 12,
              viewBox: '0 0 16 16',
              'aria-hidden': true,
              focusable: 'false',
              style: { display: 'block', flexShrink: 0 },
            },
            h('path', {
              d: 'M6 2.5c-1.6 0-2 1-2 2.3v1.4c0 .9-.5 1.4-1.5 1.5 1 .1 1.5.6 1.5 1.5v1.4c0 1.3.4 2.3 2 2.3',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.3,
              strokeLinecap: 'round',
            }),
            h('path', {
              d: 'M10 2.5c1.6 0 2 1 2 2.3v1.4c0 .9.5 1.4 1.5 1.5-1 .1-1.5.6-1.5 1.5v1.4c0 1.3-.4 2.3-2 2.3',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.3,
              strokeLinecap: 'round',
            }),
          ),
          h('span', null, t('launcher')),
        );
      }

      // -------------------------------------------------------------------
      // Panel
      // -------------------------------------------------------------------
      function Panel(props) {
        const [view, setView] = React.useState(initialView);
        const [token, setToken] = React.useState('');
        const [link, setLink] = React.useState('');
        const [drafts, setDrafts] = React.useState({});
        const cursorRef = React.useRef(0);
        const alive = React.useRef(true);
        const preRef = React.useRef(null);
        const knownThreads = React.useRef(null);
        const autoNotifyRef = React.useRef(true);
        const sessionId = props && props.sessionId ? String(props.sessionId) : '';
        autoNotifyRef.current = view.autoNotify !== false;

        function set(patch) {
          if (!alive.current) return;
          setView(function (previous) {
            return Object.assign({}, previous, patch);
          });
        }

        function applyEvents(incoming) {
          if (!alive.current) return;
          setView(function (previous) {
            return Object.assign({}, previous, {
              events: mergeEvents(previous.events, incoming),
              eventsError: '',
            });
          });
        }

        function loadProjects() {
          set({ projectsBusy: true, projectsError: '' });
          return request(R + '/projects')
            .then(function (body) {
              if (!alive.current) return;
              set({
                phase: 'picker',
                projects: objectList(body.projects),
                projectsError: '',
                projectsBusy: false,
              });
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ phase: 'picker', projectsError: message(err), projectsBusy: false });
            });
        }

        function notifyNewThreads(threads) {
          if (!sessionId) return;
          const list = Array.isArray(threads) ? threads : [];
          const seen = knownThreads.current;
          if (seen === null) {
            const initial = {};
            list.forEach(function (thread) {
              if (thread && thread.threadId) initial[String(thread.threadId)] = true;
            });
            knownThreads.current = initial;
            return;
          }
          const payload = [];
          list.forEach(function (thread) {
            if (!thread || thread.resolved === true) return;
            const id = String(thread.threadId || '');
            if (!id || seen[id]) return;
            const messages = Array.isArray(thread.messages) ? thread.messages : [];
            const last = messages.length > 0 ? messages[messages.length - 1] : null;
            payload.push({
              threadId: id,
              path: thread.path,
              line: thread.line,
              quote: thread.selectedText,
              message: last ? last.content : '',
            });
          });
          if (payload.length === 0) return;
          if (!autoNotifyRef.current) {
            payload.forEach(function (item) {
              seen[item.threadId] = true;
            });
            return;
          }
          postJson(R + '/watch', { sessionId: sessionId, threads: payload })
            .then(function (result) {
              // Mark as seen after any accepted report unless it was throttled;
              // otherwise agent-authored threads would be re-reported forever.
              if (result && result.throttled !== true) {
                payload.forEach(function (item) {
                  seen[item.threadId] = true;
                });
              }
            })
            .catch(function () {});
        }

        function loadComments() {
          set({ commentsBusy: true, commentsError: '' });
          return request(R + '/comments')
            .then(function (body) {
              if (!alive.current) return;
              const threads = objectList(body.threads);
              set({
                comments: threads,
                commentsError: '',
                commentsBusy: false,
              });
              notifyNewThreads(threads);
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ commentsError: message(err), commentsBusy: false });
            });
        }

        function loadTree() {
          set({ treeBusy: true, treeError: '' });
          return request(R + '/tree')
            .then(function (body) {
              if (!alive.current) return;
              const patch = {
                tree: Array.isArray(body.tree) ? body.tree : [],
                treeError: '',
                treeBusy: false,
              };
              if (body.project) patch.project = body.project;
              set(patch);
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ treeError: message(err), treeBusy: false });
            });
        }

        // Read-only document view: lets the user highlight a passage inside the
        // panel and leave an anchored review comment without switching to the site.
        function openPreview(node) {
          const path = String((node && node.path) || '');
          if (!path) return;
          set({
            preview: { path: path, text: '', busy: true, error: '' },
            selection: null,
            newComment: '',
          });
          request(R + '/doc?path=' + encodeURIComponent(path))
            .then(function (body) {
              if (!alive.current) return;
              set({
                preview: {
                  path: path,
                  text: typeof body.text === 'string' ? body.text : '',
                  version: body.version,
                  busy: false,
                  error: '',
                },
              });
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ preview: { path: path, text: '', busy: false, error: message(err) } });
            });
        }

        function closePreview() {
          set({ preview: null, selection: null, newComment: '', commentBusy: false });
        }

        function captureSelection() {
          const doc = typeof document === 'undefined' ? null : document;
          const win = typeof window === 'undefined' ? null : window;
          if (!doc || !win || typeof win.getSelection !== 'function') return;
          const sel = win.getSelection();
          if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
            set({ selection: null });
            return;
          }
          const text = String(sel.toString() || '');
          if (!text.trim()) {
            set({ selection: null });
            return;
          }
          let line = 0;
          try {
            const range = sel.getRangeAt(0);
            const pre = preRef.current;
            if (pre && pre.contains(range.startContainer) && typeof doc.createRange === 'function') {
              const before = doc.createRange();
              before.selectNodeContents(pre);
              before.setEnd(range.startContainer, range.startOffset);
              line = before.toString().split('\n').length;
            }
          } catch (err) {
            line = 0;
          }
          set({ selection: { text: text, line: line } });
        }

        function submitNewComment() {
          const preview = view.preview;
          const selection = view.selection;
          const content = String(view.newComment || '').trim();
          if (!preview || preview.busy || !content) return;
          if (!selection || !String(selection.text || '').trim()) {
            set({ actionError: t('selectionRequired') });
            return;
          }
          set({ commentBusy: true, actionError: '' });
          postJson(R + '/comments', {
            action: 'add',
            path: preview.path,
            content: content,
            selectedText: selection.text,
            line: selection.line > 0 ? selection.line : undefined,
          })
            .then(function () {
              if (!alive.current) return;
              set({ commentBusy: false, newComment: '', selection: null });
              return loadComments();
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ commentBusy: false, actionError: message(err) });
            });
        }

        function enterProject(project, tree) {
          cursorRef.current = 0;
          set({
            phase: 'project',
            pdfOpen: false,
            pdfNonce: 0,
            project: project || null,
            tree: Array.isArray(tree) ? tree : [],
            events: [],
            comments: [],
            compile: null,
            preview: null,
            selection: null,
            newComment: '',
            commentBusy: false,
            compileError: '',
            actionError: '',
            treeError: '',
            commentsError: '',
            eventsError: '',
            busy: '',
          });
          loadTree();
          loadComments();
        }

        function routeStatus(status) {
          if (!status || status.connected !== true) {
            set({ phase: 'disconnected', status: status || null, actionError: '' });
            return;
          }
          set({ status: status });
          if (!status.project) {
            set({ phase: 'picker', actionError: '' });
            loadProjects();
            return;
          }
          enterProject(status.project, null);
        }

        function loadStatus() {
          set({ phase: 'loading', error: '', actionError: '' });
          return request(R + '/status')
            .then(function (status) {
              if (!alive.current) return;
              routeStatus(status);
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ phase: 'error', error: message(err) });
            });
        }

        function connect() {
          const value = token.trim();
          if (!value) return;
          set({ busy: 'auth', actionError: '' });
          postJson(R + '/auth', { token: value })
            .then(function () {
              if (!alive.current) return;
              setToken('');
              set({ busy: '' });
              return loadStatus();
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ busy: '', actionError: message(err) });
            });
        }

        function disconnect() {
          set({ busy: 'logout', actionError: '' });
          postJson(R + '/logout', {})
            .then(function () {
              if (!alive.current) return;
              cursorRef.current = 0;
              set(Object.assign(initialView(), { phase: 'disconnected' }));
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ busy: '', actionError: message(err) });
            });
        }

        function openProject(body) {
          set({ busy: 'open', actionError: '' });
          postJson(R + '/open', body)
            .then(function (result) {
              if (!alive.current) return;
              enterProject(result.project, result.tree);
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ busy: '', actionError: message(err) });
            });
        }

        function openLink() {
          const url = link.trim();
          if (!url) return;
          openProject({ url: url });
        }

        function backToProjects() {
          set({ phase: 'picker', actionError: '', projectsError: '', compile: null });
          loadProjects();
        }

        function refreshAll() {
          set({ busy: 'refresh', actionError: '', treeBusy: true, commentsBusy: true });
          request(R + '/status')
            .then(function (status) {
              if (!alive.current) return;
              if (!status || status.connected !== true) {
                set({ phase: 'disconnected', status: status || null, busy: '', treeBusy: false, commentsBusy: false });
                return;
              }
              if (!status.project) {
                set({ phase: 'picker', status: status, busy: '', treeBusy: false, commentsBusy: false });
                loadProjects();
                return;
              }
              const patch = {
                busy: '',
                status: status,
                project: status.project,
                treeBusy: false,
                commentsBusy: false,
              };
              return request(R + '/tree')
                .then(function (body) {
                  patch.tree = Array.isArray(body.tree) ? body.tree : [];
                  patch.treeError = '';
                  if (body.project) patch.project = body.project;
                })
                .catch(function (err) {
                  patch.treeError = message(err);
                })
                .then(function () {
                  return request(R + '/comments')
                    .then(function (body) {
                      patch.comments = objectList(body.threads);
                      patch.commentsError = '';
                    })
                    .catch(function (err) {
                      patch.commentsError = message(err);
                    });
                })
                .then(function () {
                  if (alive.current) set(patch);
                });
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ busy: '', actionError: message(err), treeBusy: false, commentsBusy: false });
            });
        }

        function compile() {
          set({ busy: 'compile', actionError: '', compileError: '' });
          postJson(R + '/compile', {})
            .then(function (result) {
              if (!alive.current) return;
              set({
                busy: '',
                compile: result || null,
                compileError: '',
                pdfOpen: Boolean(result && result.pdfUrl),
                pdfNonce: view.pdfNonce + 1,
              });
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ busy: '', compileError: message(err) });
            });
        }

        function sendReply(threadId) {
          const draft = String(drafts[threadId] == null ? '' : drafts[threadId]).trim();
          if (!draft) return;
          set({ busyThread: threadId, actionError: '' });
          postJson(R + '/comments', { action: 'reply', threadId: threadId, content: draft })
            .then(function () {
              if (!alive.current) return;
              setDrafts(function (previous) {
                const next = Object.assign({}, previous);
                delete next[threadId];
                return next;
              });
              set({ busyThread: '' });
              return loadComments();
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ busyThread: '', actionError: message(err) });
            });
        }

        function setThreadResolved(thread, resolved) {
          const threadId = thread && thread.threadId;
          if (!threadId) return;
          set({ busyThread: threadId, actionError: '' });
          postJson(R + '/comments', {
            action: resolved ? 'resolve' : 'reopen',
            threadId: threadId,
          })
            .then(function () {
              if (!alive.current) return;
              set({ busyThread: '' });
              return loadComments();
            })
            .catch(function (err) {
              if (!alive.current) return;
              set({ busyThread: '', actionError: message(err) });
            });
        }

        React.useEffect(function () {
          alive.current = true;
          loadStatus();
          return function () {
            alive.current = false;
          };
        }, []);

        // Poll activity every 3s only while mounted and the page is visible.
        React.useEffect(
          function () {
            if (view.phase !== 'project') return undefined;
            let live = true;
            let timer = null;
            let inFlight = false;

            function tick() {
              if (!live || inFlight) return;
              const doc = typeof document === 'undefined' ? null : document;
              if (doc && doc.visibilityState && doc.visibilityState !== 'visible') return;
              inFlight = true;
              request(R + '/events?since=' + encodeURIComponent(String(cursorRef.current)))
                .then(function (body) {
                  inFlight = false;
                  if (!live) return;
                  if (body.cursor !== undefined && body.cursor !== null && body.cursor !== '') {
                    cursorRef.current = body.cursor;
                  }
                  applyEvents(body.events);
                })
                .catch(function (err) {
                  inFlight = false;
                  if (!live) return;
                  set({ eventsError: message(err) });
                });
            }

            function stop() {
              if (timer !== null) {
                clearInterval(timer);
                timer = null;
              }
            }

            function start() {
              if (timer !== null) return;
              tick();
              timer = setInterval(tick, POLL_MS);
            }

            function sync() {
              const doc = typeof document === 'undefined' ? null : document;
              if (!doc || !doc.visibilityState || doc.visibilityState === 'visible') start();
              else stop();
            }

            sync();
            let onVisibility = null;
            if (typeof document !== 'undefined' && document.addEventListener) {
              onVisibility = sync;
              document.addEventListener('visibilitychange', onVisibility);
            }
            return function () {
              live = false;
              stop();
              if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
            };
          },
          [view.phase],
        );

        // Keep review comments fresh: the user adds them on the Overleaf site,
        // so the panel must surface new threads without a manual refresh.
        React.useEffect(
          function () {
            if (view.phase !== 'project') return undefined;
            let live = true;
            let timer = null;
            let inFlight = false;

            function tick() {
              if (!live || inFlight) return;
              const doc = typeof document === 'undefined' ? null : document;
              if (doc && doc.visibilityState && doc.visibilityState !== 'visible') return;
              inFlight = true;
              request(R + '/comments')
                .then(function (body) {
                  inFlight = false;
                  if (!live) return;
                  const threads = objectList(body.threads);
                  set({ comments: threads, commentsError: '' });
                  notifyNewThreads(threads);
                })
                .catch(function () {
                  inFlight = false;
                });
            }

            function stop() {
              if (timer !== null) {
                clearInterval(timer);
                timer = null;
              }
            }

            function start() {
              if (timer !== null) return;
              tick();
              timer = setInterval(tick, COMMENTS_POLL_MS);
            }

            function sync() {
              const doc = typeof document === 'undefined' ? null : document;
              if (!doc || !doc.visibilityState || doc.visibilityState === 'visible') start();
              else stop();
            }

            sync();
            let onVisibility = null;
            if (typeof document !== 'undefined' && document.addEventListener) {
              onVisibility = sync;
              document.addEventListener('visibilitychange', onVisibility);
            }
            return function () {
              live = false;
              stop();
              if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
            };
          },
          [view.phase],
        );

        // -------------------------------------------------------------
        // Frame helpers
        // -------------------------------------------------------------
        function frame(header, content) {
          return h(
            'div',
            { className: 'al-panel', style: S.panel, role: 'region', 'aria-label': t('panelAria') },
            header || null,
            h('div', { className: 'al-scroll', style: S.scroll }, content),
          );
        }

        function loadingFrame() {
          return h(
            'div',
            { className: 'al-panel', style: S.panel, role: 'region', 'aria-label': t('panelAria') },
            h('div', { style: S.center }, t('loading')),
          );
        }

        function errorFrame() {
          return frame(
            null,
            h(
              'div',
              { style: { paddingTop: 16 } },
              h('div', { style: S.body }, t('loadFailed')),
              h(ErrorLine, { text: view.error, onRetry: loadStatus }),
            ),
          );
        }

        function userLabel(status) {
          if (!status || !status.user) return '';
          const user = status.user;
          const name = typeof user.name === 'string' && user.name ? user.name : user.email;
          return typeof name === 'string' && name ? t('connectedAs', { name: name }) : '';
        }

        // -------------------------------------------------------------
        // State 1: not connected
        // -------------------------------------------------------------
        function disconnectedFrame() {
          return frame(
            h(
              'div',
              { style: S.head },
              h('div', { style: Object.assign({}, S.body, { fontWeight: 600, minWidth: 0 }) }, t('connectTitle')),
            ),
            h(
              'div',
              { style: { paddingTop: 12 } },
              h('p', { style: Object.assign({}, S.caption, { margin: '0 0 10px', fontSize: 12, lineHeight: '18px' }) }, t('connectIntro')),
              h(
                'a',
                {
                  className: 'al-link',
                  href: SETUP_URL,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                  style: Object.assign({}, S.link, { display: 'inline-block', marginBottom: 12 }),
                },
                t('setupLink'),
              ),
              h('div', { style: Object.assign({}, S.caption, { marginBottom: 4 }) }, t('tokenLabel')),
              h(TextInput, {
                value: token,
                onChange: setToken,
                placeholder: t('tokenPlaceholder'),
                ariaLabel: t('tokenLabel'),
                password: true,
                disabled: view.busy === 'auth',
                onEnter: connect,
              }),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 } },
                h(
                  Btn,
                  {
                    primary: true,
                    onClick: connect,
                    disabled: view.busy === 'auth' || !token.trim(),
                  },
                  view.busy === 'auth' ? t('connecting') : t('connect'),
                ),
                userLabel(view.status)
                  ? h('span', { style: S.caption }, userLabel(view.status))
                  : null,
              ),
              h(ErrorLine, { text: view.actionError }),
            ),
          );
        }

        // -------------------------------------------------------------
        // State 2: connected, no project
        // -------------------------------------------------------------
        function projectRow(project) {
          const name = typeof project.name === 'string' && project.name ? project.name : String(project.id || '');
          const when = formatWhen(project.lastUpdated);
          const by = typeof project.lastUpdatedBy === 'string' ? project.lastUpdatedBy : '';
          return h(
            'button',
            {
              key: String(project.id || name),
              type: 'button',
              className: 'al-btn',
              'aria-label': t('openProjectLabel', { name: name }),
              disabled: view.busy === 'open',
              onClick: function () {
                openProject({ projectId: project.id });
              },
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                width: '100%',
                minHeight: 34,
                padding: '5px 8px',
                margin: 0,
                border: 'none',
                borderBottom: '0.5px solid var(--dsw-alias-border-l1)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                font: 'inherit',
                fontSize: 13,
                lineHeight: '20px',
                textAlign: 'left',
                cursor: view.busy === 'open' ? 'default' : 'pointer',
              },
            },
            h(
              'span',
              { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
              h('span', { className: 'al-ellipsis' }, name),
              when
                ? h(
                    'span',
                    { style: S.caption },
                    t('lastUpdated', { when: when }) + (by ? ' · ' + t('lastUpdatedBy', { name: by }) : ''),
                  )
                : null,
            ),
            h('span', { style: S.caption }, t('projectOpen')),
          );
        }

        function pickerFrame() {
          const projects = objectList(view.projects);
          return frame(
            h(
              'div',
              { style: S.head },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 } },
                h('span', { style: Object.assign({}, S.body, { fontWeight: 600 }) }, t('projectsTitle')),
                userLabel(view.status)
                  ? h('span', { className: 'al-ellipsis', style: S.caption }, userLabel(view.status))
                  : null,
              ),
              h(
                Btn,
                {
                  onClick: disconnect,
                  disabled: view.busy === 'logout',
                  title: t('disconnect'),
                },
                view.busy === 'logout' ? t('disconnecting') : t('disconnect'),
              ),
            ),
            h(
              'div',
              { style: { paddingTop: 8 } },
              h(ErrorLine, { text: view.actionError }),
              h(ErrorLine, { text: view.projectsError, onRetry: loadProjects }),
              projects.length === 0
                ? h(
                    'div',
                    { style: S.empty },
                    view.projectsBusy
                      ? t('loading')
                      : view.projectsError
                        ? ''
                        : t('projectsEmpty'),
                  )
                : h(
                    'div',
                    { style: { marginTop: 4 } },
                    projects.map(function (project) {
                      return projectRow(project);
                    }),
                  ),
              h(
                'div',
                { style: Object.assign({}, S.section, { marginTop: 16 }) },
                h('div', { style: Object.assign({}, S.caption, { marginBottom: 4 }) }, t('linkLabel')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                  h(TextInput, {
                    value: link,
                    onChange: setLink,
                    placeholder: t('linkPlaceholder'),
                    ariaLabel: t('linkLabel'),
                    disabled: view.busy === 'open',
                    onEnter: openLink,
                  }),
                  h(
                    Btn,
                    {
                      onClick: openLink,
                      disabled: view.busy === 'open' || !link.trim(),
                    },
                    view.busy === 'open' ? t('opening') : t('openLink'),
                  ),
                ),
              ),
            ),
          );
        }

        // -------------------------------------------------------------
        // State 3: project open
        // -------------------------------------------------------------
        function fileRow(node) {
          const name = nodeName(node);
          const dir = parentDir(node);
          const isDoc = node.type === 'doc';
          const href = isDoc && view.project ? docHref(view.status && view.status.baseUrl, view.project.id, node.id) : '';
          const glyph = h(FileGlyph, { key: 'glyph', doc: isDoc });
          const label = h(
            'span',
            {
              key: 'label',
              style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 },
            },
            h('span', { className: 'al-ellipsis' }, name),
            dir ? h('span', { className: 'al-ellipsis', style: S.caption }, dir) : null,
          );
          if (!isDoc) {
            return h(
              'div',
              {
                key: node.path,
                style: Object.assign({}, S.row, { cursor: 'default', opacity: 0.8 }),
              },
              glyph,
              label,
            );
          }
          return h(
            'div',
            {
              key: node.path,
              style: { display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 },
            },
            h(
              'a',
              {
                className: 'al-row',
                href: href,
                target: '_blank',
                rel: 'noreferrer noopener',
                'aria-label': t('openDocAria', { name: name }),
                style: Object.assign({}, S.row, { flex: 1 }),
              },
              glyph,
              label,
            ),
            h(
              'button',
              {
                type: 'button',
                title: t('preview'),
                'aria-label': t('previewAria', { name: name }),
                onClick: function () {
                  openPreview(node);
                },
                style: {
                  flexShrink: 0,
                  height: 22,
                  padding: '0 6px',
                  borderRadius: 6,
                  border: HAIRLINE,
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                  font: 'inherit',
                  fontSize: 11,
                  lineHeight: '14px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                },
              },
              t('preview'),
            ),
          );
        }

        function projectHeader(project) {
          const href = projectHref(project, view.status && view.status.baseUrl);
          return h(
            'div',
            { style: S.head },
            h(
              'button',
              {
                type: 'button',
                className: 'al-btn',
                title: t('back'),
                'aria-label': t('back'),
                onClick: backToProjects,
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  padding: 0,
                  border: 'none',
                  borderRadius: 6,
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                  cursor: 'pointer',
                  flexShrink: 0,
                },
              },
              h(
                'svg',
                { width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: 'false' },
                h('path', {
                  d: 'M10 3L5 8l5 5',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.6,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 } },
              h(
                'span',
                {
                  className: 'al-ellipsis',
                  style: Object.assign({}, S.body, { fontWeight: 600 }),
                  title: typeof project.name === 'string' ? project.name : '',
                },
                typeof project.name === 'string' && project.name ? project.name : t('projectFallback'),
              ),
              h(LiveDot),
              h('span', { style: S.caption }, t('live')),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
              h(
                'a',
                {
                  className: 'al-link',
                  href: href,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                  style: S.link,
                },
                t('openOnSite'),
              ),
              h(
                Btn,
                {
                  onClick: refreshAll,
                  disabled: view.busy === 'refresh',
                  title: t('refresh'),
                },
                view.busy === 'refresh' ? t('refreshing') : t('refresh'),
              ),
            ),
          );
        }

        function filesSection() {
          const nodes = sortedTree(view.tree);
          return h(
            Section,
            {
              title: t('filesTitle'),
              right: h('span', { style: S.caption }, t('filesCount', { count: nodes.length })),
            },
            h(ErrorLine, { text: view.treeError, onRetry: loadTree }),
            nodes.length === 0
              ? h(
                  'div',
                  { style: S.empty },
                  view.treeBusy ? t('loading') : view.treeError ? '' : t('filesEmpty'),
                )
              : h(
                  'div',
                  null,
                  nodes.map(function (node) {
                    return fileRow(node);
                  }),
                ),
          );
        }

        function compileSection() {
          const tone = compileTone(view.compile);
          const statusText =
            view.compile && view.compile.status != null && String(view.compile.status)
              ? t('compileStatus', { status: String(view.compile.status) })
              : '';
          const pdf = view.compile ? pdfHref(view.compile.pdfUrl, view.status && view.status.baseUrl) : '';
          return h(
            'section',
            { style: S.section },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h(
                Btn,
                { primary: true, onClick: compile, disabled: view.busy === 'compile' },
                view.busy === 'compile' ? t('compiling') : t('compile'),
              ),
              tone === 'success' ? h(Badge, { tone: 'success' }, t('compileSuccess')) : null,
              tone === 'error' ? h(Badge, { tone: 'error' }, t('compileFailure')) : null,
              pdf
                ? h(
                    'a',
                    {
                      className: 'al-link',
                      href: pdf,
                      target: '_blank',
                      rel: 'noreferrer noopener',
                      style: S.link,
                    },
                    t('openPdf'),
                  )
                : null,
            ),
            statusText ? h('div', { style: Object.assign({}, S.caption, { marginTop: 4 }) }, statusText) : null,
            tone === 'success' && !pdf
              ? h('div', { style: Object.assign({}, S.caption, { marginTop: 4 }) }, t('compileNoPdf'))
              : null,
            h(ErrorLine, { text: view.compileError }),
            view.compile && view.compile.log
              ? h(
                  'details',
                  { style: { marginTop: 6 } },
                  h('summary', { style: Object.assign({}, S.caption, { cursor: 'pointer' }) }, t('compileLog')),
                  h('pre', { className: 'al-pre', style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, String(view.compile.log)),
                )
              : null,
          );
        }

        function activitySection() {
          const events = objectList(view.events).slice().reverse().slice(0, 50);
          return h(
            Section,
            { title: t('activityTitle') },
            h(ErrorLine, { text: view.eventsError }),
            events.length === 0
              ? h('div', { style: S.empty }, view.eventsError ? '' : t('activityWaiting'))
              : h(
                  'div',
                  null,
                  events.map(function (event, index) {
                    const time = formatTime(event.at);
                    const kind = String(event.kind || '');
                    return h(
                      'div',
                      {
                        key: eventKey(event) + ':' + String(index),
                        style: {
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                          padding: '4px 0',
                          borderBottom: '0.5px solid var(--dsw-alias-border-l1)',
                          minWidth: 0,
                        },
                      },
                      h('span', { style: Object.assign({}, S.caption, { width: 58, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }) }, time),
                      h(
                        'span',
                        { style: { width: 62, flexShrink: 0 } },
                        h(Badge, { tone: kind === 'error' ? 'error' : kind === 'compile' ? 'accent' : 'neutral' }, kindLabel(kind)),
                      ),
                      h(
                        'span',
                        { style: { minWidth: 0, flex: 1, fontSize: 12, lineHeight: '18px', wordBreak: 'break-word' } },
                        String(event.summary || ''),
                        event.path
                          ? h('div', { className: 'al-ellipsis', style: S.caption }, String(event.path))
                          : null,
                      ),
                    );
                  }),
                ),
          );
        }

        function threadCard(thread) {
          const threadId = String(thread.threadId || '');
          const resolved = thread.resolved === true;
          const messages = objectList(thread.messages);
          const draft = String(drafts[threadId] == null ? '' : drafts[threadId]);
          const busy = view.busyThread === threadId;
          return h(
            'div',
            { key: threadId, style: Object.assign({}, S.card, { marginBottom: 8 }) },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, minWidth: 0 } },
              h(
                'span',
                { className: 'al-ellipsis', style: Object.assign({}, S.caption, { flex: 1 }) },
                String(thread.path || '') +
                  (thread.line ? ' · ' + t('lineRef', { line: thread.line }) : ''),
              ),
              h(Badge, { tone: resolved ? 'success' : 'neutral' }, resolved ? t('resolved') : t('unresolved')),
            ),
            thread.selectedText
              ? h(
                  'div',
                  {
                    style: {
                      borderLeft: '2px solid var(--dsw-alias-border-l3)',
                      paddingLeft: 8,
                      margin: '4px 0 6px',
                      color: 'var(--dsw-alias-label-secondary)',
                      fontSize: 12,
                      lineHeight: '18px',
                      wordBreak: 'break-word',
                    },
                  },
                  String(thread.selectedText),
                )
              : null,
            messages.map(function (msg) {
              return h(
                'div',
                { key: String(msg && msg.id), style: { marginBottom: 4 } },
                msg && msg.user
                  ? h('div', { style: S.caption }, String(msg.user))
                  : null,
                h('div', { style: { fontSize: 12, lineHeight: '18px', wordBreak: 'break-word' } }, String((msg && msg.content) || '')),
              );
            }),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 } },
              resolved
                ? null
                : h(
                    'div',
                    { style: { flex: 1, minWidth: 0 } },
                    h(TextInput, {
                      value: draft,
                      onChange: function (value) {
                        setDrafts(function (previous) {
                          const next = Object.assign({}, previous);
                          next[threadId] = value;
                          return next;
                        });
                      },
                      placeholder: t('replyPlaceholder'),
                      ariaLabel: t('replyPlaceholder'),
                      disabled: busy,
                      onEnter: function () {
                        sendReply(threadId);
                      },
                    }),
                  ),
              resolved
                ? null
                : h(
                    Btn,
                    { onClick: function () { sendReply(threadId); }, disabled: busy || !draft.trim() },
                    busy ? t('replying') : t('reply'),
                  ),
              h(
                Btn,
                {
                  onClick: function () {
                    setThreadResolved(thread, !resolved);
                  },
                  disabled: busy,
                },
                resolved ? t('reopen') : t('resolve'),
              ),
            ),
          );
        }

        function previewSection() {
          const preview = view.preview;
          if (!preview) return null;
          const selection = view.selection;
          return h(
            Section,
            {
              title: t('previewTitle'),
              right: h(Btn, { onClick: closePreview }, t('close')),
            },
            preview.busy
              ? h('div', { style: S.empty }, t('loading'))
              : preview.error
                ? h(ErrorLine, { text: preview.error, onRetry: function () { openPreview(preview); } })
                : h(
                    'div',
                    null,
                    h('div', { style: S.caption }, preview.path),
                    h(
                      'pre',
                      {
                        ref: preRef,
                        onMouseUp: captureSelection,
                        onKeyUp: captureSelection,
                        style: {
                          margin: '6px 0',
                          padding: 8,
                          maxHeight: 240,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontSize: 11.5,
                          lineHeight: '16px',
                          background: 'var(--dsw-alias-bg-layer-1)',
                          border: HAIRLINE,
                          borderRadius: 8,
                          color: 'var(--dsw-alias-label-primary)',
                          userSelect: 'text',
                        },
                      },
                      preview.text,
                    ),
                    selection
                      ? h(
                          'div',
                          {
                            style: {
                              borderLeft: '2px solid var(--dsw-alias-border-l3)',
                              paddingLeft: 8,
                              margin: '4px 0 6px',
                              color: 'var(--dsw-alias-label-secondary)',
                              fontSize: 12,
                              lineHeight: '18px',
                              maxHeight: 72,
                              overflow: 'auto',
                              wordBreak: 'break-word',
                            },
                          },
                          selection.text,
                        )
                      : h('div', { style: S.caption }, t('selectHint')),
                    h('textarea', {
                      value: view.newComment,
                      onChange: function (event) {
                        set({ newComment: event.target.value });
                      },
                      placeholder: t('commentPlaceholder'),
                      rows: 3,
                      style: {
                        boxSizing: 'border-box',
                        width: '100%',
                        marginTop: 6,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: HAIRLINE,
                        background: 'var(--dsw-alias-bg-base)',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 12,
                        lineHeight: '18px',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                      },
                    }),
                    h(
                      'div',
                      { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 } },
                      h(
                        Btn,
                        {
                          onClick: submitNewComment,
                          disabled: view.commentBusy || !String(view.newComment || '').trim() || !selection,
                        },
                        view.commentBusy ? t('submitting') : t('addComment'),
                      ),
                    ),
                  ),
          );
        }

        function pdfSection() {
          const compiled = view.compile;
          const hasPdf = Boolean(compiled && compiled.pdfUrl);
          return h(
            Section,
            {
              title: t('pdfTitle'),
              right: h(
                Btn,
                {
                  onClick: function () {
                    set({ pdfOpen: !view.pdfOpen, pdfNonce: view.pdfNonce + 1 });
                  },
                  disabled: view.busy === 'compile',
                },
                view.pdfOpen ? t('close') : t('pdfRender'),
              ),
            },
            view.pdfOpen
              ? h(
                  'div',
                  null,
                  h('iframe', {
                    src: R + '/pdf?t=' + String(view.pdfNonce),
                    title: t('pdfTitle'),
                    style: {
                      width: '100%',
                      height: 380,
                      border: HAIRLINE,
                      borderRadius: 8,
                      background: 'var(--dsw-alias-bg-layer-1)',
                    },
                  }),
                  h('div', { style: S.caption }, hasPdf ? t('pdfReady') : t('pdfHint')),
                )
              : h('div', { style: S.empty }, hasPdf ? t('pdfReady') : t('pdfHint')),
          );
        }

        function commentsSection() {
          const threads = objectList(view.comments);
          const pending = threads.filter(function (thread) {
            return thread && thread.resolved !== true;
          }).length;
          return h(
            Section,
            {
              title: t('commentsTitle'),
              right: h(
                'div',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
                h(
                  'label',
                  {
                    title: t('autoNotifyHint'),
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--dsw-alias-label-tertiary)',
                      whiteSpace: 'nowrap',
                    },
                  },
                  h('input', {
                    type: 'checkbox',
                    checked: view.autoNotify !== false,
                    onChange: function (event) {
                      set({ autoNotify: event.target.checked });
                    },
                    style: { margin: 0 },
                  }),
                  t('autoNotify'),
                ),
                pending > 0 ? h(Badge, { tone: 'neutral' }, t('pendingCount', { count: pending })) : null,
                h(
                  Btn,
                  { onClick: loadComments, disabled: view.commentsBusy },
                  view.commentsBusy ? t('loading') : t('refresh'),
                ),
              ),
            },
            h(ErrorLine, { text: view.commentsError, onRetry: loadComments }),
            threads.length === 0
              ? h(
                  'div',
                  { style: S.empty },
                  view.commentsBusy ? t('loading') : view.commentsError ? '' : t('commentsEmpty'),
                )
              : h(
                  'div',
                  null,
                  threads.map(function (thread) {
                    return threadCard(thread);
                  }),
                ),
          );
        }

        function projectFrame() {
          const project = view.project || {};
          return frame(
            projectHeader(project),
            h(
              'div',
              null,
              h(ErrorLine, { text: view.actionError }),
              filesSection(),
              previewSection(),
              compileSection(),
              pdfSection(),
              activitySection(),
              commentsSection(),
            ),
          );
        }

        if (view.phase === 'loading') return loadingFrame();
        if (view.phase === 'error') return errorFrame();
        if (view.phase === 'disconnected') return disconnectedFrame();
        if (view.phase === 'picker') return pickerFrame();
        return projectFrame();
      }

      // -------------------------------------------------------------------
      // Registrations
      // -------------------------------------------------------------------
      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          title: function () {
            return t('tab');
          },
          guide: [
            {
              id: 'latex',
              title: t('guideTitle'),
              description: t('guideDescription'),
            },
          ],
        });
      }, 'dsh-ustc-latex-agent: tab type');

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              locale: NS,
              inject: function (sessionId) {
                return { sessionId: String(sessionId) };
              },
            },
            Panel,
          );
        });
      }, 'dsh-ustc-latex-agent: pane body');

      ctx.effect(function () {
        return ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: TAB_ID,
              order: 60,
            },
            Launcher,
          );
        });
      }, 'dsh-ustc-latex-agent: launcher');
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply: apply,
    };
  },
});
