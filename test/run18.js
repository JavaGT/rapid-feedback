// 2026-11-22 feedback: pinch-zoom in Safari left the chord outline (and the
// popover/markers that share its positioning) offset from their targets. Safari
// reports getBoundingClientRect relative to the visual viewport while
// position:fixed uses the layout viewport; the fixed-at-origin probe measures
// that gap. Stub the probe to simulate the pinch offset and assert every
// BCR-derived overlay lands on the target anyway.
const { createReporter, withPage, waitFor, POP } = require('./common');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const DX = 64, DY = 37;
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

const OUTLINE = `(() => {
  const o = [...document.querySelectorAll('[data-rf-chrome]')]
    .map(h => h.shadowRoot?.querySelector('[data-rf-outline]')).find(Boolean);
  const t = document.querySelector('#c1').getBoundingClientRect();
  const r = o?.getBoundingClientRect();
  return { target: { top: t.top, left: t.left, bottom: t.bottom, width: t.width, height: t.height },
    outline: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null };
})()`;

const STUB_PROBE = `(() => {
  const probe = document.querySelector('[data-rf-fixed-probe]');
  if (!probe) return false;
  const real = probe.getBoundingClientRect();
  probe.getBoundingClientRect = () => ({
    x: real.x - ${DX}, y: real.y - ${DY},
    left: real.left - ${DX}, top: real.top - ${DY},
    right: real.right - ${DX}, bottom: real.bottom - ${DY},
    width: real.width, height: real.height
  });
  return true;
})()`;

module.exports = () => withPage(async (page) => {
	const r = createReporter();

	async function hoverC1() {
		await page.evaluate(() => {
			const el = document.querySelector('#c1');
			const b = el.getBoundingClientRect();
			el.dispatchEvent(new MouseEvent('mousemove', {
				bubbles: true, composed: true, cancelable: true,
				altKey: true, metaKey: true, ctrlKey: true,
				clientX: b.left + b.width / 2, clientY: b.top + b.height / 2
			}));
		});
		await delay(80);
	}

	// First hover creates the outline host AND the fixed probe.
	await hoverC1();
	await waitFor(page, `!!(${OUTLINE}.outline)`, { description: 'initial chord outline' });
	const baseline = await page.evaluate(OUTLINE);
	r.check('baseline outline sits on the target without a zoom offset',
		baseline.outline && near(baseline.outline.top, baseline.target.top - 2)
			&& near(baseline.outline.left, baseline.target.left - 2), JSON.stringify(baseline));

	// Simulate Safari: BCR of a fixed element at (0,0) reads (-DX,-DY).
	r.check('fixed probe exists for the offset measurement', await page.evaluate(STUB_PROBE));

	await hoverC1();
	const zoomed = await page.evaluate(OUTLINE);
	r.check('outline follows the target under a pinch offset',
		zoomed.outline && near(zoomed.outline.top, zoomed.target.top + DY - 2)
			&& near(zoomed.outline.left, zoomed.target.left + DX - 2)
			&& near(zoomed.outline.width, zoomed.target.width + 8)
			&& near(zoomed.outline.height, zoomed.target.height + 8),
		JSON.stringify(zoomed));

	// The popover is placed from the same rect, so it must shift with it too.
	const box = await page.evaluate(() => {
		const b = document.querySelector('#c1').getBoundingClientRect();
		return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
	});
	await page.keyboard.down('Alt');
	await page.keyboard.down('Meta');
	await page.mouse.click(box.x, box.y);
	await page.keyboard.up('Meta');
	await page.keyboard.up('Alt');
	await waitFor(page, `!!(${POP})`, { description: 'popover under pinch offset' });
	await delay(80);
	const pop = await page.evaluate(`(() => {
		const p = ${POP}; const r = p.getBoundingClientRect();
		return { top: r.top, left: r.left };
	})()`);
	r.check('popover follows the target under a pinch offset',
		near(pop.top, zoomed.target.bottom + 8 + DY) && near(pop.left, zoomed.target.left + DX),
		JSON.stringify(pop));

	return r.finish();
});
