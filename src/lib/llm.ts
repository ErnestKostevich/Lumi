/**
 * Minimal streaming client for OpenRouter (OpenAI-compatible chat completions).
 *
 * We use OpenRouter so the user can swap models easily (Claude / GPT / Gemini)
 * via a single key. Free-tier strategy: user provides their own key (BYO-key)
 * so we don't carry API cost. Pro tier will later add our metered key.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamOptions {
  apiKey: string;
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

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function streamChat(opts: StreamOptions): Promise<void> {
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

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter tracks app attribution — replace with real domain once we have one.
        "HTTP-Referer": "https://anime-buddy.app",
        "X-Title": "Anime Buddy",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
        max_tokens: maxTokens,
        temperature,
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable>");
      throw new Error(`OpenRouter ${response.status}: ${text.slice(0, 300)}`);
    }
    if (!response.body) throw new Error("No response body from OpenRouter");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE: split on newlines, keep partial trailing chunk in buffer.
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
          // malformed/empty chunk — skip silently
        }
      }
    }
    onDone();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onError(e instanceof Error ? e : new Error(String(e)));
  }
}

export const RECOMMENDED_MODELS: { id: string; label: string; note: string }[] = [
  {
    id: "anthropic/claude-3.5-sonnet",
    label: "Claude 3.5 Sonnet",
    note: "Best writing quality. Recommended.",
  },
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o mini",
    note: "Cheapest, still good.",
  },
  {
    id: "google/gemini-2.0-flash-001",
    label: "Gemini 2.0 Flash",
    note: "Fast and cheap.",
  },
  {
    id: "anthropic/claude-3.5-haiku",
    label: "Claude 3.5 Haiku",
    note: "Fast Anthropic model.",
  },
  {
    id: "mistralai/mistral-large-2411",
    label: "Mistral Large",
    note: "European, strong reasoning.",
  },
  {
    id: "mistralai/mistral-small-2503",
    label: "Mistral Small",
    note: "Cheap + fast Mistral.",
  },
];
