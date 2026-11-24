// Feedback against an SDK menu item ("Timestamps" in Studio's View options,
// Safari 605): the chord outline painted BEHIND the page's popover menu.
// Chrome re-raises its hosts when a page top-layer surface opens, but engines
// that delay or omit the popover `toggle` event never trigger that re-raise.
// Suppressing the menu's toggle/close here simulates that engine, then asserts
// showOutline still lifts the ring above the menu at chord time.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { createReporter } = require('./common');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'rapid-feedback.user.js'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function run() {
  const { check, finish } = createReporter();
  const browser = await puppeteer.launch({
    browser: process.env.RAPID_FEEDBACK_BROWSER === 'firefox' ? 'firefox' : 'chrome',
    executablePath: process.env.RAPID_FEEDBACK_EXECUTABLE || (process.env.RAPID_FEEDBACK_BROWSER === 'firefox'
      ? '/Applications/Firefox.app/Contents/MacOS/firefox'
      : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    headless: true,
    args: process.env.RAPID_FEEDBACK_BROWSER === 'firefox' ? ['-no-remote'] : ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
    await page.evaluateOnNewDocument(() => {
      const orig = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init) { return orig.call(this, { ...init, mode: 'open' }); };
      // Early capture listener, registered before the userscript's own: drop the
      // menu's layer-change events so reseatChrome cannot mask the fix.
      for (const type of ['toggle', 'close']) {
        addEventListener(type, (e) => {
          if (e.target && e.target.id === 'rf-menu') e.stopImmediatePropagation();
        }, true);
      }
    });
    await page.goto('file://' + path.join(__dirname, 'page.html'));
    await page.evaluate(() => { window.__RF_TEST_MODE__ = true; });
    await page.evaluate(SCRIPT);
    await wait(100);

    const hover = sel => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, composed: true, cancelable: true,
        altKey: true, metaKey: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
      }));
    }, sel);

    await hover('#c1');
    await wait(100);

    await page.evaluate(() => {
      const menu = document.createElement('div');
      menu.id = 'rf-menu';
      menu.setAttribute('popover', 'manual');
      menu.style.cssText = 'position:fixed;top:150px;left:400px;width:300px;height:200px;margin:0;padding:8px;background:#fff;border:1px solid #999';
      menu.innerHTML = '<div id="rf-menu-item" style="height:30px;background:#eef">Timestamps</div>';
      document.body.appendChild(menu);
      menu.showPopover();
    });
    await wait(50);
    check('menu popover is open in the top layer', await page.evaluate(() =>
      document.getElementById('rf-menu').matches(':popover-open')));

    await hover('#rf-menu-item');
    await wait(100);

    const result = await page.evaluate(() => {
      let host = null, outline = null;
      for (const h of document.querySelectorAll('[data-rf-chrome]')) {
        const o = h.shadowRoot?.querySelector('[data-rf-outline]');
        if (o) { host = h; outline = o; break; }
      }
      const item = document.getElementById('rf-menu-item');
      const menu = document.getElementById('rf-menu');
      const r = item.getBoundingClientRect();
      const or = outline?.getBoundingClientRect();
      host?.style.setProperty('pointer-events', 'auto', 'important');
      host?.style.setProperty('width', '100vw', 'important');
      host?.style.setProperty('height', '100vh', 'important');
      const all = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const iHost = host ? all.indexOf(host) : -1;
      const iMenu = all.indexOf(menu);
      host?.style.removeProperty('pointer-events');
      host?.style.removeProperty('width');
      host?.style.removeProperty('height');
      return { iHost, iMenu, outline: or ? { x: or.x, y: or.y, w: or.width, h: or.height } : null,
        target: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    check('chord outline paints above a popup menu whose toggle was not delivered',
      result.iHost >= 0 && result.iHost < result.iMenu, JSON.stringify(result));
    check('outline still tracks the menu item rect',
      result.outline && Math.abs(result.outline.x - (result.target.x - 2)) <= 2
        && Math.abs(result.outline.y - (result.target.y - 2)) <= 2
        && Math.abs(result.outline.w - (result.target.w + 8)) <= 2
        && Math.abs(result.outline.h - (result.target.h + 8)) <= 2,
      JSON.stringify(result));

    return finish();
  } finally {
    await browser.close();
  }
};
