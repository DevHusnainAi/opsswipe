// A second AI provider next to Claude on Vertex: NVIDIA's hosted models (Nemotron and others) through
// their OpenAI-compatible endpoint, with plain fetch. The model only ever returns JSON; every answer is
// validated by the caller (allowed fixes only, checkPatch for code), so a bad reply falls back safely.
// https://docs.api.nvidia.com/nim/reference/llm-apis
const NVIDIA = 'https://integrate.api.nvidia.com/v1/chat/completions';

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

export function nvidiaLlm(apiKey: string, model: string, maxTokens = 8192): Llm {
  return async (system, user, schema) => {
    const res = await fetch(NVIDIA, {
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
    if (!res.ok) throw new Error(`nvidia ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const out = await res.json();
    return parseJsonReply(String(out.choices?.[0]?.message?.content ?? ''));
  };
}
