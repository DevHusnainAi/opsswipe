// OpsSwipe fetches service URLs from its own servers (the health check), so a URL must point at the public
// internet: never loopback, private networks, link-local (cloud metadata) or internal names. Checked when a
// service is saved and, after resolving the name, before every probe.

function v4Private(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast/reserved
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)); // IETF, benchmarking
}

function v6Private(ip: string) {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapped) return v4Private(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(x)) return true; // mapped v4 in hex form: refuse, don't parse
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
}

const isV4 = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h);
const isV6 = (h: string) => h.includes(':');

// For a hostname or IP from a URL (URL() has already normalized forms like 0x7f.1 to 127.0.0.1).
export function isPublicHost(host: string) {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (isV4(h)) return !v4Private(h);
  if (isV6(h)) return !v6Private(h);
  if (!h.includes('.')) return false; // single-label names resolve inside networks
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(h);
}

export function isPublicUrl(raw: string) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password &&
      isPublicHost(u.hostname);
  } catch {
    return false;
  }
}

// ponytail: checked after resolving, before the fetch; a DNS answer that changes in between (rebinding)
// is the ceiling. Connecting to the checked IP with the Host header set is the upgrade.
export async function resolvesPublic(raw: string, resolve = Deno.resolveDns) {
  if (!isPublicUrl(raw)) return false;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (isV4(host) || isV6(host)) return true;
  // No record of a type is an empty answer. Any other failure means this runtime can't look names up:
  // the name already passed isPublicHost, and paging every user for it would be worse, so log and allow.
  const lookup = (type: 'A' | 'AAAA') =>
    resolve(host, type).catch((e) => {
      if (e instanceof Deno.errors.NotFound) return [] as string[];
      throw e;
    });
  try {
    const answers = (await Promise.all([lookup('A'), lookup('AAAA')])).flat();
    return answers.length > 0 && answers.every(isPublicHost);
  } catch (e) {
    console.warn('dns lookup unavailable, host checked by name only:', host, String(e));
    return true;
  }
}
