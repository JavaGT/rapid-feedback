// ==UserScript==
// @name         Rapid Feedback
// @namespace    https://scope.javagrant.ac.nz
// @version      4.1
// @description  Hold Alt+⌘/Ctrl+click any element to annotate it. Exports as markdown/JSON.
// @author       You
// @match        *://*/*
// @grant        none
// @updateURL   https://gist.githubusercontent.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96/raw/rapid-feedback.user.js
// @downloadURL https://gist.githubusercontent.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96/raw/rapid-feedback.user.js
// ==/UserScript==

(function() {
  'use strict';
  if (window.__SCOPE_FEEDBACK_API__) return;
  window.__SCOPE_FEEDBACK_API__ = true;

  const IS_MAC = /Mac|iPhone|iPod|iPad/i.test(navigator.platform || '') ||
    (navigator.userAgentData?.platform === 'macOS');
  const CHORD_HINT = IS_MAC ? 'Alt+⌘+click' : 'Alt+Ctrl+click';
  const IS_CHORD = e => e.altKey && (IS_MAC ? e.metaKey : e.ctrlKey);
  const IS_SAVE_KEY = e => (e.metaKey || e.ctrlKey) && e.key === 'Enter';

  const CATEGORIES = [
    { id: 'general', label: 'General' },
    { id: 'bug', label: 'Bug' },
    { id: 'feature', label: 'Feature' },
    { id: 'suggestion', label: 'Suggestion' },
    { id: 'question', label: 'Question' },
  ];
  const CAPTURE_PROPS = ['display','position','flex-direction','align-items','justify-content','color','background','background-color','font-size','font-weight','font-family','line-height','text-align','padding','margin','gap','width','height','border','border-radius','box-shadow','overflow','opacity','cursor','z-index'];
  const ADJUSTABLE_PROPS = [
    { key: 'padding', label: 'Padding', type: 'text' },
    { key: 'margin', label: 'Margin', type: 'text' },
    { key: 'font-size', label: 'Font size', type: 'text' },
    { key: 'color', label: 'Color', type: 'text' },
    { key: 'background-color', label: 'Background', type: 'text' },
    { key: 'border-radius', label: 'Border radius', type: 'text' },
    { key: 'width', label: 'Width', type: 'text' },
    { key: 'height', label: 'Height', type: 'text' },
    { key: 'gap', label: 'Gap', type: 'text' },
    { key: 'line-height', label: 'Line height', type: 'text' },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.05 },
  ];
  const STORAGE_KEY = 'scope_feedback_annotations';
  const TEXT_MAX = 150;
  const POPOVER_W = 320;
  const PANEL_W = 380;

  let annotations = [];
  let activeCategory = 'general';
  let panelEl = null;
  let fabEl = null;
  let popoverEl = null;
  let targetEl = null;

  function parentOf(el) {
    let p = el.parentElement || el.parentNode;
    if (!p && el.getRootNode) {
      const r = el.getRootNode();
      if (r?.host) p = r.host;
    }
    return p;
  }

  function collectAttrs(el) {
    const out = [];
    const checks = [
      ['href', el.getAttribute('href')],
      ['src', el.getAttribute('src')?.split('?')[0]],
      ['type', el.getAttribute('type') !== 'text' ? el.getAttribute('type') : null],
      ['placeholder', el.getAttribute('placeholder')],
      ['name', el.getAttribute('name')],
    ];
    for (const [k, v] of checks) if (v) out.push(`${k}="${v}"`);
    return out;
  }

  function describeElement(el) {
    if (el.nodeType !== 1) return '';
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
      const parts = [cur.tagName.toLowerCase()];
      if (cur.id) parts.push('#' + cur.id);
      if (typeof cur.className === 'string') {
        const cls = cur.className.trim().split(/\s+/).filter(Boolean);
        if (cls.length) parts.push('.' + cls.join('.'));
      }
      const attrs = collectAttrs(cur);
      if (attrs.length) parts.push('[' + attrs.join(' ') + ']');
      chain.push(parts.join(''));
      cur = parentOf(cur);
    }
    chain.reverse();
    return chain.slice(0, 8).join(' > ');
  }

  function getTextSnippet(el) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > TEXT_MAX ? t.slice(0, TEXT_MAX) + '\u2026' : t;
  }

  function getComputedStyles(el) {
    const cs = getComputedStyle(el);
    const styles = {};
    for (const prop of CAPTURE_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto') styles[prop] = v;
    }
    return styles;
  }

  function getBoundingRect(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }

  function getBrowserInfo() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
    const m = ua.match(new RegExp(browser + '/(\\d+)'));
    let os = navigator.platform || '';
    if (IS_MAC) os = 'macOS';
    else if (/Win/.test(os)) os = 'Windows';
    else if (/Linux/.test(os)) os = 'Linux';
    return (m ? browser + ' ' + m[1] : browser) + ' on ' + os;
  }

  const SCOPE_CLASS_RE = /\.svelte-[a-z0-9]+/gi;

  function stripScopeHashes(segment) {
    return segment
      .replace(SCOPE_CLASS_RE, '')
      .replace(/\.+/g, '.')
      .replace(/\.$/, '')
      .replace(/^\.+/, '');
  }

  function compactAncestorChain(selector, maxSegments = 7) {
    if (!selector) return '';
    const parts = selector.split(' > ').map(stripScopeHashes).filter(Boolean);
    return parts.slice(-maxSegments).join(' > ');
  }

  function routeFromUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url || '';
    }
  }

  function getViewport() {
    return {
      w: innerWidth,
      h: innerHeight,
      dpr: Math.round((devicePixelRatio || 1) * 100) / 100,
    };
  }

  function targetLabel(a) {
    const text = (a.text || '').trim().replace(/\s+/g, ' ');
    if (text) {
      const line = text.length > 48 ? text.slice(0, 48) + '\u2026' : text;
      return line;
    }
    const leaf = (a.selector || '').split(' > ').pop() || a.tag || 'element';
    const stripped = stripScopeHashes(leaf) || leaf;
    const hrefM = stripped.match(/\[href="([^"]+)"\]/);
    if (hrefM) {
      const slug = hrefM[1].split('/').filter(Boolean).pop();
      if (slug) return slug;
    }
    return stripped;
  }

  function extractHints(a) {
    const hints = [];
    const sel = a.selector || '';
    const text = (a.text || '').trim().replace(/\s+/g, ' ');
    if (text) hints.push({ key: 'Text', value: `"${text.length > 100 ? text.slice(0, 100) + '\u2026' : text}"` });
    const hrefM = sel.match(/\[href="([^"]+)"\]/);
    if (hrefM) hints.push({ key: 'Href', value: hrefM[1] });
    const placeholderM = sel.match(/\[placeholder="([^"]+)"\]/);
    if (placeholderM) hints.push({ key: 'Placeholder', value: `"${placeholderM[1]}"` });
    const nameM = sel.match(/\[name="([^"]+)"\]/);
    if (nameM) hints.push({ key: 'Name', value: `"${nameM[1]}"` });
    return hints;
  }

  function shortSelector(a) {
    if (!a.selector) return a.tag || 'general';
    const leaf = a.selector.split(' > ').pop() || a.tag || '';
    return stripScopeHashes(leaf) || leaf || a.tag || 'general';
  }

  function makeAnnotation(data) {
    return {
      selector: data.selector || '(general)',
      tag: data.tag || 'general',
      text: data.text || '',
      styles: data.styles || null,
      rect: data.rect || null,
      url: data.url || location.href,
      comment: data.comment || '',
      category: data.category || 'general',
      adjustedStyles: data.adjustedStyles || null,
    };
  }

  function toMarkdown(items) {
    if (!items.length) return '';
    const lines = [];
    const pageUrl = items[0].url || location.href;
    const vp = getViewport();

    lines.push(`# Feedback \u2014 ${document.title}`);
    lines.push(`Page: ${routeFromUrl(pageUrl)}`);
    lines.push(`Env: ${vp.w}\u00d7${vp.h} \u00b7 ${getBrowserInfo()}`);
    lines.push('');

    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const cat = (a.category || 'general').toUpperCase();
      const label = targetLabel(a);
      lines.push(`## ${i + 1}. [${cat}] ${label}`);
      if (a.comment) lines.push(a.comment);

      const where = compactAncestorChain(a.selector);
      if (where) lines.push(`Where: ${where}`);

      for (const hint of extractHints(a)) {
        lines.push(`${hint.key}: ${hint.value}`);
      }

      if (a.rect) {
        lines.push(`Rect: ${a.rect.width}\u00d7${a.rect.height} @ ${a.rect.x},${a.rect.y}`);
      }

      if (a.adjustedStyles && Object.keys(a.adjustedStyles).length) {
        lines.push('Tweak:');
        for (const k in a.adjustedStyles) lines.push(`  ${k}: ${a.adjustedStyles[k]};`);
      }

      if (i < items.length - 1) lines.push('');
    }
    return lines.join('\n');
  }

  function toFeedbackJSON(items) {
    const bi = getBrowserInfo(), sp = bi.indexOf(' on ');
    const vp = getViewport();
    const pageUrl = items[0]?.url || location.href;
    return {
      session: {
        pageTitle: document.title,
        url: pageUrl,
        route: routeFromUrl(pageUrl),
        viewport: vp,
        browser: sp > 0 ? bi.slice(0, sp) : bi,
        os: sp > 0 ? bi.slice(sp + 4) : '',
      },
      items: items.map(a => ({
        category: a.category || 'general',
        comment: a.comment,
        label: targetLabel(a),
        selector: a.selector || null,
        where: compactAncestorChain(a.selector) || null,
        tag: a.tag || null,
        text: a.text || null,
        rect: a.rect || null,
        adjustedStyles: a.adjustedStyles || null,
        hints: extractHints(a),
      })),
    };
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Copied'); } catch { showToast('Failed'); }
    document.body.removeChild(ta);
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Copied'))
        .catch(() => fallbackCopy(text));
      return;
    }
    fallbackCopy(text);
  }

  function load() {
    try {
      let data = localStorage.getItem(STORAGE_KEY);
      if (!data) {
        data = localStorage.getItem('rapid_feedback_annotations');
        if (data) localStorage.setItem(STORAGE_KEY, data);
      }
      if (data) annotations = JSON.parse(data);
    } catch {}
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations)); } catch {}
  }

  function persist(fn) {
    fn();
    save();
    if (panelEl) renderPanel();
  }

  function injectStyles() {
    const el = document.createElement('style');
    el.textContent = `
.rf-overlay{position:fixed;inset:0;pointer-events:none;z-index:20001;background:rgba(255,255,200,0.15);transition:opacity 0.6s}
.rf-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:6px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;z-index:20000;box-shadow:0 2px 8px rgba(0,0,0,0.2);pointer-events:none}
.rf-fab{position:fixed;bottom:20px;right:20px;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;z-index:20001;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-family:sans-serif;user-select:none;border:none;transition:opacity 0.2s,transform 0.2s;color:#fff}
.rf-panel{position:fixed;top:0;right:0;width:${PANEL_W}px;max-width:100vw;height:100dvh;background:#f7fafc;color:#2d3748;display:flex;flex-direction:column;font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;box-sizing:border-box;z-index:10001;border-left:1px solid #e2e8f0;box-shadow:-2px 0 12px rgba(0,0,0,0.1)}
.rf-panel-header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e2e8f0;flex-shrink:0}
.rf-panel-header h2{margin:0;font-size:15px;font-weight:600;flex:1}
.rf-panel-toolbar{display:flex;gap:6px;padding:8px 16px;border-bottom:1px solid #e2e8f0;flex-shrink:0;flex-wrap:wrap}
.rf-panel-list{flex:1;overflow-y:auto;padding:8px 12px}
.rf-panel-footer{border-top:1px solid #e2e8f0;padding:10px 12px;flex-shrink:0}
.rf-card{background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-bottom:8px}
.rf-card-title{font-size:12px;font-weight:600;color:#4a5568}
.rf-card-cat{font-size:9px;padding:1px 5px;border-radius:3px;background:#edf2f7;color:#718096}
.rf-comment{font-size:12px;padding:6px 8px;background:#edf2f7;border-radius:4px;border-left:3px solid #e2e8f0;margin-bottom:4px;word-break:break-word}
.rf-url{font-size:10px;color:#718096;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rf-popover{position:fixed;z-index:10002;width:${POPOVER_W}px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;box-shadow:0 4px 16px rgba(0,0,0,0.15);font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#2d3748}
.rf-popover-ta{width:100%;min-height:60px;padding:8px;border:1px solid #e2e8f0;border-radius:4px;font:13px inherit;resize:vertical;box-sizing:border-box;background:#f7fafc;color:#2d3748}
.rf-popover-ta:focus{outline:2px solid #4a5568;outline-offset:-1px}
.rf-btn{padding:5px 12px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font:12px inherit;background:#f7fafc;color:#2d3748}
.rf-btn-primary{background:#4a5568;color:#fff;border-color:#4a5568;font-weight:600}
.rf-btn-sm{padding:3px 8px;font-size:11px;background:transparent;color:#718096;border-color:#e2e8f0}
.rf-btn-icon{background:0 0;border:none;color:#718096;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:13px}
.rf-btn-del{font-size:15px}
.rf-cat-btn{padding:3px 8px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font:11px inherit;background:transparent;color:#718096}
.rf-cat-btn.active{border-color:#4a5568;background:#edf2f7;color:#2d3748}
.rf-cat-bar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}
.rf-styles-header{display:flex;align-items:center;gap:6px;padding:6px 0;cursor:pointer;border-top:1px solid #e2e8f0;user-select:none;font-size:11px;margin-top:8px}
.rf-styles-body{padding:6px 0;border-top:1px solid #e2e8f0;display:none}
.rf-styles-row{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.rf-styles-label{font-size:10px;color:#718096;width:90px;flex-shrink:0}
.rf-styles-input{flex:1;padding:2px 6px;border:1px solid #e2e8f0;border-radius:3px;font:11px monospace;background:#fff;color:#2d3748}
.rf-styles-range{flex:1;height:16px}
.rf-styles-val{font-size:10px;color:#2d3748;width:36px;text-align:right}
.rf-empty{color:#718096;text-align:center;padding:32px 16px}
.rf-actions{display:flex;gap:6px;margin-top:6px;justify-content:flex-end}
    `;
    document.head.appendChild(el);
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') el.className = v;
        else if (k === 'textContent') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else if (child) el.appendChild(child);
    }
    return el;
  }

  function showToast(msg) {
    const t = h('div', { className: 'rf-toast', style: 'background:#4a5568;color:#fff' }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }

  function renderCategoryButtons(container, activeId, onChange) {
    container.innerHTML = '';
    for (const c of CATEGORIES) {
      const btn = h('button', {
        className: 'rf-cat-btn' + (c.id === activeId ? ' active' : ''),
        'data-id': c.id,
        onClick() {
          container.querySelectorAll('.rf-cat-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          onChange(c.id);
        },
      }, c.label);
      container.appendChild(btn);
    }
  }

  function showPopover(el, data) {
    hidePopover();
    targetEl = el;
    popoverEl = h('div', { className: 'rf-popover' });
    const adjustedStyles = {};
    let stylesOpen = false;
    let selCat = activeCategory;

    const titleEl = h('div', { style: 'font-weight:600;font-size:12px;color:#2d3748;margin-bottom:2px' }, targetLabel({ ...data, comment: '' }));
    const selEl = h('div', { style: 'font-size:9px;color:#718096;margin-bottom:4px;font-family:monospace;word-break:break-all;max-height:40px;overflow:hidden' }, compactAncestorChain(data.selector) || data.selector);
    const catBar = h('div', { className: 'rf-cat-bar' });
    renderCategoryButtons(catBar, selCat, id => { selCat = id; });
    const ta = h('textarea', { className: 'rf-popover-ta', placeholder: 'What should change?' });
    const stylesHeader = h('div', { className: 'rf-styles-header' },
      h('span', { className: 'rf-arrow', style: 'font-size:11px;color:#718096;transition:transform 0.15s' }, '\u25B6'),
      h('span', { style: 'font-weight:600;color:#2d3748' }, 'Styles'),
      h('span', { style: 'font-size:10px;color:#a0aec0' }, 'adjust live'),
    );
    const stylesBody = h('div', { className: 'rf-styles-body' });

    for (const ap of ADJUSTABLE_PROPS) {
      const currentVal = data.styles?.[ap.key] || '';
      const row = h('div', { className: 'rf-styles-row' });
      row.appendChild(h('label', { className: 'rf-styles-label' }, ap.label));
      if (ap.type === 'range') {
        const v = parseFloat(currentVal);
        const val = isNaN(v) ? 1 : v;
        const inp = h('input', {
          type: 'range', min: ap.min, max: ap.max, step: ap.step,
          value: val, 'data-prop': ap.key, className: 'rf-styles-range',
        });
        const valSpan = h('span', { className: 'rf-styles-val' }, String(val));
        inp.addEventListener('input', () => applyStyle(ap.key, inp.value, adjustedStyles, valSpan));
        row.appendChild(inp);
        row.appendChild(valSpan);
      } else {
        const inp = h('input', {
          type: 'text', value: currentVal, placeholder: '\u2014',
          'data-prop': ap.key, className: 'rf-styles-input',
        });
        inp.addEventListener('input', () => applyStyle(ap.key, inp.value.trim(), adjustedStyles));
        inp.addEventListener('keydown', e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const match = inp.value.match(/^(-?[\d.]+)(.*)$/);
          if (!match) return;
          let num = parseFloat(match[1]);
          const unit = match[2] || '';
          const step = e.shiftKey ? 10 : (Math.abs(num) < 1 ? 0.1 : 1);
          num = Math.round((num + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100;
          inp.value = num + unit;
          applyStyle(ap.key, inp.value.trim(), adjustedStyles);
        });
        row.appendChild(inp);
      }
      stylesBody.appendChild(row);
    }

    const resetBtn = h('button', {
      className: 'rf-btn rf-btn-sm', textContent: 'Reset',
      onClick() {
        for (const k in adjustedStyles) targetEl.style[k] = '';
        for (const k in adjustedStyles) delete adjustedStyles[k];
        popoverEl.querySelectorAll('.rf-styles-input, .rf-styles-range').forEach(inp => {
          const prop = inp.getAttribute('data-prop');
          const def = data.styles?.[prop] || '';
          inp.value = def;
          if (inp.type === 'range') {
            const v = parseFloat(def);
            inp.value = isNaN(v) ? '1' : String(v);
            popoverEl.querySelector('.rf-styles-val').textContent = inp.value;
          }
        });
        showToast('Styles reset');
      },
    });
    stylesBody.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:4px;justify-content:flex-end' }, resetBtn));

    stylesHeader.addEventListener('click', () => {
      stylesOpen = !stylesOpen;
      stylesBody.style.display = stylesOpen ? 'block' : 'none';
      stylesHeader.querySelector('span').style.transform = stylesOpen ? 'rotate(90deg)' : 'rotate(0deg)';
    });

    function submit() {
      let comment = ta.value.trim();
      if (Object.keys(adjustedStyles).length) {
        const css = Object.entries(adjustedStyles).map(([k, v]) => `${k}: ${v};`).join('\n');
        comment = comment ? comment + '\n\n' + css : css;
      }
      if (!comment) { showToast('Please enter a comment or adjust a style'); return; }
      persist(() => {
        annotations.push(makeAnnotation({
          ...data,
          comment,
          category: selCat,
          adjustedStyles: Object.keys(adjustedStyles).length ? { ...adjustedStyles } : null,
        }));
      });
      hidePopover();
      showToast('Saved');
    }

    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (IS_SAVE_KEY(e)) { e.preventDefault(); submit(); }
    });

    const actions = h('div', { className: 'rf-actions' },
      h('button', { className: 'rf-btn', onClick: hidePopover }, 'Cancel'),
      h('button', {
        className: 'rf-btn',
        onClick() {
          const comment = ta.value.trim() || '(no comment)';
          copyText(toMarkdown([makeAnnotation({ ...data, comment, adjustedStyles: Object.keys(adjustedStyles).length ? { ...adjustedStyles } : null })]));
          hidePopover();
        },
      }, 'Cut'),
      h('button', { className: 'rf-btn rf-btn-primary', onClick: submit }, 'Submit'),
    );

    popoverEl.appendChild(titleEl);
    popoverEl.appendChild(selEl);
    if (data.text) {
      popoverEl.appendChild(h('div', { style: 'font-size:11px;color:#718096;margin-bottom:6px;font-style:italic' }, `\u201c${data.text}\u201d`));
    }
    popoverEl.appendChild(catBar);
    popoverEl.appendChild(ta);
    popoverEl.appendChild(stylesHeader);
    popoverEl.appendChild(stylesBody);
    popoverEl.appendChild(actions);
    document.body.appendChild(popoverEl);

    const rect = el.getBoundingClientRect();
    let top = rect.bottom + 10;
    let left = Math.max(4, Math.min(rect.left, innerWidth - POPOVER_W - 10));
    if (top + 400 > innerHeight) top = Math.max(4, rect.top - 400 - 10);
    popoverEl.style.top = top + 'px';
    popoverEl.style.left = left + 'px';
    ta.focus();
  }

  function hidePopover() {
    if (popoverEl) { popoverEl.remove(); popoverEl = null; }
    targetEl = null;
  }

  function applyStyle(prop, val, adjustedStyles, valSpan) {
    if (!val) {
      delete adjustedStyles[prop];
      if (targetEl) targetEl.style[prop] = '';
    } else {
      adjustedStyles[prop] = val;
      if (targetEl) targetEl.style[prop] = val;
    }
    if (valSpan) valSpan.textContent = val;
  }

  function renderAnnotationCard(a, idx) {
    const target = shortSelector(a) || a.selector;
    const catLabel = CATEGORIES.find(c => c.id === (a.category || 'general'))?.label || '';

    const card = h('div', { className: 'rf-card', 'data-idx': String(idx) });
    const body = h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:8px' });
    const left = h('div', { style: 'flex:1;min-width:0' });
    const titleRow = h('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px' },
      h('span', { className: 'rf-card-title' }, target),
    );
    if (catLabel) titleRow.appendChild(h('span', { className: 'rf-card-cat' }, catLabel));
    left.appendChild(titleRow);
    left.appendChild(h('div', { className: 'rf-comment' }, a.comment || ''));
    if (a.adjustedStyles && Object.keys(a.adjustedStyles).length) {
      const entries = Object.entries(a.adjustedStyles).map(([k, v]) => `${k}: ${v}`).join('; ');
      left.appendChild(h('div', { style: 'font-size:10px;color:#718096;margin-top:4px;font-family:monospace' }, entries));
    }
    left.appendChild(h('div', { className: 'rf-url' }, a.url));

    const right = h('div', { style: 'display:flex;gap:4px;flex-shrink:0' },
      h('button', { className: 'rf-btn-icon rf-edit-btn', 'data-idx': String(idx), textContent: '\u270E' }),
      h('button', { className: 'rf-btn-icon rf-btn-del rf-del-btn', 'data-idx': String(idx), textContent: '\u00d7' }),
    );
    body.appendChild(left);
    body.appendChild(right);
    card.appendChild(body);
    return card;
  }

  function renderPanel() {
    if (!panelEl) return;
    panelEl.innerHTML = '';

    const header = h('div', { className: 'rf-panel-header' },
      h('h2', { textContent: 'Rapid Feedback' }),
      h('span', { style: 'font-size:11px;color:#718096;font-weight:500' }, String(annotations.length)),
      h('button', { className: 'rf-btn-icon', style: 'font-size:20px', textContent: '\u00d7', onClick: closePanel }),
    );

    const toolbar = h('div', { className: 'rf-panel-toolbar' },
      h('button', { className: 'rf-btn', textContent: 'Copy', onClick: () => { if (annotations.length) copyText(toMarkdown(annotations)); else showToast('Nothing to export'); } }),
      h('button', { className: 'rf-btn', textContent: 'JSON', onClick: () => { if (annotations.length) copyText(JSON.stringify(toFeedbackJSON(annotations))); else showToast('Nothing to export'); } }),
      h('button', { className: 'rf-btn', textContent: 'Cut All', onClick: () => { if (!annotations.length) { showToast('Nothing to cut'); return; } copyText(toMarkdown(annotations)); persist(() => { annotations = []; }); showToast('Cut'); } }),
      h('button', { className: 'rf-btn', textContent: 'Clear', onClick: clearAll }),
    );

    const list = h('div', { className: 'rf-panel-list' });

    if (!annotations.length) {
      list.appendChild(h('div', { className: 'rf-empty' }, `No annotations yet. ${CHORD_HINT} any element.`));
    } else {
      for (let i = 0; i < annotations.length; i++) {
        list.appendChild(renderAnnotationCard(annotations[i], i));
      }
    }

    // Event delegation for edit/del
    list.addEventListener('click', e => {
      const editBtn = e.target.closest('.rf-edit-btn');
      const delBtn = e.target.closest('.rf-del-btn');
      if (!editBtn && !delBtn) return;

      const idx = parseInt((editBtn || delBtn).getAttribute('data-idx'), 10);
      const a = annotations[idx];
      if (!a) return;

      if (delBtn) {
        persist(() => { annotations.splice(idx, 1); });
        showToast('Deleted');
        return;
      }

      const card = panelEl.querySelector(`[data-idx="${idx}"]`);
      if (!card) return;
      const commentEl = card.querySelector('.rf-comment');
      if (!commentEl) return;

      if (commentEl.getAttribute('contenteditable') === 'true') {
        persist(() => { a.comment = commentEl.textContent.trim(); });
        commentEl.setAttribute('contenteditable', 'false');
        commentEl.style.background = '#edf2f7';
        commentEl.style.borderLeftColor = '#e2e8f0';
        editBtn.textContent = '\u270E';
      } else {
        commentEl.setAttribute('contenteditable', 'true');
        commentEl.style.background = '#fff';
        commentEl.style.borderLeftColor = '#4a5568';
        commentEl.focus();
        editBtn.textContent = '\u2713';
      }
    });

    const footer = h('div', { className: 'rf-panel-footer' });
    const ftCatBar = h('div', { style: 'display:flex;gap:4px;margin-bottom:6px' });
    renderCategoryButtons(ftCatBar, activeCategory, id => { activeCategory = id; });
    const genTa = h('textarea', {
      className: 'rf-popover-ta',
      style: 'min-height:44px;margin-bottom:6px',
      placeholder: 'Quick feedback...',
    });
    const genBtn = h('button', { className: 'rf-btn', textContent: 'Send' });
    genBtn.addEventListener('click', () => {
      const t = genTa.value.trim();
      if (!t) return;
      persist(() => { annotations.push(makeAnnotation({ comment: t, category: activeCategory })); });
      genTa.value = '';
      showToast('Saved');
    });
    genTa.addEventListener('keydown', e => {
      e.stopPropagation();
      if (IS_SAVE_KEY(e)) {
        e.preventDefault();
        const t = genTa.value.trim();
        if (!t) return;
        persist(() => { annotations.push(makeAnnotation({ comment: t, category: activeCategory })); });
        genTa.value = '';
        showToast('Saved');
      }
    });
    footer.appendChild(ftCatBar);
    footer.appendChild(genTa);
    footer.appendChild(h('div', { style: 'display:flex;gap:6px;align-items:center' }, genBtn, h('span', { style: 'font-size:10px;color:#a0aec0' }, `${annotations.length} total`)));

    panelEl.appendChild(header);
    panelEl.appendChild(toolbar);
    panelEl.appendChild(list);
    panelEl.appendChild(footer);
  }

  function openPanel() {
    if (panelEl) { panelEl.style.display = 'flex'; renderPanel(); return; }
    panelEl = h('div', { className: 'rf-panel' });
    document.body.appendChild(panelEl);
    renderPanel();
  }

  function closePanel() {
    if (panelEl) panelEl.style.display = 'none';
  }

  function clearAll() {
    if (!annotations.length) return;
    persist(() => { annotations = []; });
    showToast('Cleared');
  }

  function createFab() {
    if (fabEl) return;
    fabEl = h('button', {
      className: 'rf-fab',
      'aria-label': 'Feedback',
      textContent: '\u270f',
      style: 'opacity:0;transform:translateX(60px);pointer-events:none;background:#4a5568',
      onClick(e) {
        e.stopPropagation();
        if (panelEl && panelEl.style.display !== 'none') closePanel();
        else openPanel();
      },
    });
    document.body.appendChild(fabEl);
  }

  function revealFab() {
    if (!fabEl) createFab();
    fabEl.style.opacity = '1';
    fabEl.style.transform = 'translateX(0)';
    fabEl.style.pointerEvents = 'auto';
  }

  function concealFab() {
    if (!fabEl) return;
    fabEl.style.opacity = '0';
    fabEl.style.transform = 'translateX(60px)';
    fabEl.style.pointerEvents = 'none';
  }

  function hasAnnotations() {
    const origin = location.origin;
    return annotations.some(a => { try { return new URL(a.url).origin === origin; } catch { return false; } });
  }

  // --- Events ---

  document.addEventListener('mousedown', e => {
    if (IS_CHORD(e) && e.target?.tagName === 'SELECT') e.preventDefault();
  }, true);

  document.addEventListener('click', e => {
    if (!IS_CHORD(e)) return;
    if (fabEl && (e.target === fabEl || fabEl.contains(e.target))) return;
    e.preventDefault();
    e.stopPropagation();
    const path = e.composedPath ? e.composedPath() : [e.target];
    const target = path[0];
    if (!target || target.nodeType !== 1) return;
    hidePopover();
    showPopover(target, {
      selector: describeElement(target),
      tag: target.tagName.toLowerCase(),
      text: getTextSnippet(target),
      styles: getComputedStyles(target),
      rect: getBoundingRect(target),
    });
  }, true);

  let chordWasActive = false;
  let lastChordRelease = 0;
  const DOUBLE_TAP_MS = 300;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (popoverEl) { hidePopover(); return; }
      if (panelEl && panelEl.style.display !== 'none') { closePanel(); return; }
    }
    if (IS_CHORD(e)) {
      if (!e.repeat) revealFab();
      chordWasActive = true;
    }
  });

  document.addEventListener('keyup', e => {
    if (chordWasActive && !IS_CHORD(e)) {
      chordWasActive = false;
      const now = performance.now();
      if (now - lastChordRelease < DOUBLE_TAP_MS) {
        lastChordRelease = 0;
        if (panelEl && panelEl.style.display !== 'none') closePanel();
        else openPanel();
        return;
      }
      lastChordRelease = now;
    }
    if (!IS_CHORD(e) && !hasAnnotations()) concealFab();
  });

  // --- Init ---
  injectStyles();
  load();
  createFab();
  if (hasAnnotations()) revealFab();
})();
