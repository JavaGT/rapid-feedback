const { POP, createReporter, withPage } = require('./common');

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('#c1'); await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 150));
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'editable'; p.querySelector('.rf-btn-primary').click(); })()`);
		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		await page.evaluate(() => {
			const root = [...document.body.children].find(h => h.shadowRoot?.querySelector('.rf-panel')).shadowRoot;
			root.querySelector('.rf-btn-icon[data-idx="0"]').click();
		});
		await new Promise(r => setTimeout(r, 100));
		let state = await page.evaluate(`(() => { const p = ${POP}; return { popover: !!p, comment: p?.querySelector('.rf-popover-ta').value }; })()`);
		check('saved annotation reopens in the full popover', state.popover && state.comment === 'editable', JSON.stringify(state));
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'updated'; p.querySelector('.rf-btn-primary').click(); })()`);
		state = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.map(a => a.comment));
		check('editing replaces rather than appends annotation', state.length === 1 && state[0] === 'updated', JSON.stringify(state));
		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('#c1'); await chordClick('#c2'); await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 150));
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'group'; p.querySelector('.rf-btn-primary').click(); })()`);
		await page.evaluate(() => { document.getElementById('c2').remove(); window.__SCOPE_FEEDBACK_API__.openPanel(); });
		await page.evaluate(() => {
			const root = [...document.body.children].find(h => h.shadowRoot?.querySelector('.rf-panel')).shadowRoot;
			root.querySelector('.rf-btn-icon[data-idx="1"]').click();
		});
		state = await page.evaluate(`(() => { const p = ${POP}; return { status: p?.querySelector('.rf-sel-status')?.textContent, missing: p?.querySelector('.rf-sel-row.missing')?.textContent }; })()`);
		check('reopened selection discloses missing stored members', state.status === '1 of 2 elements still found' && /not found/.test(state.missing || ''), JSON.stringify(state));
		await page.evaluate(`(() => [...${POP}.querySelectorAll('.rf-btn')].find(b => b.textContent === 'Cancel').click())()`);
		await page.evaluate(() => { const el = document.createElement('div'); el.className = 'card'; el.id = 'c2'; el.textContent = 'Second card'; document.getElementById('row').appendChild(el); });

		await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
		await chordClick('#c1'); await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 150));
		await page.evaluate(`(() => [...${POP}.querySelectorAll('.rf-btn-sm')].find(b => b.textContent.includes('similar')).click())()`);
		await new Promise(r => setTimeout(r, 100));
		state = await page.evaluate(`(() => { const p = ${POP}; return { rows: p.querySelectorAll('.rf-sel-row').length, hint: p.querySelector('.rf-primary-hint')?.textContent, labels: [...p.querySelectorAll('.rf-sel-name')].map(n => n.textContent) }; })()`);
		check('select similar adds direct sibling cards', state.rows === 4, JSON.stringify(state));
		check('primary role is explained', /controls styles.*Where/.test(state.hint || ''), String(state.hint));
		await page.evaluate(`(() => ${POP}.querySelector('.rf-btn-sm').click())()`);
		state = await page.evaluate(`(() => ${POP}.querySelectorAll('.rf-sel-row').length)()`);
		check('similar selection undoes in one action', state === 0, String(state));

		await page.evaluate(`(() => [...${POP}.querySelectorAll('.rf-btn-sm')].find(b => b.textContent.includes('similar')).click())()`);
		await page.evaluate(() => {
			document.querySelectorAll('.card').forEach(el => { el.removeAttribute('id'); el.textContent = 'Card'; });
		});
		await page.evaluate(`(() => [...${POP}.querySelectorAll('.rf-sel-row')[1].querySelectorAll('.rf-sel-act')].find(b => b.textContent === '★').click())()`);
		state = await page.evaluate(`(() => [...${POP}.querySelectorAll('.rf-sel-name')].map(n => n.textContent))()`);
		check('duplicate labels include positional hints', state.every(s => /nth-of-type/.test(s)), JSON.stringify(state));
		await page.evaluate(() => history.pushState({}, '', '#new-route'));
		await new Promise(r => setTimeout(r, 100));
		state = await page.evaluate(`(() => !!${POP})()`);
		check('SPA navigation closes an in-flight popover', !state, String(state));
		return finish();
	});
};
