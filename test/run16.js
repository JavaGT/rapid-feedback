// 2026-11-21 feedback: the chord outline must stay visible on a child of a
// top-layer modal that the page opens AFTER our outline host was first shown.
// showPopover() on an already-showing popover is a no-op, so without an explicit
// re-raise our fixed outline paints behind the modal and looks absent — even
// though its coordinates are correct.
const { createReporter, withPage, waitFor } = require('./common');
const fs = require('fs');

const SCRIPT = fs.readFileSync(__dirname + '/../rapid-feedback.user.js', 'utf8');
const OUTLINE = `[...document.querySelectorAll('[data-rf-chrome]')].map(h => h.shadowRoot?.querySelector('[data-rf-outline]')).find(Boolean)`;

// The outline lives in a shadow root, so elementsFromPoint sees its host. Size
// the host temporarily so it can be hit-tested; its index relative to the modal
// in the returned stack is the browser's own top-layer paint order.
const PAINT_ORDER = `(() => {
  const o = ${OUTLINE};
  if (!o) return null;
  const host = o.getRootNode().host;
  const target = document.getElementById('rf-dd');
  const modal = document.getElementById('rf-modal');
  const r = target.getBoundingClientRect();
  host.style.setProperty('pointer-events', 'auto', 'important');
  host.style.setProperty('width', '100vw', 'important');
  host.style.setProperty('height', '100vh', 'important');
  const stack = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const iHost = stack.indexOf(host), iModal = stack.indexOf(modal);
  host.style.removeProperty('pointer-events');
  host.style.removeProperty('width');
  host.style.removeProperty('height');
  return { iHost, iModal, stackLen: stack.length };
})()`;

const hover = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true, composed: true, cancelable: true,
    altKey: true, metaKey: true,
    clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
  }));
}, id);

module.exports = async function run() {
  const { check, finish } = createReporter();
  return withPage(async (page) => {
    // 1. Chord-hover an ordinary page element: creates and raises the outline host.
    await hover(page, 'c1');
    await waitFor(page, `!!(${OUTLINE})`, { description: 'initial outline' });
    check('chord hover created the outline host', true);

    // 2. The page opens a ui-sdk-style top-layer popover AFTER our host exists.
    await page.evaluate(() => {
      const dlg = document.createElement('div');
      dlg.id = 'rf-modal';
      dlg.setAttribute('popover', 'manual');
      dlg.style.cssText = 'position:fixed;top:140px;left:300px;width:420px;height:240px;margin:0;padding:16px;background:#fff;border:1px solid #999';
      dlg.innerHTML = '<dl><dt>Kind</dt><dd id="rf-dd" style="width:220px;height:18px;background:#eef">Interview 07 — Marina · interview</dd></dl>';
      document.body.appendChild(dlg);
      dlg.showPopover();
    });
    // 3. Chord-hover the modal child: its outline must paint above the modal.
    await hover(page, 'rf-dd');
    await new Promise(r => setTimeout(r, 150));
    const paint = await page.evaluate(PAINT_ORDER);
    check('outline paints above a modal opened after the host',
      paint && paint.iHost >= 0 && paint.iHost < paint.iModal,
      JSON.stringify(paint));

    // 4. The outline still lands on the target's own rect (not the modal's).
    const geom = await page.evaluate(`(() => {
      const o = ${OUTLINE}; const r = o.getBoundingClientRect();
      const t = document.getElementById('rf-dd').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, tx: t.x, ty: t.y, tw: t.width, th: t.height };
    })()`);
    check('outline still tracks the modal child rect',
      Math.abs(geom.x - (geom.tx - 2)) <= 2 && Math.abs(geom.y - (geom.ty - 2)) <= 2
        && Math.abs(geom.w - (geom.tw + 8)) <= 2 && Math.abs(geom.h - (geom.th + 8)) <= 2,
      JSON.stringify(geom));

    return finish();
  });
};
