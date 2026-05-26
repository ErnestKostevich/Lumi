/**
 * Chat history persistence — localStorage backed (v0.0.1).
 *
 * Why localStorage and not SQLite: tauri-plugin-sql in May 2026 pulls a
 * broken windows-future transitive dep that fails to compile on all 3
 * platforms (~150 errors). localStorage is enough for ~thousands of messages
 * and survives app restart on the same machine.
 *
 * Cross-device sync + analytics-quality history come in v0.1.0 via either
 * rusqlite (no async deps) or a hosted DB tied to the Pro license.
 */

import type { ChatTurn } from "../hooks/useChat";

const KEY = "lumi:chat:v1";
const MAX_TURNS = 200;

interface PersistedTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}

function read(): PersistedTurn[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(turns: PersistedTurn[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Trim — keep most recent MAX_TURNS, drop older.
    const trimmed = turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Quota exceeded or storage disabled — log and continue.
    console.warn("[db] localStorage write failed:", err);
  }
}

/** Load the most recent N messages as ChatTurn[], oldest-first for UI. */
export async function loadRecentMessages(limit = 40): Promise<ChatTurn[]> {
  const all = read();
  return all.slice(-limit).map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
  }));
}

/** Append a single message to history. Fire-and-forget. */
export async function appendMessage(role: "user" | "assistant", content: string): Promise<void> {
  const all = read();
  all.push({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    ts: Date.now(),
  });
  write(all);
}

/** Wipe chat history. Called from the Clear button in ChatPanel. */
export async function clearMessages(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Record a finished Pomodoro session for future stats UI. */
export async function recordPomodoroSession(
  phase: string,
  startedAt: number,
  finishedAt: number,
): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const STATS_KEY = "lumi:pomodoros:v1";
  try {
    const raw = localStorage.getItem(STATS_KEY);
    const arr: Array<{ phase: string; startedAt: number; finishedAt: number }> = raw
      ? JSON.parse(raw)
      : [];
    arr.push({ phase, startedAt, finishedAt });
    // Keep last 500 sessions.
    const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
    localStorage.setItem(STATS_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn("[db] recordPomodoroSession:", err);
  }
}
