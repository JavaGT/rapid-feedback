const { POP, MARKERS, createReporter, withPage, waitForPopover, waitForPopoverGone } = require('./common');

module.exports = async function run() {
	const { check, finish } = createReporter();
	return withPage(async (page, chordClick) => {

  // --- Multi-select three cards with the chord, then release ---
  await page.keyboard.down('Alt');
  await page.keyboard.down('Meta');
  await chordClick('#c1');
  await chordClick('#c2');
  await chordClick('#c3');
  const markersDuring = await page.evaluate(`${MARKERS}`);
  check('markers appear while accumulating', markersDuring === 3, 'got ' + markersDuring);
  await page.keyboard.up('Meta');
  await page.keyboard.up('Alt');
  await waitForPopover(page);

  let state = await page.evaluate(`(() => {
    const p = ${POP}; if (!p) return { err: 'no popover' };
    return {
      rows: [...p.querySelectorAll('.rf-sel-row')].map(r => r.querySelector('.rf-sel-name').textContent),
      count: p.querySelector('.rf-sel-head span').textContent,
      title: p.querySelector('.rf-title').textContent,
      zoomHidden: p.querySelector('.rf-zoom-row').style.display,
      markers: ${MARKERS},
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
    markers: ${MARKERS} }; })()`);
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
  await waitForPopoverGone(page);

  const out = await page.evaluate(() => {
    const api = window.__SCOPE_FEEDBACK_API__;
    const parsed = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /feedback/i.test(k))));
    // Storage carries an { annotations } envelope since v5.14; older installs saved a bare array.
    const rows = Array.isArray(parsed) ? parsed : parsed?.annotations;
    return { raw: rows, apiKeys: api ? Object.keys(api) : null };
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
  await waitForPopover(page);
  await page.evaluate(`(() => {
    const p = ${POP};
    const ta = p.querySelector('.rf-popover-ta');
    ta.value = 'utility check';
    p.querySelector('.rf-btn-primary').click();
  })()`);
  await waitForPopoverGone(page);
  const utilSel = await page.evaluate(() => {
    const a = window.__SCOPE_FEEDBACK_API__.annotations;
    return a[a.length - 1].selector;
  });
  check('selector skips variant/arbitrary classes', /#c5/.test(utilSel) && !/[:\[]/.test(utilSel) && /btnPrimary/.test(utilSel), utilSel);

  // --- v5.13: Svelte source mapping (fake __svelte_meta, no build chain) ---
  await page.evaluate(() => {
    const mk = (el, file, line, col) => { el.__svelte_meta = { loc: { file, line, column: col } }; };
    mk(document.getElementById('row'), '/repo/src/lib/CardGrid.svelte', 18, 0);
    mk(document.getElementById('c1'), '/repo/src/lib/Card.svelte', 42, 8);
    document.getElementById('c1').__svelte_meta.parent =
      { file: '/repo/src/routes/projects/+page.svelte', line: 15, type: 'component', parent: null };
    mk(document.getElementById('c2'), '/repo/src/lib/Card.svelte', 42, 8);
    document.getElementById('c2').__svelte_meta.parent =
      { file: '/repo/src/lib/CardGrid.svelte', line: 18, type: 'component', parent:
        { file: '/repo/src/routes/projects/+page.svelte', line: 15, type: 'component', parent: null } };
    mk(document.getElementById('c3'), '/repo/src/lib/Other.svelte', 9, 0);
    window.__SCOPE_FEEDBACK_API__.setProjectRoot('/repo');
  });

  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c1');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await waitForPopover(page);
  await page.evaluate(`(() => { const p = ${POP};
    p.querySelector('.rf-popover-ta').value = 'svelte check';
    p.querySelector('.rf-btn-primary').click();
  })()`);
  await waitForPopoverGone(page);
  const sv = await page.evaluate(() => {
    const api = window.__SCOPE_FEEDBACK_API__;
    const a = api.annotations[api.annotations.length - 1];
    return {
      ref: a.source && a.source.ref,
      stack0: a.source && a.source.componentStack && a.source.componentStack[0].ref,
      components: a.source && a.source.components && a.source.components.map(c => c.ref),
      md: api.markdown(),
      json: api.json()
    };
  });
  const svJson = JSON.stringify(sv.json);
  check('svelte source maps file:line + route-aware stack',
    sv.ref === 'src/lib/Card.svelte:42' && sv.stack0 === 'CardGrid.svelte:18',
    JSON.stringify({ ref: sv.ref, stack0: sv.stack0 }));
  check('nested Svelte component trail keeps leaf-to-root order',
    JSON.stringify(sv.components) === JSON.stringify(['Card.svelte:42', 'CardGrid.svelte:18', 'projects/+page.svelte:15']),
    JSON.stringify(sv.components));
  check('editor deep link carries root, line and column',
    sv.md.includes('vscode://file/repo/src/lib/Card.svelte:42:8'),
    sv.md.split('\n').filter(l => l.includes('vscode')).join(' | '));
  // A file path containing '#' or '?' must be escaped exactly once.
  await page.evaluate(() => {
    document.getElementById('c4').__svelte_meta =
      { loc: { file: '/repo/src/lib/Weird#Name?.svelte', line: 7, column: 3 } };
  });
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c4');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await waitForPopover(page);
  await page.evaluate(`(() => { const p = ${POP};
    p.querySelector('.rf-popover-ta').value = 'weird path'; p.querySelector('.rf-btn-primary').click(); })()`);
  await waitForPopoverGone(page);
  const weird = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.markdown());
  check('editor deep link escapes # and ? exactly once',
    weird.includes('vscode://file/repo/src/lib/Weird%23Name%3F.svelte:7:3') && !weird.includes('%2523'),
    weird.split('\n').filter(l => l.includes('vscode')).join(' | '));
  // c4 is reused below for the no-meta disclosure check.
  await page.evaluate(() => { delete document.getElementById('c4').__svelte_meta; });
  check('exports include computed visual context',
    sv.md.includes('Looks:') && svJson.includes('"looks"') && !svJson.includes('"styles"'),
    sv.md.split('\n').find(l => l.startsWith('Looks:')) || svJson.slice(0, 200));

  // Select similar must group by component file: c2 shares Card.svelte, c3/c4/c5 don't.
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c1');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await waitForPopover(page);
  await page.evaluate(`(() => { const p = ${POP};
    [...p.querySelectorAll('.rf-btn-sm')].find(b => /similar/i.test(b.textContent)).click();
  })()`);
  await new Promise(r => setTimeout(r, 200));
  const simRows = await page.evaluate(`(() => { const p = ${POP}; return p ? p.querySelectorAll('.rf-sel-row').length : -1; })()`);
  check('select similar groups by component file', simRows === 2, 'rows=' + simRows + ' (signature fallback would sweep all cards)');
  await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'nested group check'; p.querySelector('.rf-btn-primary').click(); })()`);
  await waitForPopoverGone(page);
  const groupContext = await page.evaluate(() => {
    const api = window.__SCOPE_FEEDBACK_API__;
    const a = api.annotations[api.annotations.length - 1];
    return { targetSource: a.targets?.[0]?.source, md: api.markdown() };
  });
  check('group members retain their component trail',
    groupContext.targetSource?.components?.[0]?.ref === 'Card.svelte:42' && groupContext.md.includes('    Component: CardGrid.svelte:18 \u2190 projects/+page.svelte:15'),
    JSON.stringify(groupContext.targetSource));
  await new Promise(r => setTimeout(r, 150));

  // Metadata on a shadow host should still describe a target inside its root.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'shadow-card-host';
    host.style.cssText = 'display:block;margin:20px;padding:12px;border:1px solid #777';
    host.__svelte_meta = {
      loc: { file: '/repo/src/lib/ShadowCard.svelte', line: 7, column: 2 },
      parent: { file: '/repo/src/routes/projects/+page.svelte', line: 15, type: 'component', parent: null }
    };
    const root = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = 'Shadow action';
    root.appendChild(button);
    document.body.appendChild(host);
  });
  const shadowPoint = await page.evaluate(() => {
    const button = document.querySelector('#shadow-card-host').shadowRoot.querySelector('button');
    const r = button.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await page.mouse.click(shadowPoint.x, shadowPoint.y);
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await waitForPopover(page);
  await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'shadow context check'; p.querySelector('.rf-btn-primary').click(); })()`);
  await waitForPopoverGone(page);
  const shadowSource = await page.evaluate(() => {
    const api = window.__SCOPE_FEEDBACK_API__;
    return api.annotations[api.annotations.length - 1].source;
  });
  check('shadow-root targets inherit host component context',
    shadowSource?.viaAncestor && shadowSource.components?.[0]?.ref === 'ShadowCard.svelte:7' && shadowSource.components?.[1]?.ref === 'projects/+page.svelte:15',
    JSON.stringify(shadowSource));

  await page.evaluate(() => {
    const c = document.getElementById('c4');
    c.setAttribute('aria-describedby', 'c4-help');
    c.setAttribute('aria-expanded', 'true');
    const help = document.createElement('span');
    help.id = 'c4-help';
    help.textContent = 'Opens the project details';
    document.body.appendChild(help);
  });
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c4');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await waitForPopover(page);
  await page.evaluate(`(() => { const p = ${POP}; p.querySelector('.rf-popover-ta').value = 'accessibility context check'; p.querySelector('.rf-btn-primary').click(); })()`);
  await waitForPopoverGone(page);
  const a11yContext = await page.evaluate(() => window.__SCOPE_FEEDBACK_API__.annotations.at(-1).a11y);
  check('accessibility context includes descriptions and states',
    a11yContext?.description === 'Opens the project details' && a11yContext.states?.expanded === 'true',
    JSON.stringify(a11yContext));
  await page.evaluate(() => {
    document.getElementById('shadow-card-host')?.remove();
    document.getElementById('c4-help')?.remove();
  });

  // Hostile page: a throwing __svelte_meta getter must not break capture.
  await page.evaluate(() => {
    Object.defineProperty(document.getElementById('c1'), '__svelte_meta', { get() { throw new Error('boom'); }, configurable: true });
  });
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c1');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 250));
  const hostilePop = await page.evaluate(`(() => { const p = ${POP}; return !!p; })()`);
  check('hostile __svelte_meta getter fails soft', hostilePop, '');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 150));

  // Svelte-looking page without dev metadata → explicit disclosure, not silence.
  await page.evaluate(() => {
    delete document.getElementById('row').__svelte_meta;
    document.body.classList.add('svelte-probe-class');
  });
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta');
  await chordClick('#c4');
  await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await waitForPopover(page);
  await page.evaluate(`(() => { const p = ${POP};
    p.querySelector('.rf-popover-ta').value = 'disclosure check';
    p.querySelector('.rf-btn-primary').click();
  })()`);
  await waitForPopoverGone(page);
  const disc = await page.evaluate(() => {
    const api = window.__SCOPE_FEEDBACK_API__;
    const a = api.annotations[api.annotations.length - 1];
    return { status: a.source && a.source.status, md: api.markdown() };
  });
  check('prod-build disclosure when dev meta absent',
    disc.status === 'svelte-production-build' && disc.md.includes('Svelte production build'),
    String(disc.status));

	return finish();
	});
};
