// ==UserScript==
// @name         Rapid Feedback
// @namespace    oxalpha.redesign
// @version      1.0.0
// @description  Annotate any element on any page; export review feedback as Markdown or JSON.
// @match        *://*/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // --- guards ---------------------------------------------------------------
  if (window.__SCOPE_FEEDBACK_LOADED__) return;
  window.__SCOPE_FEEDBACK_LOADED__ = true;

  // --- constants ------------------------------------------------------------
  const CATEGORIES = ['General', 'Bug', 'Feature', 'Suggestion', 'Question'];
  const STORAGE_KEY = '__rapid_feedback_annotations_v1';
  const LEGACY_STORAGE_KEY = '__scope_feedback_annotations';
  const MAX_SELECTOR_SEGMENTS = 12;
  const MAX_SVELTE_FRAMES = 12;
  const MAX_TEXT_SNIPPET = 150;
  const SIMILAR_CAP = 50;
  const POPOVER_WIDTH = 320;
  const PANEL_WIDTH = 380;
  const DOUBLE_TAP_MS = 400;

  // Adjustable live style properties. kind drives the editor input:
  // length (px stepper), color (color input), number (plain stepper), range (slider).
  const TWEAK_PROPS = [
    { prop: 'padding', kind: 'length' },
    { prop: 'margin', kind: 'length' },
    { prop: 'font-size', kind: 'length' },
    { prop: 'color', kind: 'color' },
    { prop: 'background-color', kind: 'color' },
    { prop: 'border-radius', kind: 'length' },
    { prop: 'width', kind: 'length' },
    { prop: 'height', kind: 'length' },
    { prop: 'gap', kind: 'length' },
    { prop: 'line-height', kind: 'number' },
    { prop: 'opacity', kind: 'range', min: 0, max: 1, step: 0.05 },
  ];

  // Computed-style snapshot taken at capture time (~25 layout/typography props).
  const SNAPSHOT_PROPS = [
    'display', 'position', 'width', 'height', 'padding', 'margin',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'color', 'background-color', 'border-radius', 'border', 'box-shadow',
    'overflow', 'flex-direction', 'gap', 'align-items', 'justify-content',
    'text-align', 'white-space', 'opacity', 'z-index',
  ];

  // Attributes worth putting in a selector, tried in order of signal strength.
  const HIGH_SIGNAL_ATTRS = ['data-testid', 'aria-label', 'name', 'href', 'src', 'placeholder'];

  // Tailwind-style stems assumed to be utility noise in selectors.
  const UTILITY_STEMS = new Set([
    'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
    'w', 'h', 'min-w', 'max-w', 'min-h', 'max-h', 'text', 'bg', 'border', 'rounded',
    'shadow', 'gap', 'col', 'row', 'cols', 'items', 'justify', 'content', 'font',
    'leading', 'tracking', 'opacity', 'z', 'top', 'right', 'bottom', 'left', 'inset',
    'space', 'divide', 'ring', 'duration', 'ease', 'delay', 'order', 'basis', 'grow',
    'shrink', 'self', 'place', 'object', 'aspect', 'columns', 'break', 'scroll',
    'snap', 'touch', 'fill', 'stroke', 'sr', 'translate', 'rotate', 'scale', 'skew',
  ]);

  // --- platform / chord -------------------------------------------------------
  function detectPlatform() {
    const ud = navigator.userAgentData;
    if (ud && typeof ud.platform === 'string' && ud.platform) {
      return /mac/i.test(ud.platform) ? 'mac' : 'pc';
    }
    return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mac' : 'pc';
  }
  const PLATFORM = detectPlatform();
  const CHORD_MODIFIER = PLATFORM === 'mac' ? 'metaKey' : 'ctrlKey';
  const CHORD_LABEL = PLATFORM === 'mac' ? 'Alt+⌘' : 'Alt+Ctrl';

  function browserName() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Unknown';
  }
  function osName() {
    if (PLATFORM === 'mac') return 'macOS';
    const ua = navigator.userAgent;
    if (/Windows/.test(ua)) return 'Windows';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
  }

  // --- module state -----------------------------------------------------------
  let mode = 'idle'; // 'idle' | 'chord' | 'pickElement' | 'pickDestination'
  let draft = null; // { targets:[{el,desc}], primaryIdx, comment, category, tweaks, originals, destination }
  let annotations = []; // persisted, serializable Item records
  let panelOpen = false;
  let popoverTab = 'comment'; // 'comment' | 'styles'
  let hoverEl = null; // element under chord-hover preview
  let hoverRafId = 0; // coalesced hover hit-testing frame
  let anchorRafId = 0; // popover follow-target rAF loop
  let chordDown = false;
  let lastChordTapAt = 0; // double-tap detection
  let chrome = null; // { host, root, refs... } built by the overlay module
  let pickCtx = null; // active pick-mode context { kind, onPick, onCancel }
  let similarUndo = null; // one-slot undo for "Select similar"
  let saveTimer = 0;

  // --- small utilities --------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const cssIdent = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1'));
  const cssAttr = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  function textSnippet(el) {
    const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (raw.length <= MAX_TEXT_SNIPPET) return raw;
    return raw.slice(0, MAX_TEXT_SNIPPET - 1) + '…';
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    const round = (n) => Math.round(n * 10) / 10;
    return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
  }

  function computedSnapshot(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const prop of SNAPSHOT_PROPS) out[prop] = cs.getPropertyValue(prop);
    return out;
  }

  // --- class filtering (selector hygiene) --------------------------------------
  const stripSvelteHash = (cls) => cls.replace(/svelte-[a-z0-9]+/gi, '');

  function isUtilityClass(rawCls) {
    const cls = stripSvelteHash(rawCls);
    if (!cls || cls.length <= 2) return true;
    if (/[A-Z]/.test(cls)) return false; // looks semantic (PascalCase / camelCase)
    if (/[:[\]/]/.test(cls)) return true; // variants, arbitrary values, fractions
    if (/^(hover|focus|active|visited|disabled|group|peer|dark|light|first|last|odd|even|before|after|selection|marker|file|placeholder|rtl|ltr|motion|print|open|checked)-/.test(cls)) return true;
    if (/^\w[\w-]*-\d+(\.\d+)?$/.test(cls)) return true; // p-4, grid-cols-3, z-10 …
    if (/^-\w{1,4}-\d/.test(cls)) return true; // negative utilities -mt-2
    const stem = cls.replace(/-.*/, '');
    return UTILITY_STEMS.has(stem);
  }

  // Classes worth using in a selector, svelte hashes stripped.
  function semanticClasses(el) {
    return [...el.classList].map(stripSvelteHash).filter((c) => c && !isUtilityClass(c));
  }

  // --- selector generation ------------------------------------------------------
  function uniquelyMatches(path, el) {
    try {
      const nodes = document.querySelectorAll(path);
      return nodes.length === 1 && nodes[0] === el;
    } catch (_) { return false; }
  }

  function attrPredicate(el) {
    for (const attr of HIGH_SIGNAL_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return `[${attr}="${cssAttr(v)}"]`;
    }
    return '';
  }

  // One path segment: tag + (≤2 semantic classes) + best high-signal attribute.
  function segmentFor(el, forceNth) {
    let seg = el.tagName.toLowerCase();
    if (forceNth && el.parentElement) {
      const sibs = [...el.parentElement.children];
      const sameTag = sibs.filter((c) => c.tagName === el.tagName);
      if (sameTag.length > 1) seg += `:nth-of-type(${sibs.indexOf(el) + 1})`;
    }
    const kept = semanticClasses(el).slice(0, 2);
    if (kept.length) seg += '.' + kept.map(cssIdent).join('.');
    const pred = attrPredicate(el);
    if (pred) seg += pred;
    return seg;
  }

  // Shortest unique selector: grow the ancestor chain bottom-up, stop as soon as
  // it resolves to exactly this element; retry with nth-of-type; cap at 12 segments.
  function generateSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) {
      const s = '#' + cssIdent(el.id);
      if (uniquelyMatches(s, el)) return s;
    }
    for (const forceNth of [false, true]) {
      const chain = [];
      let node = el;
      while (node && node.nodeType === 1 && chain.length < MAX_SELECTOR_SEGMENTS) {
        chain.unshift(segmentFor(node, forceNth));
        const path = chain.join(' > ');
        if (uniquelyMatches(path, el)) return path;
        node = node.parentElement;
      }
    }
    return '';
  }

  // Human-readable ancestor chain (up to 4 levels, first semantic class each).
  function whereChain(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      const kept = semanticClasses(node)[0];
      parts.unshift(node.tagName.toLowerCase() + (kept ? '.' + cssIdent(kept) : ''));
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function resolves(sel) {
    if (!sel) return false;
    try { return !!document.querySelector(sel); } catch (_) { return false; }
  }

  // --- accessibility capture -----------------------------------------------------
  function implicitRoleFor(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' || tag === 'area') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button') return 'button';
    if (tag === 'img') return el.getAttribute('alt') === '' ? 'presentation' : 'image';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'option') return 'option';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'li') return 'listitem';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    if (tag === 'aside') return 'complementary';
    if (tag === 'form') return 'form';
    if (tag === 'table') return 'table';
    if (tag === 'dialog') return 'dialog';
    if (tag === 'progress') return 'progressbar';
    return null;
  }

  function captureA11y(el) {
    const explicit = el.getAttribute('role');
    let name = el.getAttribute('aria-label');
    if (!name) {
      const ids = el.getAttribute('aria-labelledby');
      if (ids) {
        name = ids.split(/\s+/).map((id) => document.getElementById(id))
          .filter(Boolean).map((n) => (n.textContent || '').trim())
          .filter(Boolean).join(' ') || null;
      }
    }
    if (!name) name = el.getAttribute('alt') || el.getAttribute('title') || null;
    const implicit = implicitRoleFor(el);
    return {
      role: explicit || implicit,
      roleSource: explicit ? 'explicit' : implicit ? 'implicit' : null,
      name: name ? name.trim() || null : null,
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || null,
    };
  }

  // --- Svelte source mapping ---------------------------------------------------
  // Nearest ancestor carrying __svelte_meta.loc gives file:line:column; walking
  // further up collects the component stack (each frame that has its own meta).
  function captureSvelte(el) {
    let node = el;
    for (let i = 0; node && i < 30; i++, node = node.parentElement) {
      const meta = node.__svelte_meta;
      if (meta && meta.loc) {
        const stack = [];
        let cur = node;
        for (let f = 0; cur && f < MAX_SVELTE_FRAMES; f++, cur = cur.parentElement) {
          const m = cur.__svelte_meta;
          if (m && m.loc) {
            const l = m.loc;
            stack.push(l.file ? `${l.file}:${l.line}:${l.column}` : String(l));
          }
        }
        return { loc: meta.loc.file ? `${meta.loc.file}:${meta.loc.line}:${meta.loc.column}` : String(meta.loc), componentStack: stack };
      }
    }
    return null;
  }

  // --- element capture ------------------------------------------------------------
  function captureElement(el) {
    return {
      selector: generateSelector(el),
      where: whereChain(el),
      tag: el.tagName.toLowerCase(),
      text: textSnippet(el),
      rect: rectOf(el),
      styles: computedSnapshot(el),
      a11y: captureA11y(el),
      source: captureSvelte(el),
    };
  }

  // --- persistence ------------------------------------------------------------------
  function loadAnnotations() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      const raw = current != null ? current : legacy;
      if (current == null && legacy != null) {
        localStorage.setItem(STORAGE_KEY, legacy); // migrate legacy key once
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  // Debounced whole-array save; annotation volume makes diffs unnecessary.
  function saveAnnotations() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations)); } catch (_) { /* quota/private mode */ }
    }, 150);
  }

  // --- export formats -----------------------------------------------------------------
  function sessionInfo() {
    return {
      pageTitle: document.title,
      url: location.href,
      route: location.pathname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      browser: browserName(),
      os: osName(),
    };
  }

  function itemLabel(item) {
    return item.label || item.selector || item.tag || 'element';
  }

  function toMarkdown(session, items) {
    const L = [];
    L.push(`# Feedback — ${session.pageTitle}`, '');
    L.push(`- URL: ${session.url}`);
    L.push(`- Viewport: ${session.viewport}`);
    L.push(`- Browser: ${session.browser} on ${session.os}`);
    items.forEach((it, i) => {
      L.push('', `## ${i + 1}. [${it.category}] ${itemLabel(it)}`);
      if (it.text) L.push('', `> ${String(it.text).replace(/\s*\n+\s*/g, ' ')}`);
      if (it.comment) L.push('', it.comment.trim());
      if (it.source) {
        L.push('', `Source: ${it.source.loc}`);
        (it.source.componentStack || []).slice(1).forEach((f) => L.push(`  - ${f}`));
      }
      if (it.a11y && (it.a11y.role || it.a11y.name)) {
        L.push(`A11y: role=${it.a11y.role || '?'}${it.a11y.name ? ` name="${it.a11y.name}"` : ''}`);
      }
      if (it.where) L.push(`Where: ${it.where}`);
      if (it.rect) {
        L.push(`Rect: x=${Math.round(it.rect.x)} y=${Math.round(it.rect.y)} w=${Math.round(it.rect.width)} h=${Math.round(it.rect.height)}`);
      }
      if (it.destination) {
        L.push(`Destination: move to \`${it.destination.selector}\`${it.destination.text ? ` — “${it.destination.text}”` : ''}`);
      }
      if (it.groupSize > 1 && Array.isArray(it.targets)) {
        L.push(`Group (${it.targets.length} elements):`);
        it.targets.forEach((t) => L.push(`  - \`${t.selector}\`${t.selector && !resolves(t.selector) ? ' *(not found)*' : ''}`));
      }
      if (it.adjustedStyles && Object.keys(it.adjustedStyles).length) {
        L.push('Tweak:');
        Object.entries(it.adjustedStyles).forEach(([k, v]) => L.push(`  ${k}: ${v};`));
      }
    });
    return L.join('\n');
  }

  function toJson(session, items) {
    return JSON.stringify({ session, items }, null, 2);
  }

  // --- overlay: chrome factory -------------------------------------------------
  // One fixed-position host; a closed shadow root holds every piece of tool UI.
  // `all:initial` on :host plus explicit base styles makes chrome immune to page CSS.
  const RF_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    [data-rf-layer] { position: fixed; }
    .rf-outline { border: 2px solid #3b82f6; border-radius: 3px; pointer-events: none; display: none;
      box-shadow: 0 0 0 3px rgba(59,130,246,.35), 0 0 12px rgba(59,130,246,.55);
      animation: rf-pulse 1s ease-in-out infinite; z-index: 2147483000; }
    @keyframes rf-pulse { 50% { box-shadow: 0 0 0 6px rgba(59,130,246,.18), 0 0 20px rgba(59,130,246,.8); } }
    .rf-marker { background: rgba(34,197,94,.16); outline: 2px solid rgba(34,197,94,.85);
      border-radius: 2px; pointer-events: none; z-index: 2147483001; }
    .rf-badge { position: absolute; top: -10px; left: -10px; min-width: 18px; height: 18px;
      padding: 0 4px; border-radius: 9px; background: #16a34a; color: #fff; font-size: 11px;
      font-weight: 600; line-height: 18px; text-align: center; }
    .rf-fab { right: 20px; bottom: 20px; width: 44px; height: 44px; border-radius: 50%; border: none;
      background: #16a34a; color: #fff; font-size: 20px; cursor: pointer; display: none;
      box-shadow: 0 4px 14px rgba(0,0,0,.3); z-index: 2147483002; }
    .rf-banner { top: 12px; left: 50%; transform: translateX(-50%); background: #111827; color: #fff;
      padding: 8px 14px; border-radius: 8px; font-size: 13px; display: none; white-space: nowrap;
      box-shadow: 0 4px 14px rgba(0,0,0,.35); z-index: 2147483003; }
    .rf-toast { bottom: 76px; left: 50%; transform: translateX(-50%); background: #111827; color: #fff;
      padding: 8px 14px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity .25s;
      pointer-events: none; max-width: 70vw; z-index: 2147483004; }
    .rf-pop { width: ${POPOVER_WIDTH}px; background: #fff; color: #111827; border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,.28); display: none; font-size: 13px; z-index: 2147483005; }
    .rf-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; }
    .rf-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-weight: 600; font-size: 12px; color: #374151; direction: rtl; text-align: left; }
    .rf-zoom button, .rf-tabs button, .rf-chips button, .rf-actions button,
    .rf-mact button, .rf-mrow button, .rf-dest button {
      font-size: 12px; border: 1px solid #d1d5db; background: #f9fafb; color: #111827;
      border-radius: 6px; padding: 3px 8px; cursor: pointer; }
    .rf-zoom button:hover, .rf-tabs button:hover, .rf-chips button:hover, .rf-actions button:hover,
    .rf-mact button:hover, .rf-mrow button:hover, .rf-dest button:hover { background: #eef2ff; }
    .rf-zoom { display: flex; gap: 2px; }
    .rf-tabs { display: flex; gap: 4px; padding: 4px 10px; border-bottom: 1px solid #e5e7eb; }
    .rf-tabs button.on { background: #e0e7ff; border-color: #6366f1; font-weight: 600; }
    .rf-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 8px;
      max-height: 46vh; overflow: auto; }
    .rf-members { border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px; }
    .rf-mrow { display: flex; align-items: center; gap: 4px; padding: 2px 0; }
    .rf-mrow .n { flex: none; width: 16px; height: 16px; border-radius: 8px; background: #16a34a;
      color: #fff; font-size: 10px; line-height: 16px; text-align: center; }
    .rf-mrow .sel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; direction: rtl; text-align: left; font-family: ui-monospace, monospace;
      font-size: 11px; color: #374151; }
    .rf-mrow .star { color: #b45309; }
    .rf-mact { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
    .rf-comment { width: 100%; min-height: 64px; resize: vertical; border: 1px solid #d1d5db;
      border-radius: 6px; padding: 6px; font: inherit; }
    .rf-chips { display: flex; gap: 4px; flex-wrap: wrap; }
    .rf-chips button.on { background: #dcfce7; border-color: #16a34a; font-weight: 600; }
    .rf-dest { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151; }
    .rf-dest .dlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; font-family: ui-monospace, monospace; font-size: 11px; }
    .rf-tweaks { display: grid; grid-template-columns: 92px 1fr; gap: 5px 8px; align-items: center; }
    .rf-tweaks label { font-size: 12px; color: #374151; }
    .rf-tweaks input { width: 100%; border: 1px solid #d1d5db; border-radius: 5px;
      padding: 3px 5px; font: inherit; font-size: 12px; }
    .rf-actions { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 10px;
      border-top: 1px solid #e5e7eb; }
    .rf-actions [data-act="submit"] { background: #16a34a; border-color: #16a34a; color: #fff; }
  `;

  function rfEl(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function buildChrome() {
    const host = document.createElement('div');
    host.setAttribute('data-rf-chrome', '');
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = RF_CSS;
    root.appendChild(style);
    const outline = rfEl('div', 'rf-outline');
    outline.setAttribute('data-rf-layer', '');
    const markers = rfEl('div');
    markers.setAttribute('data-rf-layer', '');
    markers.style.cssText = 'top:0;left:0;width:0;height:0;';
    const fab = rfEl('button', 'rf-fab');
    fab.setAttribute('data-rf-layer', '');
    fab.textContent = '💬';
    fab.title = 'Toggle feedback panel';
    const banner = rfEl('div', 'rf-banner');
    banner.setAttribute('data-rf-layer', '');
    const toast = rfEl('div', 'rf-toast');
    toast.setAttribute('data-rf-layer', '');
    const pop = rfEl('div', 'rf-pop');
    pop.setAttribute('data-rf-layer', '');
    root.append(outline, markers, fab, banner, toast, pop);
    document.documentElement.appendChild(host);
    chrome = { host, root, outline, markers, fab, banner, toast, pop, markerEls: [], popoverBound: false };
    fab.addEventListener('click', () => togglePanel());
    bindPopoverEvents();
  }

  // Tool chrome is click-through while the chord is held or a pick mode runs.
  function setChromeInteractive(on) {
    if (chrome) chrome.host.style.pointerEvents = on ? 'auto' : 'none';
  }

  // --- toast + hint banner -------------------------------------------------------
  let toastTimer = 0;
  function showToast(msg) {
    if (!chrome) return;
    chrome.toast.textContent = msg;
    chrome.toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { chrome.toast.style.opacity = '0'; }, 2600);
  }

  function showBanner(text) {
    if (!chrome) return;
    chrome.banner.textContent = text;
    chrome.banner.style.display = 'block';
  }
  function hideBanner() {
    if (chrome) chrome.banner.style.display = 'none';
  }

  // --- FAB ---------------------------------------------------------------------------
  // Only visible when this origin actually has saved annotations.
  function updateFab() {
    if (!chrome) return;
    const hasHere = annotations.some((a) => a.origin === location.origin);
    chrome.fab.style.display = hasHere ? 'block' : 'none';
  }

  // --- hover outline + selection markers ----------------------------------------------
  function showOutline(el) {
    if (!chrome || !el || !el.isConnected) return hideOutline();
    positionOutline(el);
    chrome.outline.style.display = 'block';
  }
  function positionOutline(el) {
    const r = el.getBoundingClientRect();
    Object.assign(chrome.outline.style, {
      left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px',
    });
  }
  function hideOutline() {
    if (chrome) chrome.outline.style.display = 'none';
  }

  // Green overlay per selected member + numbered badge showing its order.
  function renderMarkers() {
    if (!chrome) return;
    chrome.markers.textContent = '';
    chrome.markerEls = [];
    if (!draft) return;
    draft.targets.forEach((t, i) => {
      if (!t.el || !t.el.isConnected) return;
      const m = rfEl('div', 'rf-marker');
      const badge = rfEl('span', 'rf-badge');
      badge.textContent = String(i + 1);
      m.appendChild(badge);
      chrome.markers.appendChild(m);
      chrome.markerEls.push({ el: t.el, node: m });
    });
    positionMarkers();
  }
  function positionMarkers() {
    chrome.markerEls.forEach(({ el, node }) => {
      if (!el.isConnected) { node.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(node.style, {
        display: 'block', left: r.left + 'px', top: r.top + 'px',
        width: r.width + 'px', height: r.height + 'px',
      });
    });
  }

  // --- annotation popover ----------------------------------------------------------------
  function primaryTarget() {
    return draft && draft.targets[draft.primaryIdx];
  }

  function primaryLabel() {
    const t = primaryTarget();
    if (!t) return '';
    const d = t.desc;
    return d.selector || (d.tag + (d.text ? ` — ${d.text.slice(0, 40)}` : ''));
  }

  function renderPopover() {
    if (!chrome) return;
    if (!draft || !draft.targets.length) return hidePopover();
    const p = chrome.pop;
    p.innerHTML = `
      <div class="rf-head">
        <div class="rf-title">${esc(primaryLabel())}</div>
        <div class="rf-zoom">
          <button data-zoom="parent" title="Parent">▲</button>
          <button data-zoom="child" title="First child">▼</button>
          <button data-zoom="prev" title="Previous sibling">◀</button>
          <button data-zoom="next" title="Next sibling">▶</button>
        </div>
      </div>
      <div class="rf-tabs">
        <button data-tab="comment">Comment</button>
        <button data-tab="styles">Styles</button>
      </div>
      <div class="rf-body"></div>
      <div class="rf-actions">
        <button data-act="cancel">Cancel</button>
        <button data-act="cut">Cut</button>
        <button data-act="submit">Submit</button>
      </div>`;
    refreshTabs();
    renderTabBody();
    p.style.display = 'block';
    positionPopover();
  }

  function hidePopover() {
    if (chrome) chrome.pop.style.display = 'none';
  }

  function refreshTabs() {
    chrome.pop.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === popoverTab);
    });
  }

  function renderTabBody() {
    const body = chrome.pop.querySelector('.rf-body');
    if (popoverTab === 'comment') {
      body.innerHTML = `
        <div class="rf-members">
          <div class="rf-mlist"></div>
          <div class="rf-mact">
            <button data-mact="add">+ Add element</button>
            <button data-mact="similar">⧉ Select similar</button>
            <button data-mact="undo" style="display:none">Undo similar</button>
          </div>
        </div>
        <textarea class="rf-comment" placeholder="What should change? (${CHORD_LABEL}+click adds elements)"></textarea>
        <div class="rf-chips"></div>
        <div class="rf-dest"></div>`;
      const ta = body.querySelector('.rf-comment');
      ta.value = draft.comment;
      refreshMembers();
      refreshChips();
      refreshDest();
    } else {
      body.innerHTML = '<div class="rf-tweaks"></div>';
      refreshTweaks();
    }
  }

  function refreshMembers() {
    const list = chrome.pop.querySelector('.rf-mlist');
    const undoBtn = chrome.pop.querySelector('[data-mact="undo"]');
    if (!list) return;
    list.innerHTML = '';
    draft.targets.forEach((t, i) => {
      const row = rfEl('div', 'rf-mrow');
      const n = rfEl('span', 'n');
      n.textContent = String(i + 1);
      const sel = rfEl('span', 'sel');
      sel.textContent = t.desc.selector || t.desc.tag;
      sel.title = t.desc.selector || t.desc.tag;
      const promote = rfEl('button');
      promote.textContent = i === draft.primaryIdx ? '★' : '☆';
      promote.title = i === draft.primaryIdx ? 'Primary element' : 'Make primary';
      promote.disabled = i === draft.primaryIdx;
      promote.classList.toggle('star', i === draft.primaryIdx);
      promote.addEventListener('click', () => promoteTarget(i));
      const rm = rfEl('button');
      rm.textContent = '✕';
      rm.title = 'Remove from selection';
      rm.addEventListener('click', () => removeTarget(i));
      row.append(n, sel, promote, rm);
      list.appendChild(row);
    });
    if (undoBtn) undoBtn.style.display = similarUndo && similarUndo.length ? '' : 'none';
  }

  function refreshChips() {
    const wrap = chrome.pop.querySelector('.rf-chips');
    if (!wrap) return;
    wrap.innerHTML = '';
    CATEGORIES.forEach((cat) => {
      const b = rfEl('button');
      b.textContent = cat;
      b.dataset.chip = cat;
      b.classList.toggle('on', draft.category === cat);
      wrap.appendChild(b);
    });
  }

  function refreshDest() {
    const wrap = chrome.pop.querySelector('.rf-dest');
    if (!wrap) return;
    wrap.innerHTML = '';
    const label = rfEl('span');
    label.textContent = 'Destination:';
    const btn = rfEl('button');
    if (draft.destination) {
      const dl = rfEl('span', 'dlabel');
      dl.textContent = draft.destination.desc.selector || draft.destination.desc.tag;
      dl.title = dl.textContent;
      const clear = rfEl('button');
      clear.textContent = '✕';
      clear.title = 'Clear destination';
      clear.addEventListener('click', () => clearDestination());
      btn.textContent = 'Re-pick';
      btn.addEventListener('click', () => startPickDestination());
      wrap.append(label, dl, btn, clear);
    } else {
      btn.textContent = 'Pick destination…';
      btn.addEventListener('click', () => startPickDestination());
      wrap.append(label, btn);
    }
  }

  // Styles tab: one input per adjustable prop; values reflect pending tweaks only
  // (untouched props intentionally show empty, not the computed value).
  function refreshTweaks() {
    const grid = chrome.pop.querySelector('.rf-tweaks');
    if (!grid) return;
    grid.innerHTML = '';
    TWEAK_PROPS.forEach(({ prop, kind, min, max, step }) => {
      const label = rfEl('label');
      label.textContent = prop;
      label.htmlFor = 'rf-tk-' + prop;
      let input;
      if (kind === 'color') {
        input = document.createElement('input');
        input.type = 'color';
      } else if (kind === 'range') {
        input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = kind === 'length' ? 'e.g. 12px' : 'number';
        input.dataset.steppable = kind === 'length' ? '1' : '0.1';
      }
      input.id = 'rf-tk-' + prop;
      input.value = draft.tweaks[prop] != null ? String(draft.tweaks[prop]) : '';
      input.addEventListener('input', () => applyTweak(prop, input.value));
      input.addEventListener('keydown', (e) => {
        const stepDef = input.dataset.steppable;
        if (!stepDef || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const unit = stepDef === '1' ? 'px' : '';
        const inc = parseFloat(stepDef) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        const cur = parseFloat(input.value) || 0;
        const next = Math.round((cur + inc) * 100) / 100;
        input.value = next + unit;
        applyTweak(prop, input.value);
      });
      grid.append(label, input);
    });
  }

  // Anchor math: below → above → right → left of the primary target, clamped to
  // the viewport; falls back to a clamped centered placement for huge targets.
  function positionPopover() {
    if (!chrome || !draft || chrome.pop.style.display === 'none') return;
    const t = primaryTarget();
    if (!t || !t.el.isConnected) return;
    const r = t.el.getBoundingClientRect();
    const pw = POPOVER_WIDTH;
    const ph = chrome.pop.offsetHeight;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fits = (x, y) => x >= 4 && y >= 4 && x + pw <= vw - 4 && y + ph <= vh - 4;
    const cands = [
      [r.left, r.bottom + gap],
      [r.left, r.top - ph - gap],
      [r.right + gap, r.top],
      [r.left - pw - gap, r.top],
    ];
    let pos = null;
    for (const c of cands) { if (fits(c[0], c[1])) { pos = c; break; } }
    if (!pos) pos = [clamp(r.left, 4, vw - pw - 4), clamp(r.top + r.height / 2 - ph / 2, 4, vh - ph - 4)];
    chrome.pop.style.left = pos[0] + 'px';
    chrome.pop.style.top = pos[1] + 'px';
  }

  // Event delegation on the popover shell; survives full re-renders. Logic
  // functions (submitDraft, retargetPrimary, …) are defined in the core module.
  function bindPopoverEvents() {
    if (!chrome || chrome.popoverBound) return;
    chrome.popoverBound = true;
    chrome.pop.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.zoom) return retargetPrimary(b.dataset.zoom);
      if (b.dataset.tab) { popoverTab = b.dataset.tab; refreshTabs(); renderTabBody(); return; }
      if (b.dataset.act === 'cancel') return cancelDraft();
      if (b.dataset.act === 'cut') return cutAnnotation();
      if (b.dataset.act === 'submit') return submitDraft();
      if (b.dataset.mact === 'add') return startPickElement();
      if (b.dataset.mact === 'similar') return selectSimilar();
      if (b.dataset.mact === 'undo') return undoSelectSimilar();
      if (b.dataset.chip) { setCategory(b.dataset.chip); return; }
    });
    chrome.pop.addEventListener('input', (e) => {
      if (e.target.classList.contains('rf-comment')) draft.comment = e.target.value;
    });
    chrome.pop.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitDraft(); }
    });
  }

  // Reposition everything that tracks live elements (called by the anchor loop).
  function refreshOverlayPositions() {
    positionMarkers();
    positionPopover();
    if (hoverEl && chrome && chrome.outline.style.display === 'block') positionOutline(hoverEl);
  }

  // --- side panel -----------------------------------------------------------------
  // Right-docked 380px panel living in the same closed shadow root. Rebuilt from
  // state on open/action; typing never triggers a re-render (values kept in vars).
  let panelEditId = null; // annotation being edited inline in its card
  let quickCat = 'General';
  let quickText = '';
  let uidCounter = 0;

  function uid() {
    return 'rf-' + Date.now().toString(36) + '-' + (uidCounter++).toString(36);
  }

  const PANEL_CSS = `
    .rf-panel { top: 0; right: 0; height: 100vh; width: ${PANEL_WIDTH}px; background: #fff;
      color: #111827; font-size: 13px; box-shadow: -6px 0 24px rgba(0,0,0,.18); display: none;
      flex-direction: column; z-index: 2147483006; }
    .rf-ptoolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #e5e7eb;
      align-items: center; }
    .rf-ptoolbar button { font-size: 12px; border: 1px solid #d1d5db; background: #f9fafb;
      color: #111827; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
    .rf-ptoolbar button:hover { background: #eef2ff; }
    .rf-ptitle { flex: 1; font-weight: 600; }
    .rf-pcards { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
    .rf-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; display: flex;
      flex-direction: column; gap: 4px; }
    .rf-chead { display: flex; align-items: center; gap: 6px; }
    .rf-ccat { background: #dcfce7; color: #166534; padding: 1px 7px; border-radius: 9px;
      font-size: 11px; font-weight: 600; flex: none; }
    .rf-gbadge { background: #e0e7ff; color: #3730a3; border-radius: 9px; font-size: 11px;
      padding: 1px 7px; flex: none; }
    .rf-clabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      direction: rtl; text-align: left; font-family: ui-monospace, monospace; font-size: 11px; color: #374151; }
    .rf-cbtns button { border: 1px solid #d1d5db; background: #f9fafb; border-radius: 5px;
      cursor: pointer; font-size: 11px; padding: 2px 6px; margin-left: 3px; }
    .rf-cbtns button:hover { background: #eef2ff; }
    .rf-cview { white-space: pre-wrap; word-break: break-word; }
    .rf-cmeta { font-size: 11px; color: #6b7280; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; direction: rtl; text-align: left; }
    .rf-cedit { width: 100%; min-height: 52px; resize: vertical; border: 1px solid #d1d5db;
      border-radius: 6px; padding: 5px; font: inherit; }
    .rf-crow { display: flex; justify-content: flex-end; gap: 5px; }
    .rf-pempty { color: #6b7280; text-align: center; padding: 24px 8px; }
    .rf-pfooter { border-top: 1px solid #e5e7eb; padding: 8px; display: flex;
      flex-direction: column; gap: 6px; }
    .rf-qchips { display: flex; gap: 4px; flex-wrap: wrap; }
    .rf-qchips button { font-size: 11px; border: 1px solid #d1d5db; background: #f9fafb;
      border-radius: 9px; padding: 2px 8px; cursor: pointer; }
    .rf-qchips button.on { background: #dcfce7; border-color: #16a34a; font-weight: 600; }
    .rf-qadd { width: 100%; min-height: 44px; resize: vertical; border: 1px solid #d1d5db;
      border-radius: 6px; padding: 5px; font: inherit; }
  `;

  function buildPanel() {
    const panel = rfEl('div', 'rf-panel');
    panel.setAttribute('data-rf-layer', '');
    panel.innerHTML = `
      <div class="rf-ptoolbar">
        <span class="rf-ptitle">Feedback</span>
        <button data-tact="md">Copy Markdown</button>
        <button data-tact="json">JSON</button>
        <button data-tact="cutall">Cut All</button>
        <button data-tact="clear">Clear</button>
        <button data-tact="close">✕</button>
      </div>
      <div class="rf-pcards"></div>
      <div class="rf-pfooter">
        <div class="rf-qchips"></div>
        <textarea class="rf-qadd" placeholder="Quick note… (${PLATFORM === 'mac' ? '⌘' : 'Ctrl'}+Enter)"></textarea>
      </div>`;
    const pstyle = document.createElement('style');
    pstyle.textContent = PANEL_CSS;
    chrome.root.append(pstyle, panel);
    chrome.panel = panel;
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', (e) => {
      if (e.target.classList.contains('rf-qadd')) quickText = e.target.value;
    });
    panel.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      e.preventDefault();
      if (e.target.classList.contains('rf-qadd')) return submitQuickNote();
      if (e.target.classList.contains('rf-cedit')) return saveInlineEdit();
    });
  }

  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  function openPanel() {
    panelOpen = true;
    renderPanel();
    chrome.panel.style.display = 'flex';
  }

  function closePanel() {
    panelOpen = false;
    panelEditId = null;
    chrome.panel.style.display = 'none';
  }

  function refreshChipsPanel() {
    const wrap = chrome.panel.querySelector('.rf-qchips');
    wrap.innerHTML = '';
    CATEGORIES.forEach((cat) => {
      const b = rfEl('button');
      b.textContent = cat;
      b.dataset.chip = cat;
      b.classList.toggle('on', quickCat === cat);
      wrap.appendChild(b);
    });
  }

  function renderPanel() {
    const cards = chrome.panel.querySelector('.rf-pcards');
    refreshChipsPanel();
    chrome.panel.querySelector('.rf-qadd').value = quickText;
    if (!annotations.length) {
      cards.innerHTML = '<div class="rf-pempty">No annotations yet.<br>' +
        esc(CHORD_LABEL) + '+click any element to start.</div>';
      return;
    }
    cards.innerHTML = '';
    [...annotations].reverse().forEach((it) => {
      cards.appendChild(buildCard(it));
    });
  }

  function buildCard(it) {
    const card = rfEl('div', 'rf-card');
    const head = rfEl('div', 'rf-chead');
    const cat = rfEl('span', 'rf-ccat');
    cat.textContent = it.category;
    const label = rfEl('span', 'rf-clabel');
    label.textContent = it.label || it.selector || it.tag || 'note';
    label.title = it.selector || it.label || '';
    head.appendChild(cat);
    if (it.groupSize > 1) {
      const gb = rfEl('span', 'rf-gbadge');
      gb.textContent = '×' + it.groupSize;
      gb.title = 'Group of ' + it.groupSize + ' elements';
      head.appendChild(gb);
    }
    head.appendChild(label);
    const btns = rfEl('span', 'rf-cbtns');
    const edit = rfEl('button');
    edit.textContent = '✎';
    edit.title = 'Edit';
    edit.addEventListener('click', () => editAnnotation(it.id));
    const del = rfEl('button');
    del.textContent = '🗑';
    del.title = 'Delete';
    del.addEventListener('click', () => deleteAnnotation(it.id));
    btns.append(edit, del);
    head.appendChild(btns);
    card.appendChild(head);

    if (panelEditId === it.id) {
      const ta = rfEl('textarea', 'rf-cedit');
      ta.value = it.comment || '';
      const row = rfEl('div', 'rf-crow');
      const cancel = rfEl('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => { panelEditId = null; renderPanel(); });
      const save = rfEl('button');
      save.textContent = 'Save';
      save.addEventListener('click', () => saveInlineEdit());
      row.append(cancel, save);
      card.append(ta, row);
      return card;
    }

    if (it.comment) {
      const view = rfEl('div', 'rf-cview');
      view.textContent = it.comment;
      card.appendChild(view);
    }
    const bits = [];
    if (it.source && it.source.loc) bits.push(it.source.loc);
    if (it.adjustedStyles && Object.keys(it.adjustedStyles).length) {
      bits.push(Object.keys(it.adjustedStyles).length + ' tweak(s)');
    }
    if (it.url) {
      try { bits.push(new URL(it.url).host + new URL(it.url).pathname); } catch (_) { bits.push(it.url); }
    }
    if (bits.length) {
      const meta = rfEl('div', 'rf-cmeta');
      meta.textContent = bits.join(' · ');
      meta.title = bits.join(' · ');
      card.appendChild(meta);
    }
    return card;
  }

  // Edit reopens the full popover only on the same page with resolvable elements;
  // otherwise the comment stays editable inline in the card.
  function editAnnotation(id) {
    const it = annotations.find((a) => a.id === id);
    if (!it) return;
    const samePage = it.url === location.href;
    const allResolve = (it.targets || []).length > 0 &&
      it.targets.every((t) => t.selector && resolves(t.selector));
    if (samePage && allResolve) {
      reopenInPopover(it);
    } else {
      panelEditId = id;
      renderPanel();
      const ta = chrome.panel.querySelector('.rf-cedit');
      if (ta) ta.focus();
    }
  }

  function saveInlineEdit() {
    const ta = chrome.panel.querySelector('.rf-cedit');
    const it = annotations.find((a) => a.id === panelEditId);
    if (ta && it) {
      it.comment = ta.value;
      saveAnnotations();
      showToast('Saved');
    }
    panelEditId = null;
    renderPanel();
  }

  function deleteAnnotation(id) {
    annotations = annotations.filter((a) => a.id !== id);
    saveAnnotations();
    renderPanel();
    updateFab();
    showToast('Deleted');
  }

  // --- clipboard ---------------------------------------------------------------
  function copyText(text) {
    const done = () => showToast('Copied to clipboard');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { showToast('Copy failed'); }
    ta.remove();
  }

  // --- toolbar actions ------------------------------------------------------------
  function onPanelClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.chip) { quickCat = b.dataset.chip; refreshChipsPanel(); return; }
    switch (b.dataset.tact) {
      case 'close': return closePanel();
      case 'md': return copyText(toMarkdown(sessionInfo(), annotations));
      case 'json': return copyText(toJson(sessionInfo(), annotations));
      case 'cutall':
        copyText(toMarkdown(sessionInfo(), annotations));
        annotations = [];
        saveAnnotations();
        renderPanel();
        updateFab();
        return showToast('Copied all, session cleared');
      case 'clear':
        if (annotations.length && !confirm('Delete all saved annotations on this origin?')) return;
        annotations = [];
        saveAnnotations();
        renderPanel();
        updateFab();
        return showToast('Cleared');
    }
  }

  // --- quick-add footer --------------------------------------------------------------
  function submitQuickNote() {
    const text = quickText.trim();
    if (!text) return;
    annotations.push({
      id: uid(), ts: Date.now(), url: location.href, origin: location.origin,
      category: quickCat, comment: text, text: '', label: 'note',
      selector: '', where: '', tag: '', rect: null, a11y: null, source: null,
      adjustedStyles: {}, destination: null, groupSize: 1, targets: [], hints: [],
    });
    quickText = '';
    saveAnnotations();
    renderPanel();
    updateFab();
    showToast('Note added');
  }

  // --- core draft actions ---------------------------------------------------------
  let holdDirty = false; // targets were added during the current chord hold
  const CHORD_MOD_KEY = PLATFORM === 'mac' ? 'Meta' : 'Control';

  function createDraft() {
    draft = {
      targets: [], primaryIdx: 0, comment: '', category: 'General',
      tweaks: {}, originals: new Map(), destination: null,
    };
  }

  function addToDraft(el) {
    if (!el) return;
    if (!draft) createDraft();
    if (draft.targets.some((t) => t.el === el)) return;
    draft.targets.push({ el, desc: captureElement(el) });
    renderMarkers();
    holdDirty = true;
  }

  function snapshotOriginals(el) {
    if (!draft || draft.originals.has(el)) return;
    const snap = {};
    TWEAK_PROPS.forEach(({ prop }) => {
      snap[prop] = { v: el.style.getPropertyValue(prop), pr: el.style.getPropertyPriority(prop) };
    });
    draft.originals.set(el, snap);
  }

  function restoreOriginals() {
    if (!draft) return;
    draft.originals.forEach((snap, el) => {
      if (!el.isConnected) return;
      Object.entries(snap).forEach(([prop, rec]) => {
        if (rec.v) el.style.setProperty(prop, rec.v, rec.pr);
        else el.style.removeProperty(prop);
      });
    });
  }

  // Live-apply one style declaration to every selected element; '' removes it.
  function applyTweak(prop, value) {
    if (!draft) return;
    let v = String(value == null ? '' : value).trim();
    const def = TWEAK_PROPS.find((p) => p.prop === prop);
    if (def && def.kind === 'length' && /^-?\d+(\.\d+)?$/.test(v)) v += 'px';
    draft.targets.forEach((t) => {
      if (!t.el.isConnected) return;
      snapshotOriginals(t.el);
      if (v === '') t.el.style.removeProperty(prop);
      else t.el.style.setProperty(prop, v, 'important');
    });
    if (v === '') delete draft.tweaks[prop];
    else draft.tweaks[prop] = v;
  }

  function setCategory(cat) {
    if (draft && CATEGORIES.includes(cat)) draft.category = cat;
    refreshChips();
  }

  function promoteTarget(i) {
    if (!draft || i < 0 || i >= draft.targets.length) return;
    draft.primaryIdx = i;
    renderPopover();
    renderMarkers();
  }

  function removeTarget(i) {
    if (!draft) return;
    draft.targets.splice(i, 1);
    if (!draft.targets.length) return cancelDraft();
    if (draft.primaryIdx >= draft.targets.length) draft.primaryIdx = draft.targets.length - 1;
    renderPopover();
    renderMarkers();
  }

  // Zoom row: swap the primary for parent / first child / prev / next sibling.
  // Pending style edits belonged to the old element, so they are reverted.
  function retargetPrimary(dir) {
    if (!draft) return;
    const cur = primaryTarget();
    if (!cur || !cur.el.isConnected) return;
    let next = null;
    if (dir === 'parent') next = cur.el.parentElement;
    else if (dir === 'child') next = cur.el.firstElementChild;
    else if (dir === 'prev') next = cur.el.previousElementSibling;
    else if (dir === 'next') next = cur.el.nextElementSibling;
    if (!(next instanceof Element)) return showToast('Nothing in that direction');
    if (draft.targets.some((t) => t.el === next)) return showToast('Already selected');
    restoreOriginals();
    draft.tweaks = {};
    draft.originals = new Map();
    draft.targets[draft.primaryIdx] = { el: next, desc: captureElement(next) };
    renderPopover();
    renderMarkers();
  }

  // ⧉ Select similar: direct siblings sharing tag + semantic class signature.
  function selectSimilar() {
    if (!draft) return;
    const p = primaryTarget();
    if (!p || !p.el.parentElement) return showToast('No siblings to match');
    const sig = semanticClasses(p.el).join('.');
    const added = [];
    for (const sib of p.el.parentElement.children) {
      if (sib === p.el || sib.tagName !== p.el.tagName) continue;
      if (semanticClasses(sib).join('.') !== sig) continue;
      if (draft.targets.some((t) => t.el === sib)) continue;
      if (draft.targets.length >= SIMILAR_CAP) { showToast('Similar cap reached (' + SIMILAR_CAP + ')'); break; }
      draft.targets.push({ el: sib, desc: captureElement(sib) });
      added.push(sib);
    }
    if (!added.length) return showToast('No similar siblings found');
    similarUndo = added;
    renderPopover();
    renderMarkers();
    showToast('Added ' + added.length + ' similar element(s)');
  }

  function undoSelectSimilar() {
    if (!draft || !similarUndo || !similarUndo.length) return;
    const gone = new Set(similarUndo);
    draft.targets = draft.targets.filter((t) => !gone.has(t.el));
    if (draft.primaryIdx >= draft.targets.length) draft.primaryIdx = draft.targets.length - 1;
    similarUndo = null;
    renderPopover();
    renderMarkers();
  }

  function clearDestination() {
    if (!draft) return;
    draft.destination = null;
    refreshDest();
  }

  function itemFromDraft() {
    const d = primaryTarget().desc;
    return {
      id: uid(), ts: Date.now(), url: location.href, origin: location.origin,
      category: draft.category, comment: draft.comment.trim(),
      text: d.text, label: (d.text || '').slice(0, 60),
      selector: d.selector, where: d.where, tag: d.tag,
      rect: d.rect, a11y: d.a11y, source: d.source,
      adjustedStyles: { ...draft.tweaks },
      destination: draft.destination
        ? { selector: draft.destination.desc.selector, text: draft.destination.desc.text }
        : null,
      groupSize: draft.targets.length,
      targets: draft.targets.map((t) => ({ selector: t.desc.selector, text: t.desc.text })),
      hints: [],
    };
  }

  function closeDraft(restore) {
    stopAnchorLoop();
    hidePopover();
    if (restore && draft) restoreOriginals();
    draft = null;
    similarUndo = null;
    holdDirty = false;
    popoverTab = 'comment';
    setChromeInteractive(true);
  }

  function cancelDraft() {
    if (!draft) return;
    closeDraft(true);
    showToast('Reverted');
  }

  function submitDraft() {
    if (!draft || !draft.targets.length) return;
    annotations.push(itemFromDraft());
    saveAnnotations();
    closeDraft(false); // submitted tweaks stay applied to the page
    renderPanel();
    updateFab();
    showToast('Annotation saved');
  }

  // Cut: copy just this annotation as Markdown without saving.
  function cutAnnotation() {
    if (!draft) return;
    copyText(toMarkdown(sessionInfo(), [itemFromDraft()]));
    closeDraft(true);
  }

  // Reopen a saved annotation as an editable draft (same page + resolvable only).
  function reopenInPopover(item) {
    const targets = [];
    for (const t of item.targets || []) {
      let el = null;
      try { el = document.querySelector(t.selector); } catch (_) { el = null; }
      if (el) targets.push({ el, desc: captureElement(el) });
    }
    if (!targets.length) return showToast('Elements no longer found');
    if (draft) closeDraft(true);
    draft = {
      targets, primaryIdx: 0,
      comment: item.comment || '',
      category: CATEGORIES.includes(item.category) ? item.category : 'General',
      tweaks: { ...(item.adjustedStyles || {}) },
      originals: new Map(),
      destination: null,
    };
    targets.forEach((t) => snapshotOriginals(t.el)); // Cancel restores pre-edit state
    renderPopover();
    startAnchorLoop();
    showToast('Editing annotation');
  }

  // --- pick modes -----------------------------------------------------------------
  function enterPick(kind, onPick, bannerText) {
    exitPick();
    pickCtx = { kind, onPick };
    mode = kind === 'element' ? 'pickElement' : 'pickDestination';
    showBanner(bannerText);
    document.body.style.cursor = 'crosshair';
    setChromeInteractive(false); // tool must never swallow the pick click
  }

  function exitPick() {
    if (!pickCtx) return;
    pickCtx = null;
    mode = 'idle';
    hideBanner();
    hideOutline();
    hoverEl = null;
    document.body.style.cursor = '';
    setChromeInteractive(true);
  }

  function startPickElement() {
    enterPick('element', (el) => addToDraft(el),
      'Click an element to add it to the selection · Esc to cancel');
  }

  function startPickDestination() {
    enterPick('destination', (el) => {
      if (!draft) return;
      draft.destination = { el, desc: captureElement(el) };
      refreshDest();
    }, 'Click the destination element · Esc to cancel');
  }

  // --- overlay piercing + hover preview ---------------------------------------------
  function isOverlayLayer(el) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    const r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.9 || r.height < window.innerHeight * 0.9) return false;
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(/[\s,/]+/).map(parseFloat);
    return parts.length > 3 ? parts[3] < 0.2 : false;
  }

  // Resolve clicks on modal/drawer overlays to the element underneath.
  function pierceOverlays(x, y) {
    const stack = document.elementsFromPoint(x, y)
      .filter((el) => el instanceof Element && !el.closest('[data-rf-chrome]'));
    if (!stack.length) return null;
    for (const el of stack) {
      if (isOverlayLayer(el)) continue;
      return el;
    }
    return stack[stack.length - 1];
  }

  let lastPointer = null;

  // Hover hit-testing coalesced to one update per animation frame.
  function onPageMouseMove(e) {
    if (!chordDown && !pickCtx) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    if (hoverRafId) return;
    hoverRafId = requestAnimationFrame(() => {
      hoverRafId = 0;
      if (!lastPointer) return;
      hoverEl = pierceOverlays(lastPointer.x, lastPointer.y);
      if (hoverEl) showOutline(hoverEl);
      else hideOutline();
    });
  }

  // --- global event bindings -----------------------------------------------------------
  const isChordHeld = (e) => e.altKey && !!e[CHORD_MODIFIER];

  function enterChord() {
    chordDown = true;
    mode = 'chord';
    setChromeInteractive(false);
  }

  // Latch: whichever modifier lifts first resolves the hold — we deliberately do
  // NOT check whether the other modifier is still down on keyup.
  function exitChord() {
    if (!chordDown) return;
    chordDown = false;
    mode = 'idle';
    hideOutline();
    hoverEl = null;
    setChromeInteractive(true);
    if (holdDirty && draft) {
      holdDirty = false;
      renderPopover();
      startAnchorLoop();
    } else {
      const now = Date.now();
      if (now - lastChordTapAt < DOUBLE_TAP_MS) {
        togglePanel();
        lastChordTapAt = 0;
      } else {
        lastChordTapAt = now;
      }
    }
  }

  function handleEscape() {
    if (pickCtx) return exitPick(); // draft preserved either way
    if (draft) return cancelDraft();
    if (panelOpen) closePanel();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') return handleEscape();
    if (!chordDown && !pickCtx && isChordHeld(e) && !e.repeat) enterChord();
  }

  function onKeyUp(e) {
    if (chordDown && (e.key === 'Alt' || e.key === CHORD_MOD_KEY)) exitChord();
  }

  function onPageClick(e) {
    if (pickCtx) {
      e.preventDefault();
      e.stopPropagation();
      const el = pierceOverlays(e.clientX, e.clientY);
      const onPick = pickCtx.onPick;
      exitPick();
      if (el && onPick) onPick(el);
      return;
    }
    if (chordDown) {
      e.preventDefault();
      e.stopPropagation();
      addToDraft(pierceOverlays(e.clientX, e.clientY));
    }
  }

  // --- popover anchor loop ------------------------------------------------------------
  function startAnchorLoop() {
    stopAnchorLoop();
    const tick = () => {
      refreshOverlayPositions();
      anchorRafId = requestAnimationFrame(tick);
    };
    anchorRafId = requestAnimationFrame(tick);
  }

  function stopAnchorLoop() {
    if (anchorRafId) cancelAnimationFrame(anchorRafId);
    anchorRafId = 0;
  }

  // --- SPA route-change protection ------------------------------------------------------
  function discardForRouteChange() {
    if (pickCtx) exitPick();
    if (draft) {
      closeDraft(true);
      showToast('Route changed — draft discarded');
    }
  }

  function installSpaGuard() {
    const wrap = (orig) => function (...args) {
      const result = orig.apply(this, args);
      discardForRouteChange();
      return result;
    };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener('popstate', discardForRouteChange);
  }

  // --- public API -------------------------------------------------------------------------
  window.__SCOPE_FEEDBACK_API__ = {
    markdown: () => toMarkdown(sessionInfo(), annotations),
    json: () => toJson(sessionInfo(), annotations),
    get annotations() { return annotations.slice(); },
    clear() {
      annotations = [];
      saveAnnotations();
      renderPanel();
      updateFab();
    },
    openPanel() { if (!panelOpen) openPanel(); },
  };

  // --- init ----------------------------------------------------------------------------------
  function init() {
    annotations = loadAnnotations();
    buildChrome();
    buildPanel();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mousemove', onPageMouseMove, true);
    window.addEventListener('click', onPageClick, true);
    window.addEventListener('scroll', () => { if (draft) refreshOverlayPositions(); }, true);
    window.addEventListener('resize', () => { if (draft) refreshOverlayPositions(); });
    installSpaGuard();
    updateFab(); // FAB reveals only when this origin has saved annotations
  }

  init();
})();
