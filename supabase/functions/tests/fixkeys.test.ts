import { assertEquals } from 'jsr:@std/assert@1';
import { b64url } from '../_shared/jwt.ts';

Deno.env.set('SUPABASE_URL', Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321'); // db.ts connects on import
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'test');
const { freshSignIn, signedInAt, validKey } = await import('../_shared/fixKeys.ts');

const jwt = (claims: unknown) => `h.${b64url(new TextEncoder().encode(JSON.stringify(claims)))}.s`;
const now = Date.parse('2026-09-29T12:00:00Z');
const at = (msAgo: number) => Math.floor((now - msAgo) / 1000);

Deno.test('a fix key can only be enrolled right after a real sign-in, not with a refreshed token', () => {
  assertEquals(signedInAt(jwt({ amr: [{ method: 'password', timestamp: at(0) }] })), now);
  assertEquals(freshSignIn(jwt({ amr: [{ method: 'password', timestamp: at(5 * 60_000) }] }), now), true);
  assertEquals(
    freshSignIn(jwt({ amr: [{ method: 'oauth', timestamp: at(2 * 3600_000) }], iat: at(0) }), now),
    false,
    'a token refreshed now still carries the old sign-in time',
  );
  assertEquals(freshSignIn(jwt({}), now), false, 'no amr, no enrolment');
  assertEquals(freshSignIn('junk', now), false);
});

Deno.test('fix keys are 32 random bytes in hex', () => {
  assertEquals(validKey('a'.repeat(64)), true);
  assertEquals(validKey('a'.repeat(63)), false);
  assertEquals(validKey('Z'.repeat(64)), false);
  assertEquals(validKey(undefined), false);
});
