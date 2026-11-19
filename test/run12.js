// Regressions for the hostile-review fixes (storage, copy safety, honest saves,
// exports, selectors, drafts, API gating). Clipboard/storage are stubbed in page
// context — no real clipboard permissions or second browser context needed.
const fs = require('fs');
const path = require('path');
const { POP, createReporter, withPage, waitFor, waitForPopover, waitForPopoverGone } = require('./common');
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'rapid-feedback.user.js'), 'utf8');
const KEY = 'scope_feedback_annotations';
const HOSTS = `[...document.body.children, ...document.documentElement.children]`;
const TOASTS = `(() => ${HOSTS}.filter(h => h.style?.bottom === '80px' && h.shadowRoot)
  .map(h => h.shadowRoot.textContent.trim()))()`;
const PANEL = `${HOSTS}.find(h => h.shadowRoot?.querySelector('.rf-panel'))?.shadowRoot`;
module.exports = async function run12() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {
		const installClipboard = () => page.evaluate(() => {
			window.__copy = { mode: 'resolve', texts: [] };
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText(t) { window.__copy.texts.push(t); return window.__copy.mode === 'reject'
					? Promise.reject(new Error('denied')) : Promise.resolve(); } }
			});
			document.execCommand = () => false; // fallback must also report honest failure
		});
		const annot = async (sel) => {
			const b = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
			await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
			await page.mouse.click(b.x, b.y);
			await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
			await waitForPopover(page);
		};
		const submit = (comment) => page.evaluate(`(() => { const p = ${POP};
			p.querySelector('.rf-popover-ta').value = ${JSON.stringify(comment)};
			p.querySelector('.rf-btn-primary').click(); })()`);
		const cancel = () => page.evaluate(`(() => { const p = ${POP}; if (p) p.querySelector('.rf-btn').click(); })()`);
		const seed = (payload) => page.evaluate((p) => {
			localStorage.setItem('scope_feedback_annotations', JSON.stringify(p));
			window.dispatchEvent(new StorageEvent('storage', { key: 'scope_feedback_annotations' }));
		}, payload);
		const row = (id, ts, comment, extra = {}) => ({ id, ts, selector: '#c1', tag: 'div',
			text: 'First card', url: 'https://x.test/p', comment, ...extra });
		const anns = () => page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations
			.map(a => ({ id: a.id, ts: a.ts, comment: a.comment, url: a.url })));
		// --- Storage: a corrupt blob is preserved, never silently overwritten ---
		await page.evaluate((k) => localStorage.setItem(k, '{not json'), KEY);
		await page.reload();
		await page.evaluate(() => { window.__RF_TEST_MODE__ = true; });
		await page.evaluate(SCRIPT);
		let state = await page.evaluate((k) => ({
			backup: localStorage.getItem(k + '.corrupt'), count: window.__SCOPE_FEEDBACK_API__.annotations.length,
			toasts: [...document.body.children, ...document.documentElement.children]
				.filter(h => h.style?.bottom === '80px' && h.shadowRoot).map(h => h.shadowRoot.textContent.trim())
		}), KEY);
		check('corrupt blob is copied to the recovery key', state.backup === '{not json' && state.count === 0, JSON.stringify(state));
		check('corrupt blob shows an unreadable toast', state.toasts.some(t => /unreadable/i.test(t)), JSON.stringify(state.toasts));
		await page.evaluate((k) => localStorage.removeItem(k), KEY);
		await installClipboard();
		// --- Storage: cross-tab event reconciles by id, tombstone + newest ts win ---
		const tombstone = ['dead', 999, 'deleted'];
		const base = [row('a1', 100, 'old'), row('a2', 200, 'newer'), row(...tombstone)];
		await seed({ annotations: base, deleted: ['dead'] });
		let list = await anns();
		check('storage event reconciles with tombstones', list.length === 2 && list.every(a => a.id !== 'dead'), JSON.stringify(list));
		check('storage event announces another tab', (await page.evaluate(TOASTS)).some(t => /another tab/i.test(t)), '');
		await seed({ annotations: [row('a1', 300, 'newest'), row('a2', 200, 'newer'), row(...tombstone)], deleted: ['dead'] });
		check('newest ts wins per id', (await anns()).find(a => a.id === 'a1')?.comment === 'newest', '');
		await seed({ annotations: [row('a1', 10, 'stale'), row('a2', 200, 'newer')], deleted: ['a2'] });
		list = await anns();
		check('older ts cannot overwrite and tombstones stick', list.length === 1 && list[0].comment === 'newest', JSON.stringify(list));
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.clear());
		const deleted = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).deleted, KEY);
		check('deleted ids persist as tombstones', ['a1', 'a2', 'dead'].every(id => deleted.includes(id)), JSON.stringify(deleted));
		// --- Copy safety: a failed copy must not discard the draft or wipe storage ---
		await annot('#c1');
		await page.evaluate(`(() => { ${POP}.querySelector('.rf-popover-ta').value = 'cut me'; })()`);
		const clickCut = () => page.evaluate(`(() => { const p = ${POP};
			[...p.querySelectorAll('.rf-btn')].find(b => b.textContent === 'Cut').click(); })()`);
		await page.evaluate(() => { window.__copy.mode = 'reject'; });
		await clickCut();
		await waitFor(page, `!!(${POP}) && window.__copy.texts.length > 0`, { description: 'rejected Cut settles' });
		check('failed popover copy keeps the draft open', await page.evaluate(`!!(${POP})`), '');
		check('failed popover copy keeps the typed comment', await page.evaluate(`(() => ${POP}.querySelector('.rf-popover-ta').value)()`) === 'cut me', '');
		check('failed popover copy reports no cut', (await page.evaluate(TOASTS)).some(t => /draft kept/i.test(t)), '');
		await page.evaluate(() => { window.__copy.mode = 'resolve'; });
		await clickCut();
		await waitForPopoverGone(page);
		check('confirmed popover copy exports the draft', (await page.evaluate(() => window.__copy.texts.at(-1) || '')).includes('cut me'), '');
		await seed({ annotations: [row('cut1', 400, 'keep me')], deleted: [] });
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		const cutAllBtn = `[...(${PANEL}).querySelectorAll('.rf-btn')].find(b => /cut all|really cut/i.test(b.textContent))`;
		const clickCutAll = () => page.evaluate(`(() => { ${cutAllBtn}.click(); })()`);
		const cutAllState = () => page.evaluate(`(() => ({ text: ${cutAllBtn}.textContent.trim(),
			n: window.__SCOPE_FEEDBACK_API__.annotations.length }))()`);
		await clickCutAll();
		let cut = await cutAllState();
		check('Cut All arms before wiping', /really cut all/i.test(cut.text) && cut.n === 1, JSON.stringify(cut));
		await page.evaluate(() => { window.__copy.mode = 'reject'; });
		await clickCutAll();
		await waitFor(page, `window.__copy.texts.length >= 3`, { description: 'rejected Cut All settles' });
		check('failed export does not wipe on Cut All', await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.length) === 1, '');
		await page.evaluate(() => { window.__copy.mode = 'resolve'; });
		await clickCutAll(); await clickCutAll();
		await waitFor(page, `window.__SCOPE_FEEDBACK_API__.annotations.length === 0`, { description: 'Cut All wipe' });
		check('confirmed copy wipes on Cut All', true, '');
		const cutDeleted = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).deleted, KEY);
		check('Cut All tombstones instead of just dropping', cutDeleted.includes('cut1'), JSON.stringify(cutDeleted));
		// --- Save honesty: Submit must not close or claim success on a failed write ---
		await page.evaluate(() => {
			window.__origSet = Storage.prototype.setItem;
			Storage.prototype.setItem = function (k, v) {
				if (k === 'scope_feedback_annotations') throw new DOMException('quota');
				return window.__origSet.call(this, k, v);
			};
		});
		await annot('#c4');
		await submit('save failure check');
		await waitFor(page, TOASTS + '.some(t => /Not saved/.test(t))', { description: 'save-failure toast' });
		check('failed save leaves the popover open', await page.evaluate(`!!(${POP})`), '');
		check('failed save never announces Saved', !(await page.evaluate(TOASTS)).some(t => t === 'Saved'), '');
		await page.evaluate(() => { Storage.prototype.setItem = window.__origSet; });
		await page.evaluate(`(() => { ${POP}.querySelector('.rf-btn-primary').click(); })()`);
		await waitForPopoverGone(page);
		const saved = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.at(-1));
		check('retry after a failed save persists with id + ts', !!saved && saved.comment === 'save failure check' && !!saved.id && !!saved.ts, JSON.stringify(saved));
		// --- Export: capture from real credential-bearing locations so safeUrl runs ---
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.clear()); // old rows would be items[0]
		const pageFile = 'file://' + path.join(__dirname, 'page.html');
		// file:// navigations normalize away the query; pushState keeps it on
		// location.href so the captured annotation really exercises safeUrl.
		const loadAt = async (query) => {
			await page.goto(pageFile);
			await page.evaluate((q) => history.pushState({}, '', location.pathname + q), query);
			await page.evaluate(() => { window.__RF_TEST_MODE__ = true; });
			await page.evaluate(SCRIPT); await installClipboard();
		};
		await loadAt('?tab=3&token=SECRET&auth=hunter2&view=grid&session=abc');
		await annot('#c1'); await submit('first note'); await waitForPopoverGone(page);
		await loadAt('?view=list&code=TOPSECRET'); // reload hydrates annotation 1 from storage
		await annot('#c2'); await submit('second note'); await waitForPopoverGone(page);
		await annot('#c3'); await submit('line one\n## FORGED'); await waitForPopoverGone(page);
		await page.evaluate(() => { document.title = 'RF   Harness'; });
		const exp = await page.evaluate(() => {
			const api = window.__SCOPE_FEEDBACK_API__, md = api.markdown(), json = api.json();
			return { md, pageLines: md.split('\n').filter(l => l.startsWith('Page: ')), item: json.items[0], session: json.session };
		});
		check('stored URL strips credentials but keeps normal params', exp.item.url.includes('tab=3') && exp.item.url.includes('view=grid') && !/token|auth|session|SECRET|hunter2/i.test(exp.item.url), exp.item.url);
		check('Markdown emits a Page line per distinct URL', exp.pageLines.length >= 2 && exp.pageLines.some(l => l.includes('view=list')) && exp.pageLines.every(l => !/token|auth|session|SECRET|code=/i.test(l)), JSON.stringify(exp.pageLines));
		check('JSON items carry provenance fields', ['id', 'ts', 'url', 'pageTitle', 'route'].every(k => k in exp.item), JSON.stringify(Object.keys(exp.item)));
		check('JSON session route derives from the sanitized URL', exp.session.route.includes('tab=3') && !/token|auth|session|SECRET/i.test(exp.session.route), String(exp.session.route));
		check('page-derived strings are whitespace-collapsed', exp.md.includes('# Feedback — RF Harness') && !exp.md.includes('RF   Harness'), '');
		check('multi-line page text cannot forge a heading', !/^## FORGED/m.test(exp.md) && exp.md.includes('line one'), '');
		// --- Selectors: separate attribute pairs, CSS.escape, positional + ambiguity ---
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.clear());
		await page.evaluate(() => {
			const box = (el) => { el.style.cssText = 'display:block;width:140px;height:26px;margin:4px;background:#ddd'; document.body.appendChild(el); return el; };
			let el = document.createElement('button'); el.id = 'attr-probe';
			el.setAttribute('data-testid', 'save'); el.setAttribute('aria-label', 'Save now');
			el.className = 'semantic-probe'; el.textContent = 'Attr probe'; box(el);
			el = document.createElement('div'); el.id = 'user.name'; el.className = '2fa-card';
			el.textContent = 'Escape probe'; box(el);
			const wrap = box(document.createElement('div')); wrap.id = 'dupwrap';
			for (const t of ['A', 'B']) { const s = document.createElement('span'); s.className = 'dupitem';
				s.textContent = t; s.style.cssText = 'display:inline-block;width:30px;height:20px'; wrap.appendChild(s); }
		});
		for (const sel of ['#attr-probe', '[id="user.name"]', '#dupwrap .dupitem:nth-of-type(2)']) {
			await annot(sel); await submit('selector probe'); await waitForPopoverGone(page);
		}
		await page.evaluate(() => document.body.appendChild(document.getElementById('dupwrap').cloneNode(true)));
		const selState = await page.evaluate(() => {
			const api = window.__SCOPE_FEEDBACK_API__, sels = api.annotations.map(a => a.selector);
			const dupSel = sels.find(s => /dupitem/.test(s));
			const attrSel = sels.find(s => s.includes('data-testid="save"')) || '';
			return { sels,
				attr: attrSel.includes('[data-testid="save"]') && attrSel.includes('[aria-label="Save now"]')
					&& !/\[[^\]]*\s+[a-z-]+="/.test(attrSel),
				escaped: sels.some(s => s.includes('#' + CSS.escape('user.name')) && s.includes('.' + CSS.escape('2fa-card'))),
				nth: sels.some(s => /:nth-of-type\(2\)/.test(s)),
				dupCount: document.querySelectorAll(dupSel).length, md: api.markdown(), json: api.json() };
		});
		check('high-signal attributes are separate bracket pairs', selState.attr, JSON.stringify(selState.sels));
		check('ids and classes are CSS-escaped', selState.escaped, '');
		check('a tied plain chain gets a positional qualifier', selState.nth, '');
		check('an ambiguous chain is disclosed after slice(-12) re-verification', selState.dupCount > 1 && selState.md.includes('⚠ Selector matches multiple') && selState.json.items.some(i => i.selectorAmbiguous === true), 'dupCount=' + selState.dupCount);
		// Shadow-root targets name their host in the export.
		await page.evaluate(() => {
			const host = document.createElement('div'); host.id = 'shadow-probe';
			host.style.cssText = 'display:block;width:140px;height:30px;margin:4px';
			const b = document.createElement('button'); b.textContent = 'Shadow action';
			b.style.cssText = 'width:100%;height:100%'; host.attachShadow({ mode: 'open' }).appendChild(b);
			document.body.appendChild(host);
		});
		const spt = await page.evaluate(() => { const r = document.getElementById('shadow-probe').shadowRoot.querySelector('button').getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta'); await page.mouse.click(spt.x, spt.y);
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await waitForPopover(page); await submit('shadow probe'); await waitForPopoverGone(page);
		check('shadow-root targets are labelled with their host', (await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.markdown())).includes('(inside shadow root of <div>)'), '');
		// --- Keyboard + drafts: e.code chord, dirty Escape, query-only routing ---
		await annot('#c4');
		const codeOnly = await page.evaluate(`(() => { const e = new KeyboardEvent('keydown',
			{ key: '‡', code: 'KeyR', altKey: true, shiftKey: true, bubbles: true, cancelable: true });
			document.dispatchEvent(e); return e.defaultPrevented; })()`);
		check('alt+shift+R is recognized via e.code, not e.key', codeOnly && await page.evaluate(`!!(${POP})`), '');
		await annot('#c3'); // membership edit marks the draft dirty
		await page.evaluate(`(() => { const p = ${POP}; const ta = p.querySelector('.rf-popover-ta');
			ta.value = 'draft guard'; ta.focus(); window.__esc = { seen: 0, downstream: 0 };
			addEventListener('keydown', (e) => { if (e.key !== 'Escape') return;
				window.__esc.seen++;
				setTimeout(() => { window.__esc.prevented = e.defaultPrevented; }, 0); }, true);
			addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc.downstream++; }); })()`);
		await page.keyboard.press('Escape');
		await waitFor(page, `window.__esc.prevented !== undefined`, { description: 'first Escape settled' });
		check('membership edit makes the first Escape blur, not close',
			await page.evaluate(`(() => { const p = ${POP}; return !!p && p.getRootNode().activeElement !== p.querySelector('.rf-popover-ta'); })()`), '');
		const esc = await page.evaluate(() => window.__esc);
		check('the Escape is consumed so a host dialog stays open', esc.prevented && esc.downstream === 0, JSON.stringify(esc));
		await page.keyboard.press('Escape');
		await waitForPopoverGone(page);
		check('a second Escape closes the dirty draft', true, '');
		await annot('#c1');
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'route draft';
			history.pushState({}, '', location.pathname + '?rf=1'); })()`);
		check('query-only route change keeps the draft', await page.evaluate(`(() => { const p = ${POP}; return !!p && p.querySelector('.rf-popover-ta').value === 'route draft'; })()`), '');
		await cancel();
		// Select similar must not re-add members already in the selection.
		// Reload first: a chord release from the previous section inside the
		// double-tap window would otherwise toggle the panel instead of resolving.
		await page.reload();
		await page.evaluate(() => { window.__RF_TEST_MODE__ = true; });
		await page.evaluate(SCRIPT);
		await page.evaluate(() => { for (const id of ['c1', 'c2', 'c3'])
			document.getElementById(id).__svelte_meta = { loc: { file: '/repo/src/lib/Card.svelte', line: 42, column: 8 } }; });
		// One chord hold for both clicks: two quick releases would read as the
		// double-tap that toggles the panel and swallow the second selection.
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('#c1'); await chordClick('#c2');
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await waitForPopover(page);
		await page.evaluate(`(() => { const p = ${POP}; [...p.querySelectorAll('.rf-btn-sm')].find(b => /similar/i.test(b.textContent)).click(); })()`);
		const sim = await page.evaluate(`(() => { const p = ${POP}; return p
			? [...p.querySelectorAll('.rf-sel-row .rf-sel-name')].map(r => r.textContent) : []; })()`);
		check('select similar skips already-selected members', sim.length === 3 && new Set(sim).size === 3, JSON.stringify(sim));
		await cancel();
		// --- A cross-tab change to a rendered field must refresh the card ---
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.clear());
		await seed({ annotations: [row('r1', 100, 'note', { text: 'Old text', selector: '#c1' })], deleted: [] });
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		const cardTitle = () => page.evaluate(`(() => { const panel = ${PANEL};
			return panel?.querySelector('.rf-card-title')?.textContent || ''; })()`);
		const beforeTitle = await cardTitle();
		await seed({ annotations: [row('r1', 200, 'note', { text: 'New text', selector: '#c1' })], deleted: [] });
		const afterTitle = await cardTitle();
		check('panel card refreshes when cross-tab text changes',
			beforeTitle === 'Old text' && afterTitle === 'New text', beforeTitle + ' -> ' + afterTitle);
		// --- Cut All must not wipe a record merged in during the async copy ---
		await page.reload();
		await page.evaluate(() => { window.__RF_TEST_MODE__ = true; });
		await page.evaluate(SCRIPT);
		await installClipboard();
		await seed({ annotations: [row('cut1', 100, 'to cut')], deleted: [] });
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
				writeText(t) { window.__copy.texts.push(t); return new Promise(res => { window.__deferredCut = res; }); }
			}});
		});
		await clickCutAll(); await clickCutAll();
		await waitFor(page, '!!window.__deferredCut', { description: 'deferred Cut All copy' });
		await seed({ annotations: [row('cut1', 100, 'to cut'), row('late', 200, 'arrived')], deleted: [] });
		await page.evaluate(() => { window.__deferredCut(); });
		await waitFor(page, `window.__SCOPE_FEEDBACK_API__.annotations.length === 1`, { description: 'Cut All by id' });
		const survivors = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.map(a => a.id));
		check('Cut All keeps records merged during the copy',
			JSON.stringify(survivors) === '["late"]', JSON.stringify(survivors));
		// --- API gating: without the harness flag, no page-facing global is installed ---
		await page.reload();
		await page.evaluate(SCRIPT); // deliberately no __RF_TEST_MODE__
		check('the page-facing API is absent without test mode', await page.evaluate(() => typeof window.__SCOPE_FEEDBACK_API__ === 'undefined'), '');
		return finish();
	});
};
