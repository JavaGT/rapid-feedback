// ==UserScript==
// @name         Rapid Feedback
// @namespace    https://scope.javagrant.ac.nz
// @version      3.0
// @description  Hold Alt+⌘ and click (Mac) or Alt+Ctrl+click (Windows/Linux) any element to annotate it. Exports as markdown. Mirrors the Scope self-hosted feedback plugin (lib/feedback-core.js).
// @author       You
// @match        *://*/*
// @grant        none
// @updateURL   https://gist.githubusercontent.com/JavaGT/3cee0b3d6dae324935435ed7e5e9a6c8/raw/scope-feedback.user.js
// @downloadURL https://gist.githubusercontent.com/JavaGT/3cee0b3d6dae324935435ed7e5e9a6c8/raw/scope-feedback.user.js
// ==/UserScript==

(function() {
  'use strict';

  if (window.__SCOPE_FEEDBACK_API__) return;

  // --- shared core (mirrors public/lib/feedback-core.js) ---
  var CATEGORIES = [
    { id: 'bug', label: 'Bug' },
    { id: 'feature', label: 'Feature' },
    { id: 'suggestion', label: 'Suggestion' },
    { id: 'question', label: 'Question' },
  ];
  var STYLE_PROPS = ['display','position','flex-direction','align-items','justify-content','color','background','background-color','font-size','font-weight','font-family','line-height','text-align','padding','margin','gap','width','height','border','border-radius','box-shadow','overflow','opacity','cursor','z-index'];
  var TEXT_MAX = 150;
  var PANEL_WIDTH = 380;
  var STORAGE_KEY = 'scope_feedback_annotations';
  var VERSION = '3.0';
  var UPDATE_URL = 'https://gist.githubusercontent.com/JavaGT/3cee0b3d6dae324935435ed7e5e9a6c8/raw/scope-feedback.user.js';

  function isMacLike() {
    if (typeof navigator !== 'undefined' && navigator.userAgentData && navigator.userAgentData.platform === 'macOS') return true;
    return /Mac|iPhone|iPod|iPad/i.test(navigator.platform || '');
  }

  function isFeedbackChord(e) { return e.altKey && (isMacLike() ? e.metaKey : e.ctrlKey); }

  var chordHint = isMacLike() ? 'Alt+\u2318+click' : 'Alt+Ctrl+click';

  function parentOf(el) {
    var p = el.parentElement || el.parentNode;
    if (!p && el.getRootNode) { var r = el.getRootNode(); if (r && r.host) p = r.host; }
    return p;
  }

  function collectAttrs(el) {
    var a = [];
    var cs = [['href',el.getAttribute('href')],['src',el.getAttribute('src')&&el.getAttribute('src').split('?')[0]],['type',el.getAttribute('type')!=='text'?el.getAttribute('type'):null],['placeholder',el.getAttribute('placeholder')],['name',el.getAttribute('name')]];
    for (var i = 0; i < cs.length; i++) if (cs[i][1]) a.push(cs[i][0] + '="' + cs[i][1] + '"');
    return a;
  }

  function describeElement(el) {
    var chain = [], cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var p = [cur.tagName.toLowerCase()];
      if (cur.id) p.push('#' + cur.id);
      if (cur.className && typeof cur.className === 'string') {
        var cl = cur.className.trim().split(/\s+/).filter(Boolean);
        if (cl.length) p.push('.' + cl.join('.'));
      }
      var attrs = collectAttrs(cur);
      if (attrs.length) p.push('[' + attrs.join(' ') + ']');
      chain.push(p.join(''));
      cur = parentOf(cur);
    }
    chain.reverse();
    return chain.slice(0, 8).join(' > ');
  }

  function getTextSnippet(el) {
    var t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > TEXT_MAX ? t.slice(0, TEXT_MAX) + '\u2026' : t;
  }

  function getComputedStyles(el) {
    var cs = window.getComputedStyle(el), s = {};
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var v = cs.getPropertyValue(STYLE_PROPS[i]);
      if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto') s[STYLE_PROPS[i]] = v;
    }
    return s;
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }

  function toMarkdown(items) {
    var md = '## Change Requests\n\n';
    for (var i = 0; i < items.length; i++) {
      var a = items[i], label = a.selector ? a.selector.split(' > ')[0] : 'Feedback ' + (i+1);
      md += '### ' + (i+1) + '. ' + label + '\n- **Page**: ' + a.url + '\n';
      if (a.selector) md += '- **DOM Chain**: `' + a.selector + '`\n';
      if (a.text) md += '- **Text**: "' + a.text + '"\n';
      if (a.styles && Object.keys(a.styles).length) md += '- **Styles**: `' + Object.keys(a.styles).map(function(k){return k+': '+a.styles[k]}).join('; ') + '`\n';
      md += '- **Request**: ' + a.comment + '\n\n';
    }
    return md;
  }

  // --- storage ---
  var storageOk = (function(){try{var k='__sf__';localStorage.setItem(k,'1');localStorage.removeItem(k);return true}catch(e){return false}})();
  function load() { try { var d = localStorage.getItem(STORAGE_KEY); if (d) annotations = JSON.parse(d); } catch(e) {} }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations)); } catch(e) {} }

  // --- state ---
  var annotations = [], panelOpen = false, panel = null, fab = null, popover = null;
  var _clearConfirm = false, _fabRevealed = false;
  var _modKeys = { meta: false, alt: false, ctrl: false };
  var _category = 'bug';

  // --- UI ---
  function showToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    var s = t.style;
    s.position = 'fixed'; s.bottom = '80px'; s.left = '50%'; s.transform = 'translateX(-50%)';
    s.background = '#333'; s.color = '#fff'; s.padding = '8px 16px'; s.borderRadius = '6px';
    s.fontSize = '13px'; s.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    s.zIndex = 20000; s.boxShadow = '0 2px 8px rgba(0,0,0,0.2)'; s.pointerEvents = 'none';
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function(){showToast('Copied')}); return; }
    var ta = document.createElement('textarea'); ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('Copied'); } catch(e) { showToast('Failed'); }
    document.body.removeChild(ta);
  }

  function showPopover(el, data) {
    hidePopover();
    popover = document.createElement('div');

    var cats = '';
    for (var ci = 0; ci < CATEGORIES.length; ci++) {
      var c = CATEGORIES[ci];
      cats += '<button class="sf-cat" data-id="' + c.id + '" style="padding:3px 8px;border:1px solid ' + (c.id==='bug'?'#555':'#ddd') + ';border-radius:4px;background:' + (c.id==='bug'?'#f0f0f0':'#fff') + ';color:' + (c.id==='bug'?'#333':'#666') + ';cursor:pointer;font-size:11px;font-family:inherit;">' + c.label + '</button>';
    }

    popover.innerHTML =
      '<div style="font-weight:600;font-size:12px;color:#555;margin-bottom:2px;">' + escapeHtml(data.selector.split(' > ')[0]) + '</div>' +
      '<div style="font-size:9px;color:#999;margin-bottom:4px;font-family:monospace;word-break:break-all;max-height:32px;overflow:hidden;">' + escapeHtml(data.selector) + '</div>' +
      (data.text ? '<div style="font-size:11px;color:#666;margin-bottom:6px;font-style:italic;">\u201c' + escapeHtml(data.text) + '\u201d</div>' : '') +
      '<div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;">' + cats + '</div>' +
      '<textarea id="sf-ta" placeholder="What should change?" style="width:100%;min-height:60px;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>' +
      '<div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end;">' +
      '<button id="sf-cancel" style="padding:5px 12px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit;color:#333;">Cancel</button>' +
      '<button id="sf-submit" style="padding:5px 12px;border:1px solid #555;border-radius:4px;background:#555;color:#fff;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">Submit</button></div>';

    var s = popover.style;
    s.position = 'fixed'; s.zIndex = 10002; s.background = '#fff';
    s.border = '1px solid #ddd'; s.borderRadius = '8px'; s.padding = '14px';
    s.boxShadow = '0 4px 16px rgba(0,0,0,0.15)'; s.width = '320px';
    s.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    s.fontSize = '13px'; s.color = '#333';

    document.body.appendChild(popover);

    var rect = el.getBoundingClientRect();
    var top = rect.bottom + 10, left = Math.max(4, Math.min(rect.left, window.innerWidth - 330));
    if (top + 300 > window.innerHeight) top = Math.max(4, rect.top - 300 - 10);
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';

    var ta = popover.querySelector('#sf-ta');
    ta.focus();

    var selectedCat = 'bug';
    var catBtns = popover.querySelectorAll('.sf-cat');
    for (var cj = 0; cj < catBtns.length; cj++) {
      catBtns[cj].addEventListener('click', function() {
        for (var ck = 0; ck < catBtns.length; ck++) { catBtns[ck].style.borderColor = '#ddd'; catBtns[ck].style.background = '#fff'; catBtns[ck].style.color = '#666'; }
        this.style.borderColor = '#555'; this.style.background = '#f0f0f0'; this.style.color = '#333';
        selectedCat = this.getAttribute('data-id');
      });
    }

    function submit() {
      var comment = ta.value.trim();
      if (!comment) { showToast('Please enter a comment'); return; }
      data.comment = comment;
      data.category = selectedCat;
      annotations.push(data);
      save();
      hidePopover();
      if (panel) renderPanel();
      showToast('Saved');
      shimmer();
    }

    ta.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    popover.querySelector('#sf-submit').onclick = submit;
    popover.querySelector('#sf-cancel').onclick = hidePopover;
  }

  function hidePopover() { if (popover) { popover.remove(); popover = null; } }

  function renderPanel() {
    if (!panel) return;

    var listHtml = '';
    for (var i = 0; i < annotations.length; i++) {
      var a = annotations[i], target = a.selector.split(' > ')[0] || a.selector;
      var catLabel = '';
      for (var ci = 0; ci < CATEGORIES.length; ci++) { if (CATEGORIES[ci].id === (a.category||'bug')) catLabel = CATEGORIES[ci].label; }
      listHtml += '<div style="background:#fff;border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:8px;" data-idx="' + i + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
        '<span style="font-size:12px;font-weight:600;color:#555;">' + escapeHtml(target) + '</span>' +
        (catLabel ? '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#f5f5f5;color:#666;">' + catLabel + '</span>' : '') +
        '</div>' +
        '<div class="sf-comment" style="font-size:12px;padding:6px 8px;background:#fafafa;border-radius:4px;border-left:3px solid #ddd;margin-bottom:4px;word-break:break-word;" contenteditable="false">' + escapeHtml(a.comment) + '</div>' +
        '<div style="font-size:10px;color:#999;">' + escapeHtml(a.url) + '</div></div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0;">' +
        '<button class="sf-edit" data-idx="' + i + '" style="background:none;border:none;color:#999;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:3px;">\u270E</button>' +
        '<button class="sf-del" data-idx="' + i + '" style="background:none;border:none;color:#999;cursor:pointer;font-size:15px;padding:2px 6px;border-radius:3px;">\u00d7</button></div></div></div>';
    }

    if (!listHtml) {
      listHtml = '<div style="color:#999;text-align:center;padding:32px 16px;">No annotations yet. ' + chordHint + ' any element.</div>';
    }

    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #eee;flex-shrink:0;">' +
      '<span style="font-size:15px;font-weight:600;flex:1;">Rapid Feedback</span>' +
      '<span style="font-size:11px;color:#999;font-weight:500;">' + annotations.length + '</span>' +
      '<button id="sf-close" style="background:none;border:none;color:#999;cursor:pointer;font-size:20px;padding:2px 4px;border-radius:4px;font-family:inherit;">\u00d7</button></div>' +
      '<div style="padding:8px 16px;display:flex;gap:6px;border-bottom:1px solid #eee;flex-shrink:0;flex-wrap:wrap;">' +
      '<button id="sf-export" style="flex:1;padding:5px 10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit;">Copy</button>' +
      '<button id="sf-clear" style="padding:5px 10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit;color:#555;">Clear</button></div>' +
      '<div id="sf-list" style="flex:1;overflow-y:auto;padding:8px 12px;">' + listHtml + '</div>' +
      '<div style="padding:10px 12px;border-top:1px solid #eee;flex-shrink:0;">' +
      '<div style="display:flex;gap:4px;margin-bottom:6px;">' +
      (function(){
        var h = '';
        for (var ci2 = 0; ci2 < CATEGORIES.length; ci2++) {
          var c2 = CATEGORIES[ci2];
          h += '<button class="sf-ftcat" data-id="' + c2.id + '" style="padding:3px 8px;border:1px solid ' + (c2.id==='bug'?'#555':'#ddd') + ';border-radius:4px;background:' + (c2.id==='bug'?'#f0f0f0':'#fff') + ';color:' + (c2.id==='bug'?'#333':'#666') + ';cursor:pointer;font-size:11px;font-family:inherit;">' + c2.label + '</button>';
        }
        return h;
      })() +
      '</div>' +
      '<textarea id="sf-general" placeholder="Quick feedback..." style="width:100%;min-height:44px;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;margin-bottom:6px;"></textarea>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
      '<button id="sf-gen-submit" style="padding:4px 10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:11px;font-family:inherit;">Send</button>' +
      '<span style="font-size:10px;color:#aaa;">' + annotations.length + ' total</span></div></div>';

    panel.querySelector('#sf-close').addEventListener('click', closePanel);
    panel.querySelector('#sf-export').addEventListener('click', function(){ if (annotations.length) copyText(toMarkdown(annotations)); else showToast('Nothing to export'); });
    panel.querySelector('#sf-clear').addEventListener('click', clearAll);

    // footer category toggle
    var ftCats = panel.querySelectorAll('.sf-ftcat');
    for (var ci3 = 0; ci3 < ftCats.length; ci3++) {
      ftCats[ci3].addEventListener('click', function() {
        for (var ci4 = 0; ci4 < ftCats.length; ci4++) { ftCats[ci4].style.borderColor = '#ddd'; ftCats[ci4].style.background = '#fff'; ftCats[ci4].style.color = '#666'; }
        this.style.borderColor = '#555'; this.style.background = '#f0f0f0'; this.style.color = '#333';
        _category = this.getAttribute('data-id');
      });
    }

    var gen = panel.querySelector('#sf-general');
    panel.querySelector('#sf-gen-submit').addEventListener('click', function(){
      var t = gen.value.trim();
      if (!t) return;
      annotations.push({ selector: '(general)', tag: 'general', text: 'General', url: window.location.href, comment: t, category: _category });
      save();
      gen.value = '';
      renderPanel();
      showToast('Saved');
    });
    gen.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); gen.value = ''; annotations.push({ selector: '(general)', tag: 'general', text: 'General', url: window.location.href, comment: gen.value.trim(), category: _category }); save(); renderPanel(); showToast('Saved'); }
    });

    // inline edit
    panel.querySelectorAll('.sf-edit').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var a = annotations[idx]; if (!a) return;
        var entry = panel.querySelector('[data-idx="' + idx + '"]');
        if (!entry) return;
        var cd = entry.querySelector('.sf-comment');
        if (!cd) return;
        if (cd.contentEditable === 'true') {
          a.comment = cd.textContent.trim();
          save(); cd.contentEditable = 'false'; cd.style.outline = 'none';
          return;
        }
        cd.contentEditable = 'true'; cd.style.outline = '2px solid #ccc'; cd.focus();
      });
    });

    // delete
    panel.querySelectorAll('.sf-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.getAttribute('data-confirmed') !== 'true') {
          btn.setAttribute('data-confirmed', 'true');
          btn.textContent = 'Sure?';
          setTimeout(function() { if (btn) { btn.textContent = '\u00d7'; btn.setAttribute('data-confirmed', 'false'); } }, 3000);
          return;
        }
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        annotations.splice(idx, 1);
        save(); renderPanel();
      });
    });
  }

  function openPanel() {
    if (panel) { panel.style.display = 'flex'; renderPanel(); return; }
    panelOpen = true; _clearConfirm = false;
    panel = document.createElement('div');
    var s = panel.style;
    s.position = 'fixed'; s.top = '0'; s.right = '0'; s.width = PANEL_WIDTH + 'px'; s.maxWidth = '100vw';
    s.height = '100vh'; s.height = '100dvh';
    s.background = '#fff'; s.color = '#333';
    s.borderLeft = '1px solid #eee'; s.boxShadow = '-2px 0 12px rgba(0,0,0,0.1)'; s.zIndex = 10000;
    s.display = 'flex'; s.flexDirection = 'column';
    s.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    s.fontSize = '13px'; s.boxSizing = 'border-box';
    document.body.appendChild(panel);
    renderPanel();
    if (fab) revealFab();
  }

  function closePanel() {
    if (panel) panel.style.display = 'none';
    panelOpen = false; _clearConfirm = false;
  }

  function clearAll() {
    if (!_clearConfirm) {
      _clearConfirm = true;
      var btn = panel.querySelector('#sf-clear');
      if (btn) { btn.textContent = 'Sure?'; btn.style.borderColor = '#e74c3c'; btn.style.color = '#e74c3c'; }
      setTimeout(function(){ _clearConfirm = false; if (btn) { btn.textContent = 'Clear'; btn.style.borderColor = ''; btn.style.color = ''; } }, 3000);
      return;
    }
    annotations = []; _clearConfirm = false; save(); renderPanel(); showToast('Cleared');
  }

  // --- FAB ---
  function createFab() {
    if (fab) return;
    fab = document.createElement('button');
    fab.textContent = '\u270f';
    fab.setAttribute('aria-label', 'Feedback');
    var s = fab.style;
    s.position = 'fixed'; s.bottom = '20px'; s.right = '20px';
    s.width = '44px'; s.height = '44px'; s.borderRadius = '50%';
    s.background = '#555'; s.color = '#fff'; s.display = 'flex';
    s.alignItems = 'center'; s.justifyContent = 'center';
    s.fontSize = '20px'; s.cursor = 'pointer'; s.zIndex = 20001;
    s.boxShadow = '0 2px 8px rgba(0,0,0,0.2)'; s.fontFamily = 'sans-serif';
    s.userSelect = 'none'; s.border = 'none';
    s.transition = 'opacity 0.2s, transform 0.2s';
    s.opacity = '0'; s.transform = 'translateX(60px)'; s.pointerEvents = 'none';
    fab.addEventListener('click', function(e) { e.stopPropagation(); if (panelOpen) closePanel(); else openPanel(); });
    document.body.appendChild(fab);
  }

  function revealFab() {
    if (!fab) createFab();
    if (_fabRevealed) return;
    _fabRevealed = true;
    fab.style.opacity = '1'; fab.style.transform = 'translateX(0)'; fab.style.pointerEvents = 'auto';
  }

  function concealFab() {
    if (!_fabRevealed) return;
    _fabRevealed = false;
    fab.style.opacity = '0'; fab.style.transform = 'translateX(60px)'; fab.style.pointerEvents = 'none';
  }

  function hasAnnotations() {
    var origin = window.location.origin;
    return annotations.some(function(a) { try { return new URL(a.url).origin === origin; } catch(e) { return false; } });
  }

  // --- shimmer ---
  var shimmerStyle = null;
  function shimmer() {
    if (!shimmerStyle) {
      var st = document.createElement('style');
      st.textContent = '@keyframes sf-fab { 0% { box-shadow: 0 0 0 0 #555; transform: scale(1); } 50% { box-shadow: 0 0 0 10px transparent; transform: scale(1.1); } 100% { box-shadow: 0 0 0 0 transparent; transform: scale(1); } } .sf-fab { animation: sf-fab 0.8s ease-out; }';
      document.head.appendChild(st);
      shimmerStyle = st;
    }
    revealFab();
    if (!fab) return;
    fab.classList.remove('sf-fab'); void fab.offsetWidth;
    fab.classList.add('sf-fab');
    fab.addEventListener('animationend', function onEnd() { fab.classList.remove('sf-fab'); fab.removeEventListener('animationend', onEnd); });
  }

  // --- events ---
  document.addEventListener('click', function(e) {
    if (!isFeedbackChord(e)) return;
    if (fab && (e.target === fab || fab.contains(e.target))) return;
    e.preventDefault(); e.stopPropagation();
    var path = e.composedPath ? e.composedPath() : [e.target];
    var target = path[0] || e.target;
    hidePopover();
    showPopover(target, { selector: describeElement(target), tag: target.tagName.toLowerCase(), text: getTextSnippet(target), styles: getComputedStyles(target), url: window.location.href, comment: '' });
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { if (popover) { hidePopover(); return; } if (panelOpen) closePanel(); return; }
    if (e.key === 'Meta') _modKeys.meta = true;
    if (e.key === 'Alt') _modKeys.alt = true;
    if (e.key === 'Control') _modKeys.ctrl = true;
    if (_modKeys.alt && (isMacLike() ? _modKeys.meta : _modKeys.ctrl) && !e.repeat) revealFab();
  });

  document.addEventListener('keyup', function(e) {
    if (e.key === 'Meta') _modKeys.meta = false;
    if (e.key === 'Alt') _modKeys.alt = false;
    if (e.key === 'Control') _modKeys.ctrl = false;
    if (!(_modKeys.alt && (isMacLike() ? _modKeys.meta : _modKeys.ctrl)) && !hasAnnotations()) concealFab();
  });

  // --- init ---
  load();
  createFab();
  if (hasAnnotations()) revealFab();
})();
