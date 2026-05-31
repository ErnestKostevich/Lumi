import { useCallback, useEffect, useRef, useState } from "react";
import type { Provider } from "../lib/llm";
import type { ChatTurn } from "./useChat";
import {
  loadMemory,
  saveMemory,
  clearMemory,
  forgetFact,
  mergeFacts,
  extractMemory,
  getMemoryForPrompt,
  type MemoryFact,
} from "../lib/memory";

interface UseMemoryOpts {
  provider: Provider;
  apiKey: string;
  model: string;
  enabled: boolean;
}

/** Distill after this many new finalized turns, or after the idle delay. */
const TURN_THRESHOLD = 6;
const IDLE_MS = 25_000;

/**
 * Owns long-term memory state + a debounced, cost-safe distiller.
 *
 * Distillation only ever runs over turns produced in the CURRENT session
 * (baseline = the count of history loaded at mount), so the ~40 loaded turns —
 * already distilled in prior sessions — are never re-processed. One small LLM
 * call at most every ~6 turns / 25s; free-model friendly.
 */
export function useMemory({ provider, apiKey, model, enabled }: UseMemoryOpts) {
  const [facts, setFacts] = useState<MemoryFact[]>(() => loadMemory().facts);

  // Latest opts in refs so the async distiller closure always reads fresh values.
  const optsRef = useRef({ provider, apiKey, model, enabled });
  optsRef.current = { provider, apiKey, model, enabled };

  const baselineReadyRef = useRef(false);
  const lastNotedLenRef = useRef(0);
  const pendingRef = useRef<ChatTurn[]>([]);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const distill = useCallback(async () => {
    clearTimer();
    if (runningRef.current) return;
    const { provider: p, apiKey: key, model: m, enabled: en } = optsRef.current;
    if (!en || !key) return;
    const turns = pendingRef.current;
    if (turns.length === 0) return;

    runningRef.current = true;
    pendingRef.current = [];
    try {
      const existing = loadMemory().facts;
      const incoming = await extractMemory({
        provider: p,
        apiKey: key,
        model: m,
        recentTurns: turns.map((t) => ({ role: t.role, content: t.content })),
        existingFacts: existing,
      });
      if (incoming.length) {
        const merged = mergeFacts(existing, incoming);
        saveMemory({ facts: merged, updatedAt: Date.now(), version: 1 });
        setFacts(merged);
      }
    } catch (err) {
      console.warn("[memory] distill failed:", err);
    } finally {
      runningRef.current = false;
    }
  }, []);

  /** Called from App whenever chat.turns changes (after a turn finalizes). */
  const noteFinalizedTurns = useCallback(
    (allTurns: ChatTurn[]) => {
      if (!baselineReadyRef.current) return; // wait until history baseline is set
      if (allTurns.length > lastNotedLenRef.current) {
        const fresh = allTurns.slice(lastNotedLenRef.current);
        for (const t of fresh) {
          if (t.content.trim() && !t.streaming) pendingRef.current.push(t);
        }
        lastNotedLenRef.current = allTurns.length;
      }
      const { enabled: en, apiKey: key } = optsRef.current;
      if (!en || !key || pendingRef.current.length === 0) return;
      if (pendingRef.current.length >= TURN_THRESHOLD) {
        void distill();
      } else {
        clearTimer();
        timerRef.current = window.setTimeout(() => void distill(), IDLE_MS);
      }
    },
    [distill],
  );

  /** App calls this right after seeding loaded history so we don't distill it. */
  const setBaseline = useCallback((count: number) => {
    lastNotedLenRef.current = count;
    baselineReadyRef.current = true;
  }, []);

  const getPromptBlock = useCallback(() => getMemoryForPrompt(), []);

  const forget = useCallback((id: string) => {
    const next = forgetFact(id);
    setFacts(next.facts);
  }, []);

  const clearAll = useCallback(() => {
    clearMemory();
    setFacts([]);
  }, []);

  // Best-effort flush on unmount.
  useEffect(() => {
    return () => {
      clearTimer();
      if (pendingRef.current.length > 0) void distill();
    };
  }, [distill]);

  return { facts, noteFinalizedTurns, setBaseline, getPromptBlock, forget, clearAll };
}
