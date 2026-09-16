// ==UserScript==
// @name         Rapid Feedback
// @namespace    javagrant.ac.nz
// @version      5.18
// @description  Hold Alt+⌘/Ctrl+click any element to annotate it. Multi-select, relocation, element zoom, Shadow DOM isolation. Exports as markdown/JSON.
// @note         v5.16: same-origin iframe picking, frame-aware coordinates and stored frame paths; cross-origin frames remain isolated behind their own userscript instance
// @note         v5.18: recover an unseen popover with Alt+Shift+R or the feedback button; reset stale dragged positions on demand
// @note         v5.17: richer feedback context — nested Svelte component trails, shadow-safe metadata walks, curated visual context, expanded accessibility details, and destination/member source context
// @note         v5.14: draggable popover (persisted per origin), post-submit "revert tweaks" on saved cards, heuristic overlay piercing, selector-ambiguity warnings in exports, two-step Clear confirm, hashchange routing, raw style-attribute restore points, idle-suspending anchor loop, panel list updates without wiping chrome, versioned storage envelope, self-correcting chord-modifier latch, lost-target popover state, outline/markers moved into a shadow root
// @note         v5.13: Svelte deep support — component name in popover, route-aware refs (+page.svelte), per-member Source lines, setProjectRoot() vscode:// links, select-similar by component file, prod-build disclosure, hardened meta access
// @note         v5.12: class filter drops Tailwind variants/arbitrary values/fractions/negatives; pick modes unified behind one driver; chrome hosted on <html> so hydration wipes can't remove it
// @note         v5.11: selectors skip machine-generated ids (hashes, React uids) and read data-test/data-cy; chord-hover preview glows blue; selection markers carry numbered order badges
// @note         v5.10: selectors escape quotes and prefer a stable data-testid; corrupt saved rows no longer wipe the session; UI chrome lives in closed shadow roots; green theme refresh
// @note         v5.9: a concealed floating button no longer intercepts clicks in the corner it sits in
// @note         v5.8: @namespace is now javagrant.ac.nz, no longer tied to the Scope subdomain
// @note         v5.7: canonical home moved from the gist to github.com/JavaGT/rapid-feedback; this build re-points update checks there
// @note         v5.6: chord-clicking with the popover open grows the selection instead of discarding the draft; tool chrome is click-through while the chord is held or a pick mode is running, so it never covers what you meant to click; nothing the tool renders can be annotated; comments stay editable in place from any page
// @note         v5.5: saved selections reopen for full editing with missing-member disclosure, direct-sibling similar selection and undo, primary guidance, distinct duplicate labels, and SPA draft-close handling
// @author       JavaGT
// @match        *://*/*
// @grant        none
// @homepageURL  https://github.com/JavaGT/rapid-feedback
// @supportURL   https://github.com/JavaGT/rapid-feedback/issues
// @updateURL    https://raw.githubusercontent.com/JavaGT/rapid-feedback/main/rapid-feedback.user.js
// @downloadURL  https://raw.githubusercontent.com/JavaGT/rapid-feedback/main/rapid-feedback.user.js
// ==/UserScript==

