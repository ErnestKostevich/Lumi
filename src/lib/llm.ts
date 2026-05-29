/**
 * Streaming chat client supporting multiple LLM providers.
 *
 * Shipped providers (v0.0.1):
 *   - openrouter (multi-model routing: Claude / GPT / Gemini / Mistral / etc.)
 *   - openai     (native OpenAI — GPT-4o / o1 / o3 mini)
 *   - anthropic  (native Claude — Opus / Sonnet / Haiku, different API shape)
 *   - mistral    (native Mistral La Plateforme — EU-hosted)
 *
 * OpenRouter / OpenAI / Mistral all use OpenAI-compatible /chat/completions
 * SSE format. Anthropic uses its own /v1/messages endpoint with different
 * headers, body shape, and SSE event structure — branched in streamChat.
 *
 * From a Tauri WebView, cross-origin fetch follows browser CORS rules.
 * Anthropic requires the `anthropic-dangerous-direct-browser-access` header
 * to permit non-server callers. We send it.
 */

export type Provider = "openrouter" | "openai" | "anthropic" | "mistral";

export interface ProviderConfig {
  id: Provider;
  label: string;
  endpoint: string;
  keyUrl: string;
  keyHint: string;
  defaultModel: string;
  models: { id: string; label: string; note?: string }[];
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter — Claude / GPT / Gemini / Mistral / more",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "Starts with sk-or-v1-…",
    // Default to a FREE model so a freshly-pasted key costs the user $0.
    defaultModel: "google/gemini-2.0-flash-exp:free",
    models: [
      { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash", note: "FREE" },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B", note: "FREE" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", note: "Best writing — paid" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini", note: "Cheap" },
      { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", note: "Fast + cheap" },
      { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku" },
      { id: "mistralai/mistral-large-2411", label: "Mistral Large (via OR)" },
      { id: "mistralai/mistral-small-2503", label: "Mistral Small (via OR)" },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI — GPT-4o / GPT-4o mini / o1",
    endpoint: "https://api.openai.com/v1/chat/completions",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Starts with sk-… (project key)",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o", label: "GPT-4o", note: "Best general quality" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", note: "Cheapest, recommended" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { id: "o1-mini", label: "o1-mini", note: "Reasoning, no system msg" },
      { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", note: "Legacy, very cheap" },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic — Claude direct",
    endpoint: "https://api.anthropic.com/v1/messages",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "Starts with sk-ant-…",
    defaultModel: "claude-3-5-sonnet-latest",
    models: [
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", note: "Best writing" },
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", note: "Fast + cheap" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (Oct 2024)", note: "Pinned version" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (Oct 2024)", note: "Pinned version" },
      { id: "claude-3-opus-20240229", label: "Claude 3 Opus", note: "Older, expensive" },
    ],
  },
  mistral: {
    id: "mistral",
    label: "Mistral — native EU API",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    keyUrl: "https://console.mistral.ai/api-keys",
    keyHint: "From console.mistral.ai → API Keys",
    defaultModel: "mistral-large-latest",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large", note: "Strongest reasoning" },
      { id: "mistral-medium-latest", label: "Mistral Medium", note: "Balanced cost/quality" },
      { id: "mistral-small-latest", label: "Mistral Small", note: "Fast + cheap" },
      { id: "ministral-8b-latest", label: "Ministral 8B", note: "Tiny, very cheap" },
      { id: "ministral-3b-latest", label: "Ministral 3B", note: "Smallest, edge-friendly" },
      { id: "pixtral-large-latest", label: "Pixtral Large", note: "Vision-capable" },
    ],
  },
};

// Back-compat for existing imports (kept identical to OpenRouter models).
export const RECOMMENDED_MODELS = PROVIDERS.openrouter.models;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Error carrying the HTTP status so callers can humanise it. */
export class LlmHttpError extends Error {
  status: number;
  providerLabel: string;
  constructor(status: number, providerLabel: string, detail: string) {
    super(`${providerLabel} ${status}: ${detail}`);
    this.name = "LlmHttpError";
    this.status = status;
    this.providerLabel = providerLabel;
  }
}

/**
 * Turn any streamChat error into a short, friendly, non-technical message the
 * character can show. Keeps users out of raw JSON / stack traces.
 */
export function humanizeError(err: unknown, providerShortName = "the AI"): string {
  const status = err instanceof LlmHttpError ? err.status : undefined;
  const msg = err instanceof Error ? err.message : String(err);

  if (status === 401 || status === 403) {
    return `That ${providerShortName} key looks invalid — double-check it in ⚙ Settings.`;
  }
  if (status === 402) {
    return `Your ${providerShortName} account is out of credit. Add funds or switch to a FREE model in Settings.`;
  }
  if (status === 429) {
    return `Rate limited — wait a moment, or pick a cheaper / FREE model in Settings.`;
  }
  if (status === 404) {
    return `That model isn't available on your ${providerShortName} plan — pick another in Settings.`;
  }
  if (status && status >= 500) {
    return `${providerShortName} is having a moment (server error). Try again in a bit.`;
  }
  // Network-ish failures (fetch throws TypeError "Failed to fetch", etc.)
  if (/failed to fetch|networkerror|load failed|ecConnRefused|enotfound/i.test(msg)) {
    return `No connection — check your internet and try again.`;
  }
  return `Something went wrong talking to ${providerShortName}. Try again, or check ⚙ Settings.`;
}

/**
 * Validate an API key with a tiny 1-token request. Used by the "Test key"
 * buttons in onboarding + settings so users know the key works before relying
 * on it. Resolves quickly — aborts as soon as the first token arrives.
 */
export function pingProvider(opts: {
  provider: Provider;
  apiKey: string;
  model: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { provider, apiKey, model } = opts;
  if (!apiKey.trim()) return Promise.resolve({ ok: false, reason: "no key" });

  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const done = (result: { ok: boolean; reason?: string }) => {
      if (settled) return;
      settled = true;
      try { controller.abort(); } catch { /* noop */ }
      resolve(result);
    };
    // Hard timeout so a hung request doesn't leave the spinner forever.
    const timeout = setTimeout(() => done({ ok: false, reason: "timeout" }), 15_000);

    void streamChat({
      provider,
      apiKey,
      model,
      messages: [{ role: "user", content: "hi" }],
      systemPrompt: "Reply with a single word.",
      maxTokens: 1,
      onDelta: () => {
        clearTimeout(timeout);
        done({ ok: true });
      },
      onDone: () => {
        clearTimeout(timeout);
        done({ ok: true });
      },
      onError: (err) => {
        clearTimeout(timeout);
        done({ ok: false, reason: humanizeError(err, providerShortName(provider)) });
      },
      signal: controller.signal,
    });
  });
}

/** Short human label for a provider (used in error messages). */
export function providerShortName(p: Provider): string {
  switch (p) {
    case "mistral": return "Mistral";
    case "openai": return "OpenAI";
    case "anthropic": return "Anthropic";
    default: return "OpenRouter";
  }
}

export interface StreamOptions {
  /** Which provider to call. Determines endpoint + auth + body shape. */
  provider: Provider;
  /** Provider-specific API key. */
  apiKey: string;
  /** Model id valid for the chosen provider. */
  model: string;
  messages: ChatMessage[];
  systemPrompt: string;
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

export async function streamChat(opts: StreamOptions): Promise<void> {
  const cfg = PROVIDERS[opts.provider];
  if (!cfg) {
    opts.onError(new Error(`Unknown provider: ${opts.provider}`));
    return;
  }

  if (opts.provider === "anthropic") {
    return streamAnthropic(opts, cfg);
  }
  return streamOpenAICompat(opts, cfg);
}

/**
 * OpenAI / OpenRouter / Mistral — they all share the same /chat/completions
 * SSE format. Delta is `json.choices[0].delta.content`, end sentinel is
 * `data: [DONE]`.
 */
async function streamOpenAICompat(opts: StreamOptions, cfg: ProviderConfig): Promise<void> {
  const {
    provider,
    apiKey,
    model,
    messages,
    systemPrompt,
    onDelta,
    onDone,
    onError,
    signal,
    maxTokens = 500,
    temperature = 0.7,
  } = opts;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  // OpenRouter wants attribution headers for analytics + free-tier routing.
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://lumi-bloom0.vercel.app";
    headers["X-Title"] = "Lumi";
  }

