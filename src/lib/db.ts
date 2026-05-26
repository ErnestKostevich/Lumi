/**
 * SQLite chat history persistence via tauri-plugin-sql.
 * Migrations applied automatically on startup (see src-tauri/src/lib.rs).
 *
 * Schema:
 *   messages(id, role, content, ts)        — chat turns
 *   pomodoro_sessions(id, phase, started_at, finished_at) — for stats later
 */

import Database from "@tauri-apps/plugin-sql";
import type { ChatTurn } from "../hooks/useChat";

let dbPromise: Promise<Database> | null = null;

function db(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:lumi.db");
  }
  return dbPromise;
}

interface Row {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: number;
}

/** Load the most recent N messages as ChatTurn[], oldest-first for UI. */
export async function loadRecentMessages(limit = 40): Promise<ChatTurn[]> {
  try {
    const conn = await db();
    const rows = (await conn.select<Row[]>(
      "SELECT id, role, content, ts FROM messages ORDER BY id DESC LIMIT $1",
      [limit],
    )) ?? [];
    return rows
      .reverse()
      .map((r) => ({
        id: String(r.id),
        role: r.role,
        content: r.content,
      }));
  } catch (err) {
    console.warn("[db] loadRecentMessages:", err);
    return [];
  }
}

/** Append a single message to history. Fire-and-forget. */
export async function appendMessage(role: "user" | "assistant", content: string): Promise<void> {
  try {
    const conn = await db();
    await conn.execute(
      "INSERT INTO messages (role, content, ts) VALUES ($1, $2, $3)",
      [role, content, Date.now()],
    );
  } catch (err) {
    console.warn("[db] appendMessage:", err);
  }
}

/** Wipe chat history. Called from the Clear button in ChatPanel. */
export async function clearMessages(): Promise<void> {
  try {
    const conn = await db();
    await conn.execute("DELETE FROM messages");
  } catch (err) {
    console.warn("[db] clearMessages:", err);
  }
}

/** Record a finished Pomodoro session for future stats UI. */
export async function recordPomodoroSession(
  phase: string,
  startedAt: number,
  finishedAt: number,
): Promise<void> {
  try {
    const conn = await db();
    await conn.execute(
      "INSERT INTO pomodoro_sessions (phase, started_at, finished_at) VALUES ($1, $2, $3)",
      [phase, startedAt, finishedAt],
    );
  } catch (err) {
    console.warn("[db] recordPomodoroSession:", err);
  }
}
