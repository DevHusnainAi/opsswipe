// Secrets on the phone live in its secure hardware (expo-secure-store: Android Keystore), not in plain
// AsyncStorage, so a backup or a rooted phone can't lift the session. The fix key is also released
// only after the fingerprint, and the server checks it on every fix (execute + _shared/fixKeys.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomValues } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// Supabase's sign-in (PKCE) needs random values; React Native doesn't ship crypto.getRandomValues.
const g = globalThis as { crypto?: { getRandomValues?: typeof getRandomValues } };
g.crypto ??= {};
g.crypto.getRandomValues ??= getRandomValues;

// Keys may only use letters, digits, ".", "-" and "_". Values are split: some devices reject big ones.
const CHUNK = 1800;
const safe = (key: string) => key.replace(/[^\w.-]/g, '_');

async function readChunks(key: string) {
  const n = Number(await SecureStore.getItemAsync(`${safe(key)}.n`));
  if (!n) return null;
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(`${safe(key)}.${i}`)));
  return parts.some((p) => p === null) ? null : parts.join('');
}

async function removeChunks(key: string) {
  const n = Number(await SecureStore.getItemAsync(`${safe(key)}.n`)) || 0;
  for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${safe(key)}.${i}`);
  await SecureStore.deleteItemAsync(`${safe(key)}.n`);
}

// The storage Supabase keeps its session (and PKCE verifier) in.
export const secureStorage = {
  async getItem(key: string) {
    const value = await readChunks(key);
    if (value !== null) return value;
    // Moved once from where earlier versions kept it, then deleted there.
    const old = await AsyncStorage.getItem(key);
    if (old !== null) {
      await secureStorage.setItem(key, old);
      await AsyncStorage.removeItem(key);
    }
    return old;
  },
  async setItem(key: string, value: string) {
    await removeChunks(key);
    const n = Math.max(1, Math.ceil(value.length / CHUNK));
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${safe(key)}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${safe(key)}.n`, String(n));
  },
  async removeItem(key: string) {
    await removeChunks(key);
    await AsyncStorage.removeItem(key);
  },
};

const FIX_KEY = 'opsswipe.fix-key';
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export class FixKeyError extends Error {}

// The key for one fix: reading it shows the fingerprint prompt. None yet (new phone, or the fingerprints
// changed, which makes Android destroy it): a new one is made and enrolled, which the server allows only
// right after a sign-in. Throws FixKeyError when cancelled or when the phone has no fingerprint.
export async function fixKey(prompt: string, enroll: (key: string) => Promise<void>) {
  const opts = { requireAuthentication: true, authenticationPrompt: prompt };
  try {
    const had = await SecureStore.getItemAsync(FIX_KEY, opts);
    if (had) return had;
    const key = hex(getRandomValues(new Uint8Array(32)));
    await SecureStore.setItemAsync(FIX_KEY, key, opts);
    await enroll(key);
    return key;
  } catch (e) {
    if (e instanceof FixKeyError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new FixKeyError(
      /cancel/i.test(msg)
        ? 'Cancelled. Nothing was changed.'
        : /not (enrolled|available)|no biometric|hardware/i.test(msg)
        ? 'Set up a fingerprint on this phone to approve fixes.'
        : msg,
    );
  }
}

export const forgetFixKey = () => SecureStore.deleteItemAsync(FIX_KEY).catch(() => {});
