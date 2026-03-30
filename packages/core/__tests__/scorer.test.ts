import { describe, it, expect } from "vitest";
import { score } from "../src/scorer.js";
import { chunk } from "../src/chunker.js";
import type { Chunk, Message } from "../src/types.js";

function makeChunk(content: string, role: Message["role"] = "assistant"): Chunk {
  return chunk([{ role, content }])[0];
}

describe("scorer", () => {
  it("scores decision language as critical", () => {
    const c = makeChunk("Let's go with PostgreSQL for the database.");
    const result = score(c);
    expect(result.tier).toBe("critical");
    expect(result.signals).toContain("decision");
  });

  it("scores error resolution as critical", () => {
    const c = makeChunk("Fixed! The issue was the missing import statement.");
    const result = score(c);
    expect(result.tier).toBe("critical");
    expect(result.signals).toContain("error_resolution");
  });

  it("scores instruction language as critical", () => {
    const c = makeChunk("You should always run tests before committing. Make sure to install the dependencies first.");
    const result = score(c);
    expect(result.tier).toBe("critical");
    expect(result.signals).toContain("instruction");
  });

  it("scores code blocks as context", () => {
    const c = makeChunk("Here's the code:\n```ts\nconst x = 1;\n```");
    const result = score(c);
    expect(result.tier).toBe("context");
    expect(result.signals).toContain("has_code");
  });

  it("scores URL references as context", () => {
    const c = makeChunk("Check out https://example.com/docs for more info");
    const result = score(c);
    expect(result.signals).toContain("has_reference");
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores greetings as ambient", () => {
    const c = makeChunk("Hi! How are you?", "user");
    const result = score(c);
    expect(result.tier).toBe("ambient");
    expect(result.signals).toContain("greeting");
  });

  it("scores acknowledgments as ambient", () => {
    const c = makeChunk("Thanks, got it.", "user");
    const result = score(c);
    expect(result.tier).toBe("ambient");
    expect(result.signals).toContain("acknowledgment");
  });

  it("uses highest signal when mixed (decision + code = critical)", () => {
    const c = makeChunk("Let's go with this approach:\n```ts\nconst db = new PostgresClient();\n```");
    const result = score(c);
    expect(result.tier).toBe("critical");
    expect(result.signals).toContain("decision");
    expect(result.signals).toContain("has_code");
  });

  it("always produces a score between 0 and 1", () => {
    const inputs = [
      "Hello",
      "ok",
      "Let's go with Redis. Install it with npm install redis. The fix is working now. Check https://redis.io",
      "",
    ];
    for (const text of inputs) {
      const c = makeChunk(text);
      const result = score(c);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it("always produces at least one signal", () => {
    const c = makeChunk("Some random text about nothing in particular.");
    const result = score(c);
    expect(result.signals.length).toBeGreaterThanOrEqual(1);
  });

  it("respects configurable tier thresholds", () => {
    const c = makeChunk("Check out https://example.com for docs");
    // Default thresholds: critical=0.7, context=0.3
    const defaultResult = score(c);
    // With lowered critical threshold
    const lowered = score(c, { criticalThreshold: 0.1 });
    expect(lowered.tier).toBe("critical");
    // Original should not be critical
    expect(defaultResult.tier).not.toBe("critical");
  });

  it("scores questions as context", () => {
    const c = makeChunk("How do I configure TypeScript for ESM?", "user");
    const result = score(c);
    expect(result.signals).toContain("has_question");
    expect(result.score).toBeGreaterThan(0);
  });

  it("preserves all original chunk fields", () => {
    const c = makeChunk("Some content");
    const result = score(c);
    expect(result.id).toBe(c.id);
    expect(result.messages).toEqual(c.messages);
    expect(result.turnIndex).toBe(c.turnIndex);
  });
});
