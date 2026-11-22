import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { extractIncident, resetAiCache, setMinGapMs } from "../src/services/extraction";

const good = {
  category: "water", urgency: "high", people_affected: 6, needs: ["drinking water"],
  vulnerable_persons: ["elderly"], missing_info: [], summary: "Flooded ground floor, six people",
};
const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: JSON.stringify(content) } }] } : { error: "x" }), { status });

const saved = { ...config };
beforeEach(() => {
  config.mockAi = false;
  config.openrouterApiKey = "test-key";
  config.openrouterModel = "vendor/model:free";
  config.geminiApiKey = undefined;
  resetAiCache();
  setMinGapMs(0);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { Object.assign(config, saved); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("AI provider chain", () => {
  it("uses OpenRouter, validates the output and forces human verification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ...good, requires_human_verification: false })));
    const out = await extractIncident("Water is entering the house");
    expect(out).toMatchObject({ source: "openrouter", model_version: "vendor/model:free" });
    expect(out.extracted_data.requires_human_verification).toBe(true);
  });

  it("on a 429 tries openrouter/free next", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({}, 429))
      .mockResolvedValueOnce(reply(good));
    vi.stubGlobal("fetch", fetchMock);
    const out = await extractIncident("report one");
    expect(out).toMatchObject({ source: "openrouter", model_version: "openrouter/free" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to keywords when every provider fails or returns invalid output", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply({ category: "weather" })) // invalid enum
      .mockRejectedValueOnce(new Error("timeout")));
    const out = await extractIncident("No drinking water for 20 people");
    expect(out.source).toBe("fallback");
    expect(out.extracted_data.category).toBe("water");
    expect(out.extracted_data.requires_human_verification).toBe(true);
  });

  it("does not put keys in the failure log", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({}, 500)));
    await extractIncident("some text");
    const logged = JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain("test-key");
  });

  it("caches by report text: the second call makes no request", async () => {
    const fetchMock = vi.fn(async () => reply(good));
    vi.stubGlobal("fetch", fetchMock);
    await extractIncident("same text");
    const again = await extractIncident("  same text ");
    expect(again.source).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a fallback answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({}, 500));
    vi.stubGlobal("fetch", fetchMock);
    await extractIncident("text a");
    const calls = fetchMock.mock.calls.length;
    await extractIncident("text a");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it("keeps a minimum gap between calls", async () => {
    setMinGapMs(120);
    const times: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => { times.push(Date.now()); return reply(good); }));
    await Promise.all([extractIncident("first report"), extractIncident("second report")]);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(110);
  });

  it("goes to Gemini only when its key exists, and still ends on the keyword extractor", async () => {
    config.openrouterApiKey = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await extractIncident("no key at all")).source).toBe("fallback");
    config.geminiApiKey = "g-key"; // Gemini is a placeholder for now: it fails and the chain continues
    expect((await extractIncident("with gemini key")).source).toBe("fallback");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no calls at all with MOCK_AI=true", async () => {
    config.mockAi = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await extractIncident("anything")).source).toBe("mock");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
