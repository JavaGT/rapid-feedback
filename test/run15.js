// 2026-11-21 feedback: our input window owns interactions over its own surface
// (a click in the editor must not fire a page modal's outside-press/click-away),
// and a chord target inside a top-layer modal must keep that target even when
// the engine's elementsFromPoint omits top-layer content.
const { POP, createReporter, withPage, waitFor, waitForPopover } = require('./common');
const fs = require('fs');

const SCRIPT = fs.readFileSync(__dirname + '/../rapid-feedback.user.js', 'utf8');
const OUTLINE = `[...document.querySelectorAll('[data-rf-chrome]')].map(h => h.shadowRoot?.querySelector('[data-rf-outline]')).find(Boolean)`;
const delay = ms => new Promise(r => setTimeout(r, ms));

// Mirror the tool's platform detection so the chord fixture works in both the
// Chrome and Firefox harness runs.
const chordModifier = async (page) => {
	const useMeta = await page.evaluate(() => navigator.userAgentData?.platform
		? navigator.userAgentData.platform === 'macOS'
		: /Mac|iPhone|iPod|iPad/i.test(navigator.platform || ''));
	return useMeta ? 'Meta' : 'Control';
};

// A ui-sdk-style top-layer dialog (a popover div, like the real app's
// DialogContent) with a child target, plus the outside-press listener ui-sdk
// installs on window capture: a press outside the dialog content dismisses it.
const MAKE_DIALOG = () => {
	const dlg = document.createElement('div');
	dlg.id = 'rf-dialog';
	dlg.setAttribute('popover', 'manual');
	dlg.style.cssText = 'position:fixed;top:100px;left:300px;width:440px;height:280px;margin:0;padding:0;border:1px solid #999';
	dlg.innerHTML = '<dl><dt>Kind</dt><dd id="rf-child" style="width:220px;height:18px;background:#eef">Interview 07 — Marina · interview</dd></dl>';
	document.body.appendChild(dlg);
	dlg.showPopover();
	window.__rfDialogCloses = 0;
	addEventListener('pointerdown', (e) => {
		// ui-sdk treats a press as outside unless the composed path crosses the
		// dialog content. Our editor must present itself as inside that surface.
		if (e.composedPath().includes(dlg)) return;
		if (dlg.matches(':popover-open')) { dlg.hidePopover(); window.__rfDialogCloses++; }
	}, { capture: true });
};

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {
		let chordKey;
		// --- A: the editor hijacks interactions over its own surface ---
		await page.evaluate(MAKE_DIALOG);
		await page.keyboard.down('Alt');
		chordKey = await chordModifier(page);
		await page.keyboard.down(chordKey);
		await chordClick('#rf-child');
		await page.keyboard.up(chordKey);
		await page.keyboard.up('Alt');
		await waitForPopover(page);
		check('chord-click opened the editor', await page.evaluate(`!!(${POP})`));
		const closesAfterChord = await page.evaluate(() => window.__rfDialogCloses);
		check('the chord click itself kept the modal open', closesAfterChord === 0, String(closesAfterChord));

		const ta = await page.evaluate(`(() => {
			const p = ${POP}; const r = p.querySelector('.rf-popover-ta').getBoundingClientRect();
			const pr = p.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.toJSON(), popover: pr.toJSON() };
		})()`);
		await page.mouse.click(ta.x, ta.y);
		await delay(200);
		const afterEditorClick = await page.evaluate(`(() => ({
			open: document.getElementById('rf-dialog').matches(':popover-open'),
			closes: window.__rfDialogCloses,
			editor: !!(${POP}),
		}))()`);
		check('a click in the feedback editor does not click the modal away',
			afterEditorClick.open && afterEditorClick.closes === 0, JSON.stringify(afterEditorClick));
		check('the editor stays focused and open for typing', afterEditorClick.editor, JSON.stringify(afterEditorClick));
		const focus = await page.evaluate(`(() => { const ta = ${POP}.querySelector('.rf-popover-ta'); ta.focus(); return { active: document.activeElement === ta, activeTag: document.activeElement?.tagName, activeCls: document.activeElement?.className }; })()`);
		await page.keyboard.type('modal draft');
		const typed = await page.evaluate(`(() => ${POP}.querySelector('.rf-popover-ta').value)()`);
		check('the editor still receives keystrokes', typed === 'modal draft', JSON.stringify({ typed, focus }));

		// A click genuinely outside the modal must still dismiss it.
		await page.mouse.click(60, 700);
		await delay(200);
		const afterOutside = await page.evaluate(`(() => ({
			open: document.getElementById('rf-dialog').matches(':popover-open'),
			closes: window.__rfDialogCloses,
			editor: !!(${POP}),
		}))()`);
		check('an outside click still dismisses the modal', !afterOutside.open && afterOutside.closes === 1, JSON.stringify(afterOutside));
		check('the outside click does not close the editor', afterOutside.editor, JSON.stringify(afterOutside));

		// --- B: a top-layer child stays the target when hit-testing misses it ---
		await page.reload();
		await page.evaluate(() => { window.__RF_TEST_MODE__ = true; });
		await page.evaluate(SCRIPT);
		await page.evaluate(() => {
			const dlg = document.createElement('div');
			dlg.id = 'rf-dialog';
			dlg.setAttribute('popover', 'manual');
			dlg.style.cssText = 'position:fixed;top:100px;left:300px;width:440px;height:280px;margin:0;padding:0;border:1px solid #999';
			dlg.innerHTML = '<dl><dt>Kind</dt><dd id="rf-child" style="width:220px;height:18px;background:#eef">Interview 07 — Marina · interview</dd></dl>';
			document.body.appendChild(dlg);
			dlg.showPopover();
			// Simulate an engine whose elementsFromPoint omits top-layer content:
			// only page elements behind the modal are returned.
			const native = document.elementsFromPoint.bind(document);
			document.elementsFromPoint = (x, y) => native(x, y)
				.filter(el => !el.closest?.('dialog[open], [popover]:popover-open'));
		});
		const box = await page.evaluate(() => {
			const r = document.getElementById('rf-child').getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
		});
		await page.keyboard.down('Alt');
		chordKey = await chordModifier(page);
		await page.keyboard.down(chordKey);
		await page.mouse.move(box.x, box.y);
		await waitFor(page, `!!(${OUTLINE})`, { description: 'outline for top-layer child' });
		await delay(150); // let the rAF coalesced hover settle on the final event
		const outline = await page.evaluate(`(() => { const r = ${OUTLINE}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
		await page.keyboard.up(chordKey);
		await page.keyboard.up('Alt');
		check('outline tracks a modal child when hit-testing omits top layer',
			Math.abs(outline.x - (box.rect.x - 2)) <= 2 && Math.abs(outline.y - (box.rect.y - 2)) <= 2
				&& Math.abs(outline.w - (box.rect.w + 8)) <= 2 && Math.abs(outline.h - (box.rect.h + 8)) <= 2,
			JSON.stringify({ target: box.rect, outline }));

		return finish();
	});
};
