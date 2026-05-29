import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettings } from "../useSettings";

describe("useSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns sensible defaults when no settings stored", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.provider).toBe("openrouter");
    expect(result.current.settings.openRouterKey).toBe("");
    expect(result.current.settings.mistralKey).toBe("");
    expect(result.current.settings.model).toBe("google/gemini-2.0-flash-exp:free");
    expect(result.current.settings.userName).toBe("");
    expect(result.current.settings.userGoals).toBe("");
    expect(result.current.settings.showAllVoices).toBe(false);
  });

  it("persists changes to localStorage", () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.setSettings({ userName: "Ernest", openRouterKey: "sk-or-test" }));
    expect(result.current.settings.userName).toBe("Ernest");
    expect(result.current.settings.openRouterKey).toBe("sk-or-test");

    // New hook instance reads the same value from storage.
    const { result: r2 } = renderHook(() => useSettings());
    expect(r2.current.settings.userName).toBe("Ernest");
    expect(r2.current.settings.openRouterKey).toBe("sk-or-test");
  });

  it("merges partial updates without clobbering other fields", () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.setSettings({ userName: "Ernest" }));
    act(() => result.current.setSettings({ userGoals: "Ship Lumi" }));
    expect(result.current.settings.userName).toBe("Ernest");
    expect(result.current.settings.userGoals).toBe("Ship Lumi");
  });

  it("gracefully handles corrupted JSON in storage", () => {
    localStorage.setItem("anime-buddy:settings:v1", "{not json");
    const { result } = renderHook(() => useSettings());
    // Falls back to defaults, doesn't throw.
    expect(result.current.settings.userName).toBe("");
  });
});
