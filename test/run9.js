// #48: visible gutter guidance is pointer-transparent so ordinary clicks reach
// the editor. Feedback must pick the guidance without changing that behavior.
const { POP, createReporter, withPage, waitForPopover, waitForPopoverGone } = require('./common');

module.exports = async function run9() {
	const { check, finish } = createReporter();
	return withPage(async (page) => {
		await page.evaluate(() => {
			document.body.innerHTML = `<article id="editor" contenteditable="true" aria-label="Transcript editor" style="position:relative;margin:30px;width:870px;height:11553px;padding:16px;box-sizing:border-box">Synthetic transcript
				<div id="gutter" style="position:absolute;inset:0 0 0 auto;width:152px;pointer-events:none">
					<p id="hint" style="margin:16px;font-size:12px">Select text to apply a code</p>
				</div>
			</article>`;
			window.editorClicks = 0;
			document.querySelector('#editor').addEventListener('click', () => window.editorClicks++);
		});
		const point = await page.$eval('#hint', el => {
			const range = document.createRange();
			range.selectNodeContents(el);
			const r = range.getClientRects()[0];
			return { x: r.x + 4, y: r.y + r.height / 2 };
		});
		const before = await page.$eval('#editor', el => el.outerHTML);
		const native = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, point);
		check('fixture reproduces click-through hint hitting editor', native === 'editor', native);
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		await page.mouse.click(point.x, point.y);
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		await waitForPopover(page);
		await page.evaluate(`(() => {
			const p = ${POP};
			p.querySelector('.rf-popover-ta').value = 'Target this instruction';
			p.querySelector('.rf-btn-primary').click();
		})()`);
		await waitForPopoverGone(page);
		const saved = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.at(-1));
		check('feedback targets the hint, not the entire editor', await page.evaluate(selector => document.querySelector(selector)?.id === 'hint', saved.selector), saved.selector);
		check('feedback captures only the instruction and its small rectangle', saved.text === 'Select text to apply a code' && saved.rect.height < 100, JSON.stringify({ text: saved.text, rect: saved.rect }));
		check('picking leaves editor DOM unchanged', await page.$eval('#editor', el => el.outerHTML) === before);
		check('feedback click never activates editor', await page.evaluate(() => window.editorClicks) === 0);
		await page.mouse.click(point.x, point.y);
		check('ordinary clicks still pass through the hint', await page.evaluate(() => window.editorClicks) === 1);
		return finish();
	});
};

if (require.main === module) module.exports().then(ok => process.exit(ok ? 0 : 1)).catch(e => { console.error(e); process.exit(2); });
