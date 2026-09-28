// HMAC-SHA256 request signing, same scheme as GitHub webhooks ("sha256=<hex>").
// https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
// crypto.subtle.verify compares in constant time.
const enc = new TextEncoder();

const key = (secret: string) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function sign(secret: string, body: string) {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)));
  return `sha256=${Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function verify(secret: string, body: string, header: string | null) {
  return await verifyHex(secret, body, header?.startsWith('sha256=') ? header.slice(7) : '');
}

// Bare hex digest, as Sentry sends it in Sentry-Hook-Signature.
export async function verifyHex(secret: string, body: string, hex: string | null) {
  if (!secret || !hex || !/^[0-9a-f]{64}$/.test(hex)) return false;
  const sig = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.verify('HMAC', await key(secret), sig, enc.encode(body));
}

// Constant-time comparison of two shared secrets (a header value against the configured one).
export function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.at(i) ?? 0) ^ (y.at(i) ?? 0);
  return diff === 0;
}
