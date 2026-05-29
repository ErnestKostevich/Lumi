import { describe, it, expect } from "vitest";
import {
  humanizeError,
  providerShortName,
  LlmHttpError,
  PROVIDERS,
} from "../llm";

describe("humanizeError", () => {
  it("maps 401 to an invalid-key message", () => {
    const msg = humanizeError(new LlmHttpError(401, "OpenAI", "bad key"), "OpenAI");
    expect(msg.toLowerCase()).toContain("invalid");
  });

  it("maps 402 to out-of-credit", () => {
    const msg = humanizeError(new LlmHttpError(402, "OpenRouter", "no funds"), "OpenRouter");
    expect(msg.toLowerCase()).toContain("credit");
  });

  it("maps 429 to rate-limited", () => {
    const msg = humanizeError(new LlmHttpError(429, "Mistral", "slow down"), "Mistral");
    expect(msg.toLowerCase()).toContain("rate limited");
  });

  it("maps 5xx to a server-error message", () => {
    const msg = humanizeError(new LlmHttpError(503, "Anthropic", "down"), "Anthropic");
    expect(msg.toLowerCase()).toMatch(/server error|moment/);
  });

  it("maps network failures to a connection message", () => {
    const msg = humanizeError(new TypeError("Failed to fetch"), "OpenRouter");
    expect(msg.toLowerCase()).toContain("connection");
  });

  it("falls back to a generic message for unknown errors", () => {
    const msg = humanizeError(new Error("weird"), "OpenAI");
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe("providerShortName", () => {
  it("returns friendly names per provider", () => {
    expect(providerShortName("openai")).toBe("OpenAI");
    expect(providerShortName("anthropic")).toBe("Anthropic");
    expect(providerShortName("mistral")).toBe("Mistral");
    expect(providerShortName("openrouter")).toBe("OpenRouter");
  });
});

describe("PROVIDERS free-model defaults", () => {
  it("defaults OpenRouter to a FREE model", () => {
    expect(PROVIDERS.openrouter.defaultModel).toContain(":free");
  });

  it("labels at least one OpenRouter model as FREE", () => {
    const free = PROVIDERS.openrouter.models.filter((m) => m.note === "FREE");
    expect(free.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps all four providers", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(
      ["anthropic", "mistral", "openai", "openrouter"].sort(),
    );
  });
});
