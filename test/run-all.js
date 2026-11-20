const suites = [require('./run'), require('./run2'), require('./run3'), require('./run4'), require('./run5'), require('./run6'), require('./run7'), require('./run8'), require('./run9'), require('./run10'), require('./run11'), require('./run12'), require('./run13'), require('./run14'), require('./run15')];

(async () => {
	let passed = 0;
	for (const suite of suites) if (await suite()) passed++;
	console.log('\n' + passed + '/' + suites.length + ' suites passed');
	process.exit(passed === suites.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
