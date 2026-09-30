import { assertEquals } from 'jsr:@std/assert@1';
import { isAppBase, returnBase, withReturn } from '../_shared/appLink.ts';

Deno.test('builds and Expo Go on the LAN are valid return addresses; nothing else is', () => {
  for (
    const ok of ['opsswipe://', 'exp://192.168.1.5:8081/--/', 'exp://10.0.0.12:8081/--/', 'exp://172.20.3.4:19000/--/']
  ) {
    assertEquals(isAppBase(ok), true, ok);
  }
  for (
    const bad of [
      'exp://evil.example.com:8081/--/',
      'exp://8.8.8.8:8081/--/',
      'https://evil.example/',
      'exp://192.168.1.5:8081/--/x',
    ]
  ) {
    assertEquals(isAppBase(bad), false, bad);
  }
});

Deno.test('state round-trips an Expo Go address and falls back to the app scheme', () => {
  const state = withReturn('nonce', 'exp://192.168.1.5:8081/--/');
  assertEquals(state.startsWith('nonce~'), true);
  assertEquals(returnBase(state), 'exp://192.168.1.5:8081/--/');
  assertEquals(withReturn('nonce', 'exp://evil.example.com:8081/--/'), 'nonce', 'bad addresses are never embedded');
  assertEquals(withReturn('nonce'), 'nonce');
  assertEquals(returnBase('nonce'), 'opsswipe://');
  assertEquals(
    returnBase(`nonce~${btoa('https://evil.example/')}`),
    'opsswipe://',
    'a forged state cannot redirect out',
  );
  assertEquals(returnBase('nonce~%%%'), 'opsswipe://');
});
