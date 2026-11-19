// Regressions for the 2026-11-19 audit-fleet implementation: honest persistence,
// snapshot-based draft guards, hostile chrome markers, touch and short viewports.
const { POP, createReporter, withPage, waitForPopover } = require('./common');

const KEY = 'scope_feedback_annotations';
const HOSTS = `[...document.body.children, ...document.documentElement.children]`;
const TOASTS = `(() => ${HOSTS}.filter(h => h.style?.bottom === '80px' && h.shadowRoot)
  .map(h => h.shadowRoot.textContent.trim()))()`;
const PANEL = `${HOSTS}.find(h => h.shadowRoot?.querySelector('.rf-panel'))?.shadowRoot`;

module.exports = () => withPage(async (page) => {
	const r = createReporter();

	const popover = () => page.evaluate(`(() => ${POP})()`);
	const close = () => page.evaluate(`(() => {
		const p = ${POP};
		if (p) p.querySelector('.rf-actions .rf-btn').click();
	})()`);
	const annot = async (sel) => {
		const box = await page.$eval(sel, el => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		await page.mouse.click(box.x, box.y);
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		await waitForPopover(page);
	};

	// --- A failed quick-send must keep the only copy of the text and stay honest ---
	await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
	await page.evaluate(() => {
		window.__origSet14 = Storage.prototype.setItem;
		Storage.prototype.setItem = function (k, v) {
			if (k === 'scope_feedback_annotations') throw new DOMException('quota');
			return window.__origSet14.call(this, k, v);
		};
	});
	await page.evaluate(`(() => {
		const panel = ${PANEL};
		const ta = panel.querySelector('.rf-panel-footer textarea');
		ta.value = 'unsaved note';
		[...panel.querySelectorAll('.rf-panel-footer button')].find(b => b.textContent === 'Send').click();
	})()`);
	let state = await page.evaluate(`(() => {
		const panel = ${PANEL};
		return { text: panel.querySelector('.rf-panel-footer textarea').value, toasts: ${TOASTS} };
	})()`);
	r.check('failed quick-send keeps the note and never says Saved',
		state.text === 'unsaved note' && !state.toasts.includes('Saved'), JSON.stringify(state));
	await page.evaluate(() => { Storage.prototype.setItem = window.__origSet14; });

	// --- In-place comment edits advance ts so a cross-tab merge cannot erase them ---
	await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.clear());
	await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
		annotations: [{ id: 'inline1', ts: 100, selector: '#c1', tag: 'div', text: 'First card',
			url: 'https://elsewhere.test/p', comment: 'old' }],
		deleted: []
	})), KEY);
	await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'scope_feedback_annotations' })));
	await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
	await page.evaluate(`(() => {
		const panel = ${PANEL};
		[...panel.querySelectorAll('.rf-btn-icon:not(.rf-btn-revert)')].find(b => b.textContent === '✎').click();
	})()`);
	await page.evaluate(`(() => {
		const panel = ${PANEL};
		panel.querySelector('.rf-comment[contenteditable="true"]').textContent = 'new comment';
	})()`);
	await page.evaluate(`(() => {
		const panel = ${PANEL};
		[...panel.querySelectorAll('.rf-btn-icon')].find(b => b.textContent === '✓').click();
	})()`);
	const row = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.find(a => a.id === 'inline1'));
	r.check('inline comment edit advances ts', row && row.comment === 'new comment' && row.ts > 100, JSON.stringify(row));

	// --- A plain in-page anchor keeps the draft; SPA routes still close it ---
	await close();
	await annot('#c2');
	await page.evaluate(`(() => { ${POP}.querySelector('.rf-popover-ta').value = 'hash draft'; })()`);
	await page.evaluate(() => { location.hash = '#faq'; });
	await new Promise(resolve => setTimeout(resolve, 100));
	const kept = await page.evaluate(`(() => {
		const p = ${POP};
		return p && p.querySelector('.rf-popover-ta').value;
	})()`);
	r.check('hash-only anchor keeps the draft', kept === 'hash draft', String(kept));
	await close();
	await page.evaluate(() => { history.replaceState({}, '', location.pathname); });

	// --- Long-press resolves + annotates without activating the page control ---
	await page.evaluate(() => {
		window.__hostClicks = 0;
		const b = document.createElement('button');
		b.id = 'lp-target';
		b.textContent = 'Long press me';
		b.style.cssText = 'position:fixed;left:20px;top:20px;width:120px;height:40px;z-index:1';
		b.addEventListener('click', () => { window.__hostClicks++; });
		document.body.appendChild(b);
	});
	await page.evaluate(() => {
		const el = document.getElementById('lp-target');
		const t = new Touch({ identifier: 1, target: el, clientX: 40, clientY: 40 });
		el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
	});
	await new Promise(resolve => setTimeout(resolve, 650));
	await page.evaluate(() => {
		const el = document.getElementById('lp-target');
		el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [] }));
		el.click();
	});
	state = await page.evaluate(`(() => {
		const p = ${POP};
		return { clicks: window.__hostClicks, opened: !!p, title: p?.querySelector('.rf-title')?.textContent || '' };
	})()`);
	r.check('long-press annotates without activating the page control',
		state.clicks === 0 && state.opened && /Long press me/.test(state.title), JSON.stringify(state));
	await close();

	// --- A second finger joining (or moving) cancels the pending long-press ---
	await page.evaluate(() => {
		const el = document.getElementById('lp-target');
		const a = new Touch({ identifier: 1, target: el, clientX: 40, clientY: 40 });
		el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true,
			touches: [a], targetTouches: [a], changedTouches: [a] }));
		const b = new Touch({ identifier: 2, target: el, clientX: 90, clientY: 50 });
		el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true,
			touches: [a, b], targetTouches: [a, b], changedTouches: [b] }));
	});
	await new Promise(resolve => setTimeout(resolve, 650));
	const multi = await page.evaluate(`(() => !!${POP})()`);
	r.check('a second finger cancels the long-press', multi === false, String(multi));

	// --- A page-injected chrome marker must not make a subtree unannotatable ---
	await page.evaluate(() => {
		const d = document.createElement('div');
		d.setAttribute('data-rf-chrome', '');
		d.innerHTML = '<button id="decoy-child" style="position:fixed;left:40px;top:120px;width:90px;height:30px">Decoy child</button>';
		document.documentElement.appendChild(d);
	});
	await annot('#decoy-child');
	const decoyTitle = await page.evaluate(`(() => ${POP})()?.querySelector('.rf-title')?.textContent || ''`);
	r.check('page-injected chrome marker does not shield a subtree', /Decoy child/.test(decoyTitle), decoyTitle);
	await close();

	// --- Short viewport: actions stay reachable, badges start at 1, tabs are real ---
	await page.setViewport({ width: 844, height: 390 });
	await annot('#c1');
	await annot('#c2');
	await annot('#c3');
	state = await page.evaluate(`(() => {
		const p = ${POP};
		const actions = p.querySelector('.rf-actions').getBoundingClientRect();
		return {
			actionsBottom: actions.bottom,
			viewport: innerHeight,
			badges: ${HOSTS}.flatMap(h => [...(h.shadowRoot?.querySelectorAll('.rf-marker-badge') || [])].map(b => b.textContent)),
			tabRole: p.querySelector('.rf-tab-row').getAttribute('role'),
			selected: [...p.querySelectorAll('[role="tab"]')].map(t => t.getAttribute('aria-selected')).join(','),
			hint: p.querySelector('.rf-primary-hint').textContent
		};
	})()`);
	r.check('short-viewport popover keeps Submit on screen', state.actionsBottom <= state.viewport + 1, JSON.stringify(state));
	// The header identifies the primary as "1"; on-page badges continue 2..N.
	r.check('marker badges are contiguous from the primary', state.badges.join(',') === '2,3', JSON.stringify(state.badges));
	r.check('tabs expose ARIA tab semantics', state.tabRole === 'tablist' && state.selected === 'true,false' && /^1 /.test(state.hint), JSON.stringify(state));
	await page.setViewport({ width: 1200, height: 800 });

	// --- Raw attributes survive the record factory and drive export hints ---
	await close();
	await page.evaluate(() => {
		window.__SCOPE_FEEDBACK_API__.clear();
		const a = document.createElement('a');
		a.id = 'hint-link';
		a.href = '/target?token=abc&keep=1';
		a.textContent = 'Hint link';
		a.style.cssText = 'position:fixed;left:10px;top:200px;width:100px;height:30px;z-index:1';
		document.body.appendChild(a);
	});
	await annot('#hint-link');
	await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'hint check'; p.querySelector('.rf-btn-primary').click(); })()`);
	const exp = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.json());
	const hintItem = exp.items.find(i => i.comment === 'hint check');
	const hrefHint = hintItem?.hints.find(h => h.key === 'Href');
	r.check('raw href survives the record factory and drives hints',
		hrefHint?.value === '/target', JSON.stringify({ count: exp.items.length, item: hintItem, hrefHint }));

	// --- Group member Where is normalized to 4 segments in both exporters ---
	await page.evaluate(() => {
		const deep = 'div.shell > section.body > main.content > ul.list > li.item > a.link';
		window.__SCOPE_FEEDBACK_API__.annotations.push({
			id: 'where1', ts: Date.now(), selector: deep, tag: 'a', text: 'Where test',
			url: location.href, comment: 'where check',
			targets: [{ selector: deep, tag: 'a', text: 'member' }]
		});
	});
	const view = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.json());
	const memberWhere = view.items.find(i => i.id === 'where1')?.targets[0]?.where || '';
	r.check('JSON member Where uses the shared 4-segment policy', memberWhere.split(' > ').length === 4, memberWhere);

	// --- Saving an inline edit with unchanged text still leaves edit mode ---
	await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.clear());
	await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
		annotations: [{ id: 'inline2', ts: 200, selector: '#c1', tag: 'div', text: 'First card',
			url: 'https://elsewhere.test/p', comment: 'same' }], deleted: []
	})), KEY);
	await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'scope_feedback_annotations' })));
	await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
	await page.evaluate(`(() => { const p = ${PANEL}; [...p.querySelectorAll('.rf-btn-icon')].find(b => b.textContent === '✎').click(); })()`);
	await page.evaluate(`(() => { const p = ${PANEL}; [...p.querySelectorAll('.rf-btn-icon')].find(b => b.textContent === '✓').click(); })()`);
	const editState = await page.evaluate(`(() => {
		const p = ${PANEL};
		const c = p.querySelector('.rf-comment');
		return { editable: c.getAttribute('contenteditable'), hasPencil: [...p.querySelectorAll('.rf-btn-icon')].some(b => b.textContent === '✎') };
	})()`);
	r.check('unchanged inline save exits edit mode', editState.editable === null && editState.hasPencil, JSON.stringify(editState));

	// --- A long press held well past the timer still suppresses the click ---
	await page.evaluate(() => {
		window.__longClicks = 0;
		const b = document.createElement('button');
		b.id = 'lp-long';
		b.textContent = 'Long hold';
		b.style.cssText = 'position:fixed;left:20px;top:260px;width:100px;height:30px;z-index:1';
		b.addEventListener('click', () => { window.__longClicks++; });
		document.body.appendChild(b);
	});
	await page.evaluate(() => {
		const el = document.getElementById('lp-long');
		const t = new Touch({ identifier: 2, target: el, clientX: 40, clientY: 275 });
		el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
	});
	await new Promise(resolve => setTimeout(resolve, 1300));
	await page.evaluate(() => {
		const el = document.getElementById('lp-long');
		el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [] }));
		el.click();
	});
	r.check('a long-held press still suppresses the synthetic click',
		(await page.evaluate(() => window.__longClicks)) === 0, '');

	// --- A chord gesture whose keyup is lost cannot swallow the next click ---
	await close();
	await page.evaluate(() => {
		window.__plainClicks = 0;
		const b = document.createElement('button');
		b.id = 'plain-after-blur';
		b.textContent = 'Plain';
		b.style.cssText = 'position:fixed;left:20px;top:320px;width:80px;height:26px;z-index:1';
		b.addEventListener('click', () => { window.__plainClicks++; });
		document.body.appendChild(b);
	});
	await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
	await page.mouse.move(40, 333); await page.mouse.down(); await page.mouse.up();
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
	await page.evaluate(() => document.getElementById('plain-after-blur').click());
	const stale = await page.evaluate(`(() => ({ clicks: window.__plainClicks, popover: !!${POP} }))()`);
	r.check('focus-lost chord cannot swallow the next plain click',
		stale.clicks === 1 && !stale.popover, JSON.stringify(stale));

	return r.finish();
});
