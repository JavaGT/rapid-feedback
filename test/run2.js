const { POP, MARKERS, createReporter, withPage } = require('./common');

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {

  // --- Single element: zoom row available, no selection list ---
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c1');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 200));
  let s = await page.evaluate(`(() => { const p = ${POP}; if (!p) return {err:1}; return {
    zoom: p.querySelector('.rf-zoom-row').style.display,
    listShown: p.querySelector('.rf-sel-list').style.display,
    count: p.querySelector('.rf-sel-head span').textContent,
    title: p.querySelector('.rf-title').textContent }; })()`);
  check('single: zoom row visible', s.zoom === 'flex', JSON.stringify(s));
  check('single: no member rows', s.listShown === 'none', JSON.stringify(s));
  check('single: count reads 1 element', s.count === 'Selection — 1 element', JSON.stringify(s));
  check('single: title has no +N', !/\+\d+$/.test(s.title), s.title);

  // --- Zoom to parent still retargets ---
  await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-zoom-row button').click(); })()`);
  await new Promise(r => setTimeout(r, 150));
  s = await page.evaluate(`(() => { const p = ${POP}; return { sub: p.querySelector('.rf-sub').textContent }; })()`);
  check('zoom up retargets to parent (.row)', /row/.test(s.sub), s.sub);

  // --- Style edit on single element, Cancel reverts ---
  await page.evaluate(`(() => { const p = ${POP};
    p.querySelectorAll('.rf-tab-btn')[1].click();
    const t = [...p.querySelectorAll('.rf-styles-grid input')].find(i => i.type === 'text');
    t.value = '33px'; t.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  let live = await page.evaluate(() => document.getElementById('row').style.cssText);
  check('single: style previews live', live.includes('33px'), live);
  await page.evaluate(`(() => { const p = ${POP}; [...p.querySelectorAll('.rf-btn')].find(b => b.textContent === 'Cancel').click(); })()`);
  await new Promise(r => setTimeout(r, 150));
  live = await page.evaluate(() => document.getElementById('row').style.cssText);
  check('single: Cancel reverts the preview', !live.includes('33px'), live);
  check('single: markers cleared on close', await page.evaluate(`${MARKERS}`) === 0);

  // --- An offscreen dragged popover can always be recovered without losing draft text ---
  await new Promise(r => setTimeout(r, 350));
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c1');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 150));
  await page.evaluate(`(() => { const p = ${POP}; if (!p) throw new Error('popover did not open'); p.querySelector('.rf-popover-ta').value = 'keep this draft'; p.querySelector('.rf-popover-ta').dispatchEvent(new Event('input', {bubbles:true})); window.__rfPopoverHost = [...document.querySelectorAll('[data-rf-chrome]')].find(h => h.shadowRoot?.querySelector('.rf-popover')); if (!window.__rfPopoverHost) throw new Error('popover host not found'); window.__rfPopoverHost.style.transform = 'translate3d(-9999px, -9999px, 0)'; })()`);
  await page.keyboard.down('Alt'); await page.keyboard.down('Shift'); await page.keyboard.press('r'); await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 100));
  s = await page.evaluate(`(() => { const p = ${POP}; const h = window.__rfPopoverHost; return { transform: h.style.transform, comment: p.querySelector('.rf-popover-ta').value }; })()`);
  check('offscreen popover: shortcut returns it onscreen', !/-9999/.test(s.transform) && s.comment === 'keep this draft', JSON.stringify(s));
  await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.clear());

  // --- Destination pick round-trip preserves a group draft ---
  await page.evaluate(() => {
    document.getElementById('c4').__svelte_meta = {
      loc: { file: '/repo/src/lib/DetailsPanel.svelte', line: 24, column: 4 },
      parent: { file: '/repo/src/routes/projects/+page.svelte', line: 15, type: 'component', parent: null }
    };
  });
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c1'); await chordClick('#c2');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(`(() => { const p = ${POP};
    p.querySelector('.rf-popover-ta').value = 'move these';
    [...p.querySelectorAll('.rf-btn')].find(b => /destination/i.test(b.textContent)).click(); })()`);
  await new Promise(r => setTimeout(r, 150));
  const banner = await page.evaluate(() => { for (const h of [...document.body.children, ...document.documentElement.children]) { const b = h.shadowRoot?.querySelector('.rf-banner'); if (b) return b.textContent; } return null; });
  check('destination banner shown', /destination element/i.test(banner || ''), String(banner));
  await chordClick('#c4');
  await new Promise(r => setTimeout(r, 250));
  s = await page.evaluate(`(() => { const p = ${POP}; if (!p) return {err:1}; return {
    rows: p.querySelectorAll('.rf-sel-row').length,
    comment: p.querySelector('.rf-popover-ta').value,
    dest: p.querySelector('.rf-dest-tag').textContent }; })()`);
  check('destination round-trip keeps the 2-member selection', s.rows === 2, JSON.stringify(s));
  check('destination round-trip keeps the comment', s.comment === 'move these', JSON.stringify(s));
  check('destination recorded', /c4/.test(s.dest || ''), JSON.stringify(s));

  // --- Escape cancels the pick mode and restores the draft ---
  await page.evaluate(`(() => { const p = ${POP}; [...p.querySelectorAll('.rf-btn-sm')].find(b => b.textContent.includes('Add')).click(); })()`);
  await new Promise(r => setTimeout(r, 120));
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 250));
  s = await page.evaluate(`(() => { const p = ${POP}; if (!p) return {err:1}; return {
    rows: p.querySelectorAll('.rf-sel-row').length, comment: p.querySelector('.rf-popover-ta').value }; })()`);
  check('Escape from add-mode restores the draft unchanged', s.rows === 2 && s.comment === 'move these', JSON.stringify(s));

  // --- Submit, then check markdown + JSON export ---
  await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-btn-primary').click(); })()`);
  await new Promise(r => setTimeout(r, 200));
  const md = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.markdown());
  const js = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.json());
  check('markdown lists the group', /Group: 2 elements/.test(md), md);
  check('markdown gives each member a Where line', (md.match(/^ {4}Where:/gm) || []).length === 1, md);
  check('markdown has no duplicated text', !/— “/.test(md), md);
  check('json carries groupSize', js.items[0].groupSize === 2, JSON.stringify(js.items[0]).slice(0, 400));
  check('json members carry where + rect', js.items[0].targets.every(t => t.where && t.rect), JSON.stringify(js.items[0].targets));
  check('destination retains source and component context',
    js.items[0].destination.source?.ref === 'src/lib/DetailsPanel.svelte:24' &&
      js.items[0].destination.source.components?.[1]?.ref === 'projects/+page.svelte:15' &&
      /  Component: projects\/\+page\.svelte:15/.test(md),
    JSON.stringify(js.items[0].destination));
  console.log('\n--- MARKDOWN ---\n' + md + '\n----------------');

	return finish();
	});
};
