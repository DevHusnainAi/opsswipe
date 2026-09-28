import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { checkPatch, type PatchInput } from '../_shared/patch.ts';

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
});

Deno.test('a declined fix becomes a plain error that points to the revert', () => {
  assertThrows(
    () => checkPatch({ summary: 'Needs the database schema, which I was not given.', files: [] }, input),
    Error,
    'Try a revert instead',
  );
});