(function () {
	'use strict';
	const IS_TOP_FRAME = window.parent === window;
	// A top-level instance can bridge same-origin frames that do not run the
	// userscript themselves. Instances that do run in a frame mark it so the top
	// instance does not install a second set of handlers there.
	if (!IS_TOP_FRAME) {
		let bridged = false;
		try { bridged = !!document.__RF_BRIDGED_BY_TOP__; } catch {}
		if (bridged) return;
		try {
			Object.defineProperty(window, '__SCOPE_FEEDBACK_FRAME_INSTANCE__', { value: true, configurable: false });
		} catch { try { window.__SCOPE_FEEDBACK_FRAME_INSTANCE__ = true; } catch {} }
	}
	// Guard with a dedicated flag so a re-injection during init can't mistake the
	// half-built API object for a finished one. Flags can lie — HMR and hydration
	// wipes can strip our chrome while leaving the flag set — so the flag alone
	// isn't trusted: if no chrome host survives, rebuild rather than bail.
	if (window.__SCOPE_FEEDBACK_LOADED__) {
		const fabHost = document.querySelector('[data-rf-chrome]');
		if (fabHost?.isConnected) return;
	}
	window.__SCOPE_FEEDBACK_LOADED__ = true;

	const UA_PLATFORM = navigator.userAgentData?.platform;
	const IS_MAC = UA_PLATFORM
		? UA_PLATFORM === 'macOS'
		: /Mac|iPhone|iPod|iPad/i.test(navigator.platform || '');
	// Self-correcting platform detection: UA hints are a guess; whichever modifier
	// actually arrives with the first chord is ground truth, so a mis-detected
	// platform fixes itself on first use instead of never working.
	const CHORD_HINT = IS_MAC ? 'Alt+⌘+click' : 'Alt+Ctrl+click';
	// Self-correcting platform detection: UA hints are a guess, so whichever
	// modifier actually arrives with an interaction becomes ground truth from then
	// on — a mis-detected platform fixes itself on first use.
	let chordUsesMeta = IS_MAC;
	function updateChordLatch(e) {
		if (e.metaKey && !e.ctrlKey) chordUsesMeta = true;
		else if (e.ctrlKey && !e.metaKey) chordUsesMeta = false;
	}
	const IS_CHORD = (e) => {
		if (typeof e.altKey !== 'boolean') return false;
		updateChordLatch(e);
		return e.altKey && (chordUsesMeta ? e.metaKey : e.ctrlKey);
	};
	const IS_SAVE_KEY = (e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter';
	// Escape must not destroy an in-progress draft while the user is typing.
	// The popover/panel live in closed shadow roots, so at `document` capture
	// level e.target is the retargeted host — inspect composedPath() instead.
	function eventFromEditable(e) {
		let path = null;
		try { path = typeof e.composedPath === 'function' ? e.composedPath() : null; } catch { path = null; }
		const nodes = Array.isArray(path) && path.length ? path : [e.target];
		for (const n of nodes) {
			if (!n || n.nodeType !== 1) continue;
			const tag = n.tagName;
			if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return n;
			try { if (n.isContentEditable) return n; } catch {}
		}
		return null;
	}

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
	const LOOK_PROPS = [
		'display', 'font-size', 'line-height', 'color', 'background-color',
		'padding', 'margin', 'border', 'border-radius', 'gap'
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
	const STORAGE_VERSION = 1;
	const POPOVER_OFFSET_KEY = 'rf_popover_offset_v1';
	const DRAG_THRESHOLD_PX = 4;
	const TEXT_MAX = 150;
	const POPOVER_W = 320;
	const PANEL_W = 380;
	const SIMILAR_MAX = 50;
	const COMPONENT_MAX = 8;
	const RF_CHROME_ATTR = 'data-rf-chrome';
	const RF_PASSTHROUGH_ATTR = 'data-rf-passthrough';
	// One declared ladder instead of magic numbers repeated at six call sites:
	// overlays (toast/banner) float above everything, the outline above markers,
	// markers above the interactive surfaces.
	const Z = { surface: 2147483644, marker: 2147483645, fab: 2147483645, outline: 2147483646, overlay: 2147483647 };

	let annotations = [];
	// User-dragged popover position; survives reloads until Cancel/Esc resets it.
	let popoverOffset = null;
	let drag = null;
	let activeCategory = 'general';
	let panelEl = null;
	let panelRoot = null;
	let panelListEl = null;
	let panelCountEl = null;
	let fabEl = null;
	let popoverEl = null;
	// Reports whether the open popover's draft holds user work worth protecting
	// from a reflex Escape. Assigned in showPopover, cleared in hidePopover.
	let popoverDraftGuard = null;

	let popoverRoot = null;

	// MutationObservers watching for SPA re-renders that strand the draft; one per
	// open popover, disconnected on close.
	let domWatchers = [];
	let outlineEl = null;
	let pickMode = null;
	// Handle onto the open popover, so a chord gesture can grow its selection.
	let popoverApi = null;
	// Live style edits apply to every selected element, so both the targets and the
	// snapshot of what to restore are per-element.
	let styleTargets = [];
	// Map<Element, string|null> — the raw inline `style` attribute before the first
	// tweak (null = no inline style). One restore point per element, not per prop.
	let styleSnapshot = null; // eslint-disable-line no-unused-vars
	let anchor = null;
	// Anchor wake listeners for resize (scroll wakes are registered per-loop).
	const resizeWaiters = new Set();
	addEventListener('resize', () => { for (const wake of resizeWaiters) wake(); });

	// Pointer events stop at iframe boundaries. Keep one handler registry so the
	// top-level instance can listen inside same-origin frames without duplicating
	// the event logic, while cross-origin frames remain browser-isolated.
	const feedbackEventDocuments = new Set([document]);
	const feedbackListeners = [];
	const feedbackFrameWatchers = new WeakSet();
	const feedbackDocumentWatchers = new WeakMap();

	function addFeedbackListener(type, listener, options) {
		feedbackListeners.push({ type, listener, options });
		for (const doc of feedbackEventDocuments) doc.addEventListener(type, listener, options);
	}

	function accessibleFrameDocument(frame) {
		try {
			const doc = frame.contentDocument;
			return doc?.documentElement ? doc : null;
		} catch {
			return null;
		}
	}

	function watchFeedbackDocument(doc) {
		if (feedbackDocumentWatchers.has(doc)) return;
		const observer = new MutationObserver(records => {
			const hasFrameChange = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => {
				if (node.nodeType !== 1) return false;
				return node.matches('iframe') || !!node.querySelector('iframe');
			}));
			if (hasFrameChange) scanFeedbackFrames(doc);
		});
		// Observe the Document node rather than <html>, so document.write or a
		// hydration swap replacing the root does not orphan frame discovery.
		feedbackDocumentWatchers.set(doc, observer);
		observer.observe(doc, { childList: true, subtree: true });
	}

	function registerFeedbackDocument(doc) {
		if (!doc || doc.defaultView?.__SCOPE_FEEDBACK_FRAME_INSTANCE__) return;
		try { Object.defineProperty(doc, '__RF_BRIDGED_BY_TOP__', { value: true, configurable: false }); } catch {}
		if (!feedbackEventDocuments.has(doc)) {
			feedbackEventDocuments.add(doc);
			for (const { type, listener, options } of feedbackListeners) doc.addEventListener(type, listener, options);
			if (pickMode && doc.documentElement) doc.documentElement.style.cursor = 'crosshair';
		}
		if (anchor && doc !== document) {
			doc.addEventListener('scroll', anchor.wake, { capture: true, passive: true });
			anchor.scrollDocuments.add(doc);
		}
		if (drag && doc !== document) {
			doc.addEventListener('pointermove', drag.move);
			doc.addEventListener('pointerup', drag.up);
			drag.documents.add(doc);
		}
		watchFeedbackDocument(doc);
		scanFeedbackFrames(doc);
	}

	function unregisterFeedbackDocument(doc) {
		if (doc === document || !feedbackEventDocuments.delete(doc)) return;
		for (const { type, listener, options } of feedbackListeners) doc.removeEventListener(type, listener, options);
		const watched = feedbackDocumentWatchers.get(doc);
		watched?.disconnect();
		feedbackDocumentWatchers.delete(doc);
		anchor?.scrollDocuments.delete(doc);
	}

	function pruneFeedbackDocuments() {
		for (const doc of [...feedbackEventDocuments]) {
			if (doc === document) continue;
			try {
				const frame = doc.defaultView?.frameElement;
				if (!frame || frame.contentDocument !== doc) unregisterFeedbackDocument(doc);
			} catch { unregisterFeedbackDocument(doc); }
		}
	}

	function scanFeedbackFrames(rootDoc) {
		if (!IS_TOP_FRAME) return;
		if (rootDoc === document) pruneFeedbackDocuments();
		for (const frame of rootDoc.querySelectorAll('iframe')) {
			if (!feedbackFrameWatchers.has(frame)) {
				feedbackFrameWatchers.add(frame);
				frame.addEventListener('load', () => {
					const doc = accessibleFrameDocument(frame);
					pruneFeedbackDocuments();
					if (doc) registerFeedbackDocument(doc);
				});
			}
			const doc = accessibleFrameDocument(frame);
			// Wait for navigation to finish before registering. This avoids binding
			// stale about:blank documents before a frame's real document is ready.
			if (doc && (doc.readyState === 'interactive' || doc.readyState === 'complete')) registerFeedbackDocument(doc);
		}
	}

	function setFeedbackCursor(value) {
		for (const doc of feedbackEventDocuments) {
			if (doc.documentElement) doc.documentElement.style.cursor = value;
		}
	}

	if (IS_TOP_FRAME) watchFeedbackDocument(document);

	// --- Utility-class detection ---
	const UTILITY_CLASS_RE = /^(p|m)(t|r|b|l|x|y|s|e)?-\d+|^(w|h|min-w|min-h|max-w|max-h)-\d+|^(text|font|leading|tracking|rounded|border|bg|shadow|opacity|z|flex|grid|gap|items|justify|self|order|overflow|object|top|right|bottom|left|inset|ring|outline|decoration|underline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|truncate|italic|not-italic|font|antialiased|subpixel-antialiased|align|break|whitespace|list|sr-only|invisible|visible|static|fixed|absolute|relative|sticky|block|inline|flow-root|contents|hidden|isolate|float|clear|container|columns|aspect|basis|grow|shrink)/;

	function isUtilityClass(cls) {
		if (!cls) return true;
		// Svelte scope hashes churn per build; never anchor selectors on them.
		if (/^svelte-[a-z0-9]+$/i.test(cls)) return true;
		// CamelCase reads hand-written; keep it as signal.
		if (/[A-Z]/.test(cls)) return false;
		// Variant prefixes (hover:pt-2), arbitrary values (w-[37px]) and fractions
		// (w-1/2) are framework noise whatever their stem.
		if (/[:[\]/]/.test(cls)) return true;
		// Negative utilities (-mt-2): judge the unsigned form.
		return UTILITY_CLASS_RE.test(cls[0] === '-' ? cls.slice(1) : cls);
	}

	// SVG elements expose className as an SVGAnimatedString, so it can't be read as
	// a string. Callers that hand a raw element's classes to filterClasses go
	// through here.
	function classNameOf(el) {
		return typeof el.className === 'string' ? el.className : '';
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
	// The data-* test handles rank high: they are the most stable, developer-
	// meaningful handles a feedback selector can carry when a component ships one.
	const HIGH_SIGNAL_ATTRS = ['aria-label', 'data-testid', 'data-test', 'data-cy', 'name', 'href'];

	// Ids that look machine-generated — hex hashes, React/Radix uids (`:r1:`),
	// styled-components (`sc-XyZ12`) — churn between builds and make unstable
	// anchors, so describeElement leaves them out and prefers other signals.
	const GENERATED_ID_RE = /^(?:[0-9a-f]{8,}|sc-[a-z0-9]{4,}|.*:.*)$/i;

	function isMeaningfulId(id) {
		return !!id && id.length <= 64 && !GENERATED_ID_RE.test(id);
	}

	function collectAttrs(el) {
		// Values go inside quoted strings in the selector, so quotes and backslashes
		// must be escaped or the selector silently fails to parse — and every
		// uniqueness check downstream then fails too.
		const escapeAttrValue = (v) => String(v).replace(/[\\"]/g, '\\$&');
		const out = [];
		for (const attr of HIGH_SIGNAL_ATTRS) {
			let v = el.getAttribute(attr);
			if (attr === 'href') v = v?.split('?')[0];
			if (v) out.push(`${attr}="${escapeAttrValue(v)}"`);
		}
		const src = el.getAttribute('src')?.split('?')[0];
		if (src) out.push(`src="${escapeAttrValue(src)}"`);
		const placeholder = el.getAttribute('placeholder');
		if (placeholder) out.push(`placeholder="${escapeAttrValue(placeholder)}"`);
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

	// True when the emitted chain no longer identifies one element — the DOM
	// changed or the chain was truncated. Exports surface this so developers know
	// the selector may drift.
	function isSelectorAmbiguous(selector, el) {
		if (!selector) return false;
		try {
			const root = el?.getRootNode?.() || el?.ownerDocument || document;
			return root.querySelectorAll(selector).length > 1;
		} catch { return false; }
	}

	function describeElement(el) {
		if (el.nodeType !== 1) return '';
		const ownerDoc = el.ownerDocument || document;
		const selectorRoot = el.getRootNode?.() || ownerDoc;
		const chain = [];
		let cur = el;
		while (cur && cur.nodeType === 1 && cur !== ownerDoc.body && cur !== ownerDoc.documentElement) {
			const parts = [cur.tagName.toLowerCase()];
			if (isMeaningfulId(cur.id)) parts.push('#' + cur.id);
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
			const next = parentOf(cur);
			// A selector rooted inside a shadow tree cannot include its host. Source
			// metadata can cross that boundary, but the selector must remain resolvable.
			if (!next || next.getRootNode?.() !== selectorRoot) break;
			cur = next;
		}
		return chain.slice(-12).join(' > ');
	}

	function framePathFor(el) {
		const path = [];
		let doc = el.ownerDocument || document;
		while (doc && doc !== document) {
			const frame = doc.defaultView?.frameElement;
			if (!frame) return null;
			const selector = describeElement(frame);
			if (!selector) return null;
			path.unshift({ selector });
			doc = frame.ownerDocument;
		}
		return path.length ? path : null;
	}

	function parentOf(el) {
		// parentElement stops at a shadow root. Do not return the DocumentFragment
		// itself; cross that boundary to its host so selectors and source metadata
		// describe the same composed tree.
		let p = el.parentElement;
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

	// Keep Markdown readable while retaining the complete computed-style snapshot
	// for storage and the live Styles tab.
	function getLooks(styles) {
		if (!styles) return null;
		const looks = {};
		for (const prop of LOOK_PROPS) {
			if (styles[prop]) looks[prop] = String(styles[prop]).slice(0, 100);
		}
		return Object.keys(looks).length ? looks : null;
	}

	function getBoundingRect(el) {
		const r = el.getBoundingClientRect();
		return { width: Math.round(r.width), height: Math.round(r.height) };
	}

	// An element's rect is relative to its own frame viewport. The overlay is
	// hosted by the top document, so add each iframe's viewport offset on the way
	// up before using the rect for positioning or markers.
	function getViewportRect(el) {
		const r = el.getBoundingClientRect();
		let left = r.left;
		let top = r.top;
		let doc = el.ownerDocument;
		while (doc && doc !== document) {
			const frame = doc.defaultView?.frameElement;
			if (!frame) break;
			const fr = frame.getBoundingClientRect();
			left += fr.left + frame.clientLeft;
			top += fr.top + frame.clientTop;
			doc = frame.ownerDocument;
		}
		return { x: left, y: top, top, left, right: left + r.width, bottom: top + r.height, width: r.width, height: r.height };
	}

	function topClientPoint(e) {
		const frame = e.view?.frameElement;
		const offset = frame ? getViewportRect(frame) : null;
		return { x: e.clientX + (offset?.left || 0), y: e.clientY + (offset?.top || 0) };
	}

	// --- Svelte source location ---
	// __svelte_meta is page-owned: a hostile page can define throwing getters on
	// it, so every read is guarded. The .parent chain is Svelte-internal, not a
	// stable API — traversal fails soft and is capped.
	function frameFromSvelteNode(node, fallbackType) {
		try {
			const loc = node?.loc || node;
			const rawFile = loc?.file || node?.file;
			if (!rawFile) return null;
			const file = relSourceFile(rawFile);
			const rawLine = loc?.line ?? node?.line;
			const rawColumn = loc?.column ?? node?.column;
			const line = rawLine == null || rawLine === '' ? null : Number(rawLine);
			const column = rawColumn == null || rawColumn === '' ? null : Number(rawColumn);
			return {
				type: node?.type || fallbackType || 'component',
				file,
				line: Number.isFinite(line) ? line : null,
				column: Number.isFinite(column) ? column : null,
				ref: frameRef(file, Number.isFinite(line) ? line : null)
			};
		} catch { return null; }
	}

	function readSvelteMeta(node) {
		try {
			const meta = node && node.__svelte_meta;
			return meta && frameFromSvelteNode(meta) ? meta : null;
		} catch {}
		return null;
	}

	function findSvelteMetaEl(el) {
		let cur = el;
		let guard = 0;
		while (cur && cur.nodeType === 1 && guard++ < 50) {
			if (readSvelteMeta(cur)) return cur;
			cur = parentOf(cur);
		}
		return null;
	}

	function relSourceFile(file) {
		if (!file) return file;
		const norm = String(file).replace(/\\/g, '/');
		const m = norm.match(/(?:^|\/)((?:src|packages|node_modules)\/.*)$/);
		return m ? m[1] : norm.replace(/^.*?\/([^/]+\/[^/]+\.svelte)$/, '$1');
	}

	function baseName(file) {
		if (!file) return file;
		const norm = String(file).replace(/\\/g, '/');
		return norm.slice(norm.lastIndexOf('/') + 1);
	}

	// SvelteKit route files all share generic basenames (+page.svelte and kin), so
	// a bare basename is ambiguous — prefix the distinguishing parent directory.
	const GENERIC_ROUTE_FILE_RE = /^\+(?:page|layout|error|server)(?:\..+)?\.svelte$/;

	function frameRef(file, line) {
		const base = baseName(file);
		if (!base) return '';
		const suffix = line != null ? ':' + line : '';
		if (!GENERIC_ROUTE_FILE_RE.test(base)) return base + suffix;
		const parts = String(file).replace(/\\/g, '/').split('/');
		const dir = parts[parts.length - 2];
		return (dir ? dir + '/' : '') + base + suffix;
	}

	// "Is this a Svelte app at all?" heuristic via scoped classes. Not cached:
	// Svelte content can mount long after first capture on SPAs.
	function looksLikeSvelte(ownerDoc = document, startEl) {
		try {
			let cur = startEl;
			let guard = 0;
			while (cur && cur.nodeType === 1 && guard++ < 50) {
				if (classNameOf(cur).split(/\s+/).some(cls => /^svelte-[a-z0-9]+$/i.test(cls))) return true;
				cur = parentOf(cur);
			}
			return ownerDoc.querySelector('[class*="svelte-"]') !== null;
		} catch { return false; }
	}

	function componentFramesFor(el, metaEl, meta) {
		const primary = frameFromSvelteNode(meta, 'component');
		const metaFrames = [];
		const addMeta = (frame) => {
			if (!frame || metaFrames.some(existing => existing.file === frame.file && existing.line === frame.line && existing.column === frame.column)) return;
			metaFrames.push(frame);
		};
		addMeta(primary);

		let parent = null;
		try { parent = meta?.parent || null; } catch {}
		let guard = 0;
		while (parent && guard++ < 12) {
			addMeta(frameFromSvelteNode(parent, 'component'));
			try { parent = parent.parent || null; } catch { parent = null; }
		}

		// DOM metadata is useful when the runtime parent chain omits a nested
		// component. Keep one frame per file in this stream because Svelte stamps
		// different source locations onto ordinary elements in the same component.
		const domFrames = [];
		const addDom = (frame) => {
			if (!frame || domFrames.some(existing => existing.file === frame.file)) return;
			domFrames.push(frame);
		};
		addDom(primary);
		let cur = parentOf(metaEl || el);
		guard = 0;
		while (cur && cur.nodeType === 1 && guard++ < 50) {
			addDom(frameFromSvelteNode(readSvelteMeta(cur), 'component'));
			cur = parentOf(cur);
		}

		// Start with the explicit runtime chain, then place DOM-only frames between
		// their nearest known neighbors. This preserves leaf-to-root order in either
		// direction of partial metadata.
		const frames = [...metaFrames];
		for (let i = 0; i < domFrames.length; i++) {
			const frame = domFrames[i];
			if (frames.some(existing => existing.file === frame.file)) continue;
			let insertAt = frames.length;
			for (let j = i - 1; j >= 0; j--) {
				const anchor = frames.findIndex(existing => existing.file === domFrames[j].file);
				if (anchor >= 0) { insertAt = anchor + 1; break; }
			}
			if (insertAt !== frames.length) {
				frames.splice(insertAt, 0, frame);
				continue;
			}
			for (let j = i + 1; j < domFrames.length; j++) {
				const anchor = frames.findIndex(existing => existing.file === domFrames[j].file);
				if (anchor >= 0) { insertAt = anchor; break; }
			}
			frames.splice(insertAt, 0, frame);
		}
		return frames.length ? frames.slice(0, COMPONENT_MAX) : null;
	}

	function getSourceLoc(el) {
		const metaEl = findSvelteMetaEl(el);
		if (!metaEl) {
			// No dev metadata. If the page still smells like Svelte, say why instead
			// of going quiet — reviewers otherwise assume the tool is broken.
			return looksLikeSvelte(el.ownerDocument, el) ? { status: 'svelte-production-build' } : null;
		}
		const meta = readSvelteMeta(metaEl);
		const primary = frameFromSvelteNode(meta, 'component');
		if (!primary) return null;
		const components = componentFramesFor(el, metaEl, meta);
		return {
			file: primary.file,
			line: primary.line,
			column: primary.column,
			ref: primary.file + (primary.line != null ? ':' + primary.line : ''),
			viaAncestor: metaEl !== el,
			components,
			// Keep the original parent-only field for consumers already using it.
			componentStack: components?.slice(1).map(frame => ({ type: frame.type, ref: frame.ref })) || null
		};
	}

	// Optional editor deep links: setProjectRoot('/abs/path/to/repo') makes
	// exports carry clickable vscode:// links with line and column.
	let projectRoot = '';
	function setProjectRoot(path) {
		projectRoot = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
	}

	function editorUrlFor(file, line, column) {
		if (!projectRoot || !file) return null;
		const rel = String(file).replace(/^\.\//, '');
		const abs = rel.startsWith('/') ? rel : projectRoot + '/' + rel;
		return 'vscode://file' + encodeURI(abs) + ':' + (line || 1) + (column ? ':' + column : '');
	}

	function getA11y(el) {
		const out = {};
		const role = el.getAttribute('role') || implicitRole(el);
		if (role) out.role = role;
		const tag = el.tagName.toLowerCase();
		const label = el.getAttribute('aria-label') || labelFromLabelledBy(el) || el.getAttribute('alt') || el.getAttribute('title')
			|| (/^(button|a|summary|h[1-6])$/.test(tag) ? (el.textContent || '').trim() : '');
		if (label) out.name = label.trim().replace(/\s+/g, ' ').slice(0, 80);
		const description = textFromIds(el, 'aria-describedby');
		if (description) out.description = description.slice(0, 120);
		const rawHeadingLevel = /^h([1-6])$/.exec(tag)?.[1] || (role === 'heading' ? el.getAttribute('aria-level') : null);
		const headingLevel = Number(rawHeadingLevel);
		if (Number.isInteger(headingLevel) && headingLevel >= 1 && headingLevel <= 6) out.level = headingLevel;
		const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test') || el.getAttribute('data-cy');
		if (testId) out.testId = testId;
		const states = {};
		for (const attr of ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'aria-disabled']) {
			const value = el.getAttribute(attr);
			if (value != null && !(attr === 'aria-current' && value === 'false')) states[attr.slice(5)] = value;
		}
		if (el.disabled) states.disabled = 'true';
		if (el.required) states.required = 'true';
		if (Object.keys(states).length) out.states = states;
		return Object.keys(out).length ? out : null;
	}

	function labelFromLabelledBy(el) {
		return textFromIds(el, 'aria-labelledby');
	}

	function textFromIds(el, attr) {
		const ids = el.getAttribute(attr);
		if (!ids) return null;
		const ownerDoc = el.ownerDocument || document;
		const text = ids.split(/\s+/).map(id => ownerDoc.getElementById(id)).filter(Boolean)
			.map(ref => (ref.textContent || '').trim()).filter(Boolean).join(' ');
		return text || null;
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

	function compactFramePath(path) {
		return (Array.isArray(path) ? path : []).map(frame => compactAncestorChain(frame?.selector, 4)).filter(Boolean).join(' > ');
	}

	function componentTrail(source, includePrimary) {
		if (!source) return '';
		if (Array.isArray(source.components) && source.components.length) {
			const frames = includePrimary ? source.components : source.components.slice(1);
			return frames.map(frame => frame?.ref).filter(Boolean).join(' \u2190 ');
		}
		const refs = [];
		if (includePrimary && source.file) refs.push(frameRef(source.file, source.line));
		if (Array.isArray(source.componentStack)) refs.push(...source.componentStack.map(frame => frame?.ref));
		return refs.filter(Boolean).join(' \u2190 ');
	}

	function annotationLooks(a) {
		const looks = a?.looks;
		return looks && typeof looks === 'object' && !Array.isArray(looks) && Object.keys(looks).length
			? looks : getLooks(a?.styles);
	}

	function sourceForJSON(source) {
		if (!source || !Array.isArray(source.components)) return source || null;
		return {
			...source,
			components: source.components.filter(frame => frame && typeof frame === 'object').map(frame => ({
				...frame,
				editorUrl: editorUrlFor(frame.file, frame.line, frame.column)
			}))
		};
	}

	function formatLooks(looks) {
		return Object.entries(looks || {}).map(([key, value]) => key + '=' + value).join('; ');
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

	function positionalLabel(el) {
		let n = 1;
		for (let prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
			if (prev.tagName === el.tagName) n++;
		}
		return el.tagName.toLowerCase() + ':nth-of-type(' + n + ')';
	}

	function frameDocumentFor(path) {
		let ownerDoc = document;
		for (const frameRef of Array.isArray(path) ? path : []) {
			let frame;
			try { frame = ownerDoc.querySelector(frameRef.selector); } catch { return null; }
			if (!frame) return null;
			try { ownerDoc = frame.contentDocument; } catch { return null; }
			if (!ownerDoc) return null;
		}
		return ownerDoc;
	}

	function resolveStoredMember(ref) {
		if (!ref?.selector) return null;
		const ownerDoc = frameDocumentFor(ref.framePath);
		try { return ownerDoc?.querySelector(ref.selector) || null; } catch { return null; }
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
			framePath: Array.isArray(data.framePath) ? data.framePath : null,
			tag: data.tag || 'general',
			text: data.text || '',
			styles: data.styles || null,
			rect: data.rect || null,
			url: data.url || location.href,
			comment: data.comment || '',
			category: data.category || 'general',
			adjustedStyles: data.adjustedStyles || null,
			styleRestore: data.styleRestore || null,
			source: data.source || null,
			a11y: data.a11y || null,
			looks: data.looks || null,
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
				const trail = componentTrail(a.source);
				if (trail) lines.push('Component: ' + trail);
				const eu = editorUrlFor(a.source.file, a.source.line, a.source.column);
				if (eu) lines.push('Open: ' + eu);
			} else if (a.source?.status === 'svelte-production-build') {
				lines.push('Source: unavailable \u2014 Svelte production build (dev mode required for file mapping)');
			}
			if (a.a11y) {
				const bits = [];
				if (a.a11y.role) bits.push('role=' + a.a11y.role);
				if (a.a11y.name) bits.push('name="' + a.a11y.name + '"');
				if (a.a11y.testId) bits.push('testid=' + a.a11y.testId);
				if (a.a11y.level) bits.push('level=' + a.a11y.level);
				if (a.a11y.description) bits.push('description="' + a.a11y.description + '"');
				if (a.a11y.states) bits.push('state=' + Object.entries(a.a11y.states).map(([key, value]) => key + ':' + value).join(','));
				if (bits.length) lines.push('A11y: ' + bits.join(' '));
			}
			const looks = annotationLooks(a);
			if (looks) lines.push('Looks: ' + formatLooks(looks));
			if (isSelectorAmbiguous(a.selector, resolveStoredMember(a))) lines.push('⚠ Selector matches multiple elements right now — it may drift');
			const where = compactAncestorChain(a.selector);
			if (where) lines.push('Where: ' + where);
			const frame = compactFramePath(a.framePath);
			if (frame) lines.push('Frame: ' + frame);
			if (a.rect) lines.push('Rect: ' + a.rect.width + '\u00d7' + a.rect.height);
			if (a.destination) {
				const d = a.destination;
				lines.push('\u2192 Destination: ' + (compactAncestorChain(d.selector, 4) || d.selector));
				const frame = compactFramePath(d.framePath);
				if (frame) lines.push('  Frame: ' + frame);
				if (d.text) lines.push('  Text: \u201c' + d.text + '\u201d');
				if (d.a11y?.name) lines.push('  A11y: name="' + d.a11y.name + '"');
				if (d.source?.ref) {
					lines.push('  Source: ' + d.source.ref);
					const trail = componentTrail(d.source);
					if (trail) lines.push('  Component: ' + trail);
				}
				if (d.looks) lines.push('  Looks: ' + formatLooks(d.looks));
			}
			// Every selected element is actionable, so each one gets its own line with
			// the selector a developer would need — not just a label.
			if (a.targets && a.targets.length) {
				lines.push('Group: ' + (a.targets.length + 1) + ' elements (this + ' + a.targets.length + ')');
				for (const t of a.targets) {
					const label = compactRefLabel(t);
					lines.push('  • ' + label);
					// The label already carries short text; only spell it out when it
					// was too long to fit and got dropped.
					const txt = (t.text || '').trim().replace(/\s+/g, ' ');
					if (txt && !label.includes('"' + txt + '"')) {
						lines.push('    Text: “' + (txt.length > 80 ? txt.slice(0, 80) + '…' : txt) + '”');
					}
				const w = compactAncestorChain(t.selector, 4);
				if (w) lines.push('    Where: ' + w);
				const frame = compactFramePath(t.framePath);
				if (frame) lines.push('    Frame: ' + frame);
					if (t.source?.ref) {
						lines.push('    Source: ' + t.source.ref);
						const trail = componentTrail(t.source);
						if (trail) lines.push('    Component: ' + trail);
						const eu = editorUrlFor(t.source.file, t.source.line, t.source.column);
						if (eu) lines.push('    Open: ' + eu);
					}
					if (t.looks) lines.push('    Looks: ' + formatLooks(t.looks));
				}
			}
			if (a.adjustedStyles && Object.keys(a.adjustedStyles).length) {
				lines.push(a.targets?.length ? 'Tweak (all ' + (a.targets.length + 1) + ' elements):' : 'Tweak:');
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
				source: sourceForJSON(a.source),
				editorUrl: a.source?.ref ? editorUrlFor(a.source.file, a.source.line, a.source.column) : null,
				a11y: a.a11y || null,
				selector: a.selector || null,
				framePath: a.framePath || null,
				where: compactAncestorChain(a.selector) || null,
				tag: a.tag || null,
				rect: a.rect || null,
				looks: annotationLooks(a),
				adjustedStyles: a.adjustedStyles || null,
				styleRestore: a.styleRestore || null,
				selectorAmbiguous: isSelectorAmbiguous(a.selector, resolveStoredMember(a)),
				destination: a.destination ? {
					selector: a.destination.selector,
					framePath: a.destination.framePath || null,
					tag: a.destination.tag || null,
					text: a.destination.text || null,
					a11y: a.destination.a11y,
					source: sourceForJSON(a.destination.source),
					looks: a.destination.looks || null,
					where: compactAncestorChain(a.destination.selector, 4)
				} : null,
				groupSize: a.targets?.length ? a.targets.length + 1 : 1,
				targets: a.targets ? a.targets.map(t => ({
					selector: t.selector,
					framePath: t.framePath || null,
					tag: t.tag || null,
					text: t.text || null,
					a11y: t.a11y || null,
					where: compactAncestorChain(t.selector) || null,
					rect: t.rect || null,
					source: sourceForJSON(t.source),
					editorUrl: t.source?.ref ? editorUrlFor(t.source.file, t.source.line, t.source.column) : null,
					looks: t.looks || null
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
			const data = localStorage.getItem(STORAGE_KEY);
			if (!data) return;
			const parsed = JSON.parse(data);
			// One corrupt row shouldn't take the whole history down with it: keep the
			// well-formed objects and let makeAnnotation fill in any missing fields.
			// Installs from before v5.14 saved a bare array under this key — keep
			// reading it so an upgrade's first save doesn't overwrite their
			// annotations; the save itself re-emits the envelope.
			const rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? parsed.annotations : null);
			if (Array.isArray(rows)) annotations = rows.filter(a => a && typeof a === 'object').map(makeAnnotation);
		} catch {}
	}

	// Versioned envelope: a future format change can migrate instead of guessing.
	// Quota failures surface as a toast — silently losing a save would be worse.
	function save() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, annotations }));
		} catch {
			showToast('Could not save — storage full');
		}
	}

	function persist(fn) {
		fn();
		save();
		if (panelRoot) renderPanel();
	}

	// The dragged popover position persists per origin so a reviewer who parks it
	// out of the way keeps that spot across reloads. Reset by Cancel/Esc.
	function loadPopoverOffset() {
		try {
			const raw = localStorage.getItem(POPOVER_OFFSET_KEY);
			if (!raw) return;
			const p = JSON.parse(raw);
			if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)) popoverOffset = { x: p.x, y: p.y };
		} catch {}
	}

	function savePopoverOffset() {
		try {
			if (popoverOffset) localStorage.setItem(POPOVER_OFFSET_KEY, JSON.stringify(popoverOffset));
			else localStorage.removeItem(POPOVER_OFFSET_KEY);
		} catch {}
	}

	// --- Shadow DOM helpers ---
	function createShadowRoot() {
		const host = document.createElement('div');
		host.style.cssText = `all:initial;position:fixed;z-index:${Z.outline};pointer-events:none`;
		// Every piece of our own chrome carries this marker, so isRfChrome can reject
		// it by inspection rather than by keeping a list of hosts in sync.
		host.setAttribute(RF_CHROME_ATTR, '');
		// Closed roots keep page scripts from reaching into the feedback UI — panel
		// comments are none of the host page's business. Everything that needs the
		// root later holds its own reference.
		const root = host.attachShadow({ mode: 'closed' });
		// Hosted on <html>, not <body>: SPA frameworks routinely wipe body children
		// during hydration, and our chrome should survive that.
		document.documentElement.appendChild(host);
		return { host, root };
	}

	function shadowStyle() {
		const s = document.createElement('style');
		s.textContent = `
:host{all:initial}
:host([${RF_PASSTHROUGH_ATTR}]),:host([${RF_PASSTHROUGH_ATTR}]) *{pointer-events:none !important}
*,*::before,*::after{box-sizing:border-box}
`;
		return s;
	}

	// --- Shared style strings (used inside shadow roots) ---
	function popoverStyles() {
		return `
*{margin:0;padding:0;box-sizing:border-box}
.rf-popover{width:${POPOVER_W}px;background:#fff;border:1px solid #d7dfe5;border-radius:12px;padding:16px;box-shadow:0 14px 45px rgba(23,32,45,0.18);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#18212b;pointer-events:auto}
.rf-drag-handle{display:flex;justify-content:center;align-items:center;height:8px;margin:-6px 0 8px;cursor:grab;border-radius:6px}
.rf-drag-handle::before{content:'';width:36px;height:4px;border-radius:2px;background:#d7dfe5}
.rf-drag-handle:hover::before{background:#b9c6cf}
.rf-dragging,.rf-dragging *{cursor:grabbing !important}
.rf-lost{opacity:0.55;transition:opacity 0.15s}
.rf-popover-ta{width:100%;min-height:60px;padding:8px 10px;border:1px solid #d7dfe5;border-radius:8px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;resize:vertical;background:#f7f9fa;color:#18212b}
.rf-popover-ta:focus{outline:2px solid #258a55;outline-offset:-1px}
.rf-btn{padding:6px 13px;border:1px solid #d7dfe5;border-radius:7px;cursor:pointer;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#18212b}
.rf-btn:hover{background:#f1f4f6}
.rf-btn-primary{background:#258a55;color:#fff;border-color:#258a55;font-weight:600}
.rf-btn-primary:hover{background:#1f7a4a}
.rf-btn-sm{padding:4px 9px;font-size:11px;background:transparent;color:#697783;border-color:#d7dfe5}
.rf-cat-btn{padding:4px 10px;border:1px solid #d7dfe5;border-radius:14px;cursor:pointer;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:transparent;color:#697783}
.rf-cat-btn.active{border-color:#35ae70;background:#dff7e9;color:#146331}
.rf-cat-bar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
.rf-actions{display:flex;gap:6px;margin-top:12px;justify-content:flex-end}
.rf-tab-row{display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid #e3e9ee;padding-bottom:0}
.rf-tab-btn{padding:6px 12px;cursor:pointer;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:transparent;color:#697783;border:none;border-bottom:2px solid transparent}
.rf-tab-btn.active{color:#166534;border-bottom-color:#28a465;font-weight:600}
.rf-styles-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.rf-styles-grid label{font-size:10px;color:#697783;display:block;margin-bottom:2px}
.rf-styles-grid input{width:100%;padding:4px 7px;border:1px solid #d7dfe5;border-radius:5px;font:11px monospace;background:#fff;color:#18212b;margin-bottom:4px}
.rf-styles-grid input:focus{outline:2px solid #258a55;outline-offset:-1px}
.rf-styles-grid input[type=range]{padding:0;accent-color:#258a55;height:16px}
.rf-zoom-row{display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:11px}
.rf-zoom-row button{padding:3px 8px;border:1px solid #d7dfe5;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;color:#18212b}
.rf-zoom-tag{font-family:monospace;font-size:10px;color:#697783;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rf-sel{margin-bottom:8px}
.rf-sel-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10px;color:#697783;margin-bottom:4px}
.rf-sel-list{max-height:120px;overflow-y:auto;border:1px solid #d7dfe5;border-radius:8px;background:#fff}
.rf-sel-row{display:flex;align-items:center;gap:2px;padding:3px 4px 3px 6px;border-bottom:1px solid #e9eef2}
.rf-sel-row:last-child{border-bottom:none}
.rf-sel-row:hover{background:#eefaf2}
.rf-sel-row.primary{background:#f1fbf5}
.rf-sel-row.missing{background:#fff5f5;color:#9b2c2c}
.rf-sel-status,.rf-primary-hint{font-size:10px;color:#697783;margin:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rf-sel-name{flex:1;min-width:0;font-family:monospace;font-size:10px;color:#18212b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rf-sel-act{border:none;background:0 0;color:#697783;cursor:pointer;font-size:11px;line-height:1;padding:2px 5px;border-radius:3px;flex-shrink:0}
.rf-sel-act:hover{background:#e3e9ee;color:#18212b}
.rf-title{font-weight:600;font-size:12px;color:#18212b;margin-bottom:2px}
.rf-sub{font-size:9px;color:#697783;margin-bottom:4px;font-family:monospace;word-break:break-all;max-height:40px;overflow:hidden}
.rf-source{font-size:10px;color:#2f855a;margin-bottom:4px;font-family:monospace;word-break:break-all}
.rf-quote{font-size:11px;color:#697783;margin-bottom:6px;font-style:italic}
.rf-dest-row{display:flex;gap:6px;align-items:center;margin-top:6px}
.rf-dest-btn{font-size:11px;flex-shrink:0}
.rf-dest-tag{font-family:monospace;font-size:10px;color:#2b6cb0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
	}

	function panelStyles() {
		return `
*{margin:0;padding:0;box-sizing:border-box}
.rf-panel{width:${PANEL_W}px;max-width:100vw;height:100dvh;background:#f7f9fa;color:#18212b;display:flex;flex-direction:column;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border-left:1px solid #d7dfe5;box-shadow:-14px 0 45px rgba(23,32,45,0.10);pointer-events:auto}
.rf-panel-header{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #e3e9ee;flex-shrink:0}
.rf-panel-header h2{margin:0;font-size:18px;font-weight:700;flex:1}
.rf-panel-toolbar{display:flex;gap:6px;padding:8px 16px;border-bottom:1px solid #e3e9ee;flex-shrink:0;flex-wrap:wrap}
.rf-panel-list{flex:1;overflow-y:auto;padding:10px 12px}
.rf-panel-footer{border-top:1px solid #e3e9ee;padding:10px 12px;flex-shrink:0}
.rf-card{background:#fff;border:1px solid #dce3e8;border-radius:12px;padding:12px;margin-bottom:8px;box-shadow:0 2px 8px rgba(23,32,45,0.05)}
.rf-card-title{font-size:12px;font-weight:600;color:#18212b}
.rf-card-cat{font-size:9px;padding:2px 7px;border-radius:10px;background:#dff7e9;color:#146331}
.rf-comment{font-size:12px;padding:6px 8px;background:#f1f4f6;border-radius:6px;border-left:3px solid #d7dfe5;margin-bottom:4px;word-break:break-word}
.rf-url{font-size:10px;color:#697783;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rf-btn{padding:6px 13px;border:1px solid #d7dfe5;border-radius:7px;cursor:pointer;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#18212b}
.rf-btn-icon{background:0 0;border:none;color:#697783;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:13px}
.rf-btn-del{font-size:15px}
.rf-empty{color:#697783;text-align:center;padding:32px 16px}
.rf-cat-btn{padding:4px 10px;border:1px solid #d7dfe5;border-radius:14px;cursor:pointer;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:transparent;color:#697783}
.rf-cat-btn.active{border-color:#35ae70;background:#dff7e9;color:#146331}
.rf-popover-ta{width:100%;min-height:44px;padding:8px 10px;border:1px solid #d7dfe5;border-radius:8px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;resize:vertical;background:#fff;color:#18212b}
`;
	}

	// --- Toast (shadow DOM) ---
	function showToast(msg) {
		const { host, root } = createShadowRoot();
		host.style.cssText = `all:initial;position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:${Z.overlay};pointer-events:none`;
		const el = document.createElement('div');
		el.style.cssText = 'padding:8px 16px;border-radius:8px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 18px rgba(23,32,45,0.25);background:#18212b;color:#fff';
		el.textContent = msg;
		root.appendChild(el);
		setTimeout(() => host.remove(), 2000);
	}

	// --- FAB (shadow DOM) ---
	function createFab() {
		if (fabEl) return;
		const { host, root } = createShadowRoot();
		// The host must not take hits itself: `all:initial` resets pointer-events to
		// auto, which would leave an invisible box parked in the corner.
		host.style.cssText = `all:initial;position:fixed;bottom:20px;right:20px;z-index:${Z.fab};pointer-events:none`;
		root.appendChild(shadowStyle());
		const s = document.createElement('style');
		// Hidden is the default state, and hidden means untouchable — opacity alone
		// still hit-tests, so a concealed FAB used to swallow clicks in that corner.
		s.textContent = `
.rf-fab{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;box-shadow:0 6px 16px rgba(23,32,45,0.25);font-family:sans-serif;user-select:none;border:none;transition:opacity 0.2s,transform 0.2s;color:#fff;background:#258a55;pointer-events:none;opacity:0;transform:translateX(60px)}
.rf-fab.rf-fab-on{pointer-events:auto;opacity:1;transform:translateX(0)}
`;
		root.appendChild(s);
		const btn = document.createElement('button');
		btn.className = 'rf-fab';
		btn.setAttribute('aria-label', 'Feedback');
		btn.textContent = '\u270f';
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (popoverEl) resetPopoverPosition();
			else if (panelEl && panelEl.style.display !== 'none') closePanel();
			else openPanel();
		});
		root.appendChild(btn);
		fabEl = { host, root, btn };
	}

	function revealFab() {
		if (!fabEl) createFab();
		clearTimeout(fabGraceTimer);
		fabEl.btn.classList.add('rf-fab-on');
	}

	addFeedbackListener('mousemove', (e) => {
		const point = topClientPoint(e);
		lastPointer.x = point.x;
		lastPointer.y = point.y;
	}, true);

	function concealFab() {
		if (fabEl) fabEl.btn.classList.remove('rf-fab-on');
	}

	// The chord reveals the FAB, but concealing it the instant the chord ends
	// leaves no window to actually click it — pass-through eats clicks while the
	// chord is down, and with nothing saved yet the button disappears on release.
	// A short grace period after release, extended while the pointer rests on the
	// button, keeps it reachable without parking clutter on the page permanently.
	const FAB_GRACE_MS = 1200;
	let fabGraceTimer = 0;
	let lastPointer = { x: -1, y: -1 };
	function scheduleConcealFab() {
		clearTimeout(fabGraceTimer);
		fabGraceTimer = setTimeout(() => {
			if (fabHovered()) { scheduleConcealFab(); return; }
			if (popoverEl || pickMode || (panelEl && panelEl.style.display !== 'none')) return;
			concealFab();
		}, FAB_GRACE_MS);
	}
	function fabHovered() {
		if (!fabEl) return false;
		const b = fabEl.btn.getBoundingClientRect();
		return lastPointer.x >= b.left && lastPointer.x <= b.right && lastPointer.y >= b.top && lastPointer.y <= b.bottom;
	}

	// While a chord is held or a pick mode is running, every click is meant for the
	// page underneath. Our own chrome — FAB, panel, popover, banners — should never
	// swallow one just by covering its target, so for the duration it stops being a
	// hit-test candidate and the element beneath receives the click. The host alone
	// isn't enough: interactive parts set pointer-events:auto on themselves, which
	// beats an inherited none, hence the !important rule in shadowStyle().
	function syncChromeClickThrough() {
		const on = chordWasActive || !!pickMode;
		for (const host of document.querySelectorAll('[' + RF_CHROME_ATTR + ']')) {
			host.toggleAttribute(RF_PASSTHROUGH_ATTR, on);
		}
	}

	function hasAnnotations() {
		const origin = location.origin;
		return annotations.some(a => { try { return new URL(a.url).origin === origin; } catch { return false; } });
	}

	// --- Popover positioning ---
	// Popovers are placed by transform:translate3d, never top/left — transforms
	// don't invalidate layout, so repositioning costs nothing and dragging is a
	// pure transform update.
	function applyPopoverPosition(host, top, left) {
		host.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
	}

	// Measure the live popover height (closed roots aren't reachable off the host,
	// so measure through the retained popover root).
	function measurePopover() {
		return popoverRoot?.querySelector('.rf-popover')?.offsetHeight || 480;
	}

	// Place the popover for `targetRect`: honor the user's dragged offset when one
	// is set (clamped to the viewport), otherwise the automatic placement.
	function placePopoverAt(host, targetRect, popoverH) {
		if (popoverOffset) {
			const h = popoverH || measurePopover();
			applyPopoverPosition(host,
				clamp(popoverOffset.y, 8, Math.max(8, innerHeight - h - 8)),
				clamp(popoverOffset.x, 8, Math.max(8, innerWidth - POPOVER_W - 8)));
			return;
		}
		const pos = placePopover(targetRect, POPOVER_W, popoverH);
		applyPopoverPosition(host, pos.top, pos.left);
	}

	// A dragged position can outlive the layout and display it was created for.
	// Resetting it keeps the draft intact and returns the popover to the live target.
	function resetPopoverPosition() {
		popoverOffset = null;
		savePopoverOffset();
		if (popoverEl) {
			const el = anchor?.getTarget?.();
			const rect = el?.isConnected ? getViewportRect(el) : centeredFallbackRect();
			placePopoverAt(popoverEl, rect, measurePopover());
			anchor?.wake?.();
		}
		showToast('Popover returned to its target');
	}

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

	// Rect used when the anchor target is gone (e.g. the page re-rendered under
	// a dragged popover): horizontally centered with placePopover's 8px edge
	// pad, near the top of the viewport. Keep edge policy in one place.
	function centeredFallbackRect() {
		const pad = 8;
		return { top: 80, bottom: 80, left: Math.max(pad, (innerWidth - POPOVER_W) / 2), right: Math.max(pad, (innerWidth + POPOVER_W) / 2) };
	}

	// The popover and outline are position:fixed, so a scroll or layout shift slides
	// them off their target. Re-project both against the live rect once per frame
	// while the popover is open. When nothing changes for 20 consecutive frames
	// (~1/3s) the loop suspends itself; scroll/resize/marker churn wake it again.
	// A static popover therefore costs ~zero frames instead of a per-frame rect read.
	function startAnchor(host, getTarget) {
		stopAnchor();
		anchor = { host, getTarget, raf: 0, last: '', idleFrames: 0, scrollDocuments: new Set() };
		const tick = () => {
			if (!anchor) return;
			let changed = false;
			const el = anchor.getTarget();
			if (el && el.isConnected) {
				const r = getViewportRect(el);
				const key = r.top + ':' + r.left + ':' + r.width + ':' + r.height + ':' + innerWidth + ':' + innerHeight;
				if (key !== anchor.last) {
					anchor.last = key;
					changed = true;
					placePopoverAt(anchor.host, r, measurePopover());
					if (outlineEl) positionOutline(el);
				}
			}
			// Members can move independently of the primary, so they get their own
			// pass rather than riding on the primary's rect-change guard.
			if (selMarkers.length) { positionSelectionMarkers(); changed = true; }
			// Wake on any scroll or resize — cheap to check, and it covers the common
			// "the page moved under us" cases without an observer mesh.
			if (scrollX !== anchor.lastScrollX || scrollY !== anchor.lastScrollY || innerWidth !== anchor.lastW || innerHeight !== anchor.lastH) {
				anchor.lastScrollX = scrollX; anchor.lastScrollY = scrollY;
				anchor.lastW = innerWidth; anchor.lastH = innerHeight;
				changed = true;
			}
			anchor.idleFrames = changed ? 0 : (anchor.idleFrames || 0) + 1;
			if (anchor.idleFrames < 20) {
				anchor.raf = requestAnimationFrame(tick);
			} else {
				anchor.raf = 0; // suspended
			}
		};
		anchor.wake = () => {
			if (!anchor || anchor.raf) return;
			anchor.idleFrames = 0;
			anchor.raf = requestAnimationFrame(tick);
		};
		addEventListener('scroll', anchor.wake, { capture: true, passive: true });
		for (const doc of feedbackEventDocuments) {
			if (doc === document) continue;
			doc.addEventListener('scroll', anchor.wake, { capture: true, passive: true });
			anchor.scrollDocuments.add(doc);
		}
		resizeWaiters.add(anchor.wake);
		anchor.lastScrollX = scrollX; anchor.lastScrollY = scrollY;
		anchor.lastW = innerWidth; anchor.lastH = innerHeight;
		anchor.raf = requestAnimationFrame(tick);
	}

	function stopAnchor() {
		if (!anchor) return;
		cancelAnimationFrame(anchor.raf);
		removeEventListener('scroll', anchor.wake, { capture: true });
		for (const doc of anchor.scrollDocuments) doc.removeEventListener('scroll', anchor.wake, { capture: true });
		resizeWaiters.delete(anchor.wake);
		anchor = null;
	}

	function clamp(v, min, max) { return Math.min(max, Math.max(v, min)); }

	// --- Show popover (shadow DOM, tabbed comment-first) ---
	function showPopover(el, data, initial) {
		hidePopover();
		// Pin the record being edited by identity so a panel delete that shifts
		// array indices mid-edit cannot redirect Submit onto another annotation.
		if (initial && Number.isInteger(initial.editIndex) && !initial.editRef && annotations[initial.editIndex]) {
			initial.editRef = annotations[initial.editIndex];
		}
		const { host, root } = createShadowRoot();
		// top:0;left:0 is load-bearing: the host is parked after <body>, so its
		// static position sits at the end of document flow. Without an explicit
		// origin, every translate3d placement is displaced downward by the whole
		// page height and the popover renders off-screen on all but short pages.
		host.style.cssText = `all:initial;position:fixed;top:0;left:0;z-index:${Z.surface};pointer-events:none`;
		root.appendChild(shadowStyle());
		const ps = document.createElement('style');
		ps.textContent = popoverStyles();
		root.appendChild(ps);

		const popover = document.createElement('div');
		popover.className = 'rf-popover';

		// Drag handle. The whole strip is the grip; the drag threshold inside
		// beginPopoverDrag distinguishes drags from clicks on it.
		const dragHandle = document.createElement('div');
		dragHandle.className = 'rf-drag-handle';
		dragHandle.title = 'Drag to move. Alt+Shift+R resets the position.';
		dragHandle.addEventListener('pointerdown', (e) => {
			e.stopPropagation();
			host.style.userSelect = 'none';
			document.documentElement.classList.add('rf-dragging');
			beginPopoverDrag(e, host);
		});
		dragHandle.addEventListener('click', (e) => e.stopPropagation());
		popover.appendChild(dragHandle);

		const adjustedStyles = { ...(initial?.adjustedStyles || {}) };
		let activeTab = 'comment';
		let zoomTarget = el;
		// curData tracks whichever element the popover currently describes, so the
		// header, the style defaults and the saved annotation never disagree.
		let curData = data;
		// The live selection. members[0] is the primary — the element the header, the
		// zoom row and the annotation record describe; the rest ride along as group
		// members. Holding live nodes (not frozen refs) is what makes the list
		// editable: rows can be dropped, promoted or added while the popover is open.
		let members = (initial?.members?.length ? initial.members : [el]).filter(m => m?.isConnected);
		let missingMembers = [...(initial?.missingMembers || [])];
		let similarAdded = [];
		if (!members.includes(el)) members.unshift(el);
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
			titleEl.textContent = members.length > 1
				? targetLabel({ ...curData, comment: '' }) + ' +' + (members.length - 1)
				: targetLabel({ ...curData, comment: '' });
			if (curData.source?.ref) {
				sourceEl.style.display = 'block';
				const trail = componentTrail(curData.source, true);
				sourceEl.textContent = '◈ ' + (trail || curData.source.ref) + (curData.source.viaAncestor ? ' (ancestor)' : '');
				sourceEl.title = curData.source.ref + (trail ? ' | ' + trail : '');
			} else if (curData.source?.status === 'svelte-production-build') {
				sourceEl.style.display = 'block';
				sourceEl.textContent = '◈ Svelte production build · source mapping unavailable';
				sourceEl.title = 'Run the page in Svelte development mode to expose component source locations';
			} else {
				sourceEl.style.display = 'none';
				sourceEl.title = '';
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

		// Selection list \u2014 built below, populated by renderMembers().
		const selBox = document.createElement('div');
		selBox.className = 'rf-sel';
		const selHead = document.createElement('div');
		selHead.className = 'rf-sel-head';
		const selCount = document.createElement('span');
		const similarBtn = document.createElement('button');
		similarBtn.className = 'rf-btn rf-btn-sm';
		similarBtn.textContent = '⧉ Select similar';
		const addBtn = document.createElement('button');
		addBtn.className = 'rf-btn rf-btn-sm';
		addBtn.textContent = '+ Add element';
		selHead.appendChild(selCount);
		selHead.appendChild(similarBtn);
		selHead.appendChild(addBtn);
		const selList = document.createElement('div');
		selList.className = 'rf-sel-list';
		selBox.appendChild(selHead);
		selBox.appendChild(selList);
		popover.appendChild(selBox);

		// Zoom row \u2014 walk the tree to retarget. Ambiguous for a group, so hidden there.
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

		function repositionTo(target) {
			const r = getViewportRect(target);
			placePopoverAt(host, r, popover.offsetHeight || 480);
		}

		// Everything that has to agree with the current selection: the page markers,
		// which elements live style edits drive, and the list itself. Re-applying the
		// pending edits after retargeting is what carries a tweak onto a newly added
		// member and lifts it off one that was just removed.
		function syncSelection() {
			members = members.filter(m => m?.isConnected);
			if (!members.length) { setLostState(); return; }
			// Reviving from a lost state must undo everything setLostState changed.
			popover.classList.remove('rf-lost');
			submitBtn.title = '';
			renderHeader();
			setSelectionMarkers(members.slice(1), 1);
			setStyleTargets(members);
			for (const k in adjustedStyles) applyStyle(k, adjustedStyles[k], adjustedStyles);
			renderMembers();
		}

		// Every selected element left the DOM (SPA swap, re-render). Keep the draft
		// visible and submit-able: curData still contains the captured target details,
		// and a chord-add can revive the popover.
		function setLostState() {
			setSelectionMarkers([]);
			setStyleTargets([]);
			popover.classList.add('rf-lost');
			titleEl.textContent = 'Element no longer on page';
			sourceEl.style.display = 'none';
			selEl.textContent = curData.selector || '';
			quoteEl.style.display = 'none';
			selList.innerHTML = '';
			selList.style.display = 'none';
			zoomRow.style.display = 'none';
			submitBtn.title = 'The selected element is gone — captured details will be saved';
		}

		function setPrimary(next) {
			if (!next) return;
			zoomTarget = next;
			curData = capturableEl(next).data;
			zoomTag.textContent = compactLabel(next);
			syncSelection();
			refreshStyleInputs();
			showOutline(next);
			repositionTo(next);
		}

		function renderMembers() {
			const total = members.length + missingMembers.length;
			selCount.textContent = 'Selection — ' + total + (total === 1 ? ' element' : ' elements');
			selList.innerHTML = '';
			// A one-row list is pure noise; the header already names that element.
			selList.style.display = total > 1 ? 'block' : 'none';
			zoomRow.style.display = total > 1 ? 'none' : 'flex';
			if (missingMembers.length) {
				const status = document.createElement('div');
				status.className = 'rf-sel-status';
				status.textContent = members.length + ' of ' + total + ' elements still found';
				selList.appendChild(status);
			}
			if (members.length > 1 || missingMembers.length) {
				const labels = members.map(compactLabel);
				members.forEach((m, i) => {
					const row = document.createElement('div');
					row.className = 'rf-sel-row' + (i === 0 ? ' primary' : '');
					const name = document.createElement('span');
					name.className = 'rf-sel-name';
					const label = labels[i];
					name.textContent = (i === 0 ? '● ' : '○ ') + label + (labels.filter(l => l === label).length > 1 ? ' (' + positionalLabel(m) + ')' : '');
					name.title = describeElement(m);
					row.appendChild(name);
					if (i > 0) {
						const star = document.createElement('button');
						star.className = 'rf-sel-act';
						star.textContent = '★';
						star.title = 'Make primary';
						star.addEventListener('click', () => {
							members.splice(i, 1);
							members.unshift(m);
							setPrimary(m);
						});
						row.appendChild(star);
					}
					const del = document.createElement('button');
					del.className = 'rf-sel-act';
					del.textContent = '×';
					del.title = 'Remove from selection';
					del.addEventListener('click', () => {
						members.splice(i, 1);
						if (i === 0) setPrimary(members[0]);
						else syncSelection();
					});
					row.appendChild(del);
					row.addEventListener('mouseenter', () => showOutline(m, i === 0 ? 'target' : 'member'));
					row.addEventListener('mouseleave', () => showOutline(members[0]));
					selList.appendChild(row);
				});
				missingMembers.forEach((ref, i) => {
					const row = document.createElement('div');
					row.className = 'rf-sel-row missing';
					const name = document.createElement('span');
					name.className = 'rf-sel-name';
					name.textContent = '○ ' + compactRefLabel(ref) + ' (not found)';
					name.title = ref.selector || 'Could not resolve selector';
					const del = document.createElement('button');
					del.className = 'rf-sel-act';
					del.textContent = '×';
					del.title = 'Drop unresolvable member';
					del.addEventListener('click', () => { missingMembers.splice(i, 1); renderMembers(); });
					row.appendChild(name);
					row.appendChild(del);
					selList.appendChild(row);
				});
			}
			renderHeader();
		}

		// Direct siblings are predictable repeated peers and avoid sweeping unrelated page content.
		// When the primary carries its own Svelte dev metadata, siblings rendered by
		// the same component file are a stronger signal than tag+class — but only
		// elements with their OWN metadata count (inherited/viaAncestor would sweep
		// in shared wrappers), and we fall back to the class signature otherwise.
		function directSvelteFile(el) {
			const meta = readSvelteMeta(el);
			return meta ? meta.loc.file : null;
		}

		function selectSimilar() {
			if (similarAdded.length) {
				// The user may have promoted one of the added siblings to primary, in
				// which case undo drops it and the popover has to re-seat onto a member
				// that is still selected — otherwise the saved annotation would describe
				// an element the user just removed.
				const droppedPrimary = similarAdded.includes(members[0]);
				members = members.filter(member => !similarAdded.includes(member));
				similarAdded = [];
				similarBtn.textContent = '⧉ Select similar';
				if (droppedPrimary) setPrimary(members[0]);
				else syncSelection();
				showToast('Similar selection undone');
				return;
			}
			const directFile = directSvelteFile(zoomTarget);
			let allMatches;
			if (directFile) {
				allMatches = [...(zoomTarget.parentElement?.children || [])].filter(candidate => {
					if (candidate === zoomTarget) return false;
					const f = directSvelteFile(candidate);
					return f && f === directFile;
				});
			} else {
				const signature = filterClasses(classNameOf(zoomTarget)).sort().join(' ');
				allMatches = [...(zoomTarget.parentElement?.children || [])].filter(candidate => {
					return candidate.tagName === zoomTarget.tagName && filterClasses(classNameOf(candidate)).sort().join(' ') === signature;
				}).filter(candidate => !members.includes(candidate));
			}
			const matches = allMatches.slice(0, SIMILAR_MAX);
			if (!matches.length) { showToast('No similar siblings found'); return; }
			similarAdded = matches;
			members.push(...matches);
			similarBtn.textContent = 'Undo similar selection';
			syncSelection();
			showToast('Added ' + matches.length + ' similar element' + (matches.length === 1 ? '' : 's') + (directFile ? ' by component' : '') + (allMatches.length > SIMILAR_MAX ? ' (capped at ' + SIMILAR_MAX + ')' : ''));
		}

		similarBtn.addEventListener('click', selectSimilar);

		addBtn.addEventListener('click', () => {
			revertStyles();
			enterPick('member', zoomTarget, curData, currentDraft());
		});

		// Retargeting resets style edits: they belong to the element they were made
		// against, so we put that one back before moving on.
		function setZoomTarget(next) {
			if (!next || next === zoomTarget) return;
			revertStyles();
			for (const k in adjustedStyles) delete adjustedStyles[k];
			members[0] = next;
			setPrimary(next);
		}

		upBtn.addEventListener('click', () => {
			const p = zoomTarget.parentElement;
			const ownerDoc = zoomTarget.ownerDocument || document;
			if (p && p !== ownerDoc.body && p !== ownerDoc.documentElement) setZoomTarget(p);
		});
		downBtn.addEventListener('click', () => setZoomTarget(zoomTarget.firstElementChild));
		prevBtn.addEventListener('click', () => setZoomTarget(zoomTarget.previousElementSibling));
		nextBtn.addEventListener('click', () => setZoomTarget(zoomTarget.nextElementSibling));
		zoomRow.appendChild(upBtn);
		zoomRow.appendChild(downBtn);
		zoomRow.appendChild(prevBtn);
		zoomRow.appendChild(nextBtn);
		zoomRow.appendChild(zoomTag);
		popover.appendChild(zoomRow);
		const primaryHint = document.createElement('div');
		primaryHint.className = 'rf-primary-hint';
		primaryHint.textContent = '● Primary controls styles, zoom, destination, and exported Where';
		popover.appendChild(primaryHint);

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
		// A reflex Escape must not nuke real work, but a pristine draft closes
		// normally — established single-Esc-dismiss flows (and suites) rely on
		// it. Dirty = typed comment, style tweaks, destination, or category.
		const openComment = initial?.comment || '';
		const openCategory = initial?.category || activeCategory;
		popoverDraftGuard = () => ta.value !== openComment
			|| Object.keys(adjustedStyles).length > 0
			|| !!destData
			|| selCat !== openCategory;

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
		// Everything the popover would lose by closing for a pick mode. Reopening
		// against the zoomed element means retargeting isn't lost either.
		function currentDraft() {
			return {
				comment: ta.value,
				category: selCat,
				adjustedStyles: { ...adjustedStyles },
				styleRestore: pendingStyleRestore(),
				destination: destData,
				members: [...members],
				missingMembers: [...missingMembers],
				editIndex: initial?.editIndex,
				editRef: initial?.editRef || null,
			};
		}

		destBtn.addEventListener('click', () => {
			revertStyles();
			enterPick('destination', zoomTarget, curData, currentDraft());
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
			setStyleTargets(styleTargets);
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
		// The non-primary members, frozen into the shape the export and storage use.
		function memberRefs() {
			const refs = members.slice(1).map(captureMemberRef).concat(missingMembers);
			return refs.length ? refs : null;
		}

		// Restore points for the tweaks about to be committed, keyed by selector so
		// the panel's Revert button can put the page back after Submit. Only
		// elements we actually touched are captured; members that never resolve
		// again simply can't be reverted.
		function pendingStyleRestore() {
			if (!styleSnapshot || !Object.keys(adjustedStyles).length) return null;
			const restore = [];
			for (const el of styleTargets) {
				if (!styleSnapshot.has(el)) continue;
				const selector = describeElement(el);
				if (!selector) continue;
				restore.push({ selector, framePath: framePathFor(el), style: styleSnapshot.get(el) });
			}
			return restore.length ? {
				primary: curData.selector,
				primaryFramePath: curData.framePath || framePathFor(members[0]),
				targets: restore,
			} : null;
		}

		// One shape-builder for Submit and Cut — the two paths construct the same
		// annotation record and must never drift apart.
		function buildAnnotationData(comment) {
			return {
				...curData,
				comment,
				category: selCat,
				adjustedStyles: Object.keys(adjustedStyles).length ? { ...adjustedStyles } : null,
				styleRestore: pendingStyleRestore(),
				destination: destData,
				targets: memberRefs(),
			};
		}

		function submit() {
			let comment = ta.value.trim();
			if (Object.keys(adjustedStyles).length) {
				comment = comment ? comment + '\n\n' + Object.entries(adjustedStyles).map(([k, v]) => k + ': ' + v + ';').join('\n')
					: Object.entries(adjustedStyles).map(([k, v]) => k + ': ' + v + ';').join('\n');
			}
			if (!comment) { showToast('Please enter a comment or adjust a style'); return; }
			const annotationData = buildAnnotationData(comment);
			persist(() => {
				// Replace by identity, not raw index: the panel can delete other
				// rows while this popover is open, shifting indices. If the
				// original record is gone, append instead of overwriting a
				// stranger that slid into its slot.
				const ref = initial?.editRef;
				const at = ref ? annotations.indexOf(ref) : -1;
				if (at >= 0) annotations[at] = makeAnnotation(annotationData);
				else if (Number.isInteger(initial?.editIndex) && !ref && annotations[initial.editIndex]) annotations[initial.editIndex] = makeAnnotation(annotationData);
				else annotations.push(makeAnnotation(annotationData));
			});
			keepStyles();
			hidePopover();
			showToast('Saved');
		}

		const actions = document.createElement('div');
		actions.className = 'rf-actions';
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'rf-btn';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', cancelPopover);
		const cutBtn = document.createElement('button');
		cutBtn.className = 'rf-btn';
		cutBtn.textContent = 'Cut';
		cutBtn.addEventListener('click', () => {
			const ann = makeAnnotation(buildAnnotationData(ta.value.trim() || '(no comment)'));
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

		host.style.position = 'fixed';
		placePopoverAt(host, getViewportRect(el), popover.offsetHeight || 480);

		popoverEl = host;
		popoverRoot = root;
		// Lets a chord gesture grow this selection instead of replacing the popover.
		popoverApi = {
			addMembers(els) {
				const fresh = els.filter(m => m?.isConnected && !members.includes(m));
				if (!fresh.length) { showToast('Already in the selection'); return; }
				members.push(...fresh);
				syncSelection();
				showToast('Added ' + fresh.length + ' element' + (fresh.length === 1 ? '' : 's'));
			}
		};
		// Draws the markers, points live styles at the whole selection and re-applies
		// any edits carried back from a pick mode.
		syncSelection();
		startAnchor(host, () => zoomTarget);
		// SPA re-renders can remove every selected element mid-draft. The anchor loop
		// suspends when idle, so it can't be relied on to notice; a MutationObserver
		// stays silent until the page actually mutates, then runs one cheap
		// connectivity check. Revival is just syncSelection() re-running.
		const onDomChange = () => {
			if (members.some(m => m.isConnected)) {
				if (popover.classList.contains('rf-lost')) syncSelection();
				return;
			}
			if (!popover.classList.contains('rf-lost')) setLostState();
		};
		const watchedDocuments = new Set(members.map(member => member.ownerDocument));
		watchedDocuments.add(document);
		for (const ownerDoc of watchedDocuments) {
			if (ownerDoc?.documentElement) {
				const watcher = new MutationObserver(onDomChange);
				watcher.observe(ownerDoc.documentElement, { childList: true, subtree: true });
				domWatchers.push(watcher);
			}
		}
		ta.focus();
	}

	// A group is just the multi-member case of an annotation, so it reuses the same
	// popover — which gets it styles, destination and Cut for free.
	function showGroupPopover(targets) {
		if (!targets || targets.length < 2) return;
		showPopover(targets[0], capturableEl(targets[0]).data, { members: [...targets] });
	}

	// A selected element, frozen into the shape exports and storage read.
	function captureMemberRef(el) {
		const styles = getComputedStyles(el);
		return {
			selector: describeElement(el),
			framePath: framePathFor(el),
			tag: el.tagName.toLowerCase(),
			text: getTextSnippet(el),
			a11y: getA11y(el),
			rect: getBoundingRect(el),
			source: getSourceLoc(el),
			looks: getLooks(styles),
		};
	}

	// Live style edits mutate the page. The restore point is the element's whole
	// inline `style` attribute captured before the first touch — restoring one raw
	// string is atomic and complete, even for properties other code changed in
	// the meantime (a per-property diff would miss those).
	function applyStyle(prop, val, adjustedStyles) {
		if (!val) delete adjustedStyles[prop];
		else adjustedStyles[prop] = val;
		for (const el of styleTargets) {
			if (styleSnapshot && !styleSnapshot.has(el)) styleSnapshot.set(el, el.getAttribute('style'));
			if (!val) el.style.removeProperty(prop);
			else el.style.setProperty(prop, val);
		}
	}

	// Point live editing at a new set of elements, putting the previous set back
	// first. Callers re-apply the pending edits afterwards if they still want them.
	function setStyleTargets(els) {
		revertStyles();
		styleTargets = els.slice();
		styleSnapshot = new Map();
	}

	function revertStyles() {
		if (!styleSnapshot) return;
		for (const [el, style] of styleSnapshot) {
			if (!el.isConnected) continue;
			if (style === null) el.removeAttribute('style');
			else el.setAttribute('style', style);
		}
		styleSnapshot = null;
	}

	// Keep the live edits on the page (used when the annotation is saved), so the
	// user can keep looking at what they just described.
	function keepStyles() {
		styleSnapshot = null;
		styleTargets = [];
	}

	// Post-submit undo: put every element a saved annotation tweaked back to its
	// pre-tweak inline style. Restore points are selector-keyed because the page
	// outlives the popover's live references; elements that no longer resolve are
	// reported so the card can say how much was actually undone.
	function revertSavedTweaks(a) {
		if (!a?.styleRestore) return 0;
		let reverted = 0;
		for (const t of a.styleRestore.targets) {
			const el = resolveStoredMember(t);
			if (!el) continue;
			if (t.style === null) el.removeAttribute('style');
			else el.setAttribute('style', t.style);
			reverted++;
		}
		if (reverted) showToast('Tweaks reverted on ' + reverted + ' element' + (reverted === 1 ? '' : 's'));
		else showToast('No tweaked elements found on this page');
		return reverted;
	}

	function hidePopover() {
		if (drag) {
			removeEventListener('pointermove', drag.move);
			removeEventListener('pointerup', drag.up);
			for (const doc of drag.documents) {
				doc.removeEventListener('pointermove', drag.move);
				doc.removeEventListener('pointerup', drag.up);
			}
			drag = null;
		}
		for (const w of domWatchers) w.disconnect();
		domWatchers = [];
		// A deliberately dragged position survives across popovers — that's the
		// point of remembering it. Only an explicit Cancel/Esc resets it
		// (see cancelPopover).
		revertStyles();
		popoverApi = null;
		popoverDraftGuard = null;
		if (popoverEl) { popoverEl.remove(); popoverEl = null; popoverRoot = null; }
		styleTargets = [];
		styleSnapshot = null;
		hideOutline();
		clearSelectionMarkers();
		stopAnchor();
	}

	// Cancel/Esc: discard the draft AND the dragged position — an explicit
	// "put everything back where it was" gesture.
	function cancelPopover() {
		if (popoverOffset) { popoverOffset = null; savePopoverOffset(); }
		hidePopover();
	}

	// --- Popover dragging ---
	// The header is the grab handle. A pointer drag moves the popover by updating
	// its transform; the offset persists across popovers and reloads (per origin)
	// until Cancel/Esc resets it. Sub-4px movements are clicks, not drags.
	function beginPopoverDrag(e, host) {
		if (e.button != null && e.button !== 0) return;
		const startClient = topClientPoint(e);
		let base = popoverOffset || currentAutoPosition(host);
		let moved = false;
		const move = (ev) => {
			const point = topClientPoint(ev);
			const dx = point.x - startClient.x;
			const dy = point.y - startClient.y;
			if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
			moved = true;
			popoverOffset = {
				x: clamp(base.x + dx, 8, Math.max(8, innerWidth - POPOVER_W - 8)),
				y: clamp(base.y + dy, 8, Math.max(8, innerHeight - measurePopover() - 8)),
			};
			applyPopoverPosition(host, popoverOffset.y, popoverOffset.x);
		};
		const up = () => {
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', up);
			for (const doc of drag.documents) {
				doc.removeEventListener('pointermove', move);
				doc.removeEventListener('pointerup', up);
			}
			drag = null;
			host.style.userSelect = '';
			document.documentElement.classList.remove('rf-dragging');
			anchor?.wake?.();
			if (moved) savePopoverOffset();
		};
		const documents = new Set([...feedbackEventDocuments].filter(doc => doc !== document));
		drag = { move, up, documents };
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
		for (const doc of documents) {
			doc.addEventListener('pointermove', move);
			doc.addEventListener('pointerup', up);
		}
	}

	// Where the automatic placement would put the popover right now — the drag
	// baseline for the first drag before any offset exists.
	function currentAutoPosition(host) {
		const el = anchor?.getTarget?.() || null;
		const r = el?.isConnected ? getViewportRect(el) : { bottom: 80, left: Math.max(8, (innerWidth - POPOVER_W) / 2), top: 80 };
		const pos = placePopover(r, POPOVER_W, measurePopover());
		return { x: pos.left, y: pos.top };
	}

	// --- Panel (shadow DOM) ---
	// Data updates rebuild only the card list — the panel chrome persists, so
	// scroll position and in-flight inline comment edits survive every save,
	// delete and clear instead of being blown away by an innerHTML wipe.
	function renderPanel() {
		ensurePanelShell();
		renderPanelList();
	}

	function ensurePanelShell() {
		if (panelRoot && panelListEl) return;
		const { host, root } = createShadowRoot();
		host.style.cssText = `all:initial;position:fixed;top:0;right:0;z-index:${Z.surface}`;
		panelEl = host;
		panelRoot = root;
		root.appendChild(shadowStyle());
		const ps = document.createElement('style');
		ps.textContent = panelStyles();
		root.appendChild(ps);

		const panel = document.createElement('div');
		panel.className = 'rf-panel';

		const header = document.createElement('div');
		header.className = 'rf-panel-header';
		const h2 = document.createElement('h2');
		h2.textContent = 'Rapid Feedback';
		const count = document.createElement('span');
		count.style.cssText = 'font-size:11px;color:#697783;font-weight:500';
		panelCountEl = count;
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
		// Two-step in-panel confirm: one misclick shouldn't wipe everything, and
		// native dialogs can't be trusted on pages that override window.confirm.
		const clearBtn = toolbarBtn('Clear', () => {
			if (!annotations.length) return;
			if (clearBtn.dataset.armed) {
				delete clearBtn.dataset.armed;
				clearBtn.textContent = 'Clear';
				persist(() => { annotations = []; });
				showToast('Cleared');
				return;
			}
			clearBtn.dataset.armed = '1';
			clearBtn.textContent = 'Really clear?';
			setTimeout(() => { if (clearBtn.dataset.armed) { delete clearBtn.dataset.armed; clearBtn.textContent = 'Clear'; } }, 2500);
		});
		toolbar.appendChild(clearBtn);

		const list = document.createElement('div');
		list.className = 'rf-panel-list';
		panelListEl = list;

		// Comment-only editing, in place in the card. Used when the annotation's own
		// element is out of reach: a different page, or gone from this one.
		function toggleInlineComment(listEl, idx, a, editBtn) {
			const card = listEl.querySelector('.rf-card[data-idx="' + idx + '"]');
			const cel = card?.querySelector('.rf-comment');
			if (!cel) return;
			if (cel.getAttribute('contenteditable') === 'true') {
				persist(() => { a.comment = cel.textContent.trim(); });
				showToast('Comment saved');
				return;
			}
			cel.setAttribute('contenteditable', 'true');
			cel.style.background = '#fff';
			cel.style.borderLeftColor = '#258a55';
			editBtn.textContent = '✓';
			cel.focus();
		}

		// Edit/delete delegation
		list.addEventListener('click', (e) => {
			const editBtn = e.target.closest('.rf-btn-icon.rf-btn-del') ? null : e.target.closest('.rf-btn-icon:not(.rf-btn-revert)');
			const delBtn = e.target.closest('.rf-btn-del');
			const btn = editBtn || delBtn;
			if (!btn || !list.contains(btn)) return;
			const idx = parseInt(btn.getAttribute('data-idx'), 10);
			const a = annotations[idx];
			if (!a) return;
			if (delBtn) {
				persist(() => { annotations.splice(idx, 1); });
				showToast('Deleted');
				return;
			}
			// Reopening the popover only makes sense on the page the annotation was
			// taken on — the same selector can match an unrelated element elsewhere,
			// which would silently retarget the annotation. Anywhere else, or when the
			// element has gone, fall back to editing the comment in place so a comment
			// is always editable.
			const primary = a.url === location.href ? resolveStoredMember(a) : null;
			if (!primary) { toggleInlineComment(list, idx, a, btn); return; }
			const refs = a.targets || [];
			const found = refs.map(resolveStoredMember);
			showPopover(primary, capturableEl(primary).data, {
				comment: a.comment,
				category: a.category,
				adjustedStyles: a.adjustedStyles,
				destination: a.destination,
				members: [primary, ...found.filter(Boolean)],
				missingMembers: refs.filter((ref, i) => !found[i]),
				editIndex: idx,
			});
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
		const sendQuick = () => {
			const t = genTa.value.trim();
			if (!t) return;
			persist(() => { annotations.push(makeAnnotation({ comment: t, category: activeCategory })); });
			genTa.value = '';
			showToast('Saved');
		};
		genBtn.addEventListener('click', sendQuick);
		genTa.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (IS_SAVE_KEY(e)) { e.preventDefault(); sendQuick(); }
		});
		footer.appendChild(ftCatBar);
		footer.appendChild(genTa);
		footer.appendChild(genBtn);

		panel.appendChild(header);
		panel.appendChild(toolbar);
		panel.appendChild(list);
		panel.appendChild(footer);
		root.appendChild(panel);
	}

	// Rebuilds only the annotation cards. The panel chrome (header, toolbar,
	// footer) persists, so list scroll position and any in-flight inline comment
	// edit survive every data change.
	function renderPanelList() {
		if (!panelListEl) return;
		const list = panelListEl;
		list.scrollTop = 0;
		list.innerHTML = '';
		panelCountEl && (panelCountEl.textContent = String(annotations.length));
		if (!annotations.length) {
			const empty = document.createElement('div');
			empty.className = 'rf-empty';
			empty.textContent = 'No annotations yet. ' + CHORD_HINT + ' any element.';
			list.appendChild(empty);
			return;
		}
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
			if (a.targets?.length) {
				const g = document.createElement('span');
				g.className = 'rf-card-cat';
				g.textContent = '⧉ ' + (a.targets.length + 1);
				g.title = a.targets.map(t => compactRefLabel(t)).join(', ');
				titleRow.appendChild(g);
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
				entries.style.cssText = 'font-size:10px;color:#697783;margin-top:4px;font-family:monospace';
				entries.textContent = Object.entries(a.adjustedStyles).map(([k, v]) => k + ': ' + v).join('; ');
				left.appendChild(entries);
			}
			const urlEl = document.createElement('div');
			urlEl.className = 'rf-url';
			urlEl.textContent = a.url;
			left.appendChild(urlEl);
			const right = document.createElement('div');
			right.style.cssText = 'display:flex;gap:4px;flex-shrink:0';
			// Post-submit undo: only when this annotation carries a restore point
			// and at least one tweaked element still resolves here.
			const restoreRefs = a.styleRestore && [
				{ selector: a.styleRestore.primary, framePath: a.styleRestore.primaryFramePath },
				...(Array.isArray(a.styleRestore.targets) ? a.styleRestore.targets : []),
			];
			if (restoreRefs?.some(resolveStoredMember)) {
				const revBtn = document.createElement('button');
				revBtn.className = 'rf-btn-icon rf-btn-revert';
				revBtn.textContent = '⎌';
				revBtn.title = 'Revert style tweaks to their originals';
				revBtn.addEventListener('click', () => revertSavedTweaks(a));
				right.appendChild(revBtn);
			}
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

	function openPanel() {
		ensurePanelShell();
		panelEl.style.display = 'block';
		renderPanelList();
	}

	function closePanel() {
		if (panelEl) panelEl.style.display = 'none';
	}

	// --- Chord-hold outline & selection markers ---
	// Both live in ONE shared overlay shadow root instead of the light DOM: page
	// CSS can't restyle them, the pulse keyframes live inside the root (so no
	// stylesheet is ever injected into the host page's <head>), and everything
	// stays under the standard chrome click-through rules.
	let overlayChrome = null;

	function ensureOverlayChrome() {
		if (overlayChrome?.host?.isConnected) return overlayChrome;
		const { host, root } = createShadowRoot();
		const s = document.createElement('style');
		s.textContent = `
@keyframes rf-outline-pulse{0%,100%{opacity:1}50%{opacity:0.45}}
.rf-outline{position:fixed;pointer-events:none;border-radius:3px;transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s}
.rf-marker{position:fixed;pointer-events:none;border:2px solid #258a55;border-radius:3px;background:rgba(37,138,85,0.08);transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s}
.rf-marker-badge{position:absolute;top:-9px;left:-9px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#258a55;border:2px solid #fff;color:#fff;font:700 11px/14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(23,32,45,0.35)}
`;
		root.appendChild(s);
		overlayChrome = { host, root };
		return overlayChrome;
	}

	const OUTLINE_VARIANTS = {
		target: 'border:2px solid #2b6de8;animation:rf-outline-pulse 1.4s ease-in-out infinite;box-shadow:0 0 0 1px rgba(43,109,232,0.30),0 0 12px rgba(43,109,232,0.50)',
		dest: 'border:2px dashed #2b6de8;box-shadow:0 0 0 1px rgba(43,109,232,0.30),0 0 12px rgba(43,109,232,0.35)',
		member: 'border:2px solid #258a55;box-shadow:0 0 0 4px rgba(37,138,85,0.18)',
	};

	function showOutline(el, variant) {
		const v = variant || 'target';
		const { root } = ensureOverlayChrome();
		if (!outlineEl || !outlineEl.isConnected) {
			outlineEl = document.createElement('div');
			outlineEl.className = 'rf-outline';
			outlineEl.setAttribute('data-rf-outline', '');
			root.appendChild(outlineEl);
		}
		if (outlineEl.dataset.rfVariant !== v) {
			outlineEl.dataset.rfVariant = v;
			outlineEl.style.cssText = OUTLINE_VARIANTS[v];
		}
		positionOutline(el);
	}

	function positionOutline(el) {
		if (!outlineEl) return;
		// Sit 2px outside the element's own edge so the ring never covers content.
		const r = getViewportRect(el);
		outlineEl.style.top = r.top - 2 + 'px';
		outlineEl.style.left = r.left - 2 + 'px';
		outlineEl.style.width = r.width + 4 + 'px';
		outlineEl.style.height = r.height + 4 + 'px';
	}

	function hideOutline() {
		if (outlineEl) { outlineEl.remove(); outlineEl = null; }
	}

	// --- Pick modes ---
	// "Pick destination" and "+ Add element" share one driver: both close the
	// popover and put the page into a plain-click selection mode (no chord needed,
	// next left click picks, Escape cancels, draft popover restored afterwards).
	// Each mode declares its banner, color, hover outline variant, rejection rule
	// and how a clicked element becomes its result.
	const PICK_MODES = {
		member: {
			banner: 'Click an element to add to the selection',
			color: '#258a55',
			outline: 'member',
			rejectIf: (el, pm) => ((pm.draft?.members || []).includes(el) ? 'Already selected' : null),
			convert: (el) => el,
		},
		destination: {
			banner: 'Click the destination element',
			color: '#2b6de8',
			outline: 'dest',
			rejectIf: (el, pm) => (el === pm.sourceEl ? 'That is the source element' : null),
			convert: (el) => captureDestination(el),
		},
	};

	function enterPick(kind, sourceEl, sourceData, draft) {
		hidePopover();
		pickMode = { kind, sourceEl, sourceData, draft };
		setFeedbackCursor('crosshair');
		syncChromeClickThrough();
		showPickBanner(kind);
	}

	function exitPick(result) {
		if (!pickMode) return;
		const { kind, sourceEl, sourceData, draft } = pickMode;
		pickMode = null;
		setFeedbackCursor('');
		syncChromeClickThrough();
		hidePickBanner();
		hideOutline();
		if (kind === 'member') {
			if (result) draft.members = [...(draft.members || [sourceEl]), result];
			showPopover(sourceEl, sourceData, draft);
			if (result) showToast('Added to selection');
		} else {
			showPopover(sourceEl, sourceData, { ...draft, destination: result || draft.destination });
			if (result) showToast('Destination set');
		}
	}

	let pickBannerEl = null;

	function showPickBanner(kind) {
		hidePickBanner();
		const spec = PICK_MODES[kind];
		const { host, root } = createShadowRoot();
		host.style.cssText = `all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${Z.overlay};pointer-events:none`;
		root.appendChild(shadowStyle());
		const s = document.createElement('style');
		s.textContent = `
.rf-banner{background:${spec.color};color:#fff;padding:8px 16px;border-radius:999px;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 24px rgba(23,32,45,0.22);display:flex;gap:10px;align-items:center}
.rf-banner b{font-weight:600}
.rf-banner span{opacity:0.85}
`;
		root.appendChild(s);
		const b = document.createElement('div');
		b.className = 'rf-banner';
		const strong = document.createElement('b');
		strong.textContent = spec.banner;
		const hint = document.createElement('span');
		hint.textContent = 'Esc to cancel';
		b.appendChild(strong);
		b.appendChild(hint);
		root.appendChild(b);
		pickBannerEl = host;
	}

	function hidePickBanner() {
		if (pickBannerEl) { pickBannerEl.remove(); pickBannerEl = null; }
	}

	function destTargetFrom(e) {
		const path = e.composedPath ? e.composedPath() : [e.target];
		const el = path.find(n => n && n.nodeType === 1) || e.target;
		if (!el || el.nodeType !== 1) return null;
		if (isRfChrome(el)) return null;
		const ownerDoc = el.ownerDocument || document;
		if (el === ownerDoc.body || el === ownerDoc.documentElement) return null;
		return el;
	}

	function captureDestination(el) {
		const styles = getComputedStyles(el);
		return {
			selector: describeElement(el),
			framePath: framePathFor(el),
			tag: el.tagName.toLowerCase(),
			text: getTextSnippet(el),
			a11y: getA11y(el),
			rect: getBoundingRect(el),
			source: getSourceLoc(el),
			looks: getLooks(styles),
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

	// Walks out through shadow boundaries as well as up the light tree: composedPath
	// hands us nodes from inside our own shadow roots, and those must never be
	// annotatable either.
	function isRfChrome(el) {
		if (!el || el.nodeType !== 1) return false;
		for (let node = el; node;) {
			if (node.nodeType === 1 && node.hasAttribute?.(RF_CHROME_ATTR)) return true;
			const root = node.getRootNode?.();
			node = root && root.host ? root.host : node.parentElement;
		}
		return false;
	}

	// Heuristic for modal/drawer scrims: a fixed or absolutely positioned shell
	// that covers nearly the whole viewport and either carries an overlay-ish name
	// or paints opaque with no text. Class-name lists can't cover every framework;
	// geometry + naming/paint is the portable signal.
	const OVERLAY_NAME_RE = /modal|overlay|backdrop|drawer|scrim|dialog|sheet/i;
	function isOverlayShell(el, ownerDoc = el.ownerDocument || document) {
		if (el === ownerDoc.body || el === ownerDoc.documentElement) return false;
		const cs = getComputedStyle(el);
		if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
		const r = el.getBoundingClientRect();
		const view = ownerDoc.defaultView || window;
		if (r.width < view.innerWidth * 0.9 || r.height < view.innerHeight * 0.9) return false;
		if (OVERLAY_NAME_RE.test(el.className) || OVERLAY_NAME_RE.test(el.id)) return true;
		const bg = cs.backgroundColor;
		const alpha = bg.startsWith('rgba') ? parseFloat(bg.slice(5, -1).split(',')[3]) : 1;
		return (alpha >= 0.35 && !(el.textContent || '').trim());
	}

	function resolveChordTarget(e, hint) {
		const path = e.composedPath ? e.composedPath() : [e.target];
		let target = hint || path.find(n => n && n.nodeType === 1) || e.target;
		if (isRfChrome(target)) return null;
		const ownerDoc = target?.ownerDocument || document;
		if (target === ownerDoc.body || target === ownerDoc.documentElement) {
			// The click-through design drops chord clicks on our own chrome onto the
			// page root — annotating <html> is never useful, and a full-viewport
			// popover for it is exactly the "popup gone wrong" failure mode.
			return null;
		}
		const isPierceLayer = (el) => {
			if (!el || el.nodeType !== 1) return false;
			// Known overlay class names stay a fast-path signal; the shell heuristic
			// catches frameworks that name their scrims differently.
			if (el.matches?.('.modal-overlay,.drawer-overlay,.sheet-overlay')) return true;
			return isOverlayShell(el, ownerDoc);
		};
		if (target && isPierceLayer(target) && typeof ownerDoc.elementsFromPoint === 'function') {
			for (const el of ownerDoc.elementsFromPoint(e.clientX, e.clientY)) {
				if (el.nodeType !== 1) continue;
				if (isPierceLayer(el)) continue;
				if (isRfChrome(el)) continue;
				if (el === ownerDoc.body || el === ownerDoc.documentElement) continue;
				target = el;
				break;
			}
		}
		if (!target || target.nodeType !== 1) return null;
		return target;
	}

	function capturableEl(el) {
		const styles = getComputedStyles(el);
		const data = {
			selector: describeElement(el),
			framePath: framePathFor(el),
			tag: el.tagName.toLowerCase(),
			text: getTextSnippet(el),
			styles,
			looks: getLooks(styles),
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
	// each one starting over. An existing unopened gesture continues even if the
	// wall clock expired — only a resolved or cleared gesture starts fresh.
	function armChordGesture(e) {
		if (chordGesture && !chordGesture.opened) { chordGesture.armedAt = performance.now(); return; }
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
		// Stale-but-held gestures keep accumulating: only a resolved/closed gesture
		// blocks, and every arriving click carries the chord anyway.
		if (!chordGesture || chordGesture.opened) return;
		const target = resolveChordTarget(e, null);
		if (!target) return;
		const accumulated = chordGesture.accumulated;
		if (!accumulated.includes(target)) {
			accumulated.push(target);
			// Without markers there's no way to tell that a multi-select is building.
			setSelectionMarkers(accumulated);
		}
		chordGesture.armedAt = performance.now();
	}

	function clearChordGesture() {
		chordGesture = null;
		clearSelectionMarkers();
	}

	// The wall-clock expiry marks the gesture stale so it can't swallow unrelated
	// clicks forever; it deliberately does NOT destroy it. A chord still physically
	// held (keys not yet released) must resolve its selection on keyup — the
	// "click, glance, release" rhythm routinely outlives CHORD_GESTURE_MS.
	function isLiveChordGesture() {
		if (!chordGesture) return false;
		return performance.now() - chordGesture.armedAt <= CHORD_GESTURE_MS;
	}

	// --- Selection markers ---
	// Green overlays over the non-primary members of the selection. Used while the
	// chord gesture accumulates clicks and again while the popover is open, so the
	// set you are about to annotate stays visible the whole way through.
	let selMarkers = [];

	// Each marker overlays its element and carries a numbered badge, so a growing
	// multi-select reads as an ordered list on the page itself. startIndex lets
	// the open-popover state number non-primary members 2..N (primary is 1).
	function setSelectionMarkers(els, startIndex) {
		clearSelectionMarkers();
		const { root } = ensureOverlayChrome();
		const base = startIndex || 0;
		for (let i = 0; i < els.length; i++) {
			const el = els[i];
			const node = document.createElement('div');
			node.className = 'rf-marker';
			node.setAttribute('data-rf-marker', '');
			const badge = document.createElement('span');
			badge.className = 'rf-marker-badge';
			badge.textContent = String(base + i + 1);
			node.appendChild(badge);
			root.appendChild(node);
			selMarkers.push({ el, node });
		}
		positionSelectionMarkers();
	}

	function positionSelectionMarkers() {
		for (const { el, node } of selMarkers) {
			if (!el.isConnected) { node.style.display = 'none'; continue; }
			const r = getViewportRect(el);
			node.style.display = 'block';
			node.style.top = r.top + 'px';
			node.style.left = r.left + 'px';
			node.style.width = r.width + 'px';
			node.style.height = r.height + 'px';
		}
	}

	function clearSelectionMarkers() {
		for (const { node } of selMarkers) node.remove();
		selMarkers = [];
	}

	const CAPTURE = { capture: true, passive: false };

	function shouldCaptureChord(e) {
		if (isRfChrome(e.target)) return false;
		if (e.button != null && e.button !== 0) return false;
		return IS_CHORD(e) || isLiveChordGesture();
	}

	function finishChordGesture(e) {
		// Resolution is keyed to the physical chord release, not the wall clock:
		// a stale-but-held gesture must still open its popover here.
		if (!chordGesture && !IS_CHORD(e)) return;
		// Only meaningful when a pointer released over our chrome. On the keyup path
		// e.target is whatever holds focus, which is the popover's own textarea
		// whenever a popover is open — and that must not cancel the gesture.
		if (e.type !== 'keyup' && e.target && isRfChrome(e.target)) { clearChordGesture(); return; }
		killEvent(e);
		const accumulated = chordGesture ? [...chordGesture.accumulated] : [];
		const alreadyOpened = !!(chordGesture && chordGesture.opened);
		if (chordGesture) chordGesture.opened = true;
		const hint = chordGesture ? chordGesture.targetHint : null;
		clearChordGesture();
		if (alreadyOpened) return;
		const unique = accumulated.filter((el, i) => accumulated.indexOf(el) === i);
		// With a popover already open the chord is a continuation, not a fresh start:
		// growing the selection keeps the draft comment, styles and destination that
		// replacing it would throw away.
		if (popoverApi && unique.length) { popoverApi.addMembers(unique); return; }
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
		addFeedbackListener(type, (e) => {
			if (!pickMode) return;
			if (isRfChrome(e.target)) return;
			killEvent(e);
		}, CAPTURE);
	}

	addFeedbackListener('click', (e) => {
		if (!pickMode) return;
		if (isRfChrome(e.target)) return;
		killEvent(e);
		if (e.button != null && e.button !== 0) return;
		const target = destTargetFrom(e);
		if (!target) return;
		const spec = PICK_MODES[pickMode.kind];
		const reason = spec.rejectIf(target, pickMode);
		if (reason) { showToast(reason); return; }
		exitPick(spec.convert(target));
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
		if (pickMode) {
			const target = destTargetFrom(e);
			if (target) showOutline(target, PICK_MODES[pickMode.kind].outline);
			return;
		}
		if (!IS_CHORD(e)) return hideOutline();
		const target = resolveChordTarget(e, null);
		if (target) showOutline(target);
	}

	function queueHover(e) {
		// Snapshot what the handlers read. composedPath() returns an empty array once
		// dispatch finishes, so it has to be resolved on the tick rather than later.
		const path = e.composedPath ? e.composedPath() : [e.target];
		// A held chord with the mouse gliding is an active gesture: refresh its arm
		// so a slow "click, glance, release" rhythm can't outlive CHORD_GESTURE_MS
		// and silently drop the selection.
		if (chordGesture && IS_CHORD(e)) chordGesture.armedAt = performance.now();
		hoverEvent = {
			clientX: e.clientX, clientY: e.clientY, target: e.target,
			altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey,
			composedPath: () => path,
		};
		if (!hoverRaf) hoverRaf = requestAnimationFrame(flushHover);
	}

	addFeedbackListener('mousemove', queueHover, true);

	addFeedbackListener('pointerdown', (e) => {
		if (!IS_CHORD(e) || isRfChrome(e.target)) return;
		if (e.button != null && e.button !== 0) return;
		armChordGesture(e);
		killEvent(e);
		addToChordGroup(e);
	}, CAPTURE);

	addFeedbackListener('mousedown', (e) => {
		if (!shouldCaptureChord(e)) return;
		if (IS_CHORD(e)) armChordGesture(e);
		killEvent(e);
		addToChordGroup(e);
	}, CAPTURE);

	addFeedbackListener('pointerup', (e) => {
		if (!shouldCaptureChord(e)) return;
		killEvent(e);
	}, CAPTURE);

	// While the chord is still held, a mouseup only adds to the selection: the
	// gesture resolves on chord release (keyup) so multi-click grouping can build up.
	// Releasing the chord before the mouse is the single-click case, handled here.
	addFeedbackListener('mouseup', (e) => {
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

	addFeedbackListener('click', (e) => {
		if (!isLiveChordGesture() && !IS_CHORD(e)) return;
		// Swallow the click so the host page never sees it, but leave the gesture
		// open while the chord is down.
		killEvent(e);
		if (IS_CHORD(e)) return;
		finishChordGesture(e);
	}, CAPTURE);

	addFeedbackListener('auxclick', (e) => {
		if (!shouldCaptureChord(e)) return;
		killEvent(e);
	}, CAPTURE);

	let chordWasActive = false;
	let lastChordRelease = 0;
	const DOUBLE_TAP_MS = 300;

	addFeedbackListener('keydown', (e) => {
		if (e.altKey && e.shiftKey && String(e.key).toLowerCase() === 'r') {
			if (popoverEl) { killEvent(e); resetPopoverPosition(); }
			return;
		}
		if (e.key === 'Escape') {
			// Escape from inside a comment box: when the draft holds real work
			// (typed comment, tweaks, destination, category), blur out instead
			// of nuking it — a second Escape then closes normally. A pristine
			// draft, or focus outside any input, closes immediately.
			// The inner textarea stopPropagation guards cannot do this alone
			// because this document-capture listener runs first.
			const editable = eventFromEditable(e);
			if (editable) {
				let dirty = false;
				try { dirty = !!(popoverEl && popoverDraftGuard && popoverDraftGuard()); } catch { dirty = false; }
				if (!dirty && !popoverEl && panelEl && panelEl.style.display !== 'none') {
					const v = editable.value !== undefined ? editable.value : editable.textContent;
					dirty = !!String(v || '').trim();
				}
				if (dirty) { try { editable.blur(); } catch {} return; }
			}
			if (pickMode) { killEvent(e); exitPick(null); return; }
			if (popoverEl) { cancelPopover(); return; }
			if (panelEl && panelEl.style.display !== 'none') { closePanel(); return; }
		}
		if (IS_CHORD(e)) {
			if (!e.repeat) revealFab();
			chordWasActive = true;
			syncChromeClickThrough();
		}
	}, true);

	addFeedbackListener('keyup', (e) => {
		if (chordWasActive && !IS_CHORD(e)) {
			chordWasActive = false;
			syncChromeClickThrough();
			hideOutline();
			// Chord released: resolve whatever was selected during the hold. One target
			// opens the normal popover, several open the merged group popover. Any
			// unopened gesture resolves here, live or wall-clock-stale — the physical
			// key release is what ends it, and dropping a stale one silently ate
			// selections from the common "click, glance, release" rhythm.
			if (chordGesture && !chordGesture.opened) {
				killEvent(e);
				finishChordGesture(e);
				return;
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
		if (!IS_CHORD(e) && !hasAnnotations()) scheduleConcealFab();
	}, true);

	// A selector can point at a different component after a route swap, so closing is
	// safer than silently retargeting an unsaved draft onto the new screen. But SPAs
	// and analytics fire pushState/replaceState constantly without changing the URL
	// — only an actual location change counts as navigation.
	let lastRouteUrl = location.href;
	function handleRouteChange() {
		if (location.href === lastRouteUrl) return;
		lastRouteUrl = location.href;
		if (!popoverEl && !pickMode && !chordGesture) return;
		pickMode = null;
		setFeedbackCursor('');
		hidePickBanner();
		clearChordGesture();
		hidePopover();
		showToast('Draft selection closed after page navigation');
	}
	for (const method of ['pushState', 'replaceState']) {
		const original = history[method];
		history[method] = function (...args) {
			const result = original.apply(this, args);
			handleRouteChange();
			return result;
		};
	}
	addEventListener('popstate', handleRouteChange);
	// Hash-router SPAs never touch the History API; without this their route
	// changes would leave a draft pointing at the old screen.
	addEventListener('hashchange', handleRouteChange);

	// --- API ---
	window.__SCOPE_FEEDBACK_API__ = {
		markdown() { return toMarkdown(annotations); },
		json() { return toFeedbackJSON(annotations); },
		get annotations() { return annotations; },
		clear() { annotations = []; save(); },
		openPanel() { openPanel(); },
		setProjectRoot,
	};

	// --- Init ---
	if (IS_TOP_FRAME) scanFeedbackFrames(document);
	load();
	loadPopoverOffset();
	createFab();
	if (hasAnnotations()) revealFab();
})();
