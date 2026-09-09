// Edge cases around "Select similar": non-HTML elements, and undo when the user
// promoted one of the added siblings to primary.
const fs = require('fs');
const path = require('path');
const { POP, createReporter, withPage } = require('./common');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'rapid-feedback.user.js'), 'utf8');
const clickSimilar = `(() => { const p = ${POP}; [...p.querySelectorAll('.rf-btn-sm')].find(b => /similar/i.test(b.textContent)).click(); })()`;

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page) => {
		const errors = [];
		page.on('pageerror', e => errors.push(e.message));
		// A second fixture: sibling <svg> icons expose className as an
		// SVGAnimatedString, which is not a string and cannot be split.
		await page.goto('file://' + path.join(__dirname, 'page2.html'));
		await page.evaluate(SCRIPT);
		const chordClick = async (sel) => {
			const b = await page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
			await page.mouse.click(b.x, b.y);
		};

		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('#s1');
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 250));
		errors.length = 0;
		// The click lands on the svg's inner <rect>; zoom up so the primary is the
		// <svg> itself.
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-zoom-row button').click(); })()`);
		await new Promise(r => setTimeout(r, 150));
		await page.evaluate(clickSimilar);
		await new Promise(r => setTimeout(r, 200));
		const rows = await page.evaluate(`(() => { const p = ${POP}; return p ? p.querySelectorAll('.rf-sel-row').length : -1; })()`);
		check('select similar survives an SVG primary', errors.length === 0 && rows === 2,
			'pageerrors=' + JSON.stringify(errors) + ' rows=' + rows);

		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 150));
		await page.evaluate(() => localStorage.clear());

		// Promote an added sibling to primary, then undo the similar selection.
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('#c1');
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 250));
		await page.evaluate(clickSimilar);
		await new Promise(r => setTimeout(r, 200));
		await page.evaluate(`(() => { const p = ${POP};
			const r = p.querySelectorAll('.rf-sel-row');
			[...r[1].querySelectorAll('.rf-sel-act')].find(b => b.textContent === '★').click(); })()`);
		await new Promise(r => setTimeout(r, 200));
		await page.evaluate(`(() => { const p = ${POP}; [...p.querySelectorAll('.rf-btn-sm')].find(b => /undo/i.test(b.textContent)).click(); })()`);
		await new Promise(r => setTimeout(r, 200));
		await page.evaluate(`(() => { const p = ${POP};
			p.querySelector('.rf-popover-ta').value = 'x'; p.querySelector('.rf-btn-primary').click(); })()`);
		await new Promise(r => setTimeout(r, 200));
		const saved = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations);
		const a = saved[saved.length - 1];
		check('undo re-seats the primary onto a still-selected element',
			!!a && /c1/.test(a.selector), 'saved selector=' + (a && a.selector));

		// Regression (tracker #4): a Svelte-like meta shaped {file} without {loc}
		// used to throw inside directSvelteFile (meta.loc.file), silently killing
		// Select similar. Same-file siblings must still group, with no pageerror.
		await page.goto('file://' + path.join(__dirname, 'page.html'));
		await page.evaluate(SCRIPT);
		await page.evaluate(() => localStorage.clear());
		await page.evaluate(`(() => {
			const group = document.createElement('div');
			group.style.cssText = 'position:fixed;top:20px;left:20px;';
			for (let i = 0; i < 3; i++) {
				const d = document.createElement('div');
				d.className = 'locless-' + i;
				d.textContent = 'locless sibling ' + i;
				d.style.cssText = 'width:90px;height:26px;background:#eee;';
				d.__svelte_meta = { file: 'widget.svelte' };
				group.appendChild(d);
			}
			document.body.appendChild(group);
		})()`);
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('.locless-1');
		await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 250));
		errors.length = 0;
		await page.evaluate(clickSimilar);
		await new Promise(r => setTimeout(r, 200));
		const loclessRows = await page.evaluate(`(() => { const p = ${POP}; return p ? p.querySelectorAll('.rf-sel-row').length : -1; })()`);
		check('select similar survives a {file}-without-{loc} Svelte meta',
			errors.length === 0 && loclessRows === 3,
			'pageerrors=' + JSON.stringify(errors) + ' rows=' + loclessRows);

		return finish();
	});
};
