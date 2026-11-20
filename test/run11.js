// A target in the browser's top layer (native modal dialog, ui-sdk style popup)
// must still get an outline and a popover at the right viewport coordinates.
// Hosting chrome INSIDE the page's top-layer element wins paint order but breaks
// positioning when that element is a containing block for fixed children
// (transform/translate/filter, Safari's dialog handling); v5.23 gives each of our
// hosts its own top-layer popover instead.
const { createReporter, withPage, waitFor } = require('./common');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

const SNAPSHOT = `(() => {
  const target = document.querySelector('#rf-target');
  const tr = target.getBoundingClientRect();
  const hosts = [...document.querySelectorAll('[data-rf-chrome]')];
  const oHost = hosts.find(h => h.shadowRoot?.querySelector('[data-rf-outline]'));
  const pHost = hosts.find(h => h.shadowRoot?.querySelector('.rf-popover'));
  const o = oHost?.shadowRoot?.querySelector('[data-rf-outline]')?.getBoundingClientRect();
  const p = pHost?.shadowRoot?.querySelector('.rf-popover')?.getBoundingClientRect();
  return {
    target: { top: tr.top, left: tr.left, bottom: tr.bottom, width: tr.width, height: tr.height },
    outline: o ? { top: o.top, left: o.left, width: o.width, height: o.height } : null,
    popover: p ? { top: p.top, left: p.left } : null,
    outlineParent: oHost?.parentElement?.tagName || null,
    outlineTopLayer: !!oHost?.matches(':popover-open'),
    popoverTopLayer: !!pHost?.matches(':popover-open'),
  };
})()`;

const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

module.exports = () => withPage(async (page) => {
	const r = createReporter();

	async function case_(kind, transform) {
		await page.keyboard.press('Escape');
		await delay(50);
		await page.evaluate(({ kind, transform }) => {
			for (const id of ['rf-modal', 'rf-popup']) document.getElementById(id)?.remove();
			const el = document.createElement(kind === 'dialog' ? 'dialog' : 'div');
			el.id = kind === 'dialog' ? 'rf-modal' : 'rf-popup';
			if (kind === 'popup') el.setAttribute('popover', 'manual');
			el.style.cssText = 'position:fixed;top:140px;left:300px;width:420px;height:240px;margin:0;padding:20px;'
				+ (transform ? 'transform:translateZ(0);' : '');
			el.innerHTML = '<label id="rf-target" style="display:block;width:200px;height:18px;background:#eee">Name pattern</label>';
			document.body.appendChild(el);
			if (kind === 'dialog') el.showModal(); else el.showPopover();
		}, { kind, transform });

		const box = await page.evaluate(() => {
			const el = document.querySelector('#rf-target');
			const b = el.getBoundingClientRect();
			el.dispatchEvent(new MouseEvent('mousemove', {
				bubbles: true, composed: true, cancelable: true,
				altKey: true, metaKey: true, ctrlKey: true,
				clientX: b.left + b.width / 2, clientY: b.top + b.height / 2
			}));
			return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
		});
		await waitFor(page, `!!(${SNAPSHOT}.outline)`, { description: 'chord outline for ' + kind });
		const hover = await page.evaluate(SNAPSHOT);
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		await page.mouse.click(box.x, box.y);
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		await waitFor(page, `!!(${SNAPSHOT}.popover)`, { description: 'popover for ' + kind });
		const clicked = await page.evaluate(SNAPSHOT);

		const label = kind + (transform ? ' (transformed)' : '');
		r.check(label + ': outline tracks the target', hover.outline
			&& near(hover.outline.top, hover.target.top - 2)
			&& near(hover.outline.left, hover.target.left - 2)
			&& near(hover.outline.width, hover.target.width + 8)
			&& near(hover.outline.height, hover.target.height + 8), JSON.stringify(hover));
		r.check(label + ': popover sits below the target', clicked.popover
			&& near(clicked.popover.top, clicked.target.bottom + 8)
			&& near(clicked.popover.left, clicked.target.left), JSON.stringify(clicked));
		r.check(label + ': chrome is in its own top layer', hover.outlineTopLayer
			&& clicked.popoverTopLayer && hover.outlineParent === 'HTML', JSON.stringify(clicked));
	}

	await case_('dialog', false);
	await case_('dialog', true);   // the regression: fixed children of a transformed dialog
	await case_('popup', true);

	// Ordinary targets must behave exactly as before.
	await page.keyboard.press('Escape');
	await delay(50);
	await page.evaluate(() => { for (const id of ['rf-modal', 'rf-popup']) document.getElementById(id)?.remove(); });
	await page.evaluate(() => {
		const el = document.querySelector('#c1');
		const b = el.getBoundingClientRect();
		el.dispatchEvent(new MouseEvent('mousemove', {
			bubbles: true, composed: true, cancelable: true,
			altKey: true, metaKey: true, ctrlKey: true,
			clientX: b.left + b.width / 2, clientY: b.top + b.height / 2
		}));
	});
	await delay(120);
	const ordinary = await page.evaluate(`(() => {
		const t = document.querySelector('#c1').getBoundingClientRect();
		const o = [...document.querySelectorAll('[data-rf-chrome]')]
			.map(h => h.shadowRoot?.querySelector('[data-rf-outline]')?.getBoundingClientRect())
			.find(Boolean);
		return { target: { top: t.top, left: t.left }, outline: o ? { top: o.top, left: o.left } : null };
	})()`);
	r.check('ordinary target: outline still tracks it', ordinary.outline
		&& near(ordinary.outline.top, ordinary.target.top - 2)
		&& near(ordinary.outline.left, ordinary.target.left - 2), JSON.stringify(ordinary));

	return r.finish();
});
