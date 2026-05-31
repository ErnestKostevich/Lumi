/**
 * Long-term memory — the thing that makes Lumi feel like she *knows* you.
 *
 * Chat history (db.ts) only keeps the last ~40 raw turns. This module distils
 * durable facts about the user (ongoing projects, deadlines, wins, recurring
 * struggles, preferences) from conversation and stores them compactly, so a
 * compact "what you remember" block can be injected into every system prompt —
 * surviving across sessions long after the raw turns roll off.
 *
 * Local-first: facts live in localStorage; distillation uses the user's own LLM
 * key via the existing streamChat. Nothing leaves the device except that one
 * call. The user can see, delete, and disable all of it from Settings.
 */

import { streamChat, type ChatMessage, type Provider } from "./llm";

export type MemoryCategory =
  | "project"
  | "deadline"
  | "preference"
  | "win"
  | "struggle"
  | "personal";

export interface MemoryFact {
  id: string;
  text: string;
  category: MemoryCategory;
  createdAt: number;
  lastSeenAt: number;
  /** Bumped each time the fact is re-mentioned; drives ranking + eviction. */
  salience: number;
}

export interface MemoryStore {
  facts: MemoryFact[];
  updatedAt: number;
  version: number;
}

const KEY = "lumi:memory:v1";
const STORE_VERSION = 1;
/** Hard cap on stored facts — evict lowest salience / oldest beyond this. */
const MAX_FACTS = 40;
/** Facts injected into the prompt (top by salience×recency). */
const PROMPT_FACTS = 12;

const CATEGORIES: MemoryCategory[] = [
  "project",
  "deadline",
  "preference",
  "win",
  "struggle",
  "personal",
];

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadMemory(): MemoryStore {
  const empty: MemoryStore = { facts: [], updatedAt: 0, version: STORE_VERSION };
  if (typeof localStorage === "undefined") return empty;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as MemoryStore;
    if (!parsed || !Array.isArray(parsed.facts)) return empty;
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}

export function saveMemory(store: MemoryStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...store, updatedAt: Date.now(), version: STORE_VERSION }),
    );
  } catch (err) {
    console.warn("[memory] save failed:", err);
  }
}

export function clearMemory(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function forgetFact(id: string): MemoryStore {
  const store = loadMemory();
  const next = { ...store, facts: store.facts.filter((f) => f.id !== id) };
  saveMemory(next);
  return next;
}

/** Normalised text for dedupe — lowercased, collapsed whitespace, no trailing punct. */
function norm(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "").trim();
}

/** Rank score — higher = keep / show first. Recency decays over ~30 days. */
function score(f: MemoryFact, now: number): number {
  const ageDays = (now - f.lastSeenAt) / (24 * 60 * 60 * 1000);
  const recency = Math.max(0.2, 1 - ageDays / 30);
  return f.salience * recency;
}

/**
 * Merge freshly-extracted facts into the existing set:
 *  - exact/near-duplicate (by normalised text) → bump salience + refresh lastSeenAt
 *  - new → add
 *  - over MAX_FACTS → evict lowest-scoring
 */
export function mergeFacts(existing: MemoryFact[], incoming: { text: string; category: MemoryCategory }[]): MemoryFact[] {
  const now = nowMs();
  const out = existing.map((f) => ({ ...f }));
  const byNorm = new Map(out.map((f) => [norm(f.text), f]));

  for (const inc of incoming) {
    const text = inc.text.trim();
    if (!text) continue;
    const key = norm(text);
    const hit = byNorm.get(key);
    if (hit) {
      hit.salience += 1;
      hit.lastSeenAt = now;
    } else {
      const fact: MemoryFact = {
        id: genId(),
        text,
        category: CATEGORIES.includes(inc.category) ? inc.category : "personal",
        createdAt: now,
        lastSeenAt: now,
        salience: 1,
      };
      out.push(fact);
      byNorm.set(key, fact);
    }
  }

  if (out.length <= MAX_FACTS) return out;
  // Evict lowest-scoring beyond the cap.
  return out.sort((a, b) => score(b, now) - score(a, now)).slice(0, MAX_FACTS);
}

/** Compact memory block for the system prompt. Empty string when nothing stored. */
export function getMemoryForPrompt(store: MemoryStore = loadMemory()): string {
  if (!store.facts.length) return "";
  const now = nowMs();
  const top = [...store.facts].sort((a, b) => score(b, now) - score(a, now)).slice(0, PROMPT_FACTS);
  return top.map((f) => `- (${f.category}) ${f.text}`).join("\n");
}

/**
 * Extract durable facts from recent turns via the user's LLM. Collects the full
 * response (not streamed to UI), robustly parses the first JSON array, and
 * returns deduped-against-existing candidates. Returns [] on any failure — never
 * throws (memory is best-effort, must not disrupt chat).
 */
export async function extractMemory(opts: {
  provider: Provider;
  apiKey: string;
  model: string;
  recentTurns: { role: "user" | "assistant"; content: string }[];
  existingFacts: MemoryFact[];
  signal?: AbortSignal;
}): Promise<{ text: string; category: MemoryCategory }[]> {
  const { provider, apiKey, model, recentTurns, existingFacts, signal } = opts;
  if (!apiKey || recentTurns.length === 0) return [];

  const known =
    existingFacts.length > 0
      ? existingFacts.map((f) => `- ${f.text}`).join("\n")
      : "(none yet)";

  const transcript = recentTurns
    .map((t) => `${t.role === "user" ? "USER" : "LUMI"}: ${t.content}`)
    .join("\n");

  const systemPrompt = [
    "You extract durable long-term memory about the USER from a chat transcript.",
    "Return ONLY a JSON array (no prose, no markdown fences) of up to 5 objects:",
    `{ "text": string, "category": one of ${CATEGORIES.map((c) => `"${c}"`).join(" | ")} }`,
    "",
    "Rules:",
    "- Capture only DURABLE, useful facts worth remembering for weeks: ongoing projects, goals, deadlines, stable preferences, notable wins, recurring struggles, personal context the user volunteered (timezone, role, tools).",
    "- SKIP ephemeral chit-chat, one-off questions, and anything already in KNOWN FACTS.",
    "- Each fact: one short sentence, written about the user in third person (\"Is building a Tauri app called Lumi\").",
    "- NEVER store passwords, API keys, health, financial, or other sensitive PII.",
    "- Strictly SFW. If nothing new is worth saving, return [].",
    "",
    "KNOWN FACTS:",
    known,
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "user", content: `TRANSCRIPT:\n${transcript}\n\nReturn the JSON array now.` },
  ];

  let buffer = "";
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    void streamChat({
      provider,
      apiKey,
      model,
      messages,
      systemPrompt,
      maxTokens: 400,
      temperature: 0,
      onDelta: (d) => {
        buffer += d;
      },
      onDone: finish,
      onError: () => finish(),
      signal,
    });
  });

  return parseFacts(buffer);
}

/** Robustly pull a JSON array of {text, category} from a model response. */
export function parseFacts(raw: string): { text: string; category: MemoryCategory }[] {
  if (!raw) return [];
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: { text: string; category: MemoryCategory }[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text.trim() : "";
    if (!text) continue;
    const catRaw = (item as { category?: unknown }).category;
    const category = (typeof catRaw === "string" && CATEGORIES.includes(catRaw as MemoryCategory))
      ? (catRaw as MemoryCategory)
      : "personal";
    out.push({ text, category });
  }
  return out;
}

/** Wall clock — wrapped so tests can keep it deterministic if needed. */
function nowMs(): number {
  return Date.now();
}
