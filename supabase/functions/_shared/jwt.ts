// RS256 JWTs with WebCrypto, no dependencies. Used for Google service accounts (PKCS#8 keys) and
// GitHub Apps (PKCS#1 "BEGIN RSA PRIVATE KEY" keys, which WebCrypto can't import directly).
const text = (s: string) => new TextEncoder().encode(s);

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const b64urlDecode = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function derLength(n: number) {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

const der = (tag: number, body: Uint8Array) => Uint8Array.from([tag, ...derLength(body.length), ...body]);

// PKCS#8 PrivateKeyInfo { version 0, AlgorithmIdentifier rsaEncryption, OCTET STRING pkcs1 }
export function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const rsaAlg = Uint8Array.from('300d06092a864886f70d0101010500'.match(/../g)!, (h) => parseInt(h, 16));
  return der(0x30, Uint8Array.from([0x02, 0x01, 0x00, ...rsaAlg, ...der(0x04, pkcs1)]));
}

export function pemToPkcs8(pem: string) {
  const body = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  return pem.includes('BEGIN RSA PRIVATE KEY') ? pkcs1ToPkcs8(body) : body;
}

export async function signRs256(claims: Record<string, unknown>, pem: string) {
  const header = b64url(text(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(text(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, text(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}
