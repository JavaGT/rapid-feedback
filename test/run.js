const { POP, createReporter, withPage } = require('./common');

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {

  // --- Multi-select three cards with the chord, then release ---
  await page.keyboard.down('Alt');
  await page.keyboard.down('Meta');
  await chordClick('#c1');
  await chordClick('#c2');
  await chordClick('#c3');
  const markersDuring = await page.evaluate(() => document.querySelectorAll('div[style*="rgba(37, 138, 85"]').length);
  check('markers appear while accumulating', markersDuring === 3, 'got ' + markersDuring);
  await page.keyboard.up('Meta');
  await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 200));

  let state = await page.evaluate(`(() => {
    const p = ${POP}; if (!p) return { err: 'no popover' };
    return {
      rows: [...p.querySelectorAll('.rf-sel-row')].map(r => r.querySelector('.rf-sel-name').textContent),
      count: p.querySelector('.rf-sel-head span').textContent,
      title: p.querySelector('.rf-title').textContent,
      zoomHidden: p.querySelector('.rf-zoom-row').style.display,
      markers: document.querySelectorAll('div[style*="rgba(37, 138, 85"]').length,
    };
  })()`);
  check('popover lists all 3 members', state.rows && state.rows.length === 3, JSON.stringify(state));
  check('primary marked first', state.rows && state.rows[0].startsWith('●') && state.rows[1].startsWith('○'), JSON.stringify(state.rows));
  check('count reads 3 elements', state.count === 'Selection — 3 elements', state.count);
  check('title shows +2', /\+2$/.test(state.title || ''), state.title);
  check('zoom row hidden for group', state.zoomHidden === 'none', state.zoomHidden);
  check('markers persist while popover open (2 non-primary)', state.markers === 2, 'got ' + state.markers);

  // --- Live style edit previews across the whole selection ---
  await page.evaluate(`(() => {
    const p = ${POP};
    p.querySelectorAll('.rf-tab-btn')[1].click();
    const inputs = p.querySelectorAll('.rf-styles-grid input');
    const t = [...inputs].find(i => i.type === 'text');
    t.value = '40px';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  let applied = await page.evaluate(() => ['c1', 'c2', 'c3', 'c4'].map(id => document.getElementById(id).style.cssText));
  check('style preview hits all 3 selected', applied.slice(0, 3).every(s => s.includes('40px')), JSON.stringify(applied));
  check('style preview skips unselected', applied[3] === '', JSON.stringify(applied));

  // --- Remove a member: its preview reverts, the rest keep it ---
  await page.evaluate(`(() => {
    const p = ${POP};
    const rows = p.querySelectorAll('.rf-sel-row');
    [...rows[2].querySelectorAll('.rf-sel-act')].find(b => b.textContent === '×').click();
  })()`);
  await new Promise(r => setTimeout(r, 100));
  applied = await page.evaluate(() => ['c1', 'c2', 'c3'].map(id => document.getElementById(id).style.cssText));
  check('removed member reverts its preview', !applied[2].includes('40px'), JSON.stringify(applied));
  check('remaining members keep preview', applied[0].includes('40px') && applied[1].includes('40px'), JSON.stringify(applied));
  state = await page.evaluate(`(() => { const p = ${POP}; return {
    rows: p.querySelectorAll('.rf-sel-row').length,
    count: p.querySelector('.rf-sel-head span').textContent,
    markers: document.querySelectorAll('div[style*="rgba(37, 138, 85"]').length }; })()`);
  check('list shrinks to 2 after remove', state.rows === 2 && state.count === 'Selection — 2 elements', JSON.stringify(state));
  check('marker removed too', state.markers === 1, JSON.stringify(state));

  // --- Promote member 2 to primary ---
  await page.evaluate(`(() => {
    const p = ${POP};
    const rows = p.querySelectorAll('.rf-sel-row');
    [...rows[1].querySelectorAll('.rf-sel-act')].find(b => b.textContent === '★').click();
  })()`);
  await new Promise(r => setTimeout(r, 100));
  state = await page.evaluate(`(() => { const p = ${POP}; return {
    rows: [...p.querySelectorAll('.rf-sel-row')].map(r => r.querySelector('.rf-sel-name').textContent) }; })()`);
  check('promote reorders the list', /c2|Second/.test(state.rows[0]) && state.rows[0].startsWith('●'), JSON.stringify(state.rows));

  // --- "+ Add element" pick mode brings a 4th card in ---
  await page.evaluate(`(() => { const p = ${POP}; [...p.querySelectorAll('.rf-btn-sm')].find(b => b.textContent.includes('Add')).click(); })()`);
  await new Promise(r => setTimeout(r, 100));
  const banner = await page.evaluate(() => {
    for (const h of [...document.body.children, ...document.documentElement.children]) { const b = h.shadowRoot?.querySelector('.rf-banner'); if (b) return b.textContent; }
    return null;
  });
  check('add-element banner shown', /add to the selection/i.test(banner || ''), String(banner));
  await chordClick('#c4');
  await new Promise(r => setTimeout(r, 200));
  state = await page.evaluate(`(() => { const p = ${POP}; if (!p) return {err:'gone'}; return {
    rows: [...p.querySelectorAll('.rf-sel-row')].map(r => r.querySelector('.rf-sel-name').textContent),
    comment: p.querySelector('.rf-popover-ta').value }; })()`);
  check('added element joins the list', state.rows && state.rows.length === 3, JSON.stringify(state));
  applied = await page.evaluate(() => document.getElementById('c4').style.cssText);
  check('pending tweak carries onto the new member', applied.includes('40px'), applied);

  // --- Submit and inspect the export ---
  await page.evaluate(`(() => {
    const p = ${POP};
    p.querySelectorAll('.rf-tab-btn')[0].click();
    const ta = p.querySelector('.rf-popover-ta');
    ta.value = 'Align these cards';
    p.querySelector('.rf-btn-primary').click();
  })()`);
  await new Promise(r => setTimeout(r, 200));

  const out = await page.evaluate(() => {
    const api = window.__SCOPE_FEEDBACK_API__;
    const raw = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /feedback/i.test(k))));
    return { raw, apiKeys: api ? Object.keys(api) : null };
  });
  const ann = out.raw && out.raw[0];
  check('annotation saved', !!ann, JSON.stringify(out).slice(0, 300));
  check('saved annotation keeps 2 other members', ann && ann.targets && ann.targets.length === 2, JSON.stringify(ann && ann.targets));
  check('member refs carry selector + text', ann && ann.targets.every(t => t.selector && t.text), JSON.stringify(ann && ann.targets));

  const md = await page.evaluate(() => {
    const api = window.__SCOPE_FEEDBACK_API__;
    return api && api.markdown ? api.markdown() : null;
  });
  console.log('\n--- API keys: ' + JSON.stringify(out.apiKeys) + ' ---');
  if (md) console.log('--- MARKDOWN ---\n' + md + '\n----------------');

  // --- v5.12: framework-noise classes stay out of selectors ---
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c5');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 250));
  await page.evaluate(`(() => {
    const p = ${POP};
    const ta = p.querySelector('.rf-popover-ta');
    ta.value = 'utility check';
    p.querySelector('.rf-btn-primary').click();
  })()`);
  await new Promise(r => setTimeout(r, 200));
  const utilSel = await page.evaluate(() => {
    const a = window.__SCOPE_FEEDBACK_API__.annotations;
    return a[a.length - 1].selector;
  });
  check('selector skips variant/arbitrary classes', /#c5/.test(utilSel) && !/[:\[]/.test(utilSel) && /btnPrimary/.test(utilSel), utilSel);

	return finish();
	});
};
