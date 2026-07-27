// ==UserScript==
// @name         Rapid Feedback
// @namespace    https://scope.javagrant.ac.nz
// @version      5.3
// @description  Hold Alt+⌘/Ctrl+click any element to annotate it. Grouping, relocation, element zoom, Shadow DOM isolation. Exports as markdown/JSON.
// @note         v5.3: cancel reverts live style edits, Reset pairs inputs correctly, popover/outline follow scroll, zoom re-renders header + sibling nav, group reuses the main popover, shorter unique selectors, throttled hover
// @note         v5.2: destination picking is a real selection mode (plain click, hint banner, Esc cancels, draft preserved); fixed destination recording the source selector
// @note         v5.1: zoom arrows show outline + reposition popover; hideOutline on popover close
// @author       You
// @match        *://*/*
// @grant        none
// @updateURL   https://gist.githubusercontent.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96/raw/rapid-feedback.user.js
// @downloadURL https://gist.githubusercontent.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96/raw/rapid-feedback.user.js
// @note         v5.0: selector overhaul (utility-class filter, high-signal attrs, dynamic depth), chord-hold target preview + element zoom, grouping & relocation, tabbed comment-first popover, auto-reposition, Shadow DOM isolation, export clarity
// ==/UserScript==

(function () {
	'use strict';
	// Guard with a dedicated flag so a re-injection during init can't mistake the
	// half-built API object for a finished one.
	if (window.__SCOPE_FEEDBACK_LOADED__) return;
	window.__SCOPE_FEEDBACK_LOADED__ = true;

	const UA_PLATFORM = navigator.userAgentData?.platform;
	const IS_MAC = UA_PLATFORM
		? UA_PLATFORM === 'macOS'
		: /Mac|iPhone|iPod|iPad/i.test(navigator.platform || '');
	const CHORD_HINT = IS_MAC ? 'Alt+⌘+click' : 'Alt+Ctrl+click';
	const IS_CHORD = (e) => e.altKey && (IS_MAC ? e.metaKey : e.ctrlKey);
	const IS_SAVE_KEY = (e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter';

	const CATEGORIES = [
		{ id: 'general', label: 'General' },
		{ id: 'bug', label: 'Bug' },
		{ id: 'feature', label: 'Feature' },
		{ id: 'suggestion', label: 'Suggestion' },
		{ id: 'question', label: 'Question' }
	];
	const CAPTURE_PROPS = [
		'display', 'position', 'flex-direction', 'align-items', 'justify-content',
		'color', 'background', 'background-color', 'font-size', 'font-weight',
		'font-family', 'line-height', 'text-align', 'padding', 'margin', 'gap',
		'width', 'height', 'border', 'border-radius', 'box-shadow', 'overflow',
		'opacity', 'cursor', 'z-index'
	];
	const ADJUSTABLE_PROPS = [
		{ key: 'padding', label: 'Padding' },
		{ key: 'margin', label: 'Margin' },
		{ key: 'font-size', label: 'Font size' },
		{ key: 'color', label: 'Color' },
		{ key: 'background-color', label: 'Background' },
		{ key: 'border-radius', label: 'Border radius' },
		{ key: 'width', label: 'Width' },
		{ key: 'height', label: 'Height' },
		{ key: 'gap', label: 'Gap' },
		{ key: 'line-height', label: 'Line height' },
		{ key: 'opacity', label: 'Opacity', isRange: true, min: 0, max: 1, step: 0.05 }
	];
	const STORAGE_KEY = 'scope_feedback_annotations';
	const TEXT_MAX = 150;
	const POPOVER_W = 320;
	const PANEL_W = 380;

	let annotations = [];
	let activeCategory = 'general';
	let panelEl = null;
	let panelRoot = null;
	let fabEl = null;
	let popoverEl = null;
	let popoverRoot = null;
	let targetEl = null;
	let outlineEl = null;
	let destPick = null;
	let styleSnapshot = null;
	let anchor = null;

	// --- Utility-class detection ---
	const UTILITY_CLASS_RE = /^(p|m)(t|r|b|l|x|y|s|e)?-\d+|^(w|h|min-w|min-h|max-w|max-h)-\d+|^(text|font|leading|tracking|rounded|border|bg|shadow|opacity|z|flex|grid|gap|items|justify|self|order|overflow|object|top|right|bottom|left|inset|ring|outline|decoration|underline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|truncate|italic|not-italic|font|antialiased|subpixel-antialiased|align|break|whitespace|list|sr-only|invisible|visible|static|fixed|absolute|relative|sticky|block|inline|flow-root|contents|hidden|isolate|float|clear|container|columns|aspect|basis|grow|shrink)/;

	function isUtilityClass(cls) {
		return UTILITY_CLASS_RE.test(cls);
	}

	function filterClasses(classStr) {
		if (!classStr) return [];
		const all = classStr.trim().split(/\s+/).filter(Boolean);
		const semantic = all.filter(c => !isUtilityClass(c));
		return semantic.slice(0, 3);
	}

	// --- Selector generation (v5 overhaul) ---
	// `id` is deliberately absent: describeElement already emits it as `#id`, and
	// repeating it as [id="…"] just doubles the length of every selector.
	const HIGH_SIGNAL_ATTRS = ['aria-label', 'name', 'href'];

	function collectAttrs(el) {
		const out = [];
		for (const attr of HIGH_SIGNAL_ATTRS) {
			let v = el.getAttribute(attr);
			if (attr === 'href') v = v?.split('?')[0];
			if (v) out.push(`${attr}="${v}"`);
		}
		const src = el.getAttribute('src')?.split('?')[0];
		if (src) out.push(`src="${src}"`);
		const placeholder = el.getAttribute('placeholder');
		if (placeholder) out.push(`placeholder="${placeholder}"`);
		return out;
	}

	// Does `selector` resolve to exactly `el` and nothing else? Attribute values can
	// contain characters that make the selector invalid, so failures are non-fatal.
	function resolvesUniquely(selector, el) {
		const root = el.getRootNode?.() || document;
		const scope = root.querySelectorAll ? root : document;
		try {
			const found = scope.querySelectorAll(selector);
			return found.length === 1 && found[0] === el;
		} catch {
			return false;
		}
	}

	function describeElement(el) {
		if (el.nodeType !== 1) return '';
		const chain = [];
		let cur = el;
		while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
			const parts = [cur.tagName.toLowerCase()];
			if (cur.id) parts.push('#' + cur.id);
			if (typeof cur.className === 'string') {
				const cls = filterClasses(cur.className);
				if (cls.length) parts.push('.' + cls.join('.'));
			}
			const attrs = collectAttrs(cur);
			if (attrs.length) parts.push('[' + attrs.join(' ') + ']');
			chain.unshift(parts.join(''));
			// Walk up only as far as needed: stop as soon as the tail we've built
			// already identifies the element unambiguously.
			if (resolvesUniquely(chain.join(' > '), el)) break;
			cur = parentOf(cur);
		}
		return chain.slice(-12).join(' > ');
	}

	function parentOf(el) {
		let p = el.parentElement || el.parentNode;
		if (!p && el.getRootNode) {
			const r = el.getRootNode();
			if (r?.host) p = r.host;
		}
		return p;
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
		return { width: Math.round(r.width), height: Math.round(r.height) };
	}

	// --- Svelte source location ---
	function findSvelteMetaEl(el) {
		let cur = el;
		while (cur && cur.nodeType === 1) {
			if (cur.__svelte_meta?.loc?.file) return cur;
			cur = cur.parentElement;
		}
		return null;
	}

	function relSourceFile(file) {
		if (!file) return file;
		const norm = String(file).replace(/\\/g, '/');
		const m = norm.match(/(?:^|\/)((?:src|packages|node_modules)\/.*)$/);
		return m ? m[1] : norm.replace(/^.*?\/([^/]+\/[^/]+\.svelte)$/, '$1');
	}

	function getSourceLoc(el) {
		const metaEl = findSvelteMetaEl(el);
		if (!metaEl) return null;
		const loc = metaEl.__svelte_meta.loc;
		const file = relSourceFile(loc.file);
		const stack = [];
		let node = metaEl.__svelte_meta.parent;
		let guard = 0;
		while (node && guard++ < 12) {
			if (node.file) {
				stack.push({
					type: node.type || 'component',
					ref: relSourceFile(node.file) + (node.line ? ':' + node.line : '')
				});
			}
			node = node.parent;
		}
		return {
			file,
			line: loc.line,
			column: loc.column,
			ref: file + ':' + loc.line,
			viaAncestor: metaEl !== el,
			componentStack: stack.length ? stack : null
		};
	}

	function getA11y(el) {
		const out = {};
		const role = el.getAttribute('role') || implicitRole(el);
		if (role) out.role = role;
		const label = el.getAttribute('aria-label') || labelFromLabelledBy(el) || el.getAttribute('alt') || el.getAttribute('title');
		if (label) out.name = label.trim().replace(/\s+/g, ' ').slice(0, 80);
		const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
		if (testId) out.testId = testId;
		return Object.keys(out).length ? out : null;
	}

	function labelFromLabelledBy(el) {
		const id = el.getAttribute('aria-labelledby');
		if (!id) return null;
		const ref = document.getElementById(id.split(/\s+/)[0]);
		return ref ? (ref.textContent || '').trim() : null;
	}

	function implicitRole(el) {
		const tag = el.tagName.toLowerCase();
		const map = {
			button: 'button',
			a: el.hasAttribute('href') ? 'link' : null,
			input: { checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox' }[el.type] || 'textbox',
			select: 'combobox',
			textarea: 'textbox',
			nav: 'navigation',
			header: 'banner',
			main: 'main',
			h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading'
		};
		return map[tag] || null;
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
		return segment.replace(SCOPE_CLASS_RE, '').replace(/\.+/g, '.').replace(/\.$/, '').replace(/^\.+/, '');
	}

	function compactAncestorChain(selector, maxSegments) {
		if (!selector) return '';
		const parts = selector.split(' > ').map(stripScopeHashes).filter(Boolean);
		return parts.slice(-(maxSegments || 7)).join(' > ');
	}

	function routeFromUrl(url) {
		try { const u = new URL(url); return u.pathname + u.search; } catch { return url || ''; }
	}

	function getViewport() {
		return { w: innerWidth, h: innerHeight, dpr: Math.round((devicePixelRatio || 1) * 100) / 100 };
	}

	function targetLabel(a) {
		const text = (a.text || '').trim().replace(/\s+/g, ' ');
		if (text) return text.length > 48 ? text.slice(0, 48) + '\u2026' : text;
		const leaf = (a.selector || '').split(' > ').pop() || a.tag || 'element';
		const stripped = stripScopeHashes(leaf) || leaf;
		const hrefM = stripped.match(/\[href="([^"]+)"\]/);
		if (hrefM) { const slug = hrefM[1].split('/').filter(Boolean).pop(); if (slug) return slug; }
		return stripped;
	}

	// Live element → short label (popover chrome).
	function compactLabel(el) {
		return shortLabel(el.tagName.toLowerCase(), el.id, getA11y(el)?.name, getTextSnippet(el));
	}

	// Stored target/destination record → short label (exports). Same shape of output,
	// but reads a plain object rather than a live node.
	function compactRefLabel(t) {
		const leaf = (t.selector || '').split(' > ').pop() || '';
		const tag = t.tag || leaf.match(/^[a-z0-9-]+/i)?.[0] || 'element';
		const idM = leaf.match(/#([\w-]+)/);
		return shortLabel(tag, idM?.[1], t.a11y?.name, t.text);
	}

	function shortLabel(tag, id, name, text) {
		const base = tag + (id ? '#' + id : '');
		if (name) return base + ' "' + name.slice(0, 30) + '"';
		const t = (text || '').trim().replace(/\s+/g, ' ');
		if (t && t.length <= 30) return base + ' "' + t + '"';
		return base;
	}

	function extractHints(a) {
		const hints = [];
		const sel = a.selector || '';
		const text = (a.text || '').trim().replace(/\s+/g, ' ');
		if (text) hints.push({ key: 'Text', value: '"' + (text.length > 100 ? text.slice(0, 100) + '\u2026' : text) + '"' });
		const hrefM = sel.match(/\[href="([^"]+)"\]/);
		if (hrefM) hints.push({ key: 'Href', value: hrefM[1] });
		const placeholderM = sel.match(/\[placeholder="([^"]+)"\]/);
		if (placeholderM) hints.push({ key: 'Placeholder', value: '"' + placeholderM[1] + '"' });
		const nameM = sel.match(/\[name="([^"]+)"\]/);
		if (nameM) hints.push({ key: 'Name', value: '"' + nameM[1] + '"' });
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
			source: data.source || null,
			a11y: data.a11y || null,
			destination: data.destination || null,
			targets: data.targets || null
		};
	}

	// --- Export: v5 format (text-first, Tweak: block, compact group refs) ---
	function toMarkdown(items) {
		if (!items.length) return '';
		const lines = [];
		const pageUrl = items[0].url || location.href;
		const vp = getViewport();
		lines.push('# Feedback \u2014 ' + document.title);
		lines.push('Page: ' + pageUrl);
		lines.push('Env: ' + vp.w + '\u00d7' + vp.h + ' \u00b7 ' + getBrowserInfo());
		lines.push('');
		for (let i = 0; i < items.length; i++) {
			const a = items[i];
			const cat = (a.category || 'general').toUpperCase();
			const label = targetLabel(a);
			lines.push('## ' + (i + 1) + '. [' + cat + '] ' + label);
			if (a.text) lines.push('> ' + a.text);
			if (a.comment) lines.push(a.comment);
			if (a.source?.ref) {
				lines.push('Source: ' + a.source.ref + (a.source.viaAncestor ? ' (nearest ancestor with source)' : ''));
				if (a.source.componentStack?.length) lines.push('Component: ' + a.source.componentStack.map(s => s.ref).join(' \u2190 '));
			}
			if (a.a11y) {
				const bits = [];
				if (a.a11y.role) bits.push('role=' + a.a11y.role);
				if (a.a11y.name) bits.push('name="' + a.a11y.name + '"');
				if (a.a11y.testId) bits.push('testid=' + a.a11y.testId);
				if (bits.length) lines.push('A11y: ' + bits.join(' '));
			}
			const where = compactAncestorChain(a.selector);
			if (where) lines.push('Where: ' + where);
			if (a.rect) lines.push('Rect: ' + a.rect.width + '\u00d7' + a.rect.height);
			if (a.destination) {
				const d = a.destination;
				lines.push('\u2192 Destination: ' + (compactAncestorChain(d.selector, 4) || d.selector));
				if (d.text) lines.push('  Text: \u201c' + d.text + '\u201d');
				if (d.a11y?.name) lines.push('  A11y: name="' + d.a11y.name + '"');
			}
			if (a.targets && a.targets.length) {
				lines.push('Group: ' + a.targets.map(t => compactRefLabel(t)).join(', '));
			}
			if (a.adjustedStyles && Object.keys(a.adjustedStyles).length) {
				lines.push('Tweak:');
				for (const k in a.adjustedStyles) lines.push('  ' + k + ': ' + a.adjustedStyles[k] + ';');
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
				os: sp > 0 ? bi.slice(sp + 4) : ''
			},
			items: items.map(a => ({
				category: a.category || 'general',
				comment: a.comment,
				text: a.text || null,
				label: targetLabel(a),
				source: a.source || null,
				a11y: a.a11y || null,
				selector: a.selector || null,
				where: compactAncestorChain(a.selector) || null,
				tag: a.tag || null,
				rect: a.rect || null,
				adjustedStyles: a.adjustedStyles || null,
				destination: a.destination ? {
					selector: a.destination.selector,
					text: a.destination.text || null,
					a11y: a.destination.a11y,
					where: compactAncestorChain(a.destination.selector, 4)
				} : null,
				targets: a.targets ? a.targets.map(t => ({
					selector: t.selector,
					text: t.text || null,
					a11y: t.a11y
				})) : null,
				hints: extractHints(a)
			}))
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
			navigator.clipboard.writeText(text).then(() => showToast('Copied')).catch(() => fallbackCopy(text));
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
		if (panelRoot) renderPanel();
	}

	// --- Shadow DOM helpers ---
	function createShadowRoot() {
		const host = document.createElement('div');
		host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;pointer-events:none';
		const root = host.attachShadow({ mode: 'open' });
		document.body.appendChild(host);
		return { host, root };
	}

	function shadowStyle() {
		const s = document.createElement('style');
		s.textContent = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
`;
		return s;
	}

	// --- Shared style strings (used inside shadow roots) ---
	function popoverStyles() {
		return `
*{margin:0;padding:0;box-sizing:border-box}
.rf-popover{width:${POPOVER_W}px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;box-shadow:0 4px 16px rgba(0,0,0,0.15);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#2d3748;pointer-events:auto}
.rf-popover-ta{width:100%;min-height:60px;padding:8px;border:1px solid #e2e8f0;border-radius:4px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;resize:vertical;background:#f7fafc;color:#2d3748}
.rf-popover-ta:focus{outline:2px solid #4a5568;outline-offset:-1px}
.rf-btn{padding:5px 12px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7fafc;color:#2d3748}
.rf-btn-primary{background:#4a5568;color:#fff;border-color:#4a5568;font-weight:600}
.rf-btn-sm{padding:3px 8px;font-size:11px;background:transparent;color:#718096;border-color:#e2e8f0}
.rf-cat-btn{padding:3px 8px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:transparent;color:#718096}
.rf-cat-btn.active{border-color:#4a5568;background:#edf2f7;color:#2d3748}
.rf-cat-bar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
.rf-actions{display:flex;gap:6px;margin-top:10px;justify-content:flex-end}
.rf-tab-row{display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
.rf-tab-btn{padding:4px 10px;border-radius:4px 4px 0 0;cursor:pointer;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:transparent;color:#718096;border:none}
.rf-tab-btn.active{background:#edf2f7;color:#2d3748;font-weight:600}
.rf-styles-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.rf-styles-grid label{font-size:10px;color:#718096;display:block;margin-bottom:2px}
.rf-styles-grid input{width:100%;padding:3px 6px;border:1px solid #e2e8f0;border-radius:3px;font:11px monospace;background:#fff;color:#2d3748;margin-bottom:4px}
.rf-styles-grid input:focus{outline:2px solid #4a5568;outline-offset:-1px}
.rf-styles-grid input[type=range]{padding:0;accent-color:#4a5568;height:16px}
.rf-zoom-row{display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:11px}
.rf-zoom-row button{padding:3px 8px;border:1px solid #e2e8f0;border-radius:4px;background:#f7fafc;cursor:pointer;font-size:13px;color:#2d3748}
.rf-zoom-tag{font-family:monospace;font-size:10px;color:#718096;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rf-group-list{font-size:10px;color:#718096;margin-bottom:8px;font-family:monospace;max-height:44px;overflow:hidden}
.rf-title{font-weight:600;font-size:12px;color:#2d3748;margin-bottom:2px}
.rf-sub{font-size:9px;color:#718096;margin-bottom:4px;font-family:monospace;word-break:break-all;max-height:40px;overflow:hidden}
.rf-source{font-size:10px;color:#2f855a;margin-bottom:4px;font-family:monospace;word-break:break-all}
.rf-quote{font-size:11px;color:#718096;margin-bottom:6px;font-style:italic}
.rf-dest-row{display:flex;gap:6px;align-items:center;margin-top:6px}
.rf-dest-btn{font-size:11px;flex-shrink:0}
.rf-dest-tag{font-family:monospace;font-size:10px;color:#2b6cb0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
	}

	function panelStyles() {
		return `
*{margin:0;padding:0;box-sizing:border-box}
.rf-panel{width:${PANEL_W}px;max-width:100vw;height:100dvh;background:#f7fafc;color:#2d3748;display:flex;flex-direction:column;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border-left:1px solid #e2e8f0;box-shadow:-2px 0 12px rgba(0,0,0,0.1);pointer-events:auto}
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
.rf-btn{padding:5px 12px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7fafc;color:#2d3748}
.rf-btn-icon{background:0 0;border:none;color:#718096;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:13px}
.rf-btn-del{font-size:15px}
.rf-empty{color:#718096;text-align:center;padding:32px 16px}
.rf-cat-btn{padding:3px 8px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:transparent;color:#718096}
.rf-cat-btn.active{border-color:#4a5568;background:#edf2f7;color:#2d3748}
.rf-popover-ta{width:100%;min-height:44px;padding:8px;border:1px solid #e2e8f0;border-radius:4px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;resize:vertical;background:#f7fafc;color:#2d3748}
`;
	}

	// --- Toast (light-DOM, simple) ---
	function showToast(msg) {
		const el = document.createElement('div');
		el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:6px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;z-index:2147483647;box-shadow:0 2px 8px rgba(0,0,0,0.2);pointer-events:none;background:#4a5568;color:#fff';
		el.textContent = msg;
		document.body.appendChild(el);
		setTimeout(() => el.remove(), 2000);
	}

	// --- FAB (shadow DOM) ---
	function createFab() {
		if (fabEl) return;
		const { host, root } = createShadowRoot();
		host.style.cssText = 'all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483645';
		root.appendChild(shadowStyle());
		const s = document.createElement('style');
		s.textContent = `
.rf-fab{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-family:sans-serif;user-select:none;border:none;transition:opacity 0.2s,transform 0.2s;color:#fff;background:#4a5568;pointer-events:auto;opacity:0;transform:translateX(60px)}
`;
		root.appendChild(s);
		const btn = document.createElement('button');
		btn.className = 'rf-fab';
		btn.setAttribute('aria-label', 'Feedback');
		btn.textContent = '\u270f';
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (panelEl && panelEl.style.display !== 'none') closePanel();
			else openPanel();
		});
		root.appendChild(btn);
		document.body.appendChild(host);
		fabEl = { host, root, btn };
	}

	function revealFab() {
		if (!fabEl) createFab();
		fabEl.btn.style.opacity = '1';
		fabEl.btn.style.transform = 'translateX(0)';
	}

	function concealFab() {
		if (!fabEl) return;
		fabEl.btn.style.opacity = '0';
		fabEl.btn.style.transform = 'translateX(60px)';
	}

	function hasAnnotations() {
		const origin = location.origin;
		return annotations.some(a => { try { return new URL(a.url).origin === origin; } catch { return false; } });
	}

	// --- Popover positioning ---
	function placePopover(targetRect, popoverW, popoverH) {
		const gap = 8, pad = 8;
		const r = targetRect;
		if (r.bottom + popoverH + gap + pad <= innerHeight) return { top: r.bottom + gap, left: clamp(r.left, pad, innerWidth - popoverW - pad) };
		if (r.top - popoverH - gap >= pad) return { top: r.top - popoverH - gap, left: clamp(r.left, pad, innerWidth - popoverW - pad) };
		if (r.right + popoverW + gap + pad <= innerWidth) return { top: clamp(r.top, pad, innerHeight - popoverH - pad), left: r.right + gap };
		if (r.left - popoverW - gap >= pad) return { top: clamp(r.top, pad, innerHeight - popoverH - pad), left: r.left - popoverW - gap };
		const bestY = r.top > innerHeight / 2 ? r.top - popoverH - gap : r.bottom + gap;
		return { top: clamp(bestY, pad, innerHeight - popoverH - pad), left: clamp(r.left, pad, innerWidth - popoverW - pad) };
	}

	// The popover and outline are position:fixed, so a scroll or layout shift slides
	// them off their target. Re-project both against the live rect once per frame
	// while the popover is open.
	function startAnchor(host, getTarget) {
		stopAnchor();
		anchor = { host, getTarget, raf: 0, last: '' };
		const tick = () => {
			if (!anchor) return;
			const el = anchor.getTarget();
			if (el && el.isConnected) {
				const r = el.getBoundingClientRect();
				const key = r.top + ':' + r.left + ':' + r.width + ':' + r.height + ':' + innerWidth + ':' + innerHeight;
				if (key !== anchor.last) {
					anchor.last = key;
					const h = anchor.host.firstElementChild?.offsetHeight
						|| anchor.host.shadowRoot?.querySelector('.rf-popover')?.offsetHeight || 480;
					const pos = placePopover(r, POPOVER_W, h);
					anchor.host.style.top = pos.top + 'px';
					anchor.host.style.left = pos.left + 'px';
					if (outlineEl) positionOutline(el);
				}
			}
			anchor.raf = requestAnimationFrame(tick);
		};
		anchor.raf = requestAnimationFrame(tick);
	}

	function stopAnchor() {
		if (anchor) { cancelAnimationFrame(anchor.raf); anchor = null; }
	}

	function clamp(v, min, max) { return Math.max(min, Math.min(v, max)); }

	// --- Show popover (shadow DOM, tabbed comment-first) ---
	function showPopover(el, data, initial) {
		hidePopover();
		targetEl = el;
		const { host, root } = createShadowRoot();
		host.style.cssText = 'all:initial;position:fixed;z-index:2147483644;pointer-events:none';
		root.appendChild(shadowStyle());
		const ps = document.createElement('style');
		ps.textContent = popoverStyles();
		root.appendChild(ps);

		const popover = document.createElement('div');
		popover.className = 'rf-popover';
		const adjustedStyles = { ...(initial?.adjustedStyles || {}) };
		let activeTab = 'comment';
		let zoomTarget = el;
		// curData tracks whichever element the popover currently describes, so the
		// header, the style defaults and the saved annotation never disagree.
		let curData = data;
		const isGroup = !!(data.targets && data.targets.length);
		// Assigned once the styles grid exists; zooming re-seeds it.
		let refreshStyleInputs = () => {};

		// Title + source + selector + text
		const titleEl = document.createElement('div');
		titleEl.className = 'rf-title';
		const sourceEl = document.createElement('div');
		sourceEl.className = 'rf-source';
		const selEl = document.createElement('div');
		selEl.className = 'rf-sub';
		const quoteEl = document.createElement('div');
		quoteEl.className = 'rf-quote';

		popover.appendChild(titleEl);
		popover.appendChild(sourceEl);
		popover.appendChild(selEl);
		popover.appendChild(quoteEl);

		function renderHeader() {
			titleEl.textContent = isGroup
				? 'Group (' + (data.targets.length + 1) + ' elements)'
				: targetLabel({ ...curData, comment: '' });
			if (curData.source?.ref) {
				sourceEl.style.display = 'block';
				sourceEl.textContent = '\u25CE ' + curData.source.ref + (curData.source.viaAncestor ? ' (ancestor)' : '');
			} else {
				sourceEl.style.display = 'none';
			}
			selEl.textContent = compactAncestorChain(curData.selector) || curData.selector;
			if (curData.text) {
				quoteEl.style.display = 'block';
				quoteEl.textContent = '\u201c' + curData.text + '\u201d';
			} else {
				quoteEl.style.display = 'none';
			}
		}
		renderHeader();

		// Group member list
		if (isGroup) {
			const listEl = document.createElement('div');
			listEl.className = 'rf-group-list';
			listEl.textContent = 'with: ' + data.targets.map(t => compactRefLabel(t)).join(', ');
			popover.appendChild(listEl);
		}

		// Zoom row \u2014 walk the tree to retarget. Meaningless for a group, so hidden there.
		const zoomRow = document.createElement('div');
		zoomRow.className = 'rf-zoom-row';
		const upBtn = document.createElement('button');
		upBtn.textContent = '\u25B2';
		upBtn.title = 'Parent';
		const downBtn = document.createElement('button');
		downBtn.textContent = '\u25BC';
		downBtn.title = 'First child';
		const prevBtn = document.createElement('button');
		prevBtn.textContent = '\u25C0';
		prevBtn.title = 'Previous sibling';
		const nextBtn = document.createElement('button');
		nextBtn.textContent = '\u25B6';
		nextBtn.title = 'Next sibling';
		const zoomTag = document.createElement('span');
		zoomTag.className = 'rf-zoom-tag';
		zoomTag.textContent = compactLabel(zoomTarget);

		// Retargeting resets style edits: they belong to the element they were made
		// against, so we put that one back before moving on.
		function setZoomTarget(next) {
			if (!next || next === zoomTarget) return;
			revertStyles();
			for (const k in adjustedStyles) delete adjustedStyles[k];
			zoomTarget = next;
			targetEl = next;
			styleSnapshot = {};
			curData = capturableEl(next).data;
			if (isGroup) curData.targets = data.targets;
			zoomTag.textContent = compactLabel(zoomTarget);
			renderHeader();
			refreshStyleInputs();
			showOutline(zoomTarget);
			const r = zoomTarget.getBoundingClientRect();
			const pos = placePopover(r, POPOVER_W, popover.offsetHeight || 480);
			host.style.top = pos.top + 'px';
			host.style.left = pos.left + 'px';
		}

		upBtn.addEventListener('click', () => {
			const p = zoomTarget.parentElement;
			if (p && p !== document.body && p !== document.documentElement) setZoomTarget(p);
		});
		downBtn.addEventListener('click', () => setZoomTarget(zoomTarget.firstElementChild));
		prevBtn.addEventListener('click', () => setZoomTarget(zoomTarget.previousElementSibling));
		nextBtn.addEventListener('click', () => setZoomTarget(zoomTarget.nextElementSibling));
		zoomRow.appendChild(upBtn);
		zoomRow.appendChild(downBtn);
		zoomRow.appendChild(prevBtn);
		zoomRow.appendChild(nextBtn);
		zoomRow.appendChild(zoomTag);
		if (!isGroup) popover.appendChild(zoomRow);

		// Tab row
		const tabRow = document.createElement('div');
		tabRow.className = 'rf-tab-row';
		const commentTab = document.createElement('button');
		commentTab.className = 'rf-tab-btn active';
		commentTab.textContent = 'Comment';
		const stylesTab = document.createElement('button');
		stylesTab.className = 'rf-tab-btn';
		stylesTab.textContent = 'Styles';
		tabRow.appendChild(commentTab);
		tabRow.appendChild(stylesTab);
		popover.appendChild(tabRow);

		// Comment body
		const commentBody = document.createElement('div');
		const ta = document.createElement('textarea');
		ta.className = 'rf-popover-ta';
		ta.placeholder = 'What should change?';
		if (initial?.comment) ta.value = initial.comment;
		commentBody.appendChild(ta);

		// Category bar
		const catBar = document.createElement('div');
		catBar.className = 'rf-cat-bar';
		let selCat = initial?.category || activeCategory;
		for (const c of CATEGORIES) {
			const btn = document.createElement('button');
			btn.className = 'rf-cat-btn' + (c.id === selCat ? ' active' : '');
			btn.textContent = c.label;
			btn.addEventListener('click', () => {
				catBar.querySelectorAll('.rf-cat-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				selCat = c.id;
			});
			catBar.appendChild(btn);
		}
		commentBody.appendChild(catBar);

		// Pick destination
		let destData = initial?.destination || null;

		const destRow = document.createElement('div');
		destRow.className = 'rf-dest-row';
		const destBtn = document.createElement('button');
		destBtn.className = 'rf-btn rf-dest-btn';
		destBtn.textContent = destData ? 'Change destination' : 'Pick destination';
		const destTag = document.createElement('span');
		destTag.className = 'rf-dest-tag';
		if (destData) destTag.textContent = '\u2192 ' + (compactAncestorChain(destData.selector, 2) || destData.selector);
		const destClear = document.createElement('button');
		destClear.className = 'rf-btn rf-btn-sm';
		destClear.textContent = '\u00d7';
		destClear.title = 'Clear destination';
		destClear.style.display = destData ? 'block' : 'none';
		destClear.addEventListener('click', () => {
			destData = null;
			destTag.textContent = '';
			destClear.style.display = 'none';
			destBtn.textContent = 'Pick destination';
		});
		destBtn.addEventListener('click', () => {
			// Snapshot the draft, close the popover, and enter destination-select mode.
			// Reopen against the zoomed element so retargeting isn't lost.
			const draft = {
				comment: ta.value,
				category: selCat,
				adjustedStyles: { ...adjustedStyles },
				destination: destData,
			};
			revertStyles();
			enterDestPick(zoomTarget, curData, draft);
		});
		destRow.appendChild(destBtn);
		destRow.appendChild(destTag);
		destRow.appendChild(destClear);
		commentBody.appendChild(destRow);

		popover.appendChild(commentBody);

		// Styles body
		const stylesBody = document.createElement('div');
		stylesBody.style.display = 'none';
		const stylesGrid = document.createElement('div');
		stylesGrid.className = 'rf-styles-grid';
		for (const ap of ADJUSTABLE_PROPS) {
			const label = document.createElement('label');
			label.textContent = ap.label;
			stylesGrid.appendChild(label);
		}
		// Keep each input paired with its property so seeding and resetting can't
		// drift out of alignment.
		const styleInputs = new Map();
		for (const ap of ADJUSTABLE_PROPS) {
			const inp = document.createElement('input');
			if (ap.isRange) {
				inp.type = 'range';
				inp.min = ap.min;
				inp.max = ap.max;
				inp.step = ap.step;
				inp.addEventListener('input', () => applyStyle(ap.key, inp.value, adjustedStyles));
			} else {
				inp.type = 'text';
				inp.placeholder = '\u2014';
				inp.addEventListener('input', () => applyStyle(ap.key, inp.value.trim(), adjustedStyles));
				inp.addEventListener('keydown', (e) => {
					if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
					e.preventDefault();
					const match = inp.value.match(/^(-?[\d.]+)(.*)$/);
					if (!match) return;
					let num = parseFloat(match[1]);
					const unit = match[2] || '';
					const step = e.shiftKey ? 10 : Math.abs(num) < 1 ? 0.1 : 1;
					num = Math.round((num + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100;
					inp.value = num + unit;
					applyStyle(ap.key, inp.value.trim(), adjustedStyles);
				});
			}
			styleInputs.set(ap, inp);
			stylesGrid.appendChild(inp);
		}

		// Seed inputs from the current element, preferring any pending edit.
		refreshStyleInputs = () => {
			for (const [ap, inp] of styleInputs) {
				const val = adjustedStyles[ap.key] || curData.styles?.[ap.key] || '';
				if (ap.isRange) {
					const v = parseFloat(val);
					inp.value = isNaN(v) ? 1 : v;
				} else {
					inp.value = val;
				}
			}
		};
		refreshStyleInputs();

		stylesBody.appendChild(stylesGrid);
		const resetBtn = document.createElement('button');
		resetBtn.className = 'rf-btn rf-btn-sm';
		resetBtn.textContent = 'Reset';
		resetBtn.style.cssText = 'margin-top:6px';
		resetBtn.addEventListener('click', () => {
			revertStyles();
			styleSnapshot = {};
			for (const k in adjustedStyles) delete adjustedStyles[k];
			refreshStyleInputs();
			showToast('Styles reset');
		});
		stylesBody.appendChild(resetBtn);
		popover.appendChild(stylesBody);

		// Tab switching
		commentTab.addEventListener('click', () => {
			activeTab = 'comment';
			commentTab.classList.add('active');
			stylesTab.classList.remove('active');
			commentBody.style.display = 'block';
			stylesBody.style.display = 'none';
		});
		stylesTab.addEventListener('click', () => {
			activeTab = 'styles';
			stylesTab.classList.add('active');
			commentTab.classList.remove('active');
			commentBody.style.display = 'none';
			stylesBody.style.display = 'block';
		});

		// Actions
		function submit() {
			let comment = ta.value.trim();
			if (Object.keys(adjustedStyles).length) {
				comment = comment ? comment + '\n\n' + Object.entries(adjustedStyles).map(([k, v]) => k + ': ' + v + ';').join('\n')
					: Object.entries(adjustedStyles).map(([k, v]) => k + ': ' + v + ';').join('\n');
			}
			if (!comment) { showToast('Please enter a comment or adjust a style'); return; }
			// curData already tracks the zoom target, so no re-resolve needed.
			const annotationData = {
				...curData,
				comment,
				category: selCat,
				adjustedStyles: Object.keys(adjustedStyles).length ? { ...adjustedStyles } : null,
				destination: destData,
			};
			persist(() => { annotations.push(makeAnnotation(annotationData)); });
			keepStyles();
			hidePopover();
			showToast('Saved');
		}

		const actions = document.createElement('div');
		actions.className = 'rf-actions';
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'rf-btn';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', hidePopover);
		const cutBtn = document.createElement('button');
		cutBtn.className = 'rf-btn';
		cutBtn.textContent = 'Cut';
		cutBtn.addEventListener('click', () => {
			const comment = ta.value.trim() || '(no comment)';
			const ann = makeAnnotation({
				...curData,
				comment,
				category: selCat,
				adjustedStyles: Object.keys(adjustedStyles).length ? { ...adjustedStyles } : null,
				destination: destData,
			});
			copyText(toMarkdown([ann]));
			hidePopover();
		});
		const submitBtn = document.createElement('button');
		submitBtn.className = 'rf-btn rf-btn-primary';
		submitBtn.textContent = 'Submit';
		submitBtn.addEventListener('click', submit);
		actions.appendChild(cancelBtn);
		actions.appendChild(cutBtn);
		actions.appendChild(submitBtn);
		popover.appendChild(actions);

		ta.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (IS_SAVE_KEY(e)) { e.preventDefault(); submit(); }
		});
		ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); }, true);

		root.appendChild(popover);
		document.body.appendChild(host);

		const rect = el.getBoundingClientRect();
		const pos = placePopover(rect, POPOVER_W, popover.offsetHeight || 480);
		host.style.position = 'fixed';
		host.style.top = pos.top + 'px';
		host.style.left = pos.left + 'px';

		popoverEl = host;
		popoverRoot = root;
		styleSnapshot = {};
		// Re-apply any style edits carried back from destination-select mode.
		for (const k in adjustedStyles) applyStyle(k, adjustedStyles[k], adjustedStyles);
		startAnchor(host, () => zoomTarget);
		ta.focus();
	}

	// A group is just the multi-target case of an annotation, so it reuses the same
	// popover — which gets it styles, destination and Cut for free.
	function showGroupPopover(targets) {
		if (!targets || targets.length < 2) return;
		const primary = targets[0];
		const data = capturableEl(primary).data;
		data.targets = targets.slice(1).map(t => ({
			selector: describeElement(t),
			text: getTextSnippet(t),
			a11y: getA11y(t)
		}));
		showPopover(primary, data);
	}

	// Live style edits mutate the page. Remember each property's original inline
	// value the first time we touch it so we can put the page back if the user
	// walks away without saving.
	function applyStyle(prop, val, adjustedStyles) {
		if (targetEl && styleSnapshot && !(prop in styleSnapshot)) {
			styleSnapshot[prop] = targetEl.style.getPropertyValue(prop);
		}
		if (!val) { delete adjustedStyles[prop]; if (targetEl) targetEl.style.removeProperty(prop); }
		else { adjustedStyles[prop] = val; if (targetEl) targetEl.style.setProperty(prop, val); }
	}

	function revertStyles() {
		if (!targetEl || !styleSnapshot) return;
		for (const prop in styleSnapshot) {
			const orig = styleSnapshot[prop];
			if (orig) targetEl.style.setProperty(prop, orig);
			else targetEl.style.removeProperty(prop);
		}
		styleSnapshot = null;
	}

	// Keep the live edits on the page (used when the annotation is saved), so the
	// user can keep looking at what they just described.
	function keepStyles() {
		styleSnapshot = null;
	}

	function hidePopover() {
		revertStyles();
		if (popoverEl) { popoverEl.remove(); popoverEl = null; popoverRoot = null; }
		targetEl = null;
		styleSnapshot = null;
		hideOutline();
		stopAnchor();
	}

	// --- Panel (shadow DOM) ---
	function renderPanel() {
		if (!panelRoot) return;
		panelRoot.innerHTML = '';
		panelRoot.appendChild(shadowStyle());
		const ps = document.createElement('style');
		ps.textContent = panelStyles();
		panelRoot.appendChild(ps);

		const panel = document.createElement('div');
		panel.className = 'rf-panel';

		const header = document.createElement('div');
		header.className = 'rf-panel-header';
		const h2 = document.createElement('h2');
		h2.textContent = 'Rapid Feedback';
		const count = document.createElement('span');
		count.style.cssText = 'font-size:11px;color:#718096;font-weight:500';
		count.textContent = String(annotations.length);
		const closeBtn = document.createElement('button');
		closeBtn.className = 'rf-btn-icon';
		closeBtn.style.cssText = 'font-size:20px';
		closeBtn.textContent = '\u00d7';
		closeBtn.addEventListener('click', closePanel);
		header.appendChild(h2);
		header.appendChild(count);
		header.appendChild(closeBtn);

		const toolbar = document.createElement('div');
		toolbar.className = 'rf-panel-toolbar';
		function toolbarBtn(label, fn) {
			const b = document.createElement('button');
			b.className = 'rf-btn';
			b.textContent = label;
			b.addEventListener('click', fn);
			return b;
		}
		toolbar.appendChild(toolbarBtn('Copy', () => { if (annotations.length) copyText(toMarkdown(annotations)); else showToast('Nothing to export'); }));
		toolbar.appendChild(toolbarBtn('JSON', () => { if (annotations.length) copyText(JSON.stringify(toFeedbackJSON(annotations))); else showToast('Nothing to export'); }));
		toolbar.appendChild(toolbarBtn('Cut All', () => { if (!annotations.length) { showToast('Nothing to cut'); return; } copyText(toMarkdown(annotations)); persist(() => { annotations = []; }); showToast('Cut'); }));
		toolbar.appendChild(toolbarBtn('Clear', () => { if (!annotations.length) return; persist(() => { annotations = []; }); showToast('Cleared'); }));

		const list = document.createElement('div');
		list.className = 'rf-panel-list';
		if (!annotations.length) {
			const empty = document.createElement('div');
			empty.className = 'rf-empty';
			empty.textContent = 'No annotations yet. ' + CHORD_HINT + ' any element.';
			list.appendChild(empty);
		} else {
			for (let i = 0; i < annotations.length; i++) {
				const a = annotations[i];
				const card = document.createElement('div');
				card.className = 'rf-card';
				card.setAttribute('data-idx', String(i));
				const body = document.createElement('div');
				body.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:8px';
				const left = document.createElement('div');
				left.style.cssText = 'flex:1;min-width:0';
				const titleRow = document.createElement('div');
				titleRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';
				const cardTitle = document.createElement('span');
				cardTitle.className = 'rf-card-title';
				cardTitle.textContent = shortSelector(a) || a.selector;
				titleRow.appendChild(cardTitle);
				const catLabel = CATEGORIES.find(c => c.id === (a.category || 'general'))?.label || '';
				if (catLabel) {
					const cat = document.createElement('span');
					cat.className = 'rf-card-cat';
					cat.textContent = catLabel;
					titleRow.appendChild(cat);
				}
				left.appendChild(titleRow);
				if (a.source?.ref) {
					const s = document.createElement('div');
					s.style.cssText = 'font-size:10px;color:#2f855a;margin-bottom:4px;font-family:monospace;word-break:break-all';
					s.textContent = '\u25CE ' + a.source.ref;
					left.appendChild(s);
				}
				const commentEl = document.createElement('div');
				commentEl.className = 'rf-comment';
				commentEl.textContent = a.comment || '';
				left.appendChild(commentEl);
				if (a.adjustedStyles && Object.keys(a.adjustedStyles).length) {
					const entries = document.createElement('div');
					entries.style.cssText = 'font-size:10px;color:#718096;margin-top:4px;font-family:monospace';
					entries.textContent = Object.entries(a.adjustedStyles).map(([k, v]) => k + ': ' + v).join('; ');
					left.appendChild(entries);
				}
				const urlEl = document.createElement('div');
				urlEl.className = 'rf-url';
				urlEl.textContent = a.url;
				left.appendChild(urlEl);
				const right = document.createElement('div');
				right.style.cssText = 'display:flex;gap:4px;flex-shrink:0';
				const editBtn = document.createElement('button');
				editBtn.className = 'rf-btn-icon';
				editBtn.setAttribute('data-idx', String(i));
				editBtn.textContent = '\u270E';
				const delBtn = document.createElement('button');
				delBtn.className = 'rf-btn-icon rf-btn-del';
				delBtn.setAttribute('data-idx', String(i));
				delBtn.textContent = '\u00d7';
				right.appendChild(editBtn);
				right.appendChild(delBtn);
				body.appendChild(left);
				body.appendChild(right);
				card.appendChild(body);
				list.appendChild(card);
			}
		}

		// Edit/delete delegation
		list.addEventListener('click', (e) => {
			const editBtn = e.target.closest('.rf-btn-icon.rf-btn-del') ? null : e.target.closest('.rf-btn-icon');
			const delBtn = e.target.closest('.rf-btn-del');
			const btn = editBtn || delBtn;
			if (!btn) return;
			const idx = parseInt(btn.getAttribute('data-idx'), 10);
			const a = annotations[idx];
			if (!a) return;
			if (delBtn) {
				persist(() => { annotations.splice(idx, 1); });
				showToast('Deleted');
				return;
			}
			const card = list.querySelector('[data-idx="' + idx + '"]');
			if (!card) return;
			const cel = card.querySelector('.rf-comment');
			if (!cel) return;
			if (cel.getAttribute('contenteditable') === 'true') {
				persist(() => { a.comment = cel.textContent.trim(); });
				cel.setAttribute('contenteditable', 'false');
				cel.style.background = '#edf2f7';
				cel.style.borderLeftColor = '#e2e8f0';
				editBtn.textContent = '\u270E';
			} else {
				cel.setAttribute('contenteditable', 'true');
				cel.style.background = '#fff';
				cel.style.borderLeftColor = '#4a5568';
				cel.focus();
				editBtn.textContent = '\u2713';
			}
		});

		const footer = document.createElement('div');
		footer.className = 'rf-panel-footer';
		const ftCatBar = document.createElement('div');
		ftCatBar.style.cssText = 'display:flex;gap:4px;margin-bottom:6px';
		for (const c of CATEGORIES) {
			const btn = document.createElement('button');
			btn.className = 'rf-cat-btn' + (c.id === activeCategory ? ' active' : '');
			btn.textContent = c.label;
			btn.addEventListener('click', () => {
				ftCatBar.querySelectorAll('.rf-cat-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				activeCategory = c.id;
			});
			ftCatBar.appendChild(btn);
		}
		const genTa = document.createElement('textarea');
		genTa.className = 'rf-popover-ta';
		genTa.style.cssText = 'min-height:44px;margin-bottom:6px';
		genTa.placeholder = 'Quick feedback...';
		const genBtn = document.createElement('button');
		genBtn.className = 'rf-btn';
		genBtn.textContent = 'Send';
		genBtn.addEventListener('click', () => {
			const t = genTa.value.trim();
			if (!t) return;
			persist(() => { annotations.push(makeAnnotation({ comment: t, category: activeCategory })); });
			genTa.value = '';
			showToast('Saved');
		});
		genTa.addEventListener('keydown', (e) => {
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
		footer.appendChild(genBtn);

		panel.appendChild(header);
		panel.appendChild(toolbar);
		panel.appendChild(list);
		panel.appendChild(footer);
		panelRoot.appendChild(panel);
	}

	function openPanel() {
		if (panelEl) {
			panelEl.style.display = 'block';
			renderPanel();
			return;
		}
		const { host, root } = createShadowRoot();
		host.style.cssText = 'all:initial;position:fixed;top:0;right:0;z-index:2147483644';
		panelEl = host;
		panelRoot = root;
		document.body.appendChild(host);
		renderPanel();
	}

	function closePanel() {
		if (panelEl) panelEl.style.display = 'none';
	}

	// --- Chord-hold outline ---
	const OUTLINE_BASE = 'position:fixed;pointer-events:none;z-index:2147483646;border-radius:2px;transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s';
	const OUTLINE_VARIANTS = {
		target: 'border:2px solid #4a5568;animation:rf-outline-pulse 1.5s ease-in-out infinite;box-shadow:0 0 0 4px rgba(74,85,104,0.15)',
		dest: 'border:2px dashed #2b6cb0;box-shadow:0 0 0 4px rgba(43,108,176,0.18)',
	};

	function ensureOutlineAnim() {
		if (document.getElementById('rf-outline-anim')) return;
		const anim = document.createElement('style');
		anim.id = 'rf-outline-anim';
		anim.textContent = '@keyframes rf-outline-pulse{0%,100%{border-color:#4a5568;box-shadow:0 0 0 4px rgba(74,85,104,0.15)}50%{border-color:#718096;box-shadow:0 0 0 8px rgba(74,85,104,0.08)}}';
		document.head.appendChild(anim);
	}

	function showOutline(el, variant) {
		const v = variant || 'target';
		if (!outlineEl) {
			ensureOutlineAnim();
			outlineEl = document.createElement('div');
			document.body.appendChild(outlineEl);
		}
		if (outlineEl.dataset.rfVariant !== v) {
			outlineEl.dataset.rfVariant = v;
			outlineEl.style.cssText = OUTLINE_BASE + ';' + OUTLINE_VARIANTS[v];
		}
		positionOutline(el);
	}

	function positionOutline(el) {
		if (!outlineEl) return;
		const r = el.getBoundingClientRect();
		outlineEl.style.top = r.top + 'px';
		outlineEl.style.left = r.left + 'px';
		outlineEl.style.width = r.width + 'px';
		outlineEl.style.height = r.height + 'px';
	}

	function hideOutline() {
		if (outlineEl) { outlineEl.remove(); outlineEl = null; }
	}

	// --- Destination-select mode ---
	// Pick destination closes the popover and puts the page into a plain-click
	// selection mode: no chord needed, next left click picks the destination,
	// Escape cancels. Either way the draft popover is restored afterwards.
	function enterDestPick(sourceEl, sourceData, draft) {
		hidePopover();
		destPick = { sourceEl, sourceData, draft };
		document.documentElement.style.cursor = 'crosshair';
		showDestBanner();
	}

	function exitDestPick(destination) {
		if (!destPick) return;
		const { sourceEl, sourceData, draft } = destPick;
		destPick = null;
		document.documentElement.style.cursor = '';
		hideDestBanner();
		hideOutline();
		showPopover(sourceEl, sourceData, { ...draft, destination: destination || draft.destination });
		if (destination) showToast('Destination set');
	}

	let destBannerEl = null;

	function showDestBanner() {
		hideDestBanner();
		const { host, root } = createShadowRoot();
		host.style.cssText = 'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none';
		root.appendChild(shadowStyle());
		const s = document.createElement('style');
		s.textContent = `
.rf-banner{background:#2b6cb0;color:#fff;padding:8px 14px;border-radius:6px;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.2);display:flex;gap:10px;align-items:center}
.rf-banner b{font-weight:600}
.rf-banner span{opacity:0.85}
`;
		root.appendChild(s);
		const b = document.createElement('div');
		b.className = 'rf-banner';
		const strong = document.createElement('b');
		strong.textContent = 'Click the destination element';
		const hint = document.createElement('span');
		hint.textContent = 'Esc to cancel';
		b.appendChild(strong);
		b.appendChild(hint);
		root.appendChild(b);
		destBannerEl = host;
	}

	function hideDestBanner() {
		if (destBannerEl) { destBannerEl.remove(); destBannerEl = null; }
	}

	function destTargetFrom(e) {
		const path = e.composedPath ? e.composedPath() : [e.target];
		const el = path.find(n => n && n.nodeType === 1) || e.target;
		if (!el || el.nodeType !== 1) return null;
		if (isRfChrome(el)) return null;
		if (el === document.body || el === document.documentElement) return null;
		return el;
	}

	function captureDestination(el) {
		return {
			selector: describeElement(el),
			tag: el.tagName.toLowerCase(),
			text: getTextSnippet(el),
			a11y: getA11y(el),
			rect: getBoundingRect(el),
		};
	}

	// --- Events ---

	let chordGesture = null;
	const CHORD_GESTURE_MS = 1500;

	function killEvent(e) {
		e.preventDefault();
		e.stopPropagation();
		if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
	}

	function isRfChrome(el) {
		if (!el || el.nodeType !== 1) return false;
		if (fabEl && (el === fabEl.host || fabEl.host.contains(el))) return true;
		if (popoverEl && (el === popoverEl || popoverEl.contains(el))) return true;
		if (panelEl && (el === panelEl || panelEl.contains(el))) return true;
		return false;
	}

	function resolveChordTarget(e, hint) {
		const path = e.composedPath ? e.composedPath() : [e.target];
		let target = hint || path.find(n => n && n.nodeType === 1) || e.target;
		if (isRfChrome(target)) return null;
		const isPierceLayer = (el) => {
			if (!el || el.nodeType !== 1) return false;
			if (el.matches?.('.modal-overlay,.drawer-overlay,.sheet-overlay')) return true;
			return false;
		};
		if (target && isPierceLayer(target) && typeof document.elementsFromPoint === 'function') {
			for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
				if (el.nodeType !== 1) continue;
				if (isPierceLayer(el)) continue;
				if (isRfChrome(el)) continue;
				if (el === document.body || el === document.documentElement) continue;
				target = el;
				break;
			}
		}
		if (!target || target.nodeType !== 1) return null;
		return target;
	}

	function capturableEl(el) {
		const data = {
			selector: describeElement(el),
			tag: el.tagName.toLowerCase(),
			text: getTextSnippet(el),
			styles: getComputedStyles(el),
			rect: getBoundingRect(el),
			source: getSourceLoc(el),
			a11y: getA11y(el)
		};
		return { el, data };
	}

	function openChordAnnotation(e, hint) {
		const target = resolveChordTarget(e, hint);
		if (!target) return;
		hidePopover();
		showPopover(target, capturableEl(target).data);
	}

	// One gesture spans the whole chord hold, so repeat clicks accumulate instead of
	// each one starting over.
	function armChordGesture(e) {
		if (isLiveChordGesture()) { chordGesture.armedAt = performance.now(); return; }
		const path = e.composedPath ? e.composedPath() : [e.target];
		const hint = path.find(n => n && n.nodeType === 1) || e.target;
		chordGesture = {
			x: e.clientX,
			y: e.clientY,
			targetHint: hint,
			accumulated: [],
			opened: false,
			armedAt: performance.now()
		};
	}

	function addToChordGroup(e) {
		if (!isLiveChordGesture()) return;
		const target = resolveChordTarget(e, null);
		if (!target) return;
		const accumulated = chordGesture.accumulated;
		if (!accumulated.includes(target)) {
			accumulated.push(target);
			// Without a marker there's no way to tell that a multi-select is building.
			markGroupTarget(target);
		}
		chordGesture.armedAt = performance.now();
	}

	function clearChordGesture() {
		chordGesture = null;
		clearGroupMarkers();
	}

	function isLiveChordGesture() {
		if (!chordGesture) return false;
		if (performance.now() - chordGesture.armedAt > CHORD_GESTURE_MS) {
			clearChordGesture();
			return false;
		}
		return true;
	}

	// --- Group selection markers ---
	let groupMarkers = [];

	function markGroupTarget(el) {
		const r = el.getBoundingClientRect();
		const m = document.createElement('div');
		m.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #2f855a;border-radius:2px;background:rgba(47,133,90,0.08);top:'
			+ r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
		document.body.appendChild(m);
		groupMarkers.push(m);
	}

	function clearGroupMarkers() {
		for (const m of groupMarkers) m.remove();
		groupMarkers = [];
	}

	const CAPTURE = { capture: true, passive: false };

	function shouldCaptureChord(e) {
		if (isRfChrome(e.target)) return false;
		if (e.button != null && e.button !== 0) return false;
		return IS_CHORD(e) || isLiveChordGesture();
	}

	function finishChordGesture(e) {
		if (!isLiveChordGesture() && !IS_CHORD(e)) return;
		if (e.target && isRfChrome(e.target)) { clearChordGesture(); return; }
		killEvent(e);
		const accumulated = chordGesture ? [...chordGesture.accumulated] : [];
		const alreadyOpened = !!(chordGesture && chordGesture.opened);
		if (chordGesture) chordGesture.opened = true;
		const hint = chordGesture ? chordGesture.targetHint : null;
		clearChordGesture();
		if (alreadyOpened) return;
		const unique = accumulated.filter((el, i) => accumulated.indexOf(el) === i);
		if (unique.length >= 2) {
			showGroupPopover(unique);
		} else if (unique.length === 1) {
			// Prefer the element we actually recorded: on the keyup path `e` is a
			// keyboard event and carries no useful position.
			hidePopover();
			showPopover(unique[0], capturableEl(unique[0]).data);
		} else {
			openChordAnnotation(e, hint);
		}
	}

	// Destination-select mode: registered before the chord listeners so
	// stopImmediatePropagation here keeps the chord handlers out of it entirely.
	for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) {
		document.addEventListener(type, (e) => {
			if (!destPick) return;
			if (isRfChrome(e.target)) return;
			killEvent(e);
		}, CAPTURE);
	}

	document.addEventListener('click', (e) => {
		if (!destPick) return;
		if (isRfChrome(e.target)) return;
		killEvent(e);
		if (e.button != null && e.button !== 0) return;
		const target = destTargetFrom(e);
		if (!target) return;
		if (target === destPick.sourceEl) { showToast('That is the source element'); return; }
		exitDestPick(captureDestination(target));
	}, CAPTURE);

	// Chord-hold: show outline on mousemove. Hit-testing plus a rect read per event
	// is wasteful at mousemove rates, so coalesce to one update per frame.
	let hoverRaf = 0;
	let hoverEvent = null;

	function flushHover() {
		hoverRaf = 0;
		const e = hoverEvent;
		hoverEvent = null;
		if (!e) return;
		if (destPick) {
			const target = destTargetFrom(e);
			if (target) showOutline(target, 'dest');
			return;
		}
		if (!IS_CHORD(e)) return hideOutline();
		const target = resolveChordTarget(e, null);
		if (target) showOutline(target);
	}

	function queueHover(e) {
		// Snapshot what the handlers read. composedPath() returns an empty array once
		// dispatch finishes, so it has to be resolved now rather than on the tick.
		const path = e.composedPath ? e.composedPath() : [e.target];
		hoverEvent = {
			clientX: e.clientX, clientY: e.clientY, target: e.target,
			altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey,
			composedPath: () => path,
		};
		if (!hoverRaf) hoverRaf = requestAnimationFrame(flushHover);
	}

	document.addEventListener('mousemove', queueHover, true);

	document.addEventListener('pointerdown', (e) => {
		if (!IS_CHORD(e) || isRfChrome(e.target)) return;
		if (e.button != null && e.button !== 0) return;
		armChordGesture(e);
		killEvent(e);
		addToChordGroup(e);
	}, CAPTURE);

	document.addEventListener('mousedown', (e) => {
		if (!shouldCaptureChord(e)) return;
		if (IS_CHORD(e)) armChordGesture(e);
		killEvent(e);
		addToChordGroup(e);
	}, CAPTURE);

	document.addEventListener('pointerup', (e) => {
		if (!shouldCaptureChord(e)) return;
		killEvent(e);
	}, CAPTURE);

	// While the chord is still held, a mouseup only adds to the selection: the
	// gesture resolves on chord release (keyup) so multi-click grouping can build up.
	// Releasing the chord before the mouse is the single-click case, handled here.
	document.addEventListener('mouseup', (e) => {
		if (!shouldCaptureChord(e)) return;
		killEvent(e);
		if (!isLiveChordGesture()) return;
		if (IS_CHORD(e)) return;
		const snap = chordGesture;
		queueMicrotask(() => {
			if (chordGesture !== snap) return;
			if (!chordGesture || chordGesture.opened) return;
			finishChordGesture(e);
		});
	}, CAPTURE);

	document.addEventListener('click', (e) => {
		if (!isLiveChordGesture() && !IS_CHORD(e)) return;
		// Swallow the click so the host page never sees it, but leave the gesture
		// open while the chord is down.
		killEvent(e);
		if (IS_CHORD(e)) return;
		finishChordGesture(e);
	}, CAPTURE);

	document.addEventListener('auxclick', (e) => {
		if (!shouldCaptureChord(e)) return;
		killEvent(e);
	}, CAPTURE);

	let chordWasActive = false;
	let lastChordRelease = 0;
	const DOUBLE_TAP_MS = 300;

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			if (destPick) { killEvent(e); exitDestPick(null); return; }
			if (popoverEl) { hidePopover(); return; }
			if (panelEl && panelEl.style.display !== 'none') { closePanel(); return; }
		}
		if (IS_CHORD(e)) {
			if (!e.repeat) revealFab();
			chordWasActive = true;
		}
	}, true);

	document.addEventListener('keyup', (e) => {
		if (chordWasActive && !IS_CHORD(e)) {
			chordWasActive = false;
			hideOutline();
			// Chord released: resolve whatever was selected during the hold. One target
			// opens the normal popover, several open the merged group popover.
			if (isLiveChordGesture()) {
				const accumulated = chordGesture ? [...chordGesture.accumulated] : [];
				if (accumulated.length >= 1 && !chordGesture.opened) {
					killEvent(e);
					finishChordGesture(e);
					return;
				}
			}
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
	}, true);

	// --- API ---
	window.__SCOPE_FEEDBACK_API__ = {
		markdown() { return toMarkdown(annotations); },
		json() { return toFeedbackJSON(annotations); },
		get annotations() { return annotations; },
		clear() { annotations = []; save(); },
		openPanel() { openPanel(); },
	};

	// --- Init ---
	load();
	createFab();
	if (hasAnnotations()) revealFab();
})();
