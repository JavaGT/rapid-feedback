// v5.6: the tool's own chrome must never intercept a chord click or become an
// annotation target, and a comment must stay editable from any page.
const { POP, createReporter, withPage } = require('./common');

const PANEL = `[...document.body.children, ...document.documentElement.children].find(h => h.shadowRoot?.querySelector('.rf-panel'))?.shadowRoot`;

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {
		// Park a page element directly under the FAB's corner so the FAB covers it.
		await page.evaluate(() => {
			const t = document.createElement('div');
			t.id = 'under-fab';
			t.textContent = 'covered';
			t.style.cssText = 'position:fixed;bottom:20px;right:20px;width:44px;height:44px;background:#cdf';
			document.body.appendChild(t);
		});

		// --- A concealed FAB must not intercept ordinary clicks ---
		// It starts hidden with no annotations on this page. Hidden has to mean
		// untouchable: opacity:0 alone still hit-tests.
		await page.evaluate(() => { window.__rfHits = 0; document.getElementById('under-fab').addEventListener('click', () => window.__rfHits++); });
		await page.$eval('#under-fab', el => { const r = el.getBoundingClientRect(); window.__rfPt = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		const pt = await page.evaluate(() => window.__rfPt);
		await page.mouse.click(pt.x, pt.y);
		await new Promise(r => setTimeout(r, 150));
		let hits = await page.evaluate(() => window.__rfHits);
		const panelAfter = await page.evaluate(`(() => !!${PANEL} && ${PANEL}.host.style.display !== 'none')()`);
		check('a concealed FAB does not swallow ordinary clicks', hits === 1, 'hits=' + hits);
		check('a concealed FAB does not open the panel', !panelAfter, String(panelAfter));

		// --- Chord + click where the FAB sits: the element underneath wins ---
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await page.mouse.move(600, 400); // reveal FAB via chord keydown already done
		await chordClick('#under-fab');
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 250));
		let state = await page.evaluate(`(() => { const p = ${POP}; return {
			popover: !!p, sub: p?.querySelector('.rf-sub').textContent,
			panelOpen: !!${PANEL} && ${PANEL}.host.style.display !== 'none' }; })()`);
		check('chord-click passes through the FAB to the element beneath',
			state.popover && /under-fab/.test(state.sub || ''), JSON.stringify(state));
		check('the FAB did not open the panel instead', !state.panelOpen, JSON.stringify(state));

		// --- Chrome is interactive again once the chord is released ---
		const fabLive = await page.evaluate(`(() => {
			const host = [...document.body.children, ...document.documentElement.children].find(h => h.shadowRoot?.querySelector('.rf-fab'));
			return host ? !host.hasAttribute('data-rf-passthrough') : false; })()`);
		check('chrome becomes interactive again after chord release', fabLive, String(fabLive));

		// --- The open popover itself is click-through under a chord ---
		const popPass = await page.evaluate(`(() => {
			const host = [...document.body.children, ...document.documentElement.children].find(h => h.shadowRoot?.querySelector('.rf-popover'));
			if (!host) return null;
			const before = host.hasAttribute('data-rf-passthrough');
			return { before }; })()`);
		check('popover is interactive while no chord is held', popPass && popPass.before === false, JSON.stringify(popPass));

		// --- Chord-clicking with the popover open grows the selection ---
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'keep me'; })()`);
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('#c2');
		await chordClick('#c3');
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 250));
		state = await page.evaluate(`(() => { const p = ${POP}; if (!p) return {gone:true}; return {
			rows: p.querySelectorAll('.rf-sel-row').length,
			comment: p.querySelector('.rf-popover-ta').value }; })()`);
		check('chord-click with popover open adds to the selection', state.rows === 3, JSON.stringify(state));
		check('growing the selection keeps the draft comment', state.comment === 'keep me', JSON.stringify(state));

		// --- Chrome can never be annotated ---
		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 150));
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		await new Promise(r => setTimeout(r, 200));
		const before = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.length);
		// Chord-click straight at the panel, which covers the right edge of the page.
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await page.mouse.click(1100, 300);
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 250));
		state = await page.evaluate(`(() => { const p = ${POP}; return {
			popover: !!p, sub: p?.querySelector('.rf-sub').textContent }; })()`);
		check('chord-click on the panel never targets tool chrome',
			!/rf-|rapid/i.test(state.sub || ''), JSON.stringify(state));
		const after = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.length);
		check('no annotation was created from tool chrome', after === before, before + ' -> ' + after);

		// --- A comment stays editable from a different page ---
		await page.evaluate(() => {
			window.__SCOPE_FEEDBACK_API__.clear();
			localStorage.setItem('scope_feedback_annotations', JSON.stringify([{
				selector: 'div#c1.card', tag: 'div', text: 'First card', url: 'https://example.com/other',
				comment: 'from another page', category: 'general'
			}]));
		});
		await page.reload();
		await page.evaluate(require('fs').readFileSync(__dirname + '/../rapid-feedback.user.js', 'utf8'));
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		await new Promise(r => setTimeout(r, 200));
		const loaded = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.length);
		check('annotation from another page loads', loaded === 1, String(loaded));
		await page.evaluate(`(() => { ${PANEL}.querySelector('.rf-btn-icon[data-idx="0"]').click(); })()`);
		await new Promise(r => setTimeout(r, 200));
		const editable = await page.evaluate(`(() => {
			const cel = ${PANEL}.querySelector('.rf-card[data-idx="0"] .rf-comment');
			return { editable: cel?.getAttribute('contenteditable'), popover: !!${POP} }; })()`);
		check('editing an off-page annotation edits the comment in place, not the popover',
			editable.editable === 'true' && !editable.popover, JSON.stringify(editable));
		await page.evaluate(`(() => {
			const cel = ${PANEL}.querySelector('.rf-card[data-idx="0"] .rf-comment');
			cel.textContent = 'edited elsewhere';
			${PANEL}.querySelector('.rf-btn-icon[data-idx="0"]').click(); })()`);
		await new Promise(r => setTimeout(r, 200));
		const saved = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations[0].comment);
		check('the off-page comment edit persists', saved === 'edited elsewhere', String(saved));

		return finish();
	});
};
