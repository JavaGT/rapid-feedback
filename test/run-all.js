// One suite crashing must not hide the suites after it (tracker #14): each
// suite runs isolated and a crash counts as a failure with the suite named.
const names = ['run', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7', 'run8'];
const suites = names.map(name => require('./' + name));

(async () => {
	let passed = 0, failed = 0;
	for (let i = 0; i < suites.length; i++) {
		try {
			if (await suites[i]()) passed++;
			else { failed++; console.log('SUITE FAILED: ' + names[i]); }
		} catch (e) {
			failed++;
			console.error('SUITE CRASHED: ' + names[i] + ' — ' + (e && e.message || e));
		}
	}
	console.log('\n' + passed + '/' + suites.length + ' suites passed');
	process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
