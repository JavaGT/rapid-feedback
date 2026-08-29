// Same-origin iframe regression: the top-level picker must reach the actual
// element instead of stopping at the iframe's outer box.
const { POP, createReporter, withPage } = require('./common');

module.exports = async function run7() {
	const { check, finish } = createReporter();
	return withPage(async (page) => {
		await page.evaluate(() => {
			const frame = document.createElement('iframe');
			frame.id = 'rf-frame';
			frame.srcdoc = '<button id="inside" style="margin:20px;width:120px;height:40px">Inside frame</button>';
			frame.style.cssText = 'position:absolute;left:500px;top:240px;width:300px;height:140px;border:4px solid #789';
			document.body.appendChild(frame);
		});
		await new Promise(resolve => setTimeout(resolve, 200));

		const point = await page.$eval('#rf-frame', frame => {
			const target = frame.contentDocument.querySelector('#inside');
			const frameRect = frame.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			return {
				x: frameRect.left + frame.clientLeft + targetRect.left + targetRect.width / 2,
				y: frameRect.top + frame.clientTop + targetRect.top + targetRect.height / 2,
			};
		});
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		await page.mouse.click(point.x, point.y);
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		await new Promise(resolve => setTimeout(resolve, 200));

		let state = await page.evaluate(`(() => {
			const p = ${POP};
			return p ? {
				selector: p.querySelector('.rf-sub').textContent,
				quote: p.querySelector('.rf-quote').textContent,
				popoverRect: p.getRootNode().host.getBoundingClientRect().toJSON(),
			} : null;
		})()`);
		check('same-origin iframe opens the child popover', !!state, JSON.stringify(state));
		check('iframe pick targets the inner element', /inside/.test(state?.selector || '') && !/rf-frame/.test(state?.selector || ''), JSON.stringify(state));
		check('iframe pick captures child text', /Inside frame/.test(state?.quote || ''), JSON.stringify(state));

		await page.evaluate(`(() => {
			const p = ${POP};
			p.querySelectorAll('.rf-tab-btn')[1].click();
			const padding = p.querySelector('.rf-styles-grid input');
			padding.value = '12px';
			padding.dispatchEvent(new Event('input', { bubbles: true }));
			p.querySelector('.rf-popover-ta').value = 'iframe target';
			p.querySelector('.rf-btn-primary').click();
		})()`);
		await new Promise(resolve => setTimeout(resolve, 150));
		const saved = await page.evaluate(() => {
			const a = window.__SCOPE_FEEDBACK_API__.annotations.at(-1);
			const frame = a?.framePath?.[0]?.selector && document.querySelector(a.framePath[0].selector);
			return { a, resolved: !!frame?.contentDocument?.querySelector(a?.selector || '') };
		});
		check('iframe path is persisted for reopening', saved.a?.framePath?.length === 1 && saved.resolved, JSON.stringify(saved.a));
		check('iframe style preview is applied', await page.evaluate(() => document.querySelector('#rf-frame').contentDocument.querySelector('#inside').style.padding === '12px'));
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		await page.evaluate(() => {
			for (const host of [...document.documentElement.children]) {
				const button = host.shadowRoot?.querySelector('.rf-btn-revert');
				if (button) { button.click(); return; }
			}
		});
		await new Promise(resolve => setTimeout(resolve, 100));
		check('iframe style restore resolves through the frame path', await page.evaluate(() => document.querySelector('#rf-frame').contentDocument.querySelector('#inside').style.padding === ''));
		const markdown = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.markdown());
		check('markdown identifies the containing iframe', /Frame: iframe#rf-frame/.test(markdown), markdown);
		check('iframe popover is positioned in the top viewport', state?.popoverRect?.left >= 0 && state?.popoverRect?.top >= 0, JSON.stringify(state?.popoverRect));

		return finish();
	});
};
