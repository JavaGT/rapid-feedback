// A selected element can disappear during a draft (for example, when a tooltip
// closes). The frozen annotation should still be submit-able.
const { POP, createReporter, withPage } = require('./common');

module.exports = async function run8() {
	const { check, finish } = createReporter();
	return withPage(async (page) => {
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		const box = await page.$eval('#c1', el => {
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		});
		await page.mouse.click(box.x, box.y);
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		await new Promise(resolve => setTimeout(resolve, 200));

		await page.evaluate(`(() => {
			const p = ${POP};
			p.querySelector('.rf-popover-ta').value = 'tooltip disappeared';
			document.getElementById('c1').remove();
		})()`);
		await new Promise(resolve => setTimeout(resolve, 100));

		const state = await page.evaluate(`(() => {
			const p = ${POP};
			const submit = p?.querySelector('.rf-btn-primary');
			return { lost: p?.classList.contains('rf-lost'), disabled: submit?.disabled };
		})()`);
		check('Submit stays available after target removal', state.lost && state.disabled === false, JSON.stringify(state));

		await page.evaluate(`(() => ${POP}.querySelector('.rf-btn-primary').click())()`);
		await new Promise(resolve => setTimeout(resolve, 150));
		const saved = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.at(-1));
		check('removed target draft can be submitted', saved?.comment === 'tooltip disappeared' && /c1/.test(saved?.selector), JSON.stringify(saved));

		return finish();
	});
};
