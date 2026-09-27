// CI glue: sends the replay + test results for this exact PR commit to OpsSwipe (signed).
// Env: OPSSWIPE_PROOF_URL, PROOF_SECRET, TESTS_PASSED, plus GitHub's own variables.
const fs = require('node:fs');
const { createHmac } = require('node:crypto');

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const replay = fs.existsSync('replay-result.json')
    ? JSON.parse(fs.readFileSync('replay-result.json', 'utf8'))
    : { passed: 0, total: 0 };
  const payload = JSON.stringify({
    repo: process.env.GITHUB_REPOSITORY,
    pr: event.pull_request.number,
    headSha: event.pull_request.head.sha,
    replay: { passed: replay.passed, total: replay.total },
    tests: { passed: process.env.TESTS_PASSED === 'true' },
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });
  console.log(`proof: ${payload}`);
  const { OPSSWIPE_PROOF_URL: url, PROOF_SECRET: secret } = process.env;
  if (!url || !secret) return console.log('OPSSWIPE_PROOF_URL / PROOF_SECRET not set; not reporting');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opsswipe-signature': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`,
    },
    body: payload,
  });
  console.log(`OpsSwipe answered ${res.status}: ${await res.text()}`);
}

main();
