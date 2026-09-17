// #46 step 1 (tests-first): branch-preserving placement matrix for the popover,
// asserted through the real UI at controlled viewport sizes, plus the centered
// fallback rect and the dragged-offset clamp. The formulas below are the spec:
// placePopover's five branches, centeredFallbackRect, and the 8px edge policy.
const { POP, createReporter, withPage, waitForPopover, waitForPopoverGone } = require('./common');

const GAP = 8, PAD = 8, POPOVER_W = 320;
// A pristine draft closes on Escape, but the popover may autofocus its comment
// box — then the first Escape only blurs. Retry once.
const close = async (page) => {
	await page.keyboard.press('Escape');
	try { await waitForPopoverGone(page, { timeoutMs: 800, description: 'popover closed' }); return; } catch {}
	await page.keyboard.press('Escape');
	await waitForPopoverGone(page, { timeoutMs: 800, description: 'popover closed on second Escape' });
};

async function openOn(page, [x, y, w, h], id) {
	await page.evaluate(([x, y, w, h, id]) => {
		const el = document.createElement('div');
		el.id = id;
		el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:2147483646`;
		document.body.appendChild(el);
	}, [x, y, w, h, id]);
	const box = await page.$eval('#' + id, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
	await page.keyboard.down('Alt');
	await page.keyboard.down('Meta');
	await page.mouse.click(box.x, box.y);
	await page.keyboard.up('Meta');
	await page.keyboard.up('Alt');
	await waitForPopover(page, { description: 'popover open on #' + id });
}

// Live geometry: the anchor rect, the popover rect (transform already applied),
// and the measured height placement used. Expected values are computed from
// these, so the matrix stays exact whatever the popover's content height is.
const GEO = `(() => { const p = ${POP}; const a = document.querySelector('#${'PLACEHOLDER'}');
	const ar = a.getBoundingClientRect(); const r = p.getBoundingClientRect();
	return { at: ar.top, ab: ar.bottom, al: ar.left, ar2: ar.right, pt: r.top, pl: r.left, h: p.offsetHeight, iw: innerWidth, ih: innerHeight }; })()`;

async function readGeo(page, id) {
	return page.evaluate(GEO.replace('PLACEHOLDER', id));
}

const near = (a, b) => Math.abs(a - b) <= 1;

module.exports = async function run10() {
	const { check, finish } = createReporter();
	return withPage(async (page) => {
		let n = 0;
		const matrixCase = async (name, vw, vh, rect, branch) => {
			n++;
			const id = 'pa' + n;
			await page.setViewport({ width: vw, height: vh });
			await openOn(page, rect, id);
			// Placement uses the height measured when it ran; late content growth
			// does not re-place (the anchor key tracks target+viewport, not height).
			// Let content settle, then force the production re-place path — a 1px
			// viewport change puts innerHeight in the anchor key — and assert
			// against the settled geometry.
			await new Promise(r => setTimeout(r, 200));
			await page.setViewport({ width: vw, height: vh - 1 });
			await new Promise(r => setTimeout(r, 100));
			const g = await readGeo(page, id);
			let top, left, why;
			if (branch === 'below') { top = g.ab + GAP; left = Math.min(Math.max(g.al, PAD), g.iw - POPOVER_W - PAD); why = `top=bottom+${GAP}`; }
			else if (branch === 'above') { top = g.at - g.h - GAP; left = Math.min(Math.max(g.al, PAD), g.iw - POPOVER_W - PAD); why = `top=top-h-${GAP}`; }
			else if (branch === 'right') { top = Math.min(Math.max(g.at, PAD), g.ih - g.h - PAD); left = g.ar2 + GAP; why = `left=right+${GAP}`; }
			else if (branch === 'left') { top = Math.min(Math.max(g.at, PAD), g.ih - g.h - PAD); left = g.al - POPOVER_W - GAP; why = `left=left-w-${GAP}`; }
			else { const bestY = g.at > g.ih / 2 ? g.at - g.h - GAP : g.ab + GAP; top = Math.min(Math.max(bestY, PAD), g.ih - g.h - PAD); left = Math.min(Math.max(g.al, PAD), g.iw - POPOVER_W - PAD); why = 'overlap bestY'; }
			check(name + ' — ' + branch + ' (' + why + ')', near(g.pt, top) && near(g.pl, left),
				`expected (${top},${left}) got (${g.pt},${g.pl})`);
			await page.evaluate((id) => document.getElementById(id)?.remove(), id);
			await close(page);
			await waitForPopoverGone(page, { description: 'popover closed after ' + name });
		};

		await matrixCase('placement matrix: room below target', 1200, 800, [100, 100, 200, 50], 'below');
		await matrixCase('placement matrix: target near viewport bottom', 1200, 800, [100, 700, 200, 50], 'above');
		await matrixCase('placement matrix: full-height target at left', 1200, 800, [100, 0, 100, 800], 'right');
		await matrixCase('placement matrix: full-height target at right', 1200, 800, [1100, 0, 100, 800], 'left');
		await matrixCase('placement matrix: target fills viewport', 1200, 800, [0, 0, 1200, 800], 'overlap');
		await matrixCase('placement matrix: lower-half target collapses upward with clamp', 1200, 800, [0, 500, 1200, 300], 'overlap');
		await matrixCase('placement matrix: narrow viewport pads the left clamp', 800, 600, [700, 50, 80, 40], 'below');

		// Centered fallback: with the anchor target removed, Alt+Shift+R reset must
		// place the popover at top:80, horizontally centered with the edge pad.
		await page.setViewport({ width: 1200, height: 800 });
		const fid = 'paf';
		await openOn(page, [100, 100, 200, 50], fid);
		await page.evaluate(() => document.querySelector('#paf').remove());
		await page.keyboard.down('Alt');
		await page.keyboard.down('Shift');
		await page.keyboard.press('r');
		await page.keyboard.up('Shift');
		await page.keyboard.up('Alt');
		await page.waitForFunction(`(() => { const p = ${POP}; return p && p.getBoundingClientRect().top > 0; })()`, { timeout: 2000 })
			.catch(() => {});
		const f = await page.evaluate(`(() => { const r = ${POP}.getBoundingClientRect(); return { pt: r.top, pl: r.left }; })()`);
		// The fallback rect's top is 80; placePopover then applies the below-gap,
		// so the popover lands at 80 + gap, horizontally centered with the pad.
		check('centered fallback: rect top 80, centered with pad', near(f.pt, 80 + GAP) && near(f.pl, Math.max(PAD, (1200 - POPOVER_W) / 2)),
			`expected (${80 + GAP},${Math.max(PAD, (1200 - POPOVER_W) / 2)}) got (${f.pt},${f.pl})`);
		await close(page);
		await waitForPopoverGone(page, { description: 'popover closed after fallback' });

		// Dragged-offset clamp: dragging far past an edge must clamp to the 8px pad,
		// not lose the popover.
		const clampCase = async (name, dx, dy, expectX, expectY) => {
			const cid = 'pac';
			await openOn(page, [300, 300, 200, 50], cid);
			const handle = await page.evaluate(`(() => { const r = ${POP}.querySelector('.rf-drag-handle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			await page.mouse.move(handle.x, handle.y);
			await page.mouse.down();
			await page.mouse.move(handle.x + dx, handle.y + dy, { steps: 5 });
			await page.mouse.up();
			const g = await page.evaluate(`(() => { const r = ${POP}.getBoundingClientRect(); return { pt: r.top, pl: r.left, h: ${POP}.offsetHeight, iw: innerWidth, ih: innerHeight }; })()`);
			check(name, near(g.pl, expectX(g)) && near(g.pt, expectY(g)), `got (${g.pl},${g.pt}) h=${g.h} viewport=${g.iw}x${g.ih}`);
			await page.evaluate(() => document.querySelector('#pac')?.remove());
			await close(page);
			await waitForPopoverGone(page, { description: 'popover closed after clamp case' });
		};
		await clampCase('drag clamp: far up-left pins to pad', -20000, -20000, () => PAD, () => PAD);
		await clampCase('drag clamp: far down-right pins to viewport edge',
			20000, 20000, g => g.iw - POPOVER_W - PAD, g => g.ih - g.h - PAD);

		return finish();
	});
};
