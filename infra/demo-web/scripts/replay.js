// Replays every failing production request saved by OpsSwipe (.opsswipe/replays/*.json) against a
// running build. A request passes if it no longer returns 5xx. Zero dependencies.
//   node scripts/replay.js http://127.0.0.1:3000
const fs = require('node:fs');
const path = require('node:path');

function loadSamples(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).samples ?? []);
}

async function replayAll(baseUrl, dir = path.join(process.cwd(), '.opsswipe', 'replays')) {
  const results = [];
  for (const s of loadSamples(dir)) {
    const init = { method: s.method, signal: AbortSignal.timeout(10_000) };
    if (s.body && !['GET', 'HEAD'].includes(s.method)) init.body = s.body;
    const status = await fetch(new URL(s.path, baseUrl), init).then((r) => r.status, () => 0);
    results.push({ method: s.method, path: s.path, was: s.status, now: status, passed: status >= 200 && status < 500 });
  }
  return { passed: results.filter((r) => r.passed).length, total: results.length, results };
}

module.exports = { replayAll, loadSamples };

if (require.main === module) {
  replayAll(process.argv[2] ?? 'http://127.0.0.1:3000').then((r) => {
    for (const x of r.results) console.log(`${x.passed ? 'PASS' : 'FAIL'}  ${x.method} ${x.path}  was ${x.was}, now ${x.now}`);
    console.log(`${r.passed}/${r.total} failing production requests now pass`);
    fs.writeFileSync('replay-result.json', JSON.stringify(r));
    process.exit(r.passed === r.total ? 0 : 1);
  });
}
