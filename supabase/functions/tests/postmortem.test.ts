import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { checkPostmortem, writePostmortem } from '../_shared/postmortem.ts';

const input = {
  title: 'Requests are failing',
  service: 'opsswipe-demo',
  symptom: 'GET /api/price → 500',
  downFor: '4m 10s',
  failing: [{ method: 'GET', path: '/api/price', status: 500 }],
  badCommit: {
    sha: 'a'.repeat(40),
    message: 'Ship new pricing',
    diff: '-const RELEASE_OK = true;\n+const RELEASE_OK = false;',
  },
  fixes: [{ action: 'revert_pr', outcome: 'executed', detail: 'https://github.com/me/app/pull/2' }],
  regressionTest: null,
};

Deno.test('a postmortem keeps short plain strings and at most four steps', () => {
  const long = 'x'.repeat(900);
  const p = checkPostmortem({ why: ` ${long} `, prevent: ['a', '', 7, 'b', 'c', 'd', 'e'] });
  assertEquals(p!.why.length, 600);
  assertEquals(p!.prevent, ['a', 'b', 'c', 'd']);
  assertEquals(checkPostmortem({ why: 'no steps', prevent: [] }), null);
  assertEquals(checkPostmortem('nonsense'), null);
});

Deno.test('the model gets what was recorded and an unusable answer is an error', async () => {
  let seen = '';
  const p = await writePostmortem((_s, user) => {
    seen = user;
    return Promise.resolve({ why: 'The release flipped RELEASE_OK.', prevent: ['Test /api/price'] });
  }, input);
  assertEquals(p, { why: 'The release flipped RELEASE_OK.', prevent: ['Test /api/price'] });
  assertEquals(JSON.parse(seen).badCommit.message, 'Ship new pricing');
  await assertRejects(() => writePostmortem(() => Promise.resolve(null), input), Error, 'could not write');
});
