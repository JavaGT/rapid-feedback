// ==UserScript==
// @name         Rapid Feedback
// @namespace    https://scope.javagrant.ac.nz
// @version      2.5
// @description  Hold Alt+⌘ and click (Mac) or Alt+Ctrl+click (Windows/Linux) any element to annotate it for AI tools. Exports as markdown. Tampermonkey: set @match for sites you use, or keep the default broad match.
// @author       You
// @match        *://*/*
// @grant        none
// @updateURL   https://gist.githubusercontent.com/JavaGT/3cee0b3d6dae324935435ed7e5e9a6c8/raw/scope-feedback.user.js
// @downloadURL https://gist.githubusercontent.com/JavaGT/3cee0b3d6dae324935435ed7e5e9a6c8/raw/scope-feedback.user.js
// ==/UserScript==
// Future: browser extension + context menu for per-site enable.

(function() {
  'use strict';

  var VERSION = '2.5';
  var UPDATE_URL = 'https://gist.githubusercontent.com/JavaGT/3cee0b3d6dae324935435ed7e5e9a6c8/raw/scope-feedback.user.js';
  var STORAGE_KEY = 'scope_feedback_annotations';
  var TEXT_MAX = 150;
  var PANEL_WIDTH = 380;
  var BANNER_ID = 'scope-feedback-storage-banner';

  function testLocalStorage() {
    try {
      var k = '__scope_feedback_ls_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (_) {
      return false;
    }
  }

  var storageAvailable = testLocalStorage();

  var annotations = [];
  var panelOpen = false;
  var panel = null;
  var fab = null;
  var popover = null;
  var _clearConfirming = false;
  var _fabRevealed = false;
  var _modKeys = { meta: false, alt: false, ctrl: false };

  function isMacLike() {
    if (typeof navigator !== 'undefined' && navigator.userAgentData && navigator.userAgentData.platform === 'macOS') return true;
    return /Mac|iPhone|iPod|iPad/i.test(navigator.platform || '');
  }

  function isFeedbackChord(e) {
    if (!e.altKey) return false;
    return isMacLike() ? e.metaKey : e.ctrlKey;
  }

  var chordHintShort = isMacLike() ? 'Alt+⌘+click' : 'Alt+Ctrl+click';
  var chordHintFab = isMacLike()
    ? 'Rapid Feedback — Alt+⌘+click any element to add a note'
    : 'Rapid Feedback — Alt+Ctrl+click any element to add a note';

  function v(name, fallback) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch(_) { return fallback; }
  }

  function load() {
    if (!storageAvailable) return;
    try { var d = localStorage.getItem(STORAGE_KEY); if (d) annotations = JSON.parse(d); } catch (_) {}
  }
  function save() {
    if (!storageAvailable) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations)); } catch (_) {}
  }

  function describeElement(el) {
    var chain = [];
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var tag = current.tagName.toLowerCase();
      var parts = [tag];

      if (current.id) parts.push('#' + current.id);

      if (current.className && typeof current.className === 'string') {
        var cls = current.className.trim().split(/\s+/).filter(Boolean);
        if (cls.length) parts.push('.' + cls.join('.'));
      }

      var attrs = [];
      var href = current.getAttribute && current.getAttribute('href');
      var src = current.getAttribute && current.getAttribute('src');
      var type = current.getAttribute && current.getAttribute('type');
      var placeholder = current.getAttribute && current.getAttribute('placeholder');
      var value = current.getAttribute && current.getAttribute('value');
      var name = current.getAttribute && current.getAttribute('name');
      var role = current.getAttribute && current.getAttribute('role');
      if (href) attrs.push('href="' + href + '"');
      if (src) attrs.push('src="' + src.split('?')[0] + '"');
      if (type && type !== 'text') attrs.push('type="' + type + '"');
      if (placeholder) attrs.push('placeholder="' + placeholder + '"');
      if (name) attrs.push('name="' + name + '"');
      if (role) attrs.push('role="' + role + '"');
      if (value && value.length > 0 && value.length < 60 && tag !== 'button') attrs.push('value="' + value + '"');
      if (attrs.length) parts.push('[' + attrs.join(' ') + ']');

      chain.push(parts.join(''));

      var parent = current.parentElement;
      if (!parent && current.getRootNode) {
        var root = current.getRootNode();
        if (root && root.host) parent = root.host;
      }
      current = parent;
    }
    chain.reverse();
    return chain.slice(0, 8).join(' > ');
  }

  function getTextSnippet(el) {
    var text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX) + '\u2026';
    return text;
  }

  var STYLE_PROPS = ['display','position','flex-direction','align-items','justify-content','color','background','background-color','font-size','font-weight','font-family','line-height','text-align','padding','margin','gap','width','height','border','border-radius','box-shadow','overflow','opacity','cursor','z-index'];

  function getComputedStyles(el) {
    var cs = window.getComputedStyle(el);
    var styles = {};
    STYLE_PROPS.forEach(function(p) {
      var val = cs.getPropertyValue(p);
      if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'auto') styles[p] = val;
    });
    return styles;
  }

  function getCssSources(el) {
    var sources = [];
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var sheet = document.styleSheets[i];
        try {
          var rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          for (var j = 0; j < rules.length; j++) {
            var rule = rules[j];
            if (rule.selectorText && rule.style) {
              try { if (el.matches(rule.selectorText)) sources.push(rule.selectorText); } catch(_) {}
            }
          }
        } catch(_) {}
      }
    } catch(_) {}
    return sources.filter(function(s, i) { return sources.indexOf(s) === i; }).slice(0, 8);
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function showToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    var s = t.style;
    s.position = 'fixed'; s.bottom = '24px'; s.left = '50%'; s.transform = 'translateX(-50%)';
    s.background = v('--text', '#333'); s.color = v('--bg', 'white'); s.padding = '10px 20px'; s.borderRadius = '6px';
    s.fontSize = '13px'; s.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    s.zIndex = 20000; s.boxShadow = '0 2px 10px rgba(0,0,0,0.2)'; s.pointerEvents = 'none';
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 2000);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function() { showToast('Copied to clipboard!'); },
        function() { fallbackCopy(text); }
      );
    } else { fallbackCopy(text); }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    var s = ta.style;
    s.position = 'fixed'; s.left = '-9999px'; s.top = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    try { var ok = document.execCommand('copy'); showToast(ok ? 'Copied!' : 'Failed.'); } catch (_) { showToast('Failed.'); }
    document.body.removeChild(ta);
  }

  function showPopover(el, elementData) {
    hidePopover();
    var surface = v('--surface', 'white');
    var text = v('--text', '#333');
    var border = v('--border', '#e0e0e0');
    var textMuted = v('--text-muted', '#777');
    var textMutedLight = v('--text-muted-light', '#999');
    var primary = v('--primary', '#0056b3');
    var bg = v('--bg', '#f4f4f9');
    var submitDisabled = !storageAvailable;
    var submitStyle = submitDisabled
      ? 'opacity:0.45;cursor:not-allowed;'
      : '';
    popover = document.createElement('div');
    popover.innerHTML =
      '<div style="font-size:11px;font-weight:600;color:' + primary + ';margin-bottom:2px;">' + escapeHtml(elementData.selector.split(' > ')[0]) + '</div>' +
      '<div style="font-size:9px;color:' + textMutedLight + ';margin-bottom:6px;font-family:monospace;word-break:break-all;max-height:40px;overflow:hidden;">' + escapeHtml(elementData.selector) + '</div>' +
      '<div style="font-size:11px;color:' + textMuted + ';margin-bottom:8px;word-break:break-word;">"' + escapeHtml(elementData.text) + '"</div>' +
      (elementData.styles && Object.keys(elementData.styles).length ? '<div style="font-size:10px;color:' + textMuted + ';margin-bottom:6px;font-family:monospace;line-height:1.5;">' +
        Object.keys(elementData.styles).slice(0, 6).map(function(k) { return k + ': ' + elementData.styles[k]; }).join('; ') +
        (Object.keys(elementData.styles).length > 6 ? '; \u2026' : '') +
        '</div>' : '') +
      '<textarea id="scope-feedback-textarea" placeholder="What should the AI change here?" ' +
      (submitDisabled ? 'readonly ' : '') +
      'style="width:100%;min-height:70px;padding:8px;border:1px solid ' + border + ';border-radius:4px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;background:' + surface + ';color:' + text + ';"></textarea>' +
      (submitDisabled ? '<div style="font-size:11px;color:' + textMuted + ';margin-top:6px;">Feedback cannot be saved in this browser (storage blocked). Enable storage or use a normal window to add notes.</div>' : '') +
      '<div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end;">' +
      '<button id="scope-feedback-cancel" style="padding:5px 12px;border:1px solid ' + border + ';background:' + surface + ';border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit;color:' + text + ';">Cancel</button>' +
      '<button id="scope-feedback-submit" ' + (submitDisabled ? 'disabled ' : '') + 'style="padding:5px 12px;border:1px solid ' + primary + ';background:' + primary + ';color:white;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;' + submitStyle + '">Submit</button>' +
      '</div>';

    var s = popover.style;
    s.position = 'fixed'; s.zIndex = 10002; s.background = surface; s.border = '1px solid ' + border;
    s.borderRadius = '8px'; s.padding = '14px'; s.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    s.width = '320px'; s.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    s.fontSize = '13px'; s.color = text;

    document.body.appendChild(popover);

    var rect = el.getBoundingClientRect();
    var top = rect.bottom + 8;
    var left = Math.max(4, Math.min(rect.left, window.innerWidth - 330));
    if (top + 220 > window.innerHeight) top = Math.max(4, rect.top - 220 - 8);
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';

    var textarea = popover.querySelector('#scope-feedback-textarea');
    if (!submitDisabled) textarea.focus();

    function submitAnnotation() {
      if (!storageAvailable) { showToast('Saving is disabled (storage unavailable).'); return; }
      var comment = textarea.value.trim();
      if (!comment) { showToast('Please enter a comment.'); return; }
      elementData.comment = comment;
      annotations.push(elementData);
      save();
      hidePopover();
      showToast('Annotation saved.');
      triggerShimmer();
    }

    textarea.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitAnnotation(); }
    });

    popover.querySelector('#scope-feedback-submit').onclick = submitAnnotation;
    popover.querySelector('#scope-feedback-cancel').onclick = hidePopover;
  }

  function hidePopover() { if (popover) { popover.remove(); popover = null; } }

  function renderPanel() {
    if (!panel) return;
    var surface = v('--surface', 'white');
    var text = v('--text', '#333');
    var textMuted = v('--text-muted', '#777');
    var textMutedLight = v('--text-muted-light', '#999');
    var border = v('--border', '#e0e0e0');
    var primary = v('--primary', '#0056b3');
    var bg = v('--bg', '#f4f4f9');
    var primaryLight = v('--primary-light', '#f0f4ff');

    var emptyHint = 'No annotations yet. ' + chordHintShort + ' any element to add feedback.';

    var listHtml = annotations.map(function(a, i) {
      var parts = a.selector.split(' > ');
      var target = parts[0] || a.selector;
      var editDisabled = !storageAvailable;
      var editStyle = editDisabled ? 'opacity:0.35;cursor:not-allowed;' : '';
      return '<div style="background:' + surface + ';border:1px solid ' + border + ';border-radius:6px;padding:12px;margin-bottom:10px;" data-aidx="' + i + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:12px;font-weight:600;color:' + primary + ';margin-bottom:2px;">' + escapeHtml(target) + '</div>' +
        '<div style="font-size:10px;color:' + textMutedLight + ';margin-bottom:4px;font-family:monospace;word-break:break-all;">' + escapeHtml(a.selector) + '</div>' +
        '<div style="font-size:11px;color:' + textMuted + ';margin-bottom:6px;word-break:break-word;">"' + escapeHtml(a.text) + '"</div>' +
        (a.styles && Object.keys(a.styles).length ? '<div style="font-size:9px;color:' + textMuted + ';margin-bottom:4px;font-family:monospace;line-height:1.4;max-height:60px;overflow:hidden;">' +
          Object.keys(a.styles).slice(0, 8).map(function(k) { return k + ': ' + a.styles[k]; }).join('; ') +
          (Object.keys(a.styles).length > 8 ? '; \u2026' : '') +
          '</div>' : '') +
        '<div class="sf-comment" style="font-size:12px;color:' + text + ';background:' + primaryLight + ';padding:6px 8px;border-radius:4px;margin-bottom:6px;border-left:3px solid ' + primary + ';" contenteditable="false">' + escapeHtml(a.comment) + '</div>' +
        '<div style="font-size:10px;color:' + textMutedLight + ';">' + escapeHtml(a.url) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0;">' +
        '<button class="sf-edit" data-idx="' + i + '" ' + (editDisabled ? 'disabled ' : '') + 'style="padding:2px 8px;border:1px solid ' + border + ';background:' + surface + ';border-radius:4px;cursor:pointer;font-size:11px;color:' + textMuted + ';line-height:1;font-family:inherit;' + editStyle + '" title="' + (editDisabled ? 'Editing requires storage' : 'Edit') + '">\u270E</button>' +
        '<button class="sf-del" data-idx="' + i + '" style="padding:2px 8px;border:1px solid ' + border + ';background:' + surface + ';border-radius:4px;cursor:pointer;font-size:12px;color:' + textMuted + ';line-height:1;font-family:inherit;" data-confirmed="false">\u00d7</button>' +
        '</div>' +
        '</div></div>';
    }).join('') || '<div style="color:' + textMutedLight + ';font-style:italic;text-align:center;padding:30px 0;">' + emptyHint + '</div>';

    var genDisabled = !storageAvailable;
    var genReadonly = genDisabled ? 'readonly ' : '';
    var genBtnStyle = genDisabled ? 'opacity:0.45;cursor:not-allowed;' : '';

    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:' + primary + ';color:white;flex-shrink:0;">' +
      '<span style="font-size:15px;font-weight:700;">Rapid Feedback</span>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span id="scope-feedback-update" style="font-size:10px;cursor:pointer;opacity:0.7;text-decoration:underline;" title="Check for updates">v' + VERSION + '</span>' +
      '<button id="scope-feedback-close" style="background:none;border:none;color:white;cursor:pointer;font-size:22px;line-height:1;padding:0;font-family:inherit;">\u00d7</button>' +
      '</div>' +
      '</div>' +
      '<div style="padding:8px 16px;display:flex;gap:8px;border-bottom:1px solid ' + border + ';background:' + surface + ';flex-shrink:0;">' +
      '<button id="scope-feedback-export" style="flex:1;padding:6px 10px;border:1px solid ' + primary + ';background:' + primary + ';color:white;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">Copy</button>' +
      '<button id="scope-feedback-cut" style="padding:6px 10px;border:1px solid ' + border + ';background:' + surface + ';color:' + textMuted + ';border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">Cut</button>' +
      '<button id="scope-feedback-clear" style="padding:6px 10px;border:1px solid ' + border + ';background:' + surface + ';color:' + textMuted + ';border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">Clear</button>' +
      '</div>' +
      '<div id="scope-feedback-list" style="flex:1;overflow-y:auto;padding:12px 16px;background:' + bg + ';">' + listHtml + '</div>' +
      '<div style="padding:8px 12px;border-top:1px solid ' + border + ';background:' + surface + ';flex-shrink:0;">' +
      '<textarea id="scope-feedback-general" ' + genReadonly + 'placeholder="General feedback (not tied to an element)&hellip;" ' +
      'style="width:100%;min-height:50px;padding:6px 8px;border:1px solid ' + border + ';border-radius:4px;font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;margin-bottom:6px;background:' + surface + ';color:' + text + ';"></textarea>' +
      (genDisabled ? '<div style="font-size:10px;color:' + textMuted + ';margin-bottom:6px;">Saving disabled — storage unavailable.</div>' : '') +
      '<div style="display:flex;gap:6px;align-items:center;">' +
      '<button id="scope-feedback-general-submit" ' + (genDisabled ? 'disabled ' : '') + 'style="padding:4px 10px;border:1px solid ' + primary + ';background:' + primary + ';color:white;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;font-family:inherit;' + genBtnStyle + '">Submit</button>' +
      '<span style="font-size:10px;color:' + textMutedLight + ';">' + annotations.length + ' annotation' + (annotations.length !== 1 ? 's' : '') + ' \u00b7 ' + chordHintShort + ' any element</span>' +
      '</div></div>';

    panel.querySelector('#scope-feedback-close').addEventListener('click', closePanel);
    panel.querySelector('#scope-feedback-export').addEventListener('click', exportMarkdown);
    panel.querySelector('#scope-feedback-cut').addEventListener('click', cutMarkdown);
    panel.querySelector('#scope-feedback-clear').addEventListener('click', clearAll);
    panel.querySelector('#scope-feedback-update').addEventListener('click', checkUpdate);

    var generalText = panel.querySelector('#scope-feedback-general');
    var generalBtn = panel.querySelector('#scope-feedback-general-submit');
    function submitGeneral() {
      if (!storageAvailable) { showToast('Saving is disabled (storage unavailable).'); return; }
      var gtext = generalText.value.trim();
      if (!gtext) { showToast('Please enter feedback.'); return; }
      annotations.push({ selector: '(general)', tag: 'general', text: 'General feedback', url: window.location.href, comment: gtext });
      save();
      generalText.value = '';
      renderPanel();
      showToast('Feedback saved.');
    }
    generalBtn.addEventListener('click', submitGeneral);
    generalText.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitGeneral(); }
    });

    panel.querySelectorAll('.sf-edit').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (!storageAvailable) { showToast('Editing requires browser storage.'); return; }
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var a = annotations[idx];
        if (!a) return;
        var entry = panel.querySelector('[data-aidx="' + idx + '"]');
        if (!entry) return;
        var commentDiv = entry.querySelector('.sf-comment');
        if (!commentDiv) return;
        if (commentDiv.contentEditable === 'true') {
          a.comment = commentDiv.textContent.trim();
          save();
          commentDiv.contentEditable = 'false';
          commentDiv.style.outline = 'none';
          return;
        }
        commentDiv.contentEditable = 'true';
        commentDiv.style.outline = '2px solid ' + primary;
        commentDiv.focus();
      });
    });

    panel.querySelectorAll('.sf-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.getAttribute('data-confirmed') !== 'true') {
          btn.setAttribute('data-confirmed', 'true');
          btn.textContent = 'Sure?';
          return;
        }
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        annotations.splice(idx, 1);
        save();
        renderPanel();
      });
    });
  }

  function hasAnnotationsForOrigin() {
    var origin = window.location.origin;
    return annotations.some(function(a) {
      try { return new URL(a.url).origin === origin; } catch(_) { return false; }
    });
  }

  function revealFab() {
    if (!fab) createFab();
    if (_fabRevealed) return;
    _fabRevealed = true;
    var s = fab.style;
    s.transform = 'translateX(0)';
    s.opacity = '1';
    s.pointerEvents = 'auto';
  }

  function concealFab() {
    if (!_fabRevealed) return;
    _fabRevealed = false;
    var s = fab.style;
    s.transform = 'translateX(80px)';
    s.opacity = '0';
    s.pointerEvents = 'none';
  }

  function openPanel() {
    if (panel) { panel.style.display = 'flex'; renderPanel(); return; }
    panelOpen = true;
    _clearConfirming = false;

    var surface = v('--surface', 'white');
    var bg = v('--bg', '#f4f4f9');
    var text = v('--text', '#333');
    var border = v('--border', '#e0e0e0');

    panel = document.createElement('div');
    var s = panel.style;
    s.position = 'fixed'; s.top = '0'; s.right = '0'; s.width = PANEL_WIDTH + 'px'; s.height = '100vh';
    s.background = bg; s.borderLeft = '1px solid ' + border; s.boxShadow = '-4px 0 16px rgba(0,0,0,0.15)';
    s.zIndex = 10000; s.display = 'flex'; s.flexDirection = 'column';
    s.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    s.fontSize = '13px'; s.color = text; s.boxSizing = 'border-box';

    document.body.appendChild(panel);
    renderPanel();
    if (fab) revealFab();
  }

  function closePanel() {
    if (panel) { panel.style.display = 'none'; }
    panelOpen = false;
    _clearConfirming = false;
  }

  function clearAll() {
    if (annotations.length === 0) return;
    if (!_clearConfirming) {
      _clearConfirming = true;
      var btn = panel.querySelector('#scope-feedback-clear');
      if (btn) {
        btn.textContent = 'I\'m sure';
        btn.style.border = '1px solid ' + v('--danger', '#d32f2f');
        btn.style.color = v('--danger', '#d32f2f');
      }
      return;
    }
    annotations = [];
    _clearConfirming = false;
    save();
    renderPanel();
    showToast('Cleared.');
  }

  function exportMarkdown() {
    if (annotations.length === 0) { showToast('No annotations to export.'); return; }
    var md = '## Change Requests\n\n';
    annotations.forEach(function(a, i) {
      md += '### ' + (i + 1) + '. ' + a.selector.split(' > ')[0] + '\n';
      md += '- **Page**: ' + a.url + '\n';
      md += '- **DOM Chain**: `' + a.selector + '`\n';
      md += '- **Text**: "' + a.text + '"\n';
      if (a.styles && Object.keys(a.styles).length) {
        md += '- **Computed Styles**: `' + Object.keys(a.styles).map(function(k) { return k + ': ' + a.styles[k]; }).join('; ') + '`\n';
      }
      if (a.cssSources && a.cssSources.length) {
        md += '- **CSS Rules**: ' + a.cssSources.map(function(s) { return '`' + s + '`'; }).join(', ') + '\n';
      }
      md += '- **Request**: ' + a.comment + '\n\n';
    });
    copyToClipboard(md);
  }

  function cutMarkdown() {
    if (annotations.length === 0) { showToast('No annotations to cut.'); return; }
    exportMarkdown();
    annotations = [];
    save();
    renderPanel();
    showToast('Cut — annotations cleared.');
  }

  function checkUpdate() {
    var el = panel && panel.querySelector('#scope-feedback-update');
    if (el) { el.textContent = 'checking\u2026'; el.style.opacity = '0.5'; el.style.cursor = 'default'; }
    fetch(UPDATE_URL, { cache: 'no-cache' }).then(function(r) { return r.text(); }).then(function(body) {
      var m = body.match(/@version\s+(\S+)/);
      var latest = m ? m[1] : null;
      if (!latest) { showToast('Could not read version from gist.'); return; }
      if (latest === VERSION) {
        showToast('v' + VERSION + ' is up to date.');
        if (el) { el.textContent = 'v' + VERSION + ' \u2713'; el.style.opacity = '0.5'; el.style.cursor = 'default'; }
      } else {
        showToast('Update available: v' + latest + ' (yours: v' + VERSION + '). Open Tampermonkey to update.');
        if (el) { el.textContent = 'v' + VERSION + ' \u2191 v' + latest; el.style.opacity = '1'; el.style.cursor = 'pointer'; }
      }
    }).catch(function() {
      showToast('Update check failed.');
      if (el) { el.textContent = 'v' + VERSION + ' \u2717'; el.style.opacity = '0.5'; }
    });
  }

  function createFab() {
    if (fab) return;
    var primary = v('--primary', '#0056b3');
    fab = document.createElement('div');
    fab.textContent = '\u270f';
    fab.title = chordHintFab;
    var s = fab.style;
    s.position = 'fixed'; s.bottom = '24px'; s.right = '24px';
    s.width = '48px'; s.height = '48px'; s.borderRadius = '50%';
    s.background = primary; s.color = 'white'; s.display = 'flex';
    s.alignItems = 'center'; s.justifyContent = 'center';
    s.fontSize = '20px'; s.cursor = 'pointer'; s.zIndex = 20001;
    s.boxShadow = '0 2px 10px rgba(0,0,0,0.25)'; s.fontFamily = 'sans-serif';
    s.userSelect = 'none';
    s.transition = 'transform 0.25s ease, opacity 0.25s ease, box-shadow 0.3s';
    s.transform = 'translateX(80px)';
    s.opacity = '0';
    s.pointerEvents = 'none';
    fab.addEventListener('click', function(e) { e.stopPropagation(); if (panelOpen) closePanel(); else openPanel(); });
    document.body.appendChild(fab);
  }

  function ensureStorageBanner() {
    if (storageAvailable) return;
    if (document.getElementById(BANNER_ID)) return;
    var bar = document.createElement('div');
    bar.id = BANNER_ID;
    bar.setAttribute('role', 'status');
    bar.textContent = 'Rapid Feedback: browser storage is unavailable. Notes cannot be saved and will be lost when you leave this page. Export markdown if you need a copy.';
    var bs = bar.style;
    bs.position = 'fixed';
    bs.top = '0';
    bs.left = '0';
    bs.right = '0';
    bs.zIndex = '20003';
    bs.padding = '8px 12px';
    bs.fontSize = '12px';
    bs.lineHeight = '1.4';
    bs.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    bs.background = '#fff3cd';
    bs.color = '#664d03';
    bs.borderBottom = '1px solid #e6d89c';
    bs.boxSizing = 'border-box';
    document.body.appendChild(bar);
  }

  // Inject shimmer keyframes once
  var shimmerSheet = null;
  function ensureShimmerStyle() {
    if (shimmerSheet) return;
    var primary = v('--primary', '#0056b3');
    var style = document.createElement('style');
    style.textContent =
      '@keyframes scope-feedback-shimmer {' +
      '  0% { box-shadow: 0 0 0 0 ' + primary + '; transform: scale(1); }' +
      '  50% { box-shadow: 0 0 0 12px rgba(0,86,179,0); transform: scale(1.08); }' +
      '  100% { box-shadow: 0 0 0 0 rgba(0,86,179,0); transform: scale(1); }' +
      '}' +
      '.scope-feedback-shimmer {' +
      '  animation: scope-feedback-shimmer 1s ease-out;' +
      '}';
    document.head.appendChild(style);
    shimmerSheet = style;
  }

  function triggerShimmer() {
    ensureShimmerStyle();
    revealFab();
    if (!fab) return;
    fab.classList.remove('scope-feedback-shimmer');
    void fab.offsetWidth;
    fab.classList.add('scope-feedback-shimmer');
    fab.addEventListener('animationend', function onEnd() {
      fab.classList.remove('scope-feedback-shimmer');
      fab.removeEventListener('animationend', onEnd);
    });
  }

  document.addEventListener('click', function(e) {
    if (!isFeedbackChord(e)) return;

    if (e.target && e.target.closest && e.target.closest('#' + BANNER_ID)) return;
    // Clicking the FAB should open the panel, not annotate it.
    if (fab && (e.target === fab || fab.contains(e.target))) return;
    // Allow chord-click on panel & popover to annotate the extension's own UI.

    e.preventDefault();
    e.stopPropagation();

    var path = e.composedPath ? e.composedPath() : [e.target];
    var target = path[0] || e.target;

    hidePopover();
    var desc = describeElement(target);
    var styles = getComputedStyles(target);
    var sources = getCssSources(target);
    showPopover(target, { selector: desc, tag: target.tagName.toLowerCase(), text: getTextSnippet(target), styles: styles, cssSources: sources, url: window.location.href, comment: '' });
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (popover) { hidePopover(); return; }
      if (panelOpen) closePanel();
      return;
    }
    if (e.key === 'Meta') _modKeys.meta = true;
    if (e.key === 'Alt') _modKeys.alt = true;
    if (e.key === 'Control') _modKeys.ctrl = true;
    var fabChord = _modKeys.alt && (isMacLike() ? _modKeys.meta : _modKeys.ctrl);
    if (fabChord && !e.repeat) revealFab();
  });

  document.addEventListener('keyup', function(e) {
    if (e.key === 'Meta') _modKeys.meta = false;
    if (e.key === 'Alt') _modKeys.alt = false;
    if (e.key === 'Control') _modKeys.ctrl = false;
    var fabChord = _modKeys.alt && (isMacLike() ? _modKeys.meta : _modKeys.ctrl);
    if (!fabChord && !hasAnnotationsForOrigin()) concealFab();
  });

  load();
  createFab();
  if (hasAnnotationsForOrigin()) revealFab();
  ensureStorageBanner();
})();
