// One suite crashing must not hide the suites after it (tracker #14): each
// suite runs isolated and a crash counts as a failure with the suite named.
const names = ['run', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7', 'run8'];
const suites = [];
for (const name of names) {
	try { suites.push(require('./' + name)); }
	catch (e) { console.error('SUITE FAILED TO LOAD: ' + name + ' — ' + (e && e.message || e)); }
}

(async () => {
	let passed = 0, failed = 0;
	for (let i = 0; i < names.length; i++) {
		const suite = suites[i];
		if (!suite) { failed++; continue; }
		try {
			if (await suite()) passed++;
			else { failed++; console.log('SUITE FAILED: ' + names[i]); }
		} catch (e) {
			failed++;
			console.error('SUITE CRASHED: ' + names[i] + ' — ' + (e && e.message || e));
		}
	}
	console.log('\n' + passed + '/' + names.length + ' suites passed');
	process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
