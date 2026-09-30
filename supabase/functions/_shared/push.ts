// Push notifications through Expo's push service: one POST, no SDK. Returns the tokens Expo says are
// dead so the caller can forget them. https://docs.expo.dev/push-notifications/sending-notifications/
const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

// page: an outage that needs someone now. It goes to the app's pager channel, which rings at alarm volume with a
// long vibration; everything else (back up, proven, weekly) uses the normal incidents channel.
export type Push = { title: string; body: string; data?: Record<string, unknown>; page?: boolean };

export const pushMessages = (tokens: string[], { page, ...p }: Push) =>
  tokens.map((to) => ({ to, ...p, channelId: page ? 'pager' : 'incidents', priority: 'high', sound: 'default' }));

// ponytail: one request, fine up to Expo's 100-per-request limit; chunk if a user ever has more phones.
export async function sendPush(tokens: string[], p: Push): Promise<string[]> {
  if (!tokens.length) return [];
  const res = await fetch(EXPO_PUSH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(pushMessages(tokens, p)),
  });
  if (!res.ok) throw new Error(`expo push ${res.status}: ${await res.text()}`);
  const tickets: { details?: { error?: string } }[] = (await res.json()).data ?? [];
  return tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
}