  // OpenAI o1 family doesn't accept system messages — fold into first user msg.
  const isO1 = provider === "openai" && /^o1/.test(model);
  const body = isO1
    ? {
        model,
        messages: [
          { role: "user", content: `${systemPrompt}\n\n---\n\n${messages[0]?.content ?? ""}` },
          ...messages.slice(1),
        ],
        stream: true,
        max_completion_tokens: maxTokens,
      }
    : {
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
        max_tokens: maxTokens,
        temperature,
      };

  try {
    const response = await fetch(cfg.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable>");
      throw new LlmHttpError(response.status, cfg.label, text.slice(0, 300));
    }
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          onDone();
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length) onDelta(delta);
        } catch {
          /* malformed chunk — skip */
        }
      }
    }
    onDone();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onError(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Anthropic /v1/messages — different shape entirely:
 *   - Headers: x-api-key + anthropic-version + anthropic-dangerous-direct-browser-access
 *   - Body: { model, system, messages, max_tokens, stream: true }
 *     where `system` is TOP-LEVEL (not a message role)
 *   - SSE events: content_block_delta carries `delta.text`, end marker is
 *     `message_stop` event (no `[DONE]` sentinel).
 */
async function streamAnthropic(opts: StreamOptions, cfg: ProviderConfig): Promise<void> {
  const {
    apiKey,
    model,
    messages,
    systemPrompt,
    onDelta,
    onDone,
    onError,
    signal,
    maxTokens = 500,
    temperature = 0.7,
  } = opts;

  // Anthropic only accepts user/assistant in messages, system is separate.
  const cleanedMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(cfg.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: cleanedMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable>");
      throw new LlmHttpError(response.status, cfg.label, text.slice(0, 300));
    }
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          // Streaming text comes only on content_block_delta with type=text_delta.
          if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
            const txt = json.delta.text;
            if (typeof txt === "string" && txt.length) onDelta(txt);
          }
          // Anthropic signals end via `message_stop` event (no [DONE] sentinel).
          if (json.type === "message_stop") {
            onDone();
            return;
          }
        } catch {
          /* malformed chunk — skip */
        }
      }
    }
    onDone();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onError(e instanceof Error ? e : new Error(String(e)));
  }
}
