import { useCallback, useRef, useState } from "react";
import {
  streamChat,
  PROVIDERS,
  humanizeError,
  providerShortName,
  type ChatMessage,
  type Provider,
} from "../lib/llm";
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
  /** Called when the user tries to chat but no API key is configured. */
  onNeedsKey?: () => void;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useChat({
  provider,
  apiKey,
  model,
  buildContext,
  onAssistantTurn,
  onNeedsKey,
}: UseChatOpts) {
  const [turns, setTurnsState] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // External setter — used by App.tsx to seed history loaded from SQLite.
  const setTurns = useCallback((next: ChatTurn[] | ((prev: ChatTurn[]) => ChatTurn[])) => {
    if (typeof next === "function") setTurnsState(next);
    else setTurnsState(next);
  }, []);

  // Core streaming routine — streams an assistant reply for a given history.
  const runStream = useCallback(
    async (history: ChatMessage[], assistantId: string) => {
      setBusy(true);
      const controller = new AbortController();
      controllerRef.current = controller;
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
              x.id === assistantId
                ? {
                    ...x,
                    streaming: false,
                    error: humanizeError(err, providerShortName(provider)),
                  }
                : x,
            ),
          );
          setBusy(false);
        },
        signal: controller.signal,
      });
    },
    [provider, apiKey, model, buildContext, onAssistantTurn],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (busy) return;

      if (!apiKey) {
        const cfg = PROVIDERS[provider];
        const label = providerShortName(provider);
        const url = cfg.keyUrl.replace(/^https?:\/\//, "");
        setTurnsState((t) => [
          ...t,
          { id: genId(), role: "user", content: trimmed },
          {
            id: genId(),
            role: "assistant",
            content: `I'd love to chat! I just need a free ${label} key first — tap the button below or open ⚙ Settings. Grab one at ${url} ✨`,
          },
        ]);
        onNeedsKey?.();
        return;
      }

      const userTurn: ChatTurn = { id: genId(), role: "user", content: trimmed };
      const assistantId = genId();
      setTurnsState((t) => [
        ...t,
        userTurn,
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);

      const history: ChatMessage[] = [...turns, userTurn].map((t) => ({
        role: t.role,
        content: t.content,
      }));
      await runStream(history, assistantId);
    },
    [provider, apiKey, busy, turns, runStream, onNeedsKey],
  );

  // Retry the last user message after an error — drops the errored assistant
  // turn and re-streams from the cleaned history (no duplicate user turn).
  const retry = useCallback(async () => {
    if (busy) return;
    // Find the last user message.
    let lastUserIdx = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    // History up to and including the last user message.
    const history: ChatMessage[] = turns
      .slice(0, lastUserIdx + 1)
      .map((t) => ({ role: t.role, content: t.content }));

    const assistantId = genId();
    // Replace everything after the last user turn with a fresh streaming turn.
    setTurnsState((t) => [
      ...t.slice(0, lastUserIdx + 1),
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    await runStream(history, assistantId);
  }, [busy, turns, runStream]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setBusy(false);
  }, []);

  const clear = useCallback(() => setTurnsState([]), []);

  return { turns, busy, send, retry, cancel, clear, setTurns };
}
