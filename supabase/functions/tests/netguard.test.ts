import { assertEquals } from 'jsr:@std/assert@1';
import { isPublicUrl, resolvesPublic } from '../_shared/netguard.ts';

Deno.test('service URLs must be on the public internet', () => {
  for (
    const bad of [
      'http://localhost:3000/',
      'http://127.0.0.1/',
      'http://0x7f.1/', // URL() normalizes this to 127.0.0.1
      'http://2130706433/', // and this
      'http://10.0.0.5/',
      'http://172.20.1.1/',
      'http://192.168.1.10/',
      'http://100.64.0.1/',
      'http://169.254.169.254/computeMetadata/v1/',
      'http://metadata.google.internal/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://intranet/',
      'http://printer.local/',
      'http://user:pw@example.com/',
      'ftp://example.com/',
      'not a url',
    ]
  ) assertEquals(isPublicUrl(bad), false, bad);
  for (const good of ['http://34.135.145.87/', 'https://api.example.com/health', 'https://[2606:4700::1111]/']) {
    assertEquals(isPublicUrl(good), true, good);
  }
});

Deno.test('a public name that resolves inside a network is refused before the probe', async () => {
  const dns = (answers: Record<string, string[]>) => (_h: string, type: string) =>
    Promise.resolve(answers[type] ?? []) as ReturnType<typeof Deno.resolveDns>;
  assertEquals(await resolvesPublic('https://ok.example.com/', dns({ A: ['34.1.2.3'] }) as never), true);
  assertEquals(await resolvesPublic('https://evil.example.com/', dns({ A: ['169.254.169.254'] }) as never), false);
  assertEquals(
    await resolvesPublic('https://mixed.example.com/', dns({ A: ['34.1.2.3'], AAAA: ['::1'] }) as never),
    false,
  );
  assertEquals(await resolvesPublic('https://nx.example.com/', dns({}) as never), false, 'no answer, no probe');
});
