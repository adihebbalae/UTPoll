/**
 * inject.js — Runs in the PAGE context (injected by content.js).
 * Intercepts three transport layers used by Instapoll:
 *   1. WebSocket (Pusher) — real-time push; this is the primary alert path.
 *   2. fetch             — initial page-load poll check.
 *   3. XMLHttpRequest    — fallback for older code paths.
 *
 * All interception is read-only and non-blocking. The original behaviour of
 * every API is fully preserved.
 */
(function () {
  'use strict';

  // Config is passed via data-* attributes on the <script> element (CSP-safe — no inline scripts).
  // content.js also posts a UTPOLL_CONFIG message once storage has loaded so that the
  // accurate user settings are applied even though inject.js starts with safe defaults.
  const scriptEl   = document.currentScript;
  let patternStr   = (scriptEl && scriptEl.dataset.pattern)    || '/api/v1/student/course/*/poll';
  let courseId     = (scriptEl && scriptEl.dataset.courseId)   || '';
  let autoSubmit   = (scriptEl && scriptEl.dataset.autosubmit) === '1';
  const configNonce = (scriptEl && scriptEl.dataset.nonce)      || '';

  /** Convert a glob-style pattern (only * is special) to a RegExp. */
  function globToRegex(glob) {
    // Escape all regex metacharacters except *, then replace * with a URL-segment matcher.
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped.replace(/\*/g, '[^/?]+'));
  }

  let POLL_PATTERN = globToRegex(patternStr);

  // Receive the real user settings from content.js once chrome.storage resolves.
  // Requires a matching nonce to prevent spoofing by other page scripts.
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'UTPOLL_CONFIG') return;
    if (!configNonce || event.data.nonce !== configNonce) return;
    const cfg = event.data;
    if (cfg.pattern)  { patternStr = cfg.pattern; POLL_PATTERN = globToRegex(patternStr); }
    if (cfg.courseId !== undefined) courseId   = cfg.courseId;
    if (cfg.autosubmit !== undefined) autoSubmit = cfg.autosubmit === '1';
  });

  /** Returns true if the URL is a poll endpoint that should be monitored. */
  function shouldIntercept(url) {
    if (!url || !POLL_PATTERN.test(url)) return false;
    // If a specific course ID is configured, only monitor that course.
    if (courseId && !url.includes('/course/' + courseId + '/')) return false;
    return true;
  }

  /** Parse poll data and notify the content script. */
  function notify(data) {
    const isLive = Array.isArray(data) && data.length > 0;
    window.postMessage(
      { type: isLive ? 'UTPOLL_LIVE' : 'UTPOLL_IDLE', data: isLive ? data : [] },
      '*'
    );
    if (isLive && autoSubmit) {
      data.forEach(tryAutoSubmit);
    }
  }

  /**
   * Auto-submit an attendance poll using the page's own session credentials.
   * Only acts on trivial poll types (attendance / participation with no config).
   * Uses the original _fetch to avoid triggering our own interceptor.
   */
  async function tryAutoSubmit(poll) {
    const trivialTypes = ['attendance'];
    const hasNoQuestions = !poll.config_json || poll.config_json.length === 0;
    if (!trivialTypes.includes(poll.type) || !hasNoQuestions) return;

    // Look for a CSRF token in the standard locations.
    const csrfMeta   = document.querySelector('meta[name="csrf-token"]');
    const xsrfCookie = document.cookie.split(';')
      .find(c => c.trim().startsWith('XSRF-TOKEN='));
    const csrfToken  = csrfMeta?.content ||
      (xsrfCookie ? decodeURIComponent(xsrfCookie.split('=')[1].trim()) : null);

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (csrfToken) {
      headers['X-CSRF-TOKEN'] = csrfToken;
      headers['X-XSRF-TOKEN'] = csrfToken;
    }

    // Validate IDs are numeric to prevent path traversal.
    if (!/^\d+$/.test(String(poll.course_id)) || !/^\d+$/.test(String(poll.id))) return;

    // Try the most likely submission endpoint pattern.
    const url = `/api/v1/student/course/${poll.course_id}/poll/${poll.id}/respond`;
    try {
      const res = await _fetch(url, {
        method:      'POST',
        headers,
        credentials: 'same-origin',
        body:        JSON.stringify({}),
      });
      window.postMessage(
        { type: res.ok ? 'UTPOLL_AUTOSUBMIT_OK' : 'UTPOLL_AUTOSUBMIT_FAIL',
          status: res.status },
        '*'
      );
    } catch (err) {
      window.postMessage(
        { type: 'UTPOLL_AUTOSUBMIT_FAIL', error: err.message },
        '*'
      );
    }
  }

  // ── WebSocket interception (Pusher) ───────────────────────────────────────
  //
  // Pusher sends JSON frames with this shape:
  //   { event: "App\\Events\\SomeName", channel: "...", data: "<JSON string>" }
  //
  // We watch for any event whose data, when parsed, contains a non-empty
  // "polls" array (or is itself a non-empty array), or whose event name
  // contains "poll". Filtering is intentionally broad — Pusher events carry
  // their own payload so we don't need to match a URL pattern here.
  const _WS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new _WS(url, protocols) : new _WS(url);
    const isCampusPusher = /pusher-ws\.la\.utexas\.edu/i.test(String(url));

    if (isCampusPusher) {
      ws.addEventListener('message', (event) => {
        try {
          const frame = JSON.parse(event.data);
          // Pusher wraps the real payload as a JSON-string inside frame.data.
          const innerText = frame.data;
          if (!innerText) return;

          const inner = typeof innerText === 'string'
            ? JSON.parse(innerText)
            : innerText;

          // Detect poll payload: array at root, or object with a polls/poll property.
          let polls = null;
          if (Array.isArray(inner) && inner.length > 0) {
            polls = inner;
          } else if (inner && Array.isArray(inner.polls) && inner.polls.length > 0) {
            polls = inner.polls;
          } else if (inner && inner.poll) {
            polls = [inner.poll];
          }

          // If we found live poll data, and optional course filter matches, notify.
          if (polls) {
            // Course ID filter (if set).
            const filtered = courseId
              ? polls.filter(p => String(p.course_id) === String(courseId) ||
                                  String(p.courseId)  === String(courseId))
              : polls;
            if (filtered.length > 0) {
              notify(filtered);
              return;
            }
          }

          // If the event name itself mentions poll clearing / finishing, send IDLE.
          const evtName = String(frame.event || '').toLowerCase();
          if (evtName.includes('poll') && (evtName.includes('end') ||
              evtName.includes('finish') || evtName.includes('close') ||
              evtName.includes('stop'))) {
            window.postMessage({ type: 'UTPOLL_IDLE', data: [] }, '*');
          }
        } catch (_) {
          // Non-JSON frame (Pusher heartbeats etc.) — ignore silently.
        }
      });
    }

    return ws;
  };

  // Copy static properties (WebSocket.CONNECTING etc.) to the wrapper.
  Object.setPrototypeOf(window.WebSocket, _WS);
  Object.defineProperties(window.WebSocket, {
    CONNECTING: { value: 0 }, OPEN: { value: 1 },
    CLOSING:    { value: 2 }, CLOSED: { value: 3 },
  });

  // ── fetch interception ─────────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    // Always await the original fetch first — never delay or block it.
    const response = await _fetch.apply(this, args);

    let url = '';
    if (typeof args[0] === 'string')      url = args[0];
    else if (args[0] instanceof URL)      url = args[0].href;
    else if (args[0] instanceof Request)  url = args[0].url;

    if (shouldIntercept(url)) {
      // Clone the response so the page can still consume the original.
      response.clone().json().then(notify).catch(() => {});
    }

    return response;
  };

  // ── XHR interception ──────────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._utpoll_url = String(url);
    return _open.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (shouldIntercept(this._utpoll_url)) {
      this.addEventListener('load', function () {
        try { notify(JSON.parse(this.responseText)); } catch (_) {}
      });
    }
    return _send.apply(this, args);
  };
})();
