// ==UserScript==
// @name         Rapid Feedback (DeepSeek redesign)
// @namespace    rapid-feedback.deepseek
// @version      1.0.0
// @description  Annotate any element on any page, then export developer-ready feedback as Markdown or JSON.
// @author       DeepSeek independent rebuild
// @match        *://*/*
// @run-at       document_idle
// @grant        none
// ==/UserScript==

/**
 * Rapid Feedback — an independent re-implementation designed purely from the
 * project brief (`.scratch/app-brief.md`). No code from the original repo was
 * read. Single-file, zero-dependency, vanilla JS, Shadow-DOM-isolated chrome.
 */
(function () {
  'use strict';

  /* =====================================================================
   * 1. BOOT & RE-INJECTION GUARD
   * ===================================================================== */

  if (window.__SCOPE_FEEDBACK_LOADED__) return;
  window.__SCOPE_FEEDBACK_LOADED__ = true;

  var STORAGE_KEY = 'rapidFeedback.annotations.v1';
  var LEGACY_STORAGE_KEY = 'rapidFeedback.annotations';

  /* =====================================================================
   * 2. PLATFORM DETECTION
   * ===================================================================== */

  function detectPlatform() {
    var uaData = navigator.userAgentData;
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
      // Best effort; treat as async and read synchronously via a cached flag.
    }
    if (uaData && uaData.platform) {
      return String(uaData.platform).toLowerCase();
    }
    var ua = navigator.userAgent || '';
    if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'macos';
    if (/Win/i.test(ua)) return 'windows';
    if (/Linux/i.test(ua)) return 'linux';
    return 'unknown';
  }

  var PLATFORM = detectPlatform();
  var IS_MAC = PLATFORM.indexOf('mac') === 0 || /iphone|ipad|ipod/.test(PLATFORM);

  /**
   * The chord modifiers: Alt+Meta on macOS, Alt+Ctrl elsewhere.
   * Exposed as a function so tests/other modules can read current chord state.
   */
  function chordMatches(e) {
    var alt = e.altKey;
    var mod = IS_MAC ? e.metaKey : e.ctrlKey;
    return !!alt && !!mod;
  }

  /* ---------------------------------------------------------------------
   * Small DOM / string helpers
   * --------------------------------------------------------------------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function closest(el, fn) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      if (fn(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /** Real hit-test at a point, piercing overlay layers to the top-most *solid* element. */
  function elementAt(clientX, clientY) {
    if (typeof document.elementsFromPoint === 'function') {
      var stack = document.elementsFromPoint(clientX, clientY);
      for (var i = 0; i < stack.length; i++) {
        var el = stack[i];
        if (el === document.documentElement || el === document.body) continue;
        // Skip any of our own tool chrome (all our roots carry a marker attr).
        if (el.hasAttribute && el.hasAttribute('data-rf-chrome')) continue;
        return el;
      }
      return document.body;
    }
    return document.elementFromPoint(clientX, clientY) || document.body;
  }

  function viewport() {
    return {
      w: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
      h: Math.max(document.documentElement.clientHeight, window.innerHeight || 0)
    };
  }

  function browserAndOS() {
    var ua = navigator.userAgent || '';
    var browser = 'Unknown';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Chrome\//i.test(ua) && !/Chromium|CriOS/i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/MSIE|Trident/i.test(ua)) browser = 'IE';
    var os = 'Unknown';
    if (/Mac/i.test(ua)) os = 'macOS';
    else if (/Windows|Win/i.test(ua)) os = 'Windows';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    return { browser: browser, os: os };
  }

  /* =====================================================================
   * 3. SHADOW CHROME FACTORY
   * ===================================================================== */

  /**
   * Create a detached container attached to the body, hosting a shadow root
   * with an `all:initial` reset and our own stylesheet. Returns an object:
   * { root, host, baseStyles(css) }.
   */
  function createChrome(id) {
    var host = document.createElement('div');
    host.setAttribute('data-rf-chrome', '');
    host.setAttribute('data-rf-id', id);
    host.style.cssText =
      'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent =
      ':host{all:initial}' +
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
      'font-size:13px;line-height:1.4;color:#1d2733;}' +
      'button,input,textarea,select{font:inherit;color:inherit;}' +
      'button{cursor:pointer;border:none;background:transparent;}' +
      '.btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;' +
      'border-radius:6px;font-weight:600;background:#eef1f5;color:#1d2733;}' +
      '.btn:hover{background:#e2e6ec;}' +
      '.btn.primary{background:#2b6de8;color:#fff;}' +
      '.btn.primary:hover{background:#2458c4;}' +
      '.btn.danger{background:#fff1f0;color:#cf1322;}' +
      '.btn.small{padding:2px 8px;font-size:12px;}' +
      'input[type=text],textarea{width:100%;border:1px solid #cdd4dc;border-radius:6px;' +
      'padding:6px 8px;background:#fff;}' +
      'textarea{resize:vertical;}' +
      'input[type=range]{width:100%;}' +
      'input:focus,textarea:focus{outline:2px solid #2b6de8;outline-offset:1px;border-color:#2b6de8;}';
    root.appendChild(style);
    return {
      root: root,
      host: host,
      style: style,
      /** Append a <style> block of additional CSS scoped to this chrome. */
      addCss: function (css) {
        var s = document.createElement('style');
        s.textContent = css;
        root.appendChild(s);
      },
      /** A content container that itself never intercepts pointer events. */
      layer: function () {
        var div = document.createElement('div');
        div.style.cssText =
          'all:initial;position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;';
        root.appendChild(div);
        return div;
      }
    };
  }

  /* =====================================================================
   * 4. SELECTOR GENERATION
   * ===================================================================== */

  var UTILITY_RE = /^(flex|grid|hidden|block|inline|contents|static|relative|absolute|fixed|sticky|m[tblrxy]?-|p[tblrxy]?-|mx-|my-|px-|py-|gap-|w-|h-|min-w-|max-w-|min-h-|max-h-|text-|leading-|tracking-|font-|bg-|from-|via-|to-|border|rounded|shadow|opacity-|transition-|duration-|ease-|delay-|scale-|rotate-|translate-|overflow-|whitespace-|break-|z-|order-|basis-|content-|items-|justify-|self-|place-|col-|row-|inset-|top-|right-|bottom-|left-|space-|divide-|ring-|fill-|stroke-|object-|aspect-|sr-only|pointer-events-|select-|align-|clear-|float-|list-|table-|transform-|visible|invisible|collapse|resize-|isolate|mix-blend-|backdrop-|blur-|brightness-|contrast-|grayscale-|hue-|invert-|saturate-|sepia-)/;
  var SVELTE_RE = /\.svelte-[a-z0-9]+/gi;
  var PREF_ATTRS = ['aria-label', 'name', 'href', 'src', 'placeholder', 'data-testid', 'data-cy', 'data-test', 'role', 'title', 'alt'];

  function isMeaningfulId(id) {
    return !!id && !/^[a-z0-9]{8,}$/i.test(id) && id.length <= 64;
  }

  function semanticClasses(el) {
    var out = [];
    var cls = el.classList || [];
    for (var i = 0; i < cls.length; i++) {
      var c = cls[i];
      if (!c) continue;
      if (SVELTE_RE.test('.' + c)) continue;
      if (UTILITY_RE.test(c)) continue;
      if (/^[0-9a-f]{6,}$/i.test(c)) continue; // hash-like
      out.push(c);
    }
    return out;
  }

  function highSignalAttr(el) {
    for (var i = 0; i < PREF_ATTRS.length; i++) {
      var name = PREF_ATTRS[i];
      var v = el.getAttribute(name);
      if (v && v.trim()) {
        // Don't use href/src when they are data-ish or empty hashes.
        if ((name === 'href' || name === 'src') && (!v || /^[\s"']*$/.test(v) || v === '#')) continue;
        var safe = v.replace(/"/g, '\\"').split(/\s+/).join('\\ ');
        if (safe.length > 0 && safe.length <= 80) return '[' + name + '="' + safe + '"]';
      }
    }
    return null;
  }

  /** One segment descriptor for level el. */
  function segmentFor(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id && isMeaningfulId(el.id)) {
      return { text: '#' + el.id, forceFull: true };
    }
    var attr = highSignalAttr(el);
    var classes = semanticClasses(el);
    if (attr) return { text: tag + attr, forceFull: false };
    if (classes.length) {
      return { text: tag + '.' + classes.join('.'), forceFull: false };
    }
    return { text: tag, forceFull: false };
  }

  /**
   * Build the shortest unique selector. Try progressively longer ancestor
   * chains (child-first) and return the first that matches exactly one element.
   */
  function shortestUniqueSelector(el) {
    if (!el || el.nodeType !== 1) return '';

    var chain = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 14) {
      if (cur === document.documentElement || cur === document.body) break;
      chain.unshift(segmentFor(cur));
      depth++;
    }
    chain.unshift({ text: 'body', forceFull: true });
    chain.unshift({ text: 'html', forceFull: true });

    var preferForce = -1;
    for (var i = 0; i < chain.length; i++) {
      if (chain[i].forceFull) preferForce = i;
    }

    var maxLen = Math.min(12, chain.length);
    // Try increasing hover-chain lengths; if an id/force appears, honor it.
    for (var len = 1; len <= maxLen; len++) {
      var start = Math.max(0, chain.length - len);
      var segs = chain.slice(start);
      var selector = segs.map(function (s) { return s.text; }).join(' > ');
      try {
        var matches = document.querySelectorAll(selector);
        if (matches.length === 1) return selector;
        if (matches.length === 0) continue;
        // Multi-match but our element is among them and we're at a forced milepost → give nearest desc.
        if (preferForce >= start && len >= 3) {
          // fall through to longer chain
        }
      } catch (e) {
        /* invalid selector fragment — skip */
      }
    }
    // Fallback: as unique as possible without throwing.
    return buildFallbackSelector(el);
  }

  /** Structural fallback using :nth-of-type along a capped ancestor chain. */
  function buildFallbackSelector(el) {
    var parts = [];
    var cur = el;
    var count = 0;
    while (cur && cur !== document.body && cur !== document.documentElement && cur !== null && count < 12) {
      var tag = cur.tagName ? cur.tagName.toLowerCase() : '';
      var nth = 1;
      var p = cur.parentElement;
      if (p) {
        var kids = p.children;
        var idx = 0;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].tagName === cur.tagName) idx++;
          if (kids[k] === cur) break;
        }
        nth = idx;
      }
      parts.unshift(tag + ':nth-of-type(' + nth + ')');
      cur = p;
      count++;
    }
    return 'body ' + parts.join(' > ');
  }

  /* =====================================================================
   * 5. ELEMENT CAPTURE
   * ===================================================================== */

  function elementText(el) {
    var txt = (el.innerText != null ? el.innerText : el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt.length > 150) txt = txt.slice(0, 147) + '…';
    return txt;
  }

  var STYLE_PROPS = [
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
    'color', 'background-color', 'background-image',
    'border-radius', 'border-width', 'border-style', 'border-color',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'display', 'position', 'flex-direction', 'gap', 'opacity', 'visibility', 'overflow'
  ];

  function computedSnapshot(el) {
    var cs = window.getComputedStyle(el);
    var out = {};
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var p = STYLE_PROPS[i];
      var v = cs.getPropertyValue(p).trim();
      if (v) out[p] = v;
    }
    return out;
  }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return {
      x: round2(r.x), y: round2(r.y), width: round2(r.width), height: round2(r.height),
      top: round2(r.top), left: round2(r.left), right: round2(r.right), bottom: round2(r.bottom)
    };
  }

  function accessibleName(el) {
    if (el.getAttribute && el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    var lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) {
      var ref = document.getElementById(lb);
      if (ref) return ref.textContent.replace(/\s+/g, ' ').trim();
    }
    var alt = el.getAttribute && el.getAttribute('alt');
    if (alt) return alt;
    var title = el.getAttribute && el.getAttribute('title');
    if (title) return title;
    var label = closest(el, function (n) {
      if (n.nodeType === 1 && n.tagName === 'LABEL' && n.htmlFor === (el.id || '') && n.textContent.trim()) return true;
      return false;
    });
    if (label && label.nodeType === 1) return label.textContent.replace(/\s+/g, ' ').trim();
    return '';
  }

  function explicitOrImplicitRole(el) {
    var r = el.getAttribute && el.getAttribute('role');
    if (r) return r;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var map = {
      a: 'link', button: 'button', img: 'img', h1: 'heading', h2: 'heading', h3: 'heading',
      h4: 'heading', h5: 'heading', h6: 'heading', input: 'textbox', textarea: 'textbox',
      select: 'combobox', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
      ul: 'list', ol: 'list', li: 'listitem', table: 'table', form: 'form', dialog: 'dialog'
    };
    return map[tag] || '';
  }

  function testId(el) {
    var t = el.getAttribute && (
      el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-test')
    );
    return t || '';
  }

  function a11yInfo(el) {
    return {
      role: explicitOrImplicitRole(el),
      name: accessibleName(el),
      testid: testId(el)
    };
  }

  /** Svelte source mapping from __svelte_meta on the nearest ancestor. */
  function svelteSource(el) {
    var meta = null;
    var ancestor = el;
    while (ancestor && ancestor.nodeType === 1) {
      if (ancestor.__svelte_meta && ancestor.__svelte_meta.loc) {
        meta = ancestor.__svelte_meta;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (!meta || !meta.loc) return null;
    var loc = meta.loc;
    var frames = [];
    var cur = meta;
    var count = 0;
    while (cur && count < 12) {
      if (cur && cur.loc) {
        frames.push({
          file: cur.loc.file || '',
          line: cur.loc.line != null ? cur.loc.line : 0,
          column: cur.loc.column != null ? cur.loc.column : 0
        });
      }
      cur = cur.ownerMeta || cur.parentMeta || null;
      count++;
    }
    return {
      file: (loc.file || ''),
      line: loc.line != null ? loc.line : 0,
      column: loc.column != null ? loc.column : 0,
      stack: frames
    };
  }

  function captureElement(el) {
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      selector: shortestUniqueSelector(el),
      text: elementText(el),
      styles: computedSnapshot(el),
      rect: rectOf(el),
      a11y: a11yInfo(el),
      svelte: svelteSource(el)
    };
  }

  /* ---------------------------------------------------------------------
   * Similarity (for ⧉ Select similar)
   * --------------------------------------------------------------------- */

  /** Semantic signature: tag + sorted semantic classes. */
  function elementSignature(el) {
    var classes = semanticClasses(el).slice().sort();
    return (el.tagName ? el.tagName.toLowerCase() : '') + '|' + classes.join(',');
  }

  function findSimilar(primary) {
    if (!primary || !primary.parentElement) return [];
    var sig = elementSignature(primary);
    var kids = primary.parentElement.children;
    var out = [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === primary) continue;
      if (elementSignature(kids[i]) === sig) out.push(kids[i]);
      if (out.length >= 50) break;
    }
    return out;
  }

  /* =====================================================================
   * 6. STATE STORE (localStorage persistence, per-origin scoping)
   * ===================================================================== */

  var Store = (function () {
    var items = [];
    var origin = location.origin || '';
    var loaded = false;

    function normalize(list) {
      return (Array.isArray(list) ? list : []).filter(function (a) {
        return a && typeof a === 'object';
      }).map(function (a) {
        // Drop oversized/old fields we don't use; keep schema shape.
        return a;
      });
    }

    function load() {
      if (loaded) return items;
      loaded = true;
      var raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      if (!raw) {
        // Migrate legacy key.
        try {
          var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy) {
            localStorage.setItem(STORAGE_KEY, legacy);
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            raw = legacy;
          }
        } catch (e) {}
      }
      items = normalize(raw ? JSON.parse(raw) : []);
      return items;
    }

    function save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch (e) {}
    }

    /** True if the current origin has saved annotations (drives FAB reveal). */
    function hasLocal() {
      return items.some(function (a) { return a.origin === origin; });
    }

    function add(annotation) {
      annotation.origin = origin;
      items.unshift(annotation);
      save();
      return annotation;
    }

    function update(id, patch) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === id) {
          items[i] = Object.assign({}, items[i], patch);
          items[i].updatedAt = Date.now();
          break;
        }
      }
      save();
    }

    function remove(id) {
      items = items.filter(function (a) { return a.id !== id; });
      save();
    }

    function clear() {
      items = []; save();
    }

    function getAll() { return items.slice(); }

    return {
      load: load, getAll: getAll, add: add, update: update, remove: remove,
      clear: clear, hasLocal: hasLocal,
      get origin() { return origin; }
    };
  })();

  /* =====================================================================
   * 7. TOASTS
   * ===================================================================== */

  var Toast = (function () {
    var chrome = null;
    function ensure() {
      if (!chrome) {
        chrome = createChrome('rf-toast');
        chrome.root.appendChild(chrome.layer());
      }
      return chrome;
    }
    function show(msg, ms) {
      var c = ensure();
      var layer = c.root.firstChild;
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText =
        'pointer-events:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
        'background:#1d2733;color:#fff;padding:9px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
        'opacity:0;transition:opacity .18s ease;max-width:80vw;z-index:1;';
      layer.appendChild(t);
      requestAnimationFrame(function () { t.style.opacity = '1'; });
      setTimeout(function () {
        t.style.opacity = '0';
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 200);
      }, ms || 2600);
    }
    return { show: show };
  })();

  /* =====================================================================
   * 8. INPUT CONTROLLER & HOVER PREVIEW
   * ===================================================================== */

  var Hover = (function () {
    var chrome = null;
    var layer = null;
    var current = null; // element being hovered
    var frame = null;

    function ensure() {
      if (!chrome) {
        chrome = createChrome('rf-hover');
        layer = chrome.layer();
        chrome.addCss(
          '@keyframes rfPulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}' +
          '.rf-hover-box{position:fixed;border:2px solid #2b6de8;border-radius:3px;' +
          'animation:rfPulse 1.1s ease-in-out infinite;z-index:1;pointer-events:none;' +
          'box-shadow:0 0 0 1px rgba(43,109,232,.3),0 0 12px rgba(43,109,232,.5);}'
        );
      }
      return chrome;
    }

    function clearBox() {
      if (layer) { var kids = layer.childNodes; for (var i = kids.length - 1; i >= 0; i--) layer.removeChild(kids[i]); }
      current = null;
    }

    /** Coalesced hit-test + outline on the hovered element. Coalesced per rAF. */
    function poll(clientX, clientY) {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = null;
        var target = elementAt(clientX, clientY);
        if (target === current) return;
        current = target;
        ensure();
        clearBox();
        if (!target) return;
        var box = document.createElement('div');
        box.className = 'rf-hover-box';
        var r = target.getBoundingClientRect();
        box.style.left = (r.left - 2) + 'px';
        box.style.top = (r.top - 2) + 'px';
        box.style.width = (r.width + 4) + 'px';
        box.style.height = (r.height + 4) + 'px';
        layer.appendChild(box);
      });
    }

    function hide() {
      if (frame) { cancelAnimationFrame(frame); frame = null; }
      clearBox();
    }

    return { poll: poll, hide: hide };
  })();

  /** Green markers for accumulating group members. */
  var Markers = (function () {
    var chrome = null;
    var layer = null;
    function ensure() {
      if (!chrome) {
        chrome = createChrome('rf-markers');
        layer = chrome.layer();
        chrome.addCss(
          '.rf-mark{position:fixed;background:#22a06b;border:2px solid #fff;border-radius:50%;' +
          'width:18px;height:18px;transform:translate(-50%,-50%);z-index:1;' +
          'box-shadow:0 2px 6px rgba(0,0,0,.3);color:#fff;font-size:11px;font-weight:700;' +
          'display:flex;align-items:center;justify-content:center;pointer-events:none;}'
        );
      }
      return chrome;
    }
    function render(elements, primaryIndex) {
      ensure();
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      elements.forEach(function (el, i) {
        if (!el || !el.getBoundingClientRect) return;
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        var m = document.createElement('div');
        m.className = 'rf-mark';
        m.textContent = String(i + 1);
        m.style.left = (r.left + r.width / 2) + 'px';
        m.style.top = (r.top + r.height / 2) + 'px';
        if (i === primaryIndex) m.style.background = '#e8590c';
        layer.appendChild(m);
      });
    }
    function clear() { if (layer) while (layer.firstChild) layer.removeChild(layer.firstChild); }
    return { render: render, clear: clear };
  })();

  /* =====================================================================
   * 9. ANNOTATION / DRAFT MODEL
   * ===================================================================== */

  var EMPTY_DRAFT = function () {
    return {
      id: null,
      category: 'General',
      comment: '',
      label: '',
      targets: [],        // capture snapshots array (one per member)
      selector: '',
      text: '',
      a11y: {},
      where: [],
      tag: '',
      rect: null,
      adjustedStyles: {}, // prop -> value, applied live
      destination: null,
      groupSize: 0,
      hints: []
    };
  };

  function whereChain(el) {
    var parts = [];
    var cur = el;
    var count = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && count < 8) {
      var tag = cur.tagName ? cur.tagName.toLowerCase() : '';
      var cls = cur.id ? '#' + cur.id : (semanticClasses(cur)[0] ? '.' + semanticClasses(cur)[0] : '');
      parts.unshift(tag + cls);
      cur = cur.parentElement;
      count++;
    }
    return parts;
  }

  /** Given a live selection (primary element + members), build the draft capture. */
  function buildDraftFromSelection(selection, primaryIndex, draft) {
    var primaryEl = selection[primaryIndex] || selection[0];
    var primCapture = captureElement(primaryEl);
    draft = draft || EMPTY_DRAFT();
    draft.selector = primCapture.selector;
    draft.text = primCapture.text;
    draft.tag = primCapture.tag;
    draft.rect = primCapture.rect;
    draft.a11y = primCapture.a11y;
    draft.svelte = primCapture.svelte;
    draft.where = whereChain(primaryEl);
    draft.targets = selection.map(function (el, i) {
      if (i === primaryIndex) return primCapture;
      return captureElement(el);
    });
    draft.groupSize = selection.length;
    draft.label = draft.label || primCapture.text.slice(0, 60) || (primCapture.tag || 'element');
    return draft;
  }

  /**
   * Resolve a saved annotation's member elements on the current page.
   * Returns { found: Element[] or null, missing, total } — null found set means
   * the primary no longer resolves.
   */
  function resolveTargets(annotation) {
    var selectors = [];
    if (annotation.selector) selectors.push(annotation.selector);
    (annotation.targets || []).forEach(function (t) {
      if (t && t.selector && selectors.indexOf(t.selector) === -1) selectors.push(t.selector);
    });
    var found = [];
    var missing = 0;
    for (var i = 0; i < selectors.length; i++) {
      var sel = selectors[i];
      var el = null;
      try { el = document.querySelector(sel); } catch (e) { el = null; }
      if (el) found.push(el); else missing++;
    }
    var primaryFound = null;
    try { primaryFound = document.querySelector(annotation.selector); } catch (e) { primaryFound = null; }
    return {
      found: primaryFound ? found : found.length ? found : null,
      primaryFound: !!primaryFound,
      missing: missing,
      total: selectors.length
    };
  }

  /* =====================================================================
   * 10. POPOVER (Shadow DOM) — comment-first, tabbed, anchored
   * ===================================================================== */

  var CATEGORIES = ['General', 'Bug', 'Feature', 'Suggestion', 'Question'];

  var Popover = (function () {
    var chrome = null;
    var layer = null;
    var open = false;
    var draft = null;
    var selection = [];
    var primaryIndex = 0;
    var anchorEl = null;      // host element this popover tracks (follow)
    var snapshots = new Map(); // Element -> {prop:value}
    var membersForUndo = [];
    var editId = null;        // annotation id being edited (null = new draft)
    var raf = null;
    var view = 'comment';     // current tab

    /* ----- DOM refs (rebuilt on each open) ----- */
    var refs = {};

    /* ---------- Live style tweak support ---------- */
    var TWEAK_PROPS = [
      ['padding', 'padding', '12px'], ['margin', 'margin', '0px'],
      ['font-size', 'font-size', '16px'], ['color', 'color', '#1d2733'],
      ['background-color', 'background-color', '#ffffff'],
      ['border-radius', 'border-radius', '4px'],
      ['width', 'width', ''], ['height', 'height', ''],
      ['gap', 'gap', ''], ['line-height', 'line-height', ''],
      ['opacity', 'opacity', '1']
    ];

    function snapshotStyles(elements) {
      snapshots = new Map();
      elements.forEach(function (el) {
        if (!el || !el.style) return;
        var m = new Map();
        (el.style.cssText || '').split(';').forEach(function (decl) {
          var i = decl.indexOf(':');
          if (i > 0) m.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
        });
        snapshots.set(el, m);
      });
    }

    function restoreSnapshots() {
      snapshots.forEach(function (vals, el) {
        if (!el || !el.style) return;
        var css = [];
        vals.forEach(function (v, k) { css.push(k + ': ' + v); });
        el.style.cssText = css.join('; ');
      });
      snapshots = new Map();
    }

    function applyTweaksToAll() {
      selection.forEach(function (el) {
        if (!el || !el.style) return;
        Object.keys(draft.adjustedStyles).forEach(function (prop) {
          el.style[prop] = draft.adjustedStyles[prop];
        });
      });
    }

    /* ---------- ensure chrome ---------- */
    function ensure() {
      if (!chrome) {
        chrome = createChrome('rf-popover');
        layer = chrome.layer();
        chrome.addCss(requirePopoverCss());
      }
      return chrome;
    }

    function requirePopoverCss() {
      return [
        '.rf-wrap{pointer-events:auto;position:fixed;width:320px;background:#fff;' +
        'border:1px solid #d8dee6;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.22);' +
        'display:flex;flex-direction:column;overflow:hidden;z-index:2;}',
        '.rf-head{display:flex;align-items:center;gap:6px;padding:8px 10px;' +
        'border-bottom:1px solid #eef1f5;background:#fafbfc;flex-wrap:wrap;}',
        '.rf-head .lbl{font-weight:600;font-size:12px;color:#4a5568;max-width:150px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.rf-nav{display:flex;gap:4px;}',
        '.rf-tabs{display:flex;padding:6px 10px 0;gap:4px;border-bottom:1px solid #eef1f5;}',
        '.rf-tabs button{padding:4px 10px;border-radius:6px 6px 0 0;color:#5a6472;font-weight:600;}',
        '.rf-tabs button.on{background:#eef3fd;color:#2b6de8;}',
        '.rf-body{padding:10px;display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto;}',
        '.rf-cats{display:flex;flex-wrap:wrap;gap:5px;}',
        '.rf-cats button{padding:3px 10px;border-radius:20px;border:1px solid #d8dee6;font-size:12px;}',
        '.rf-cats button.on{background:#2b6de8;color:#fff;border-color:#2b6de8;}',
        '.rf-dest{display:flex;align-items:center;gap:6px;}',
        '.rf-members{margin-top:2px;}',
        '.rf-member{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:6px;font-size:12px;}',
        '.rf-member:hover{background:#f4f6f9;}',
        '.rf-member .mk{width:16px;height:16px;border-radius:50%;background:#22a06b;color:#fff;' +
        'font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;}',
        '.rf-member .mk.primary{background:#e8590c;}',
        '.rf-member .p{color:#2b6de8;margin-left:auto;}',
        '.rf-member .x{color:#cf1322;font-weight:700;padding:0 3px;}',
        '.rf-member .tag{font-size:11px;color:#718096;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;}',
        '.rf-tweakrow{display:flex;align-items:center;gap:8px;}',
        '.rf-tweakrow label{width:130px;flex:none;font-size:12px;color:#4a5568;}',
        '.rf-tweakrow input[type=range]{flex:1;}',
        '.rf-tweakrow output{width:52px;text-align:right;font-size:11px;color:#718096;}',
        '.rf-tweakrow .num{width:64px;flex:none;}',
        '.rf-footer{display:flex;gap:6px;padding:8px 10px;border-top:1px solid #eef1f5;' +
        'background:#fafbfc;align-items:center;}',
        '.rf-footer .spacer{flex:1;}',
        '.rf-destbar{font-size:12px;color:#2b6de8;}',
        '.rf-destbar .d{padding:2px 10px;border:1px dashed #2b6de8;border-radius:6px;}',
        '.rf-where{font-size:11px;color:#718096;word-break:break-all;}' +
        '.rf-where b{color:#4a5568;}',
        '.rf-toolbar{display:flex;gap:4px;align-items:center;}',
        '.rf-zoom{font-weight:700;color:#4a5568;padding:2px 6px;border-radius:5px;}' +
        '.rf-zoom:hover{background:#eef1f5;}',
        '.rf-note{font-size:11px;color:#718096;}' +
        '.no-scrollbar::-webkit-scrollbar{width:0;height:0;}' +
        '.rf-missing{font-size:11px;color:#e8590c;background:#fff4e6;padding:4px 8px;border-radius:6px;}'
      ].join('\n');
    }

    /* ---------- open helpers ---------- */

    function resetChrome() {
      if (layer) while (layer.firstChild) layer.removeChild(layer.firstChild);
    }

    function setupDraftTargets() {
      // ensure draft.targets exists
      if (!draft.targets || !draft.targets.length) {
        draft.targets = selection.map(function (el) { return captureElement(el); });
      }
      draft.groupSize = selection.length;
    }

    function render() {
      resetChrome();
      var wrap = document.createElement('div');
      wrap.className = 'rf-wrap';
      layer.appendChild(wrap);

      // --- header: label + zoom row + tabs ---
      var head = document.createElement('div');
      head.className = 'rf-head';

      var lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = (draft.label || draft.text || (draft.tag || 'element')).slice(0, 60);
      head.appendChild(lbl);

      var zoom = document.createElement('div');
      zoom.className = 'rf-zoom';
      zoom.innerHTML =
        '<button class="rf-zoom" data-zoom="up" title="Parent">▲</button>' +
        '<button class="rf-zoom" data-zoom="down" title="First child">▼</button>' +
        '<button class="rf-zoom" data-zoom="prev" title="Previous sibling">◀</button>' +
        '<button class="rf-zoom" data-zoom="next" title="Next sibling">▶</button>';
      head.appendChild(zoom);

      var toolbar = document.createElement('div');
      toolbar.className = 'rf-toolbar';
      toolbar.innerHTML =
        '<button class="btn small" data-act="cut">Cut</button>';
      head.appendChild(toolbar);

      wrap.appendChild(head);

      // --- tabs ---
      var tabs = document.createElement('div');
      tabs.className = 'rf-tabs';
      tabs.innerHTML =
        '<button data-view="comment" class="' + (view === 'comment' ? 'on' : '') + '">Comment</button>' +
        '<button data-view="styles" class="' + (view === 'styles' ? 'on' : '') + '">Styles</button>';
      wrap.appendChild(tabs);

      // --- body ---
      var body = document.createElement('div');
      body.className = 'rf-body';
      wrap.appendChild(body);

      if (view === 'comment') renderComment(body);
      else renderStyles(body);

      // --- footer ---
      var footer = document.createElement('div');
      footer.className = 'rf-footer';
      footer.innerHTML =
        '<button class="btn" data-act="cancel">Cancel</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn primary" data-act="submit">Submit</button>';
      wrap.appendChild(footer);

      // --- event binding ---
      wrap.addEventListener('click', onWrapClick);
      wrap.addEventListener('input', onWrapInput);
      wrap.addEventListener('keydown', onWrapKeydown);

      refs.wrap = wrap;
      refs.body = body;

      position();
    }

    function renderComment(body) {
      var note = document.createElement('div');
      note.className = 'rf-where';
      note.innerHTML = '<b>' + escapeHtml(draft.tag || 'element') + '</b> ' +
        escapeHtml((draft.where || []).join(' › '));
      body.appendChild(note);

      var ta = document.createElement('textarea');
      ta.rows = 3;
      ta.placeholder = 'Write a comment…';
      ta.value = draft.comment || '';
      ta.dataset.field = 'comment';
      body.appendChild(ta);
      refs.comment = ta;

      var cats = document.createElement('div');
      cats.className = 'rf-cats';
      CATEGORIES.forEach(function (c) {
        var b = document.createElement('button');
        b.textContent = c;
        b.dataset.category = c;
        if (c === draft.category) b.className = 'on';
        cats.appendChild(b);
      });
      body.appendChild(cats);

      // members editor
      var memList = document.createElement('div');
      memList.className = 'rf-members';
      renderMembers(memList);
      body.appendChild(memList);

      // missing disclosure (edit mode, reopening stored annotation)
      if (editId) {
        var resolved = resolveTargets(annotationFor(editId));
        if (resolved.missing > 0) {
          var miss = document.createElement('div');
          miss.className = 'rf-missing';
          miss.textContent = resolved.missing + ' of ' + resolved.total + ' members still found on this page';
          body.appendChild(miss);
        }
      }

      // destination
      var destRow = document.createElement('div');
      destRow.className = 'rf-dest';
      var destInfo = document.createElement('span');
      destInfo.className = 'rf-destbar';
      renderDestination(destInfo);
      var pickBtn = document.createElement('button');
      pickBtn.className = 'btn small';
      pickBtn.textContent = draft.destination ? 'Change' : 'Pick destination';
      pickBtn.dataset.act = 'pick-dest';
      destRow.appendChild(destInfo);
      destRow.appendChild(pickBtn);
      body.appendChild(destRow);
      refs.destInfo = destInfo;
    }

    function renderDestination(el) {
      if (draft.destination && draft.destination.selector) {
        el.innerHTML = '→ Move to <span class="d">' + escapeHtml(shortSelector(draft.destination.selector)) + '</span>';
      } else {
        el.innerHTML = '<span class="rf-note">No destination</span>';
      }
    }

    function renderMembers(container) {
      while (container.firstChild) container.removeChild(container.firstChild);
      selection.forEach(function (el, i) {
        var row = document.createElement('div');
        row.className = 'rf-member';
        var mk = document.createElement('span');
        mk.className = 'mk' + (i === primaryIndex ? ' primary' : '');
        mk.textContent = String(i + 1);
        var tag = document.createElement('span');
        var cap = (draft.targets && draft.targets[i]) || captureElement(el);
        tag.className = 'tag';
        tag.textContent = (cap.text || cap.tag || el.tagName || 'el').slice(0, 40);
        row.appendChild(mk);
        row.appendChild(tag);
        if (i === primaryIndex) {
          var p = document.createElement('span');
          p.className = 'p';
          p.textContent = 'primary';
          row.appendChild(p);
        } else {
          var promote = document.createElement('button');
          promote.className = 'x';
          promote.title = 'Make primary';
          promote.textContent = '★';
          promote.dataset.member = String(i);
          row.appendChild(promote);
        }
        var rm = document.createElement('button');
        rm.className = 'x';
        rm.title = 'Remove';
        rm.textContent = '✕';
        rm.dataset.removemember = String(i);
        row.appendChild(rm);
        container.appendChild(row);
      });

      var tools = document.createElement('div');
      tools.className = 'rf-toolbar';
      tools.innerHTML =
        '<button class="btn small" data-act="add-element">+ Add element</button>' +
        '<button class="btn small" data-act="similar">⧉ Select similar</button>';
      container.appendChild(tools);
    }

    function renderStyles(body) {
      var note = document.createElement('div');
      note.className = 'rf-note';
      note.textContent = 'Styles apply live to every selected element. Cancel/Submit restore or keep them.';
      body.appendChild(note);

      TWEAK_PROPS.forEach(function (cfg) {
        var name = cfg[0];
        var prop = cfg[1];
        var placeholder = cfg[2];
        var isColor = prop === 'color' || prop === 'background-color';
        var isOpacity = prop === 'opacity';

        var row = document.createElement('div');
        row.className = 'rf-tweakrow';

        var label = document.createElement('label');
        label.textContent = name;
        row.appendChild(label);

        var current = draft.adjustedStyles[prop];

        if (isOpacity) {
          var range = document.createElement('input');
          range.type = 'range';
          range.min = '0'; range.max = '1'; range.step = '0.01';
          range.value = current != null ? clamp(parseFloat(current), 0, 1) : '1';
          range.dataset.tweak = prop;
          var out = document.createElement('output');
          out.textContent = range.value;
          row.appendChild(range);
          row.appendChild(out);
          refs['out-' + prop] = out;
        } else if (isColor) {
          var colorIn = document.createElement('input');
          colorIn.type = 'color';
          colorIn.value = normalizeColor(current);
          colorIn.dataset.tweak = prop;
          row.appendChild(colorIn);
          var textIn = document.createElement('input');
          textIn.type = 'text';
          textIn.className = 'num';
          textIn.placeholder = placeholder;
          textIn.value = current || '';
          textIn.dataset.tweakText = prop;
          row.appendChild(textIn);
        } else {
          var num = document.createElement('input');
          num.type = 'text';
          num.className = 'num';
          num.placeholder = placeholder;
          num.value = current || '';
          num.dataset.tweak = prop;
          row.appendChild(num);
        }
        body.appendChild(row);
      });
    }

    function normalizeColor(v) {
      if (!v) return '#ffffff';
      var cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      var c = cv.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillStyle = v;
      return c.fillStyle;
    }

    function shortSelector(sel) {
      if (!sel) return '';
      var parts = sel.split(' > ');
      return parts[parts.length - 1] || sel;
    }

    /* ---------- interaction ---------- */

    function onWrapClick(e) {
      var t = e.target;
      var act = t.dataset ? t.dataset.act : undefined;
      if (act) {
        if (act === 'cancel') cancel();
        else if (act === 'submit') submit();
        else if (act === 'cut') cut();
        else if (act === 'pick-dest') startPickDestination();
        else if (act === 'add-element') startPickElement();
        else if (act === 'similar') selectSimilar();
        return;
      }
      if (t.dataset && t.dataset.zoom) { zoom(t.dataset.zoom); return; }
      if (t.dataset && t.dataset.view) { view = t.dataset.view; render(); return; }
      if (t.dataset && t.dataset.category) {
        draft.category = t.dataset.category;
        var cats = e.currentTarget.querySelectorAll('.rf-cats button');
        cats.forEach(function (b) {
          b.className = (b.dataset.category === t.dataset.category) ? 'on' : '';
        });
        return;
      }
      if (t.dataset && t.dataset.member != null) {
        primaryIndex = parseInt(t.dataset.member, 10);
        rebaseAfterPrimaryChange();
        return;
      }
      if (t.dataset && t.dataset.removemember != null) {
        var idx = parseInt(t.dataset.removemember, 10);
        selection.splice(idx, 1);
        if (primaryIndex >= selection.length) primaryIndex = Math.max(0, selection.length - 1);
        if (primaryIndex >= idx) primaryIndex = Math.max(0, primaryIndex - 1);
        rebaseAfterPrimaryChange();
        return;
      }
    }

    function onWrapInput(e) {
      var t = e.target;
      if (!t.dataset) return;
      if (t.dataset.field) { draft.comment = t.value; return; }
      if (t.dataset.tweak) {
        var prop = t.dataset.tweak;
        var val = t.value;
        if (prop === 'opacity') {
          draft.adjustedStyles[prop] = String(parseFloat(val) || 0);
          if (refs['out-' + prop]) refs['out-' + prop].textContent = t.value;
        } else {
          draft.adjustedStyles[prop] = val;
          // sync the paired text input for color fields
          if (refs && refs.wrap) {
            var pair = refs.wrap.querySelector('[data-tweak-text="' + prop + '"]');
            if (pair && t.type === 'color') pair.value = val;
          }
        }
        applyTweaksToAll();
      }
      if (t.dataset.tweakText) {
        var prop2 = t.dataset.tweakText;
        draft.adjustedStyles[prop2] = t.value;
        applyTweaksToAll();
      }
    }

    function onWrapKeydown(e) {
      // arrow key increment/decrement for numeric inputs; shift = x10
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        var t = e.target;
        if (t && t.tagName === 'INPUT' && t.dataset && (t.dataset.tweak || t.dataset.tweakText)) {
          e.preventDefault();
          var prop = t.dataset.tweak || t.dataset.tweakText;
          if (prop === 'padding' || prop === 'margin') return; // skip freeform multi-value
          var cv = t.value;
          var num = parseFloat(cv);
          if (isNaN(num)) return;
          var step = e.shiftKey ? 10 : 1;
          var mult = cv.includes('px') || cv.includes('em') || cv.includes('rem') ? '' : 'px';
          var newVal = (e.key === 'ArrowUp' ? num + step : num - step);
          // clamp opacity
          if (prop === 'opacity') newVal = clamp(newVal, 0, 1);
          var out = newVal + mult;
          t.value = out;
          draft.adjustedStyles[prop] = out;
          applyTweaksToAll();
        }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); e.stopPropagation();
        submit();
      }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        cancel();
      }
    }

    function rebaseAfterPrimaryChange() {
      // primary index changed (promote/remove): re-capture election from live selection
      draft = buildDraftFromSelection(selection, primaryIndex, draft);
      // reset pending style edits
      restoreSnapshots();
      draft.adjustedStyles = {};
      // re-snapshot for live tweaks
      snapshotStyles(selection);
      render();
      Markers.render(selection, primaryIndex);
    }

    /* ---------- zoom ---------- */
    function zoom(dir) {
      var el = selection[0] || selection[primaryIndex] || anchorEl;
      if (!el) return;
      var next = null;
      if (dir === 'up') next = el.parentElement;
      else if (dir === 'down') next = el.firstElementChild;
      else if (dir === 'prev') next = el.previousElementSibling;
      else if (dir === 'next') next = el.nextElementSibling;
      if (!next || next === document.body || next === document.documentElement) return;
      // Retarget selection[0] to new element, drop other members.
      selection = [next];
      primaryIndex = 0;
      anchorEl = next;
      // reset pending style edits
      restoreSnapshots();
      draft.adjustedStyles = {};
      draft = buildDraftFromSelection(selection, 0, draft);
      snapshotStyles(selection);
      render();
      Markers.render(selection, 0);
    }

    /* ---------- actions ---------- */

    function cancel() {
      restoreSnapshots();
      dismiss();
    }

    function submit() {
      var final = normalizedAnnotation();
      if (editId) {
        // resolve on page; if elements resolve, sync DOM; else just save data
        Store.update(editId, final);
        Toast.show('Annotation updated');
      } else {
        final.id = 'rf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        Store.add(final);
        Toast.show('Annotation saved');
      }
      applyTweaksToAll(); // keep edits applied on submit
      dismiss();
      FAB.refresh();
      Panel.refresh();
    }

    function cut() {
      var final = normalizedAnnotation();
      copyMarkdownForOne(final);
      Toast.show('Copied as Markdown (not saved)');
      restoreSnapshots(); // Cut should not keep edits? brief: "Cut (copy this one annotation without saving)". Keep edits? We restore to be safe (no submit semantics).
      dismiss();
    }

    function normalizedAnnotation() {
      return {
        id: editId || null,
        category: draft.category,
        comment: (draft.comment || '').trim(),
        label: (draft.label || draft.text || draft.tag || '').slice(0, 80),
        text: draft.text,
        tag: draft.tag,
        selector: draft.selector,
        targetSelector: draft.selector,
        a11y: draft.a11y,
        svelte: draft.svelte,
        where: draft.where || [],
        rect: draft.rect,
        adjustedStyles: draft.adjustedStyles || {},
        destination: draft.destination || null,
        groupSize: draft.groupSize,
        targets: draft.targets || [],
        hints: draft.hints || [],
        pageUrl: location.href,
        createdAt: editId ? (annotationFor(editId) || {}).createdAt || Date.now() : Date.now()
      };
    }

    function annotationFor(id) {
      return Store.getAll().filter(function (a) { return a.id === id; })[0] || null;
    }

    /* ---------- anchoring ---------- */

    function position() {
      if (!open || !refs.wrap || !anchorEl) return;
      var r = anchorEl.getBoundingClientRect();
      var vp = viewport();
      var w = refs.wrap.offsetWidth || 320;
      var h = refs.wrap.offsetHeight || 200;

      var placements = [
        { x: r.left + r.width / 2 - w / 2, y: r.bottom + 8, ok: r.bottom + 8 + h <= vp.h },
        { x: r.left + r.width / 2 - w / 2, y: r.top - h - 8, ok: r.top - h - 8 >= 0 },
        { x: r.left - w - 8, y: r.top + r.height / 2 - h / 2, ok: r.left - w - 8 >= 0 },
        { x: r.right + 8, y: r.top + r.height / 2 - h / 2, ok: r.right + 8 + w <= vp.w }
      ];
      var chosen = placements[0];
      for (var i = 0; i < placements.length; i++) {
        if (placements[i].ok) { chosen = placements[i]; break; }
      }
      // clamp to viewport without covering target
      chosen.x = clamp(chosen.x, 6, vp.w - w - 6);
      chosen.y = clamp(chosen.y, 6, vp.h - h - 6);
      refs.wrap.style.left = chosen.x + 'px';
      refs.wrap.style.top = chosen.y + 'px';
    }

    function follow() {
      if (!open) return;
      position();
      raf = requestAnimationFrame(follow);
    }

    /* ---------- pick modes (destination / add-element) ---------- */

    function startPickDestination() {
      Input.deactivatePickChrome(); // ensure the popover's own layer doesn't swallow later
      beginPick('destination');
    }

    function startPickElement() {
      beginPick('element');
    }

    function beginPick(kind) {
      Input.enterPick(kind);
    }

    function selectSimilar() {
      var primaryEl = selection[primaryIndex] || selection[0];
      if (!primaryEl) return;
      var similar = findSimilar(primaryEl);
      if (!similar.length) { Toast.show('No similar siblings found'); return; }
      membersForUndo = selection.slice();
      var merged = selection.slice();
      similar.forEach(function (el) {
        if (merged.indexOf(el) === -1) merged.push(el);
      });
      selection = merged;
      draft = buildDraftFromSelection(selection, primaryIndex, draft);
      snapshotStyles(selection);
      render();
      Markers.render(selection, primaryIndex);
      Toast.show('Added ' + similar.length + ' similar (undo) — press Undo');
    }

    /* ---------- public popover API used by Input ---------- */

    function openForSelection(elements, primary, editRef) {
      ensure();
      selection = elements.slice();
      primaryIndex = clamp(primary != null ? primary : 0, 0, Math.max(0, elements.length - 1));
      anchorEl = selection[primaryIndex] || elements[0];
      editId = editRef ? editRef.id : null;
      draft = editRef ? buildEditDraft(editRef) : EMPTY_DRAFT();
      draft = buildDraftFromSelection(selection, primaryIndex, draft);
      snapshotStyles(selection);
      open = true;
      view = 'comment';
      render();
      follow();
      Markers.render(selection, primaryIndex);
      Input.notifyChromeOpen();
    }

    function buildEditDraft(a) {
      var d = EMPTY_DRAFT();
      d.id = a.id;
      d.category = a.category;
      d.comment = a.comment;
      d.label = a.label;
      d.text = a.text;
      d.tag = a.tag;
      d.selector = a.selector;
      d.targetSelector = a.selector;
      d.a11y = a.a11y || {};
      d.svelte = a.svelte;
      d.where = a.where || [];
      d.rect = a.rect;
      d.adjustedStyles = a.adjustedStyles || {};
      d.destination = a.destination || null;
      d.targets = a.targets || [];
      d.hints = a.hints || [];
      d.groupSize = a.groupSize || 1;
      return d;
    }

    function dismiss() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      restoreSnapshots();
      open = false;
      resetChrome();
      Markers.clear();
      Input.notifyChromeClosed();
    }

    function isOpen() { return open; }
    function getDraft() { return draft; }
    function getSelection() { return selection; }
    function getEditId() { return editId; }
    function refreshRender() { if (open) render(); }

    // when a pick mode resolves (from Input), grow/capture while keeping popover open
    function addMemberElement(el) {
      if (selection.indexOf(el) === -1) selection.push(el);
      draft = buildDraftFromSelection(selection, primaryIndex, draft);
      render();
      Markers.render(selection, primaryIndex);
    }

    function setDestination(targetEl) {
      draft.destination = targetEl ? {
        selector: captureElement(targetEl).selector,
        tag: targetEl.tagName.toLowerCase(),
        text: elementText(targetEl).slice(0, 60),
        where: whereChain(targetEl)
      } : null;
      render();
      Toast.show('Destination set');
    }

    /* Copy a single annotation as Markdown (Cut). */
    function copyMarkdownForOne(annotation) {
      var md = Exporter.markdownSingle(annotation);
      Clipboard.copy(md);
    }

    return {
      openForSelection: openForSelection, dismiss: dismiss, isOpen: isOpen,
      getDraft: getDraft, getSelection: getSelection, getEditId: getEditId,
      refreshRender: refreshRender, addMemberElement: addMemberElement,
      setDestination: setDestination, startPickDestination: startPickDestination,
      startPickElement: startPickElement
    };
  })();

  /* =====================================================================
   * 11. INPUT CONTROLLER — chord, hit test, pick modes
   * ===================================================================== */

  var Input = (function () {
    var chordsHeld = 0;       // how many chord keys currently down
    var grabbing = false;     // chord fully held
    var accum = [];           // elements accumulated during current hold
    var accumPrimary = 0;
    var pickMode = null;      // null | 'destination' | 'element'
    var lastPoint = null;
    var suppressClick = false;

    function chordDown(e) {
      if (!chordMatches(e)) return;
      if (!chordsHeld) {
        chordsHeld = 1;
        grabbing = true;
        Hover.hide();
      }
    }

    function chordUp(e) {
      if (!chordMatches(e)) return;
      chordsHeld = Math.max(0, chordsHeld - 1);
      if (chordsHeld === 0) {
        var wasGrabbing = grabbing;
        grabbing = false;
        if (wasGrabbing) endGrab();
      }
    }

    function mouseMove(e) {
      lastPoint = { x: e.clientX, y: e.clientY };
      if (grabbing && !pickMode) {
        // hovering preview while chord held
        Hover.poll(e.clientX, e.clientY);
      }
    }

    function mouseDown(e) {
      if (pickMode === 'destination') {
        // plain click selects destination (chord not required here)
        e.preventDefault();
        var dest = elementAt(e.clientX, e.clientY);
        if (dest) {
          Popover.setDestination(dest);
          leavePick();
        }
        suppressClick = true;
        return;
      }
      if (pickMode === 'element') {
        e.preventDefault();
        var mem = elementAt(e.clientX, e.clientY);
        if (mem) Popover.addMemberElement(mem);
        leavePick();
        suppressClick = true;
        return;
      }
      if (grabbing) {
        // chord-click: capture element(s) via overlay piercing
        e.preventDefault();
        e.stopPropagation();
        var target = elementAt(e.clientX, e.clientY);
        if (target) {
          accum.push(target);
          Markers.render(accum, 0);
        }
        suppressClick = true;
        return;
      }
    }

    function mouseUp() {
      suppressClick = false;
    }

    function click(e) {
      if (suppressClick) {
        e.preventDefault(); e.stopPropagation();
        suppressClick = false;
      }
    }

    /** Growing selection: chord-click while popover open. Handled in endGrab. */

    function endGrab() {
      if (accum.length === 0) return;
      var elements = accum.slice();
      accum = [];
      Markers.clear();

      if (Popover.isOpen()) {
        // grow the current selection instead of discarding draft
        var existing = Popover.getSelection().slice();
        elements.forEach(function (el) {
          if (existing.indexOf(el) === -1) existing.push(el);
        });
        Popover.openForSelection(existing, 0);
        return;
      }
      Popover.openForSelection(elements, 0);
    }

    /* pick mode (destination / element). While a pick runs, tool chrome is click-through. */
    function enterPick(kind) {
      pickMode = kind;
      document.body.style.cursor = 'crosshair';
      Hint.show(kind === 'destination'
        ? 'Click an element to record the destination. Esc to cancel.'
        : 'Click an element to add it to the group. Esc to cancel.');
      deactivatePickChrome();
    }

    /** Keep chrome from swallowing clicks while picking: set pointer-events none on chrome hosts. */
    function deactivatePickChrome() {
      var hosts = document.querySelectorAll('[data-rf-chrome]');
      hosts.forEach(function (h) { h.style.pointerEvents = 'none'; });
    }

    function reactivateChrome() {
      var hosts = document.querySelectorAll('[data-rf-chrome]');
      hosts.forEach(function (h) { h.style.pointerEvents = ''; });
    }

    function leavePick() {
      if (!pickMode) return;
      pickMode = null;
      document.body.style.cursor = '';
      Hint.hide();
      reactivateChrome();
    }

    function onKeydown(e) {
      chordDown(e);
      if (e.key === 'Escape') {
        // Esc layers: cancel pick -> close popover -> close panel
        if (pickMode) { leavePick(); Toast.show('Pick cancelled'); return; }
        if (Popover.isOpen()) { Popover.dismiss(); return; }
        if (Panel.isOpen()) { Panel.close(); return; }
        return;
      }
      if (chordMatches(e) && (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt')) {
        // just modifier, no action
        return;
      }
    }

    function onKeyup(e) {
      chordUp(e);
    }

    function onKeydownGlobal(e) {
      onKeydown(e);
    }

    function onKeyupGlobal(e) {
      onKeyup(e);
    }

    // Double-tapping the chord toggles the panel.
    var lastChordTap = 0;
    function chordTapDetect() {
      var now = Date.now();
      if (now - lastChordTap < 400) {
        Panel.toggle();
        lastChordTap = 0;
      } else {
        lastChordTap = now;
      }
    }

    function onKeydownForTap(e) {
      if (chordMatches(e) && (e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Alt')) {
        // a chord+non-modifier keypress, not a tap
        lastChordTap = 0;
      }
    }

    function notifyChromeOpen() { reactivateChrome(); }
    function notifyChromeClosed() { reactivateChrome(); }

    function bind() {
      document.addEventListener('mousemove', mouseMove, true);
      document.addEventListener('mousedown', mouseDown, true);
      document.addEventListener('mouseup', mouseUp, true);
      document.addEventListener('click', click, true);
      window.addEventListener('keydown', onKeydownGlobal, true);
      window.addEventListener('keyup', onKeyupGlobal, true);
      // double-chord tap
      window.addEventListener('keydown', function (e) {
        if (chordMatches(e) && (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt')) {
          chordTapDetect();
        }
      }, false);
      // Escape priority handled in onKeydownGlobal
    }

    return {
      bind: bind, enterPick: enterPick, leavePick: leavePick,
      deactivatePickChrome: deactivatePickChrome, reactivateChrome: reactivateChrome,
      notifyChromeOpen: notifyChromeOpen, notifyChromeClosed: notifyChromeClosed
    };
  })();

  /* =====================================================================
   * 12. HINT BANNER
   * ===================================================================== */

  var Hint = (function () {
    var chrome = null;
    var node = null;
    function ensure() {
      if (!chrome) {
        chrome = createChrome('rf-hint');
        chrome.addCss(
          '.rf-hint-banner{position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
          'background:rgba(29,39,51,.92);color:#fff;padding:10px 18px;border-radius:10px;' +
          'box-shadow:0 6px 24px rgba(0,0,0,.3);z-index:2;pointer-events:none;' +
          'display:flex;align-items:center;gap:8px;font-size:14px;}'
        );
      }
      return chrome;
    }
    function show(text) {
      var c = ensure();
      if (node && node.parentNode) node.parentNode.removeChild(node);
      node = document.createElement('div');
      node.className = 'rf-hint-banner';
      node.textContent = text;
      c.root.appendChild(node);
    }
    function hide() {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      node = null;
    }
    return { show: show, hide: hide };
  })();

  /* =====================================================================
   * 13. CLIPBOARD
   * ===================================================================== */

  var Clipboard = (function () {
    function copy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { navigator.clipboard.writeText(text); } catch (e) {}
      }
    }
    return { copy: copy };
  })();

  /* =====================================================================
   * 14. SIDE PANEL (Shadow DOM)
   * ===================================================================== */

  var Panel = (function () {
    var chrome = null;
    var layer = null;
    var open = false;
    var refs = {};

    function ensure() {
      if (!chrome) {
        chrome = createChrome('rf-panel');
        layer = chrome.layer();
        chrome.addCss(
          '.rf-panel{position:fixed;top:0;right:0;height:100vh;width:380px;max-width:92vw;' +
          'background:#fff;box-shadow:-6px 0 30px rgba(0,0,0,.18);z-index:3;' +
          'display:flex;flex-direction:column;pointer-events:auto;}',
          '.rf-panel-head{display:flex;align-items:center;gap:8px;padding:12px 14px;' +
          'border-bottom:1px solid #eef1f5;background:#fafbfc;font-weight:700;font-size:15px;}',
          '.rf-panel-head .spacer{flex:1;}',
          '.rf-toolbar{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid #eef1f5;flex-wrap:wrap;}',
          '.rf-list{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;}',
          '.rf-card{border:1px solid #e4e8ee;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;background:#fff;}',
          '.rf-card .top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
          '.rf-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;}',
          '.rf-chip.General{background:#eef1f5;color:#4a5568;}' +
          '.rf-chip.Bug{background:#fff1f0;color:#cf1322;}' +
          '.rf-chip.Feature{background:#e6f4ff;color:#0958d9;}' +
          '.rf-chip.Suggestion{background:#f6ffed;color:#389e0d;}' +
          '.rf-chip.Question{background:#fff7e6;color:#d46b08;}',
          '.rf-sel{font-size:12px;color:#718096;word-break:break-all;flex:1;}',
          '.rf-size{font-size:11px;color:#4a5568;background:#eef1f5;padding:2px 6px;border-radius:10px;}',
          '.rf-comment{font-size:13px;white-space:pre-wrap;color:#1d2733;}',
          '.rf-comment.editable{outline:1px dashed #2b6de8;outline-offset:2px;border-radius:4px;padding:4px;}',
          '.rf-src{font-size:11px;color:#718096;font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;}' +
          '.rf-src b{color:#4a5568;}',
          '.rf-adj{font-size:11px;color:#4a5568;background:#f6f8fa;border-radius:6px;padding:4px 6px;}' +
          '.rf-adj b{color:#1d2733;}',
          '.rf-foot{display:flex;flex-direction:column;gap:6px;padding:10px 14px;border-top:1px solid #eef1f5;}' +
          '.rf-foot .cats{display:flex;gap:5px;flex-wrap:wrap;}',
          '.rf-foot .cats button{padding:2px 8px;border-radius:20px;border:1px solid #d8dee6;font-size:12px;}' +
          '.rf-foot .cats button.on{background:#2b6de8;color:#fff;border-color:#2b6de8;}',
          '.rf-card-actions{display:flex;gap:6px;margin-top:2px;}'
        );
      }
      return chrome;
    }

    function render() {
      reset();
      var list = Store.getAll().filter(function (a) { return a.origin === Store.origin; });
      var panel = document.createElement('div');
      panel.className = 'rf-panel';
      layer.appendChild(panel);

      var head = document.createElement('div');
      head.className = 'rf-panel-head';
      head.innerHTML = '<span>Feedback</span><span class="spacer"></span>' +
        '<button class="btn small primary" data-act="close">✕</button>';
      panel.appendChild(head);

      var toolbar = document.createElement('div');
      toolbar.className = 'rf-toolbar';
      toolbar.innerHTML =
        '<button class="btn small" data-act="copy-md">Copy Markdown</button>' +
        '<button class="btn small" data-act="copy-json">JSON</button>' +
        '<button class="btn small" data-act="cut-all">Cut All</button>' +
        '<button class="btn small danger" data-act="clear">Clear</button>';
      panel.appendChild(toolbar);

      var listEl = document.createElement('div');
      listEl.className = 'rf-list';
      if (!list.length) {
        var empty = document.createElement('div');
        empty.className = 'rf-comment';
        empty.style.color = '#8a94a6';
        empty.textContent = 'No annotations yet. Hold ' + chordLabel() + ' and click an element to annotate.';
        listEl.appendChild(empty);
      } else {
        list.forEach(function (a) { listEl.appendChild(card(a)); });
      }
      panel.appendChild(listEl);
      refs.list = listEl;

      // footer quick add
      var foot = document.createElement('div');
      foot.className = 'rf-foot';
      var ta = document.createElement('textarea');
      ta.rows = 2;
      ta.placeholder = 'Add a general note… (⌘/Ctrl+Enter)';
      ta.dataset.quick = '';
      var cats = document.createElement('div');
      cats.className = 'cats';
      var selCat = 'General';
      CATEGORIES.forEach(function (c) {
        var b = document.createElement('button');
        b.textContent = c;
        b.dataset.qcat = c;
        if (c === selCat) b.className = 'on';
        cats.appendChild(b);
      });
      foot.appendChild(cats);
      foot.appendChild(ta);
      panel.appendChild(foot);

      panel.addEventListener('click', onPanelClick);
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          var text = ta.value.trim();
          if (!text) return;
          Store.add({ id: 'rf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), category: selCat, comment: text, label: 'note' });
          ta.value = '';
          Toast.show('Note added');
          render();
        }
      });
      refs.cats = cats;
      refs.quick = ta;

      // category chip switching within footer
      cats.addEventListener('click', function (e) {
        var b = e.target.closest('[data-qcat]');
        if (!b) return;
        selCat = b.dataset.qcat;
        cats.querySelectorAll('[data-qcat]').forEach(function (x) { x.className = x === b ? 'on' : ''; });
      });
    }

    function card(a) {
      var c = document.createElement('div');
      c.className = 'rf-card';
      c.dataset.id = a.id;

      var top = document.createElement('div');
      top.className = 'top';
      var chip = document.createElement('span');
      chip.className = 'rf-chip ' + escapeHtml(String(a.category || 'General').replace(/\s/g, ''));
      chip.textContent = a.category || 'General';
      var label = document.createElement('span');
      label.className = 'rf-sel';
      label.textContent = (a.label || a.text || a.tag || 'element').slice(0, 40);
      var size = a.groupSize > 1
        ? '<span class="rf-size">' + a.groupSize + '</span>' : '';
      top.innerHTML = size;
      top.insertBefore(label, top.firstChild);
      top.insertBefore(chip, top.firstChild);
      c.appendChild(top);

      if (a.comment) {
        var com = document.createElement('div');
        com.className = 'rf-comment editable';
        com.contentEditable = 'true';
        com.textContent = a.comment;
        com.addEventListener('blur', function () {
          Store.update(a.id, { comment: (com.textContent || '').trim() });
        });
        com.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        c.appendChild(com);
      }

      if (a.svelte && a.svelte.file) {
        var src = document.createElement('div');
        src.className = 'rf-src';
        var file = a.svelte.file.split('/').pop();
        src.innerHTML = '<b>' + escapeHtml(file) + '</b>:' + a.svelte.line + ':' + a.svelte.column;
        if (a.svelte.stack && a.svelte.stack.length > 1) {
          src.innerHTML += ' <span style="opacity:.6">(' + (a.svelte.stack.length) + ' frames)</span>';
        }
        c.appendChild(src);
      } else if (a.source) {
        var src2 = document.createElement('div');
        src2.className = 'rf-src';
        src2.innerHTML = '<b>' + escapeHtml(a.source.split('/').pop()) + '</b>';
        c.appendChild(src2);
      }

      if (a.adjustedStyles && Object.keys(a.adjustedStyles).length) {
        var adj = document.createElement('div');
        adj.className = 'rf-adj';
        adj.innerHTML = '<b>Tweaks:</b> ' + Object.keys(a.adjustedStyles).map(function (k) {
          return escapeHtml(k) + ': ' + escapeHtml(a.adjustedStyles[k]);
        }).join('; ');
        c.appendChild(adj);
      }

      var url = document.createElement('div');
      url.className = 'rf-src';
      url.innerHTML = escapeHtml(a.pageUrl || '');
      c.appendChild(url);

      var actions = document.createElement('div');
      actions.className = 'rf-card-actions';
      actions.innerHTML =
        '<button class="btn small" data-act="edit">Edit</button>' +
        '<button class="btn small danger" data-act="delete">Delete</button>';
      c.appendChild(actions);
      return c;
    }

    function onPanelClick(e) {
      var t = e.target;
      var act = t.dataset ? t.dataset.act : undefined;
      if (!act) return;
      if (act === 'close') { close(); return; }
      if (act === 'copy-md') { Exporter.copyMarkdown(); return; }
      if (act === 'copy-json') { Exporter.copyJSON(); return; }
      if (act === 'cut-all') { Exporter.cutAll(); return; }
      if (act === 'clear') {
        if (window.confirm('Clear all annotations for this page?')) {
          var mine = Store.getAll().filter(function (a) { return a.origin === Store.origin; });
          mine.forEach(function (a) { Store.remove(a.id); });
          Toast.show('Cleared');
          render();
          FAB.refresh();
        }
        return;
      }
      if (act === 'edit') {
        var card = e.target.closest('.rf-card');
        var id = card ? card.dataset.id : null;
        if (id) editCard(id);
        return;
      }
      if (act === 'delete') {
        var card2 = e.target.closest('.rf-card');
        var id2 = card2 ? card2.dataset.id : null;
        if (id2) { Store.remove(id2); Toast.show('Deleted'); render(); FAB.refresh(); }
        return;
      }
    }

    function editCard(id) {
      var a = Store.getAll().filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      // Only reopen the full popover on the page it was taken on AND elements resolve.
      var samePage = a.pageUrl === location.href;
      var resolved = resolveTargets(a);
      if (samePage && resolved.primaryFound) {
        // Reopen full popover with resolved elements.
        var elements = resolved.found && resolved.found.length ? resolved.found : [document.querySelector(a.selector)];
        if (elements.length && elements[0]) {
          Popover.openForSelection(elements.filter(Boolean), 0, a);
          return;
        }
      }
      // Else comment stays editable inline in the card (already contentEditable).
      Toast.show('Editing comment inline');
    }

    function chordLabel() {
      return IS_MAC ? 'Alt+⌘' : 'Alt+Ctrl';
    }

    function reset() {
      if (layer) while (layer.firstChild) layer.removeChild(layer.firstChild);
    }

    function open() {
      ensure();
      open = true;
      render();
    }
    function close() {
      open = false;
      reset();
    }
    function toggle() {
      if (open) close(); else open();
    }
    function isOpen() { return open; }
    function refresh() { if (open) render(); }

    return { open: open, close: close, toggle: toggle, isOpen: isOpen, refresh: refresh };
  })();

  /* =====================================================================
   * 15. FAB (floating action button) — reveals only when origin has saved annotations
   * ===================================================================== */

  var FAB = (function () {
    var chrome = null;
    var layer = null;
    var shown = false;
    function ensure() {
      if (!chrome) {
        chrome = createChrome('rf-fab');
        layer = chrome.layer();
        chrome.addCss(
          '@keyframes rfPop{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}' +
          '.rf-fab{position:fixed;right:18px;bottom:18px;width:52px;height:52px;border-radius:50%;' +
          'background:#2b6de8;color:#fff;font-size:24px;font-weight:700;display:flex;align-items:center;' +
          'justify-content:center;box-shadow:0 6px 20px rgba(43,109,232,.4);cursor:pointer;' +
          'animation:rfPop .2s ease-out;pointer-events:auto;border:none;}',
          '.rf-fab:hover{background:#2458c4;}'
        );
      }
      return chrome;
    }
    function refresh() {
      var visible = !PlayerLocked() && Store.hasLocal();
      if (visible === shown) return;
      shown = visible;
      if (!chrome) ensure();
      if (layer) while (layer.firstChild) layer.removeChild(layer.firstChild);
      if (!visible) return;
      var b = document.createElement('button');
      b.className = 'rf-fab';
      b.textContent = '★';
      b.title = 'Open feedback panel';
      b.addEventListener('click', function () { Panel.toggle(); });
      layer.appendChild(b);
    }
    function PlayerLocked() { return false; } // placeholder hook for future locking
    return { refresh: refresh };
  })();

  /* =====================================================================
   * 16. EXPORTER (Markdown + JSON)
   * ===================================================================== */

  var Exporter = (function () {
    function sessionMeta() {
      var vp = viewport();
      var bo = browserAndOS();
      return {
        pageTitle: document.title || '',
        url: location.href,
        route: (location.pathname || '') + (location.search || ''),
        viewport: vp.w + 'x' + vp.h,
        browser: bo.browser,
        os: bo.os
      };
    }

    function formatRect(r) {
      if (!r) return '';
      return [r.x, r.y, r.width + 'x' + r.height].map(String).join(' ');
    }

    function tweakBlock(a) {
      var styles = a.adjustedStyles || {};
      var keys = Object.keys(styles);
      if (!keys.length) return '';
      var lines = keys.map(function (k) { return '  ' + k + ': ' + styles[k] + ';'; }).join('\n');
      return 'Tweak:\n' + lines + '\n';
    }

    function groupBlock(a) {
      if (!a.groupSize || a.groupSize <= 1) return '';
      var lines = [''];
      (a.targets || []).forEach(function (t, i) {
        if (!t) return;
        lines.push('  #' + (i + 1) + ' ' + (t.selector || t.tag || 'element'));
      });
      return lines.join('\n');
    }

    function sourceLine(a) {
      if (a.svelte && a.svelte.file) {
        var file = a.svelte.file.split('/').pop();
        var line = 'Source: `' + file + ':' + a.svelte.line + ':' + a.svelte.column + '`';
        if (a.svelte.stack && a.svelte.stack.length) {
          var frames = a.svelte.stack.map(function (f) {
            return '`' + String(f.file || '').split('/').pop() + ':' + f.line + ':' + f.column + '`';
          }).join(' → ');
          line += '\nComponent stack: ' + frames;
        }
        return line;
      }
      if (a.source) return 'Source: `' + String(a.source).split('/').pop() + '`';
      return '';
    }

    function a11yLine(a) {
      var a11y = a.a11y || {};
      var bits = [];
      if (a11y.role) bits.push('role=' + a11y.role);
      if (a11y.name) bits.push('name=' + a11y.name);
      if (a11y.testid) bits.push('testid=' + a11y.testid);
      return bits.length ? 'A11y: ' + bits.join(', ') : '';
    }

    function whereLine(a) {
      return 'Where: ' + ((a.where || []).join(' › ') || '');
    }

    function oneItem(a, i) {
      var lines = [];
      var label = (a.label || a.text || a.tag || 'element').replace(/\n/g, ' ');
      lines.push((i + 1) + '. [' + escapeMd(String(a.category || 'General')) + '] ' + label);
      if (a.comment) lines.push('   > ' + escapeMd(a.comment));
      if (a.text) lines.push('   ‹' + escapeMd(a.text) + '›');
      var src = sourceLine(a);
      if (src) lines.push('   ' + src);
      var a11y = a11yLine(a);
      if (a11y) lines.push('   ' + a11y);
      lines.push('   ' + whereLine(a));
      if (a.rect) lines.push('   Rect: ' + formatRect(a.rect));
      if (a.destination && a.destination.selector) {
        lines.push('   Destination: ' + a.destination.selector + ' (' + (a.destination.tag || '') + ')');
      }
      if (a.groupSize > 1) lines.push('   Group (' + a.groupSize + '):' + groupBlock(a));
      var tw = tweakBlock(a);
      if (tw) lines.push('   ' + tw);
      return lines.join('\n');
    }

    function escapeMd(s) {
      return String(s == null ? '' : s).replace(/^[ \t]+/gm, function (m) { return m; });
    }

    function markdown() {
      var meta = sessionMeta();
      var list = Store.getAll().filter(function (a) { return a.origin === Store.origin; });
      var lines = [];
      lines.push('# ' + meta.pageTitle);
      lines.push('');
      lines.push('- URL: ' + meta.url);
      lines.push('- Route: ' + meta.route);
      lines.push('- Viewport: ' + meta.viewport);
      lines.push('- ' + meta.browser + ' / ' + meta.os);
      lines.push('');
      if (!list.length) {
        lines.push('_No annotations._');
        return lines.join('\n');
      }
      list.forEach(function (a, i) { lines.push(oneItem(a, i)); lines.push(''); });
      return lines.join('\n');
    }

    function markdownSingle(a) {
      var meta = sessionMeta();
      var lines = [];
      lines.push('# ' + meta.pageTitle);
      lines.push('');
      lines.push('- URL: ' + meta.url);
      lines.push('- ' + meta.browser + ' / ' + meta.os);
      lines.push('');
      lines.push(oneItem(a, 0));
      return lines.join('\n');
    }

    function json() {
      var meta = sessionMeta();
      var list = Store.getAll().filter(function (a) { return a.origin === Store.origin; });
      var items = list.map(function (a) {
        return {
          category: a.category,
          comment: a.comment,
          text: a.text,
          label: a.label,
          source: a.svelte ? (a.svelte.file.split('/').pop() + ':' + a.svelte.line + ':' + a.svelte.column) : (a.source || ''),
          a11y: a.a11y,
          selector: a.selector,
          where: a.where,
          tag: a.tag,
          rect: a.rect,
          adjustedStyles: a.adjustedStyles,
          destination: a.destination,
          groupSize: a.groupSize,
          targets: (a.targets || []).map(function (t) { return t ? t.selector : null; }).filter(Boolean),
          hints: a.hints
        };
      });
      return JSON.stringify({ session: meta, items: items }, null, 2);
    }

    return {
      markdown: markdown, json: json, markdownSingle: markdownSingle,
      copyMarkdown: function () { Clipboard.copy(markdown()); Toast.show('Markdown copied'); },
      copyJSON: function () { Clipboard.copy(json()); Toast.show('JSON copied'); },
      cutAll: function () {
        Clipboard.copy(markdown());
        var mine = Store.getAll().filter(function (a) { return a.origin === Store.origin; });
        mine.forEach(function (a) { Store.remove(a.id); });
        Toast.show('Copied & cleared');
        Panel.refresh(); FAB.refresh();
      }
    };
  })();

  /* =====================================================================
   * 17. SPA ROUTE HANDLING
   * ===================================================================== */

  var SPA = (function () {
    var lastUrl = location.href;
    function onRouteChange() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      // Close unsaved drafts with a toast rather than silently retarget.
      if (Popover.isOpen()) {
        Toast.show('Route changed — draft closed');
        Popover.dismiss();
      }
      Hover.hide();
      Markers.clear();
      FAB.refresh();
      if (Panel.isOpen()) Panel.refresh();
    }
    function patch(proto, method) {
      var orig = proto[method];
      proto[method] = function () {
        var ret = orig.apply(this, arguments);
        onRouteChange();
        return ret;
      };
    }
    function init() {
      try {
        patch(history, 'pushState');
        patch(history, 'replaceState');
        window.addEventListener('popstate', onRouteChange, false);
      } catch (e) {}
    }
    return { init: init, onRouteChange: onRouteChange };
  })();

  /* =====================================================================
   * 18. PUBLIC API
   * ===================================================================== */

  window.__SCOPE_FEEDBACK_API__ = {
    markdown: function () { return Exporter.markdown(); },
    json: function () { return Exporter.json(); },
    annotations: function () {
      return Store.getAll().filter(function (a) { return a.origin === Store.origin; }).slice();
    },
    clear: function () {
      var mine = Store.getAll().filter(function (a) { return a.origin === Store.origin; });
      mine.forEach(function (a) { Store.remove(a.id); });
      FAB.refresh(); Panel.refresh();
    },
    openPanel: function () { Panel.open(); }
  };

  /* =====================================================================
   * 19. INIT
   * ===================================================================== */

  function init() {
    Store.load();
    Input.bind();
    SPA.init();
    FAB.refresh();
    // Show a one-time hint toast when chord is first held is handled in Input.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }
})();
