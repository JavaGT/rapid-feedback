// #70 — the chord outline must stay visible over elements in the browser's top
// layer. Native modal dialogs and ui-sdk style popups paint above every z-index,
// so an outline hosted on <html> silently disappears behind them. The fix hosts
// the overlay chrome inside the top-layer element that owns the target.
const { createReporter, withPage, waitFor } = require('./common');

const HOST_AND_PARENT = `(() => {
	for (const h of document.querySelectorAll('[data-rf-chrome]')) {
		if (!h.shadowRoot?.querySelector('[data-rf-outline]')) continue;
		const p = h.parentElement;
		return { found: true, tag: p?.tagName, id: p?.id, popover: !!p?.hasAttribute('popover') };
	}
	return { found: false };
})()`;

const expect = (kind) => `(() => {
	const p = ${HOST_AND_PARENT};
	if (${JSON.stringify(kind)} === 'dialog') return p.tag === 'DIALOG' && p.id === 'rf-modal';
	if (${JSON.stringify(kind)} === 'popover') return p.popover;
	return p.tag === 'HTML';
})()`;

module.exports = () => withPage(async (page) => {
	const r = createReporter();

	const hover = (sel) => page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) throw new Error('no element ' + sel);
		const b = el.getBoundingClientRect();
		el.dispatchEvent(new MouseEvent('mousemove', {
			bubbles: true, composed: true, cancelable: true,
			altKey: true, ctrlKey: true,
			clientX: b.left + b.width / 2, clientY: b.top + b.height / 2
		}));
	}, sel);

	// --- native <dialog showModal()> ---
	await page.evaluate(() => {
		const d = document.createElement('dialog');
		d.id = 'rf-modal';
		d.innerHTML = '<button id="rf-in-dialog" style="width:120px;height:40px">Inside modal</button>';
		document.body.appendChild(d);
		d.showModal();
	});
	await hover('#rf-in-dialog');
	await waitFor(page, expect('dialog'), { description: 'outline moves into the modal dialog' });
	const overModal = await page.evaluate(HOST_AND_PARENT);
	r.check('outline for a modal-dialog target is hosted inside the dialog', overModal.tag === 'DIALOG' && overModal.id === 'rf-modal', JSON.stringify(overModal));

	// --- ui-sdk style popup: div[popover] shown into the top layer ---
	await page.evaluate(() => {
		document.querySelector('#rf-modal').close();
		const p = document.createElement('div');
		p.id = 'rf-popup';
		p.setAttribute('popover', 'manual');
		p.innerHTML = '<button id="rf-in-popup" style="width:120px;height:40px">Inside popup</button>';
		document.body.appendChild(p);
		p.showPopover();
	});
	await hover('#rf-in-popup');
	await waitFor(page, expect('popover'), { description: 'outline moves into the popup' });
	const overPopup = await page.evaluate(HOST_AND_PARENT);
	r.check('outline for a top-layer popup target is hosted inside the popup', overPopup.popover, JSON.stringify(overPopup));

	// --- ordinary element: host returns to <html> ---
	await page.evaluate(() => document.querySelector('#rf-popup').hidePopover());
	await hover('#c1');
	await waitFor(page, expect('html'), { description: 'outline returns to <html>' });
	const ordinary = await page.evaluate(HOST_AND_PARENT);
	r.check('outline for a normal target is hosted on <html>', ordinary.tag === 'HTML', JSON.stringify(ordinary));

	return r.finish();
});
