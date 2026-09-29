import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { checkPatch, type PatchInput, regressionTestPath } from '../_shared/patch.ts';

const input: PatchInput = {
  repo: 'me/app',
  commit: { sha: 'a'.repeat(40), message: 'Ship new checkout' },
  symptom: 'POST /checkout → 500',
  failing: [{ method: 'POST', path: '/checkout', status: 500, at: '2026-09-28T10:00:00Z' }],
  files: [
    { path: 'server.js', patch: '@@ -1 +1 @@', content: 'const ok = false;\n' },
    { path: 'old.js', patch: '', content: null }, // removed by the commit
  ],
};

Deno.test('checkPatch keeps real changes to files the bad commit touched', () => {
  const p = checkPatch({
    summary: ' Restored the flag. ',
    files: [{ path: 'server.js', content: 'const ok = true;\n' }],
  }, input);
  assertEquals(p, { summary: 'Restored the flag.', files: [{ path: 'server.js', content: 'const ok = true;\n' }] });
});

Deno.test('checkPatch drops files outside the commit, removed files, no-op and empty changes', () => {
  const p = checkPatch({
    summary: 's',
    files: [
      { path: 'server.js', content: 'const ok = true;\n' },
      { path: '.github/workflows/deploy.yml', content: 'evil' }, // never touched by the commit
      { path: 'old.js', content: 'resurrected' }, // the commit removed it
    ],
  }, input);
  assertEquals(p.files.map((f) => f.path), ['server.js']);
  assertThrows(() =>
    checkPatch({ summary: 's', files: [{ path: 'server.js', content: 'const ok = false;\n' }] }, input)
  );
  assertThrows(() => checkPatch({ summary: 's', files: [{ path: 'server.js', content: '   ' }] }, input));
  const ci = { ...input, files: [{ path: '.github/workflows/opsswipe-proof.yml', patch: '', content: 'real' }] };
  assertThrows(() =>
    checkPatch({ summary: 's', files: [{ path: '.github/workflows/opsswipe-proof.yml', content: 'forged' }] }, ci)
  );
});

Deno.test('a declined fix becomes a plain error that points to the revert', () => {
  assertThrows(
    () => checkPatch({ summary: 'Needs the database schema, which I was not given.', files: [] }, input),
    Error,
    'Try a revert instead',
  );
});

Deno.test('the regression test lands only at the path OpsSwipe picked, and never on its own', () => {
  const path = regressionTestPath('server.test.js', 'a'.repeat(40));
  assertEquals(path, 'opsswipe-aaaaaaa.test.js');
  assertEquals(regressionTestPath('test/api/price.spec.ts', 'b'.repeat(40)), 'test/api/opsswipe-bbbbbbb.test.ts');
  const withTest = { ...input, test: { example: { path: 'server.test.js', content: 'test()' }, path } };
  const p = checkPatch({
    summary: 's',
    files: [
      { path: 'server.js', content: 'const ok = true;\n' },
      { path, content: 'test("price is back")' },
      { path: 'server.test.js', content: '// weakened' }, // an existing test: not the AI's to rewrite
      { path: 'other.test.js', content: 'test()' }, // a test somewhere else
    ],
  }, withTest);
  assertEquals(p.files.map((f) => f.path), ['server.js', path]);
  assertThrows(() => checkPatch({ summary: 's', files: [{ path, content: 'test()' }] }, withTest), Error, 'confident');
});
