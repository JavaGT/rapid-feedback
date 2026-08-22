const { POP, createReporter, withPage } = require('./common');

module.exports = async function run6() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {
		// Chord-hold wrapper: keys down, click, keys up.
		const annot = async (sel) => {
			await page.keyboard.down('Alt');
			await page.keyboard.down('Meta');
			await chordClick(sel);
			await new Promise(r => setTimeout(r, 120));
			await page.keyboard.up('Meta');
			await page.keyboard.up('Alt');
			await new Promise(r => setTimeout(r, 200));
		};
		const hostWith = (sel) => `(() => {
			for (const h of [...document.documentElement.children]) {
				const el = h.shadowRoot?.querySelector('${sel}');
				if (el) return el;
			}
			return null;
		})()`;

		// --- Draggable popover: header strip moves it and persists the offset ---
		await annot('#c1');

		const before = await page.evaluate(`(() => {
			const p = ${POP}; if (!p) return null;
			const m = new DOMMatrix(getComputedStyle(p.getRootNode().host).transform);
			return { x: m.m41, y: m.m42 };
		})()`);
		check('popover opens for drag test', !!before);

		const handleBox = await page.evaluate(`(() => {
			const el = ${hostWith('.rf-drag-handle')};
			if (!el) return null;
			el.scrollIntoViewIfNeeded?.();
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		})()`);
		check('drag handle exists', !!handleBox);

		await page.mouse.move(handleBox.x, handleBox.y);
		await page.mouse.down();
		await page.mouse.move(handleBox.x + 60, handleBox.y + 40, { steps: 5 });
		await page.mouse.up();
		await new Promise(r => setTimeout(r, 100));

		const after = await page.evaluate(`(() => {
			const p = ${POP}; if (!p) return null;
			const m = new DOMMatrix(getComputedStyle(p.getRootNode().host).transform);
			return { x: m.m41, y: m.m42 };
		})()`);
		check('drag moves the popover', Math.abs(after.x - before.x - 60) < 3 && Math.abs(after.y - before.y - 40) < 3,
			JSON.stringify({ before, after }));
		check('drag persists offset', await page.evaluate(() => !!localStorage.getItem('rf_popover_offset_v1')));

		// Submit while dragged; a fresh popover should open at the same spot.
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'drag test'; })()`);
		await page.evaluate(`(() => { ${POP}.querySelector('.rf-btn-primary').click(); })()`);
		await new Promise(r => setTimeout(r, 150));
		await annot('#c2');
		const reopened = await page.evaluate(`(() => {
			const p = ${POP}; if (!p) return null;
			const m = new DOMMatrix(getComputedStyle(p.getRootNode().host).transform);
			return { comment: p.querySelector('.rf-popover-ta').value, x: m.m41, y: m.m42 };
		})()`);
		check('fresh popover honors persisted offset', Math.abs(reopened.x - after.x) < 3 && Math.abs(reopened.y - after.y) < 3,
			JSON.stringify(reopened));

		// Esc resets the offset and closes the popover.
		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 100));
		check('Esc clears the saved offset', await page.evaluate(() => !localStorage.getItem('rf_popover_offset_v1')));
		await page.evaluate(() => { localStorage.clear(); window.__SCOPE_FEEDBACK_API__.clear(); });

		// --- Post-submit revert of tweaks ---
		await page.evaluate(() => { document.getElementById('c1').style.background = 'rgb(250, 250, 250)'; });
		await annot('#c1');
		await page.evaluate(`(() => {
			const p = ${POP};
			p.querySelectorAll('.rf-tab-btn')[1].click();
			const t = [...p.querySelectorAll('.rf-styles-grid input')].find(i => i.type === 'text');
			t.value = '12px';
			t.dispatchEvent(new Event('input', { bubbles: true }));
			p.querySelector('.rf-btn-primary').click();
		})()`);
		await new Promise(r => setTimeout(r, 150));
		const tweaked = await page.evaluate(() => document.getElementById('c1').style.padding);
		check('tweak applied on submit', tweaked === '12px', tweaked);
		check('restore point persisted', await page.evaluate(() =>
			JSON.parse(localStorage.getItem('scope_feedback_annotations'))?.annotations?.[0]?.styleRestore !== undefined));

		await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.openPanel());
		await new Promise(r => setTimeout(r, 100));
		const revClicked = await page.evaluate(`(() => {
			for (const h of [...document.body.children, ...document.documentElement.children]) {
				const btn = h.shadowRoot?.querySelector('.rf-card .rf-btn-revert');
				if (btn) { btn.click(); return true; }
			}
			return false;
		})()`);
		check('revert button shown on card', revClicked);
		await new Promise(r => setTimeout(r, 100));
		check('tweak reverted to original', await page.evaluate(() => !document.getElementById('c1').style.padding),
			await page.evaluate(() => document.getElementById('c1').style.cssText));
		await page.evaluate(() => { localStorage.clear(); window.__SCOPE_FEEDBACK_API__.clear(); });

		// --- Two-step Clear confirm ---
		await page.evaluate(`(() => {
			for (const h of [...document.body.children, ...document.documentElement.children]) {
				const ta = h.shadowRoot?.querySelector('.rf-panel-footer textarea');
				if (ta) ta.value = 'quick note';
			}
		})()`);
		await page.evaluate(`(() => {
			for (const h of [...document.body.children, ...document.documentElement.children]) {
				const send = [...(h.shadowRoot?.querySelectorAll('.rf-panel-footer button') || [])].find(b => b.textContent === 'Send');
				if (send) { send.click(); return; }
			}
		})()`);
		await new Promise(r => setTimeout(r, 100));
		let count = await page.evaluate(`(() => { let n = 0; for (const h of [...document.body.children, ...document.documentElement.children]) n += h.shadowRoot?.querySelectorAll('.rf-card').length || 0; return n; })()`);
		check('quick note saved', count === 1, String(count));

		await page.evaluate(`(() => {
			for (const h of [...document.body.children, ...document.documentElement.children]) {
				const b = [...(h.shadowRoot?.querySelectorAll('.rf-panel-toolbar button') || [])].find(x => x.textContent === 'Clear');
				if (b) { b.click(); return; }
			}
		})()`);
		count = await page.evaluate(`(() => { let n = 0; for (const h of [...document.body.children, ...document.documentElement.children]) n += h.shadowRoot?.querySelectorAll('.rf-card').length || 0; return n; })()`);
		check('first Clear click does not wipe', count === 1, String(count));
		const armed = await page.evaluate(`(() => {
			for (const h of [...document.body.children, ...document.documentElement.children]) {
				const b = [...(h.shadowRoot?.querySelectorAll('.rf-panel-toolbar button') || [])].find(x => x.textContent === 'Really clear?');
				if (b) { b.click(); return true; }
			}
			return false;
		})()`);
		check('armed Clear label appears', armed);
		await new Promise(r => setTimeout(r, 100));
		count = await page.evaluate(`(() => { let n = 0; for (const h of [...document.body.children, ...document.documentElement.children]) n += h.shadowRoot?.querySelectorAll('.rf-card').length || 0; return n; })()`);
		check('second Clear click wipes', count === 0, String(count));

		// --- Selector-ambiguity disclosure in exports ---
		await page.evaluate(() => {
			// A twin inside the same parent makes the stored selector ambiguous.
			const c = document.createElement('div');
			c.id = 'c1';
			c.className = 'card';
			c.textContent = 'First card';
			document.getElementById('row').appendChild(c);
		});
		await annot('#c1');
		await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'ambiguous'; })()`);
		await page.evaluate(`(() => { ${POP}.querySelector('.rf-btn-primary').click(); })()`);
		await new Promise(r => setTimeout(r, 150));
		const md = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.markdown());
		check('ambiguity warning in markdown', md.includes('matches multiple elements'), md.split('\n').slice(0, 12).join('\n'));

		return finish();
	});
};
