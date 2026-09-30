// Where an OAuth redirect lands back in the app. Our builds use "opsswipe://"; Expo Go uses
// "exp://<laptop>:8081/--/". Only LAN Expo Go hosts are accepted: an arbitrary exp:// host would let
// a crafted link hand a user's one-time code to someone else's Expo Go project.
const EXPO_GO_LAN = /^exp:\/\/(192\.168|10|172\.(1[6-9]|2\d|3[01]))(\.\d{1,3}){2,3}:\d{2,5}\/--\/$/;
export const DEFAULT_BASE = 'opsswipe://';

export const isAppBase = (base: string) => base === DEFAULT_BASE || EXPO_GO_LAN.test(base);

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// OAuth state carries the return base after a "~", so the callback can find its way back.
export const withReturn = (nonce: string, base?: unknown) =>
  typeof base === 'string' && base !== DEFAULT_BASE && isAppBase(base) ? `${nonce}~${b64url(base)}` : nonce;

export function returnBase(state: string | null): string {
  const enc = state?.split('~')[1];
  if (!enc) return DEFAULT_BASE;
  try {
    const base = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
    return isAppBase(base) ? base : DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}
