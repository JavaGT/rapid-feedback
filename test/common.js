const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'rapid-feedback.user.js'), 'utf8');
const CHROME = process.env.RAPID_FEEDBACK_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const POP = `(() => { for (const h of [...document.body.children, ...document.documentElement.children]) { const p = h.shadowRoot?.querySelector('.rf-popover'); if (p) return p; } return null; })()`;

function createReporter() {
	const results = [];
	return {
		check(name, cond, detail) {
			results.push({ name, ok: !!cond, detail });
			console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail && !cond ? '\n      ' + detail : ''));
		},
		finish() {
			const fails = results.filter(r => !r.ok);
			console.log('\n' + (results.length - fails.length) + '/' + results.length + ' checks passed');
			return fails.length === 0;
		}
	};
}

async function withPage(run) {
	const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
	try {
		const page = await browser.newPage();
		await page.setViewport({ width: 1200, height: 800 });
		page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
		page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR: ' + m.text()); });
		// The userscript closes its shadow roots so host pages can't reach into the
		// feedback UI. Tests introspect that UI, so force roots open in the harness.
		// Runs in every document (including navigations) before page scripts.
		await page.evaluateOnNewDocument(() => {
			const original = Element.prototype.attachShadow;
			Element.prototype.attachShadow = function (init) {
				return original.call(this, { ...init, mode: 'open' });
			};
		});
		await page.goto('file://' + path.join(__dirname, 'page.html'));
		await page.evaluate(SCRIPT);
		const chordClick = async (sel) => {
			const box = await page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
			await page.mouse.click(box.x, box.y);
		};
		return await run(page, chordClick);
	} finally {
		await browser.close();
	}
}

module.exports = { POP, createReporter, withPage };
