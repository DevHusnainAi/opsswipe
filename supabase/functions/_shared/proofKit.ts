// The files OpsSwipe adds to a repo (via a PR the user approves) so every PR is proven against
// saved production failures. No secrets: the report is authenticated with GitHub's OIDC token.

export const PROOF_SCRIPT_PATH = '.opsswipe/proof.mjs';
export const PROOF_WORKFLOW_PATH = '.github/workflows/opsswipe-proof.yml';

// Written without template literals so it can live inside this TypeScript string.
export const PROOF_SCRIPT = `// OpsSwipe proof. Replays the production requests that failed (saved in .opsswipe/replays)
// against this PR's running build, then reports the result to OpsSwipe with a GitHub OIDC token.
// Zero dependencies. Usage: node .opsswipe/proof.mjs http://127.0.0.1:3000
import fs from 'node:fs';
import path from 'node:path';

export function loadSamples(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).samples || []);
}

export async function replayAll(baseUrl, dir) {
  const results = [];
  for (const s of loadSamples(dir)) {
    const init = { method: s.method, signal: AbortSignal.timeout(10000) };
    if (s.body && s.method !== 'GET' && s.method !== 'HEAD') init.body = s.body;
    const status = await fetch(new URL(s.path, baseUrl), init).then((r) => r.status, () => 0);
    results.push({ method: s.method, path: s.path, was: s.status, now: status, passed: status >= 200 && status < 500 });
  }
  return { passed: results.filter((r) => r.passed).length, total: results.length, results };
}

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('add "permissions: id-token: write" to the workflow');
  const res = await fetch(url + '&audience=opsswipe', { headers: { Authorization: 'bearer ' + bearer } });
  return (await res.json()).value;
}

async function main() {
  const r = await replayAll(process.argv[2] || 'http://127.0.0.1:3000', '.opsswipe/replays');
  for (const x of r.results) console.log((x.passed ? 'PASS ' : 'FAIL ') + x.method + ' ' + x.path + ' was ' + x.was + ', now ' + x.now);
  console.log(r.passed + '/' + r.total + ' failing production requests now pass');
  const testsPassed = process.env.TESTS_PASSED === 'true';
  const proofUrl = process.env.OPSSWIPE_PROOF_URL;
  if (proofUrl && process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const body = JSON.stringify({
      headSha: event.pull_request.head.sha,
      replay: { passed: r.passed, total: r.total },
      tests: { passed: testsPassed },
      runUrl: process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID,
    });
    const res = await fetch(proofUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await oidcToken()) },
      body,
    });
    console.log('OpsSwipe answered ' + res.status + ': ' + (await res.text()));
  }
  process.exit(testsPassed && r.total > 0 && r.passed === r.total ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
`;

export const proofWorkflow = (proofUrl: string) =>
  `# OpsSwipe proof: before a fix can be merged, replay the requests that failed in production
# against this PR's build and run the tests. Edit the three commands below for your app.
name: opsswipe-proof
on: pull_request

permissions:
  contents: read
  id-token: write # lets the run prove to OpsSwipe it came from this repo; no secrets needed

jobs:
  proof:
    runs-on: ubuntu-latest
    env:
      INSTALL_COMMAND: npm install
      TEST_COMMAND: npm test
      START_COMMAND: npm start
      PORT: '3000'
      OPSSWIPE_PROOF_URL: ${proofUrl}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: $INSTALL_COMMAND
      - name: Tests
        id: tests
        run: if $TEST_COMMAND; then echo "passed=true" >> "$GITHUB_OUTPUT"; else echo "passed=false" >> "$GITHUB_OUTPUT"; fi
      - name: Start this PR's build
        run: |
          $START_COMMAND &
          for i in $(seq 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
      - name: Replay production failures and report
        env:
          TESTS_PASSED: \${{ steps.tests.outputs.passed }}
        run: node ${PROOF_SCRIPT_PATH} "http://127.0.0.1:$PORT"
`;
