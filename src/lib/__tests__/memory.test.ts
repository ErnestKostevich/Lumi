import { describe, it, expect, beforeEach } from "vitest";
import {
  parseFacts,
  mergeFacts,
  getMemoryForPrompt,
  loadMemory,
  saveMemory,
  clearMemory,
  forgetFact,
  type MemoryFact,
} from "../memory";

function fact(text: string, salience = 1, lastSeenAt = Date.now()): MemoryFact {
  return {
    id: text,
    text,
    category: "project",
    createdAt: lastSeenAt,
    lastSeenAt,
    salience,
  };
}

describe("parseFacts", () => {
  it("parses a clean JSON array", () => {
    const out = parseFacts('[{"text":"Builds Lumi","category":"project"}]');
    expect(out).toEqual([{ text: "Builds Lumi", category: "project" }]);
  });

  it("extracts the array even with surrounding prose / fences", () => {
    const raw = 'Sure! Here you go:\n```json\n[{"text":"Deadline Friday","category":"deadline"}]\n```';
    const out = parseFacts(raw);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("deadline");
  });

  it("returns [] on garbled JSON", () => {
    expect(parseFacts("[{text: not valid")).toEqual([]);
  });

  it("returns [] on empty / non-array", () => {
    expect(parseFacts("")).toEqual([]);
    expect(parseFacts("no json here")).toEqual([]);
    expect(parseFacts('{"text":"x"}')).toEqual([]);
  });

  it("coerces unknown categories to 'personal' and drops empty text", () => {
    const out = parseFacts('[{"text":"likes tea","category":"weird"},{"text":"","category":"win"}]');
    expect(out).toEqual([{ text: "likes tea", category: "personal" }]);
  });
});

describe("mergeFacts", () => {
  it("adds new facts", () => {
    const merged = mergeFacts([], [{ text: "Builds Lumi", category: "project" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].salience).toBe(1);
  });

  it("bumps salience + refreshes lastSeenAt on near-duplicate (case/punct insensitive)", () => {
    const existing = [fact("Builds Lumi", 1, 1000)];
    const merged = mergeFacts(existing, [{ text: "builds lumi.", category: "project" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].salience).toBe(2);
    expect(merged[0].lastSeenAt).toBeGreaterThan(1000);
  });

  it("evicts lowest-scoring beyond the cap of 40", () => {
    const existing: MemoryFact[] = Array.from({ length: 40 }, (_, i) =>
      fact(`fact ${i}`, 5, Date.now()),
    );
    // a brand-new low-salience fact should push the set back to 40 (evicting weakest)
    const merged = mergeFacts(existing, [{ text: "newcomer", category: "win" }]);
    expect(merged.length).toBe(40);
  });
});

describe("getMemoryForPrompt", () => {
  it("returns empty string when no facts", () => {
    expect(getMemoryForPrompt({ facts: [], updatedAt: 0, version: 1 })).toBe("");
  });

  it("formats facts as category-tagged bullets", () => {
    const store = { facts: [fact("Builds Lumi")], updatedAt: 0, version: 1 };
    const out = getMemoryForPrompt(store);
    expect(out).toContain("(project)");
    expect(out).toContain("Builds Lumi");
    expect(out.startsWith("- ")).toBe(true);
  });

  it("caps the prompt to at most 12 facts", () => {
    const facts = Array.from({ length: 20 }, (_, i) => fact(`fact ${i}`, i + 1));
    const out = getMemoryForPrompt({ facts, updatedAt: 0, version: 1 });
    expect(out.split("\n").length).toBe(12);
  });
});

describe("store CRUD (localStorage)", () => {
  beforeEach(() => localStorage.clear());

  it("saves and loads", () => {
    saveMemory({ facts: [fact("x")], updatedAt: 0, version: 1 });
    expect(loadMemory().facts).toHaveLength(1);
  });

  it("forgetFact removes by id", () => {
    saveMemory({ facts: [fact("keep"), { ...fact("drop"), id: "drop-id" }], updatedAt: 0, version: 1 });
    const next = forgetFact("drop-id");
    expect(next.facts.map((f) => f.text)).toEqual(["keep"]);
  });

  it("clearMemory wipes everything", () => {
    saveMemory({ facts: [fact("x")], updatedAt: 0, version: 1 });
    clearMemory();
    expect(loadMemory().facts).toEqual([]);
  });

  it("returns empty store on corrupted JSON", () => {
    localStorage.setItem("lumi:memory:v1", "{not json");
    expect(loadMemory().facts).toEqual([]);
  });
});
