// AI providers next to Claude on Vertex: any OpenAI-compatible chat API, with plain fetch. NVIDIA's
// hosted models (Nemotron) are the default; Groq or any other works by base URL. The model only ever
// returns JSON; every answer is validated by the caller (allowed fixes only, checkPatch for code), so a
// bad reply falls back safely. https://docs.api.nvidia.com/nim/reference/llm-apis
export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';

export type Llm = (system: string, user: string, schema: Record<string, unknown>) => Promise<unknown>;

// Reasoning models may think out loud first, or wrap JSON in a code fence: take the JSON object only.
export function parseJsonReply(text: string): unknown {
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUSY = new Set([429, 502, 503, 504]); // overloaded or rate-limited: worth another try

// ponytail: 3 tries with 1s/3s backoff; then the caller's fallback (another provider, or the rules).
export function openaiLlm(baseUrl: string, apiKey: string, model: string, maxTokens = 8192, wait = sleep): Llm {
  return async (system, user, schema) => {
    for (let attempt = 1;; attempt++) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'system',
              content: `${system}\nReply with one JSON object only, matching: ${JSON.stringify(schema)}`,
            },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const out = await res.json();
        return parseJsonReply(String(out.choices?.[0]?.message?.content ?? ''));
      }
      const text = (await res.text()).slice(0, 200);
      if (!BUSY.has(res.status) || attempt === 3) throw new Error(`${new URL(baseUrl).host} ${res.status}: ${text}`);
      await wait(attempt === 1 ? 1000 : 3000);
    }
  };
}

export const nvidiaLlm = (apiKey: string, model: string, maxTokens?: number) =>
  openaiLlm(NVIDIA_BASE, apiKey, model, maxTokens);

// The primary model, then a backup provider if it fails (overloaded, down, or an unusable answer).
export const withFallback = (primary: Llm, backup?: Llm): Llm =>
  backup
    ? async (s, u, schema) => {
      try {
        const r = await primary(s, u, schema);
        if (r !== null) return r;
      } catch (e) {
        console.warn('primary AI failed, trying the backup:', String(e));
      }
      return await backup(s, u, schema);
    }
    : primary;
