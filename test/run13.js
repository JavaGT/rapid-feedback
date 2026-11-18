const fs = require('fs');
const path = require('path');
const { POP, createReporter, withPage, waitFor, waitForPopoverGone } = require('./common');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'rapid-feedback.user.js'), 'utf8');

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page) => {
		const pause = (ms) => new Promise(r => setTimeout(r, ms));
		const statusTexts = () => page.evaluate(() => {
			const texts = [];
			for (const h of [...document.body.children, ...document.documentElement.children]) {
				for (const el of h.shadowRoot?.querySelectorAll('[role="status"]') || []) texts.push(el.textContent);
			}
			return texts;
		});

		// A first-time user gets one hint naming both input paths; an empty store
		// must not be reported as corrupt.
		const hints = await statusTexts();
		check('first-run hint names the keyboard path', hints.some(t => /Alt\+Shift\+E/.test(t)), JSON.stringify(hints));
		check('empty storage is not reported as corrupt', !hints.some(t => /unreadable/i.test(t)), JSON.stringify(hints));

		// Structural host styles are pinned against page CSS.
		const priorities = await page.evaluate(() => {
			const host = [...document.documentElement.children].find(h => h.hasAttribute?.('data-rf-chrome'));
			if (!host) return null;
			return {
				position: host.style.getPropertyPriority('position'),
				visibility: host.style.getPropertyPriority('visibility'),
				token: typeof window.__RF_BOOT_TOKEN__,
				stamped: host.__rfBootToken === window.__RF_BOOT_TOKEN__,
			};
		});
		check('chrome hosts pinned with !important', priorities?.position === 'important' && priorities?.visibility === 'important', JSON.stringify(priorities));
		check('boot token stamps owned hosts', priorities?.token === 'string' && priorities?.stamped === true, JSON.stringify(priorities));

		// Keyboard-only entry annotates the focused element.
		await page.evaluate(() => {
			const el = document.getElementById('c1');
			el.setAttribute('tabindex', '0');
			el.focus();
		});
		await page.keyboard.down('Alt');
		await page.keyboard.down('Shift');
		await page.keyboard.press('KeyE');
		await page.keyboard.up('Shift');
		await page.keyboard.up('Alt');
		await waitFor(page, `!!(${POP})`, { description: 'keyboard-opened popover' });
		const keyboardState = await page.evaluate(`(() => { const p = ${POP}; return {
			comment: !!p?.querySelector('.rf-popover-ta'),
			role: p?.getAttribute('role'),
			label: p?.getAttribute('aria-label')
		}; })()`);
		check('Alt+Shift+E opens the editor on focus', keyboardState.comment, JSON.stringify(keyboardState));
		check('popover is a labelled dialog', keyboardState.role === 'dialog' && !!keyboardState.label, JSON.stringify(keyboardState));

		// Interactive chrome follows the anchor into a top-layer dialog and back.
		await page.evaluate(() => {
			if (window.__dialogForRf) return;
			const d = document.createElement('dialog');
			d.id = 'rf-modal-test';
			const inner = document.createElement('button');
			inner.id = 'rf-modal-target';
			inner.textContent = 'Inside modal';
			d.appendChild(inner);
			document.body.appendChild(d);
			window.__dialogForRf = d;
			d.showModal();
			inner.focus();
		});
		await page.keyboard.down('Alt');
		await page.keyboard.down('Shift');
		await page.keyboard.press('KeyE');
		await page.keyboard.up('Shift');
		await page.keyboard.up('Alt');
		await pause(150);
		const parentInModal = await page.evaluate(() => {
			const hosts = [...document.querySelectorAll('[data-rf-chrome]')];
			const p = hosts.find(h => h.shadowRoot?.querySelector('.rf-popover'));
			return p?.parentElement?.tagName || null;
		});
		check('popover follows target into the top layer', parentInModal === 'DIALOG', String(parentInModal));
		await waitForPopoverGone(page);
		await page.evaluate(() => window.__dialogForRf.close());
		await pause(100);
		const parentAfter = await page.evaluate(() => {
			const hosts = [...document.querySelectorAll('[data-rf-chrome]')];
			const fab = hosts.find(h => h.shadowRoot?.querySelector('.rf-fab'));
			return fab?.parentElement?.tagName || null;
		});
		check('chrome returns to <html> after dialog closes', parentAfter === 'HTML', String(parentAfter));

		// Last: a page-set flag plus a decoy host cannot suppress installation,
		// because ownership is proven by the per-boot token stamped on real hosts.
		await page.evaluate(() => {
			window.__SCOPE_FEEDBACK_LOADED__ = true;
			const decoy = document.createElement('div');
			decoy.setAttribute('data-rf-chrome', '');
			document.body.appendChild(decoy);
			window.__RF_TEST_MODE__ = true;
		});
		await page.evaluate(SCRIPT);
		check('decoy chrome cannot brick re-injection', await page.evaluate(() => !!window.__SCOPE_FEEDBACK_API__));

		return finish();
	});
};
