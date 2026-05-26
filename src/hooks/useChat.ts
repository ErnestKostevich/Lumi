import { useCallback, useRef, useState } from "react";
import { streamChat, type ChatMessage, type Provider } from "../lib/llm";
import { buildSystemPrompt, type PersonalityContext } from "../lib/personality";

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: string;
}

export interface UseChatOpts {
  provider: Provider;
  apiKey: string;
  model: string;
  /** Snapshot of personality context at send time. Called once per send. */
  buildContext: () => PersonalityContext;
  /** Called when a new assistant turn finishes streaming. */
  onAssistantTurn?: (text: string) => void;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useChat({ provider, apiKey, model, buildContext, onAssistantTurn }: UseChatOpts) {
  const [turns, setTurnsState] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // External setter — used by App.tsx to seed history loaded from SQLite.
  const setTurns = useCallback((next: ChatTurn[] | ((prev: ChatTurn[]) => ChatTurn[])) => {
    if (typeof next === "function") setTurnsState(next);
    else setTurnsState(next);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (busy) return;

      if (!apiKey) {
        const providerLabel = provider === "mistral" ? "Mistral" : "OpenRouter";
        const url =
          provider === "mistral"
            ? "console.mistral.ai/api-keys"
            : "openrouter.ai/keys";
        setTurnsState((t) => [
          ...t,
          { id: genId(), role: "user", content: trimmed },
          {
            id: genId(),
            role: "assistant",
            content: `I need a ${providerLabel} API key first. Open ⚙ Settings and paste it — grab one at ${url} ✨`,
          },
        ]);
        return;
      }

      const userTurn: ChatTurn = { id: genId(), role: "user", content: trimmed };
      const assistantId = genId();
      setTurnsState((t) => [
        ...t,
        userTurn,
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setBusy(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      const history: ChatMessage[] = [...turns, userTurn].map((t) => ({
        role: t.role,
        content: t.content,
      }));

      let buffer = "";
      await streamChat({
        provider,
        apiKey,
        model,
        messages: history,
        systemPrompt: buildSystemPrompt(buildContext()),
        onDelta: (d) => {
          buffer += d;
          setTurnsState((t) =>
            t.map((x) => (x.id === assistantId ? { ...x, content: x.content + d } : x)),
          );
        },
        onDone: () => {
          setTurnsState((t) =>
            t.map((x) => (x.id === assistantId ? { ...x, streaming: false } : x)),
          );
          setBusy(false);
          if (buffer.trim()) onAssistantTurn?.(buffer);
        },
        onError: (err) => {
          setTurnsState((t) =>
            t.map((x) =>
              x.id === assistantId ? { ...x, streaming: false, error: err.message } : x,
            ),
          );
          setBusy(false);
        },
        signal: controller.signal,
      });
    },
    [provider, apiKey, model, busy, turns, buildContext, onAssistantTurn],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setBusy(false);
  }, []);

  const clear = useCallback(() => setTurnsState([]), []);

  return { turns, busy, send, cancel, clear, setTurns };
}
