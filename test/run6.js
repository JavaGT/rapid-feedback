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

		// --- History churn must not kill a draft (SPAs fire replaceState constantly) ---
		await annot('#c1');
		await new Promise(r => setTimeout(r, 150));
		await page.evaluate(() => { for (let i = 0; i < 3; i++) history.replaceState(null, '', location.href); });
		await new Promise(r => setTimeout(r, 200));
		let stillOpen = await page.evaluate(`!!${POP}`);
		check('replaceState with same URL keeps the draft open', stillOpen);
		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 100));

		// --- Chord-click on the FAB must not annotate the page root ---
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		await chordClick('[data-rf-chrome]'); // clicks pass through chrome while the chord is held
		await new Promise(r => setTimeout(r, 100));
		const rootAnnotated = await page.evaluate(() => {
			for (const h of [...document.body.children, ...document.documentElement.children]) {
				const t = h.shadowRoot?.querySelector('.rf-title')?.textContent || '';
				if (t) return t;
			}
			return '';
		});
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		stillOpen = await page.evaluate(`!!${POP}`);
		check('chord-click on tool chrome does not annotate <html>', !stillOpen || !/RF Harness|html/.test(rootAnnotated), 'title=' + rootAnnotated);

		// --- Re-render stranding: wipe targets mid-draft -> dimmed lost state ---
		await annot('#c1');
		await page.evaluate(() => {
			const row = document.getElementById('row');
			row.replaceWith(row.cloneNode(true));
		});
		await new Promise(r => setTimeout(r, 200));
		const lost = await page.evaluate(`(() => { const p = ${POP}; return p ? p.classList.contains('rf-lost') : false; })()`);
		check('wiping every selected element dims the popover to the lost state', lost);
		// Revive by chord-adding one of the fresh clones.
		await annot('#c1');
		await new Promise(r => setTimeout(r, 200));
		const revived = await page.evaluate(`(() => {
			const p = ${POP};
			return p ? { lost: p.classList.contains('rf-lost'), disabled: p.querySelector('.rf-btn-primary').disabled } : null;
		})()`);
		check('chord-add revives a lost draft with Submit re-enabled', !!revived && !revived.lost && !revived.disabled, JSON.stringify(revived));
		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 100));

		// --- Empty chord gesture must not eat the next plain click ---
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		await new Promise(r => setTimeout(r, 80));
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 120));
		const fabBox = await page.evaluate(`(() => {
			const el = ${hostWith('.rf-fab.rf-fab-on')};
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		})()`);
		if (fabBox && typeof fabBox.x === 'number') {
			await page.mouse.click(fabBox.x, fabBox.y);
			await new Promise(r => setTimeout(r, 300));
			const panelOpened = await page.evaluate(() => {
				for (const h of [...document.body.children, ...document.documentElement.children]) {
					if (h.shadowRoot?.querySelector('.rf-panel')) return true;
				}
				return false;
			});
			check('first click after an empty chord reaches the FAB', panelOpened);
			await page.evaluate(() => {
				for (const h of [...document.body.children, ...document.documentElement.children]) {
					const b = h.shadowRoot?.querySelector('.rf-panel-close');
					if (b) b.click();
				}
			});
		} else {
			check('first click after an empty chord reaches the FAB', false, 'FAB was not revealed');
		}

		// --- Slow release: chord held >CHORD_GESTURE_MS after the click must survive ---
		const cdp = await page.createCDPSession();
		await page.keyboard.down('Alt');
		await page.keyboard.down('Meta');
		const slowBox = await page.evaluate(`(() => {
			const r = document.querySelector('#c2').getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		})()`);
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: slowBox.x, y: slowBox.y, modifiers: 5, button: 'left', clickCount: 1 });
		await new Promise(r => setTimeout(r, 1800));
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: slowBox.x, y: slowBox.y, modifiers: 5, button: 'left', clickCount: 1 });
		await new Promise(r => setTimeout(r, 100));
		await page.keyboard.up('Meta');
		await page.keyboard.up('Alt');
		await new Promise(r => setTimeout(r, 250));
		const slowRelease = await page.evaluate(`!!${POP}`);
		check('holding the chord past the gesture window keeps the selection', slowRelease);
		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 100));

		// --- Tall page: placement origin must be the viewport, not document flow ---
		await page.evaluate(() => { const s = document.createElement('div'); s.style.height = '3000px'; document.body.appendChild(s); });
		await annot('#c3');		const placed = await page.evaluate(`(() => {
			const p = ${POP}; if (!p) return null;
			const r = p.getRootNode().host.getBoundingClientRect();
			return { top: Math.round(r.top), left: Math.round(r.left) };
		})()`);
		check('popover renders inside the viewport on a tall page', !!placed && placed.top >= 0 && placed.top < 800 && placed.left >= 0 && placed.left < 1200, JSON.stringify(placed));
		await page.keyboard.press('Escape');

		return finish();
	});
};
