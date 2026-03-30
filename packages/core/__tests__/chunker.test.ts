import { describe, it, expect } from "vitest";
import { chunk } from "../src/chunker.js";
import type { Message } from "../src/types.js";

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

describe("chunker", () => {
  it("returns empty array for empty conversation", () => {
    expect(chunk([])).toEqual([]);
  });

  it("creates one chunk for a single message", () => {
    const result = chunk([msg("user", "hello")]);
    expect(result).toHaveLength(1);
    expect(result[0].messages).toHaveLength(1);
    expect(result[0].turnIndex).toBe(0);
  });

  it("creates a new chunk on each role transition", () => {
    const messages = [
      msg("user", "What is TypeScript?"),
      msg("assistant", "TypeScript is a typed superset of JavaScript."),
      msg("user", "How do I install it?"),
    ];
    const result = chunk(messages);
    expect(result).toHaveLength(3);
    expect(result[0].messages[0].role).toBe("user");
    expect(result[1].messages[0].role).toBe("assistant");
    expect(result[2].messages[0].role).toBe("user");
  });

  it("groups consecutive same-role messages into one chunk", () => {
    const messages = [
      msg("user", "First question"),
      msg("user", "Actually, let me rephrase"),
      msg("assistant", "Here's my answer"),
    ];
    const result = chunk(messages);
    expect(result).toHaveLength(2);
    expect(result[0].messages).toHaveLength(2);
    expect(result[1].messages).toHaveLength(1);
  });

  it("isolates system messages into their own chunks", () => {
    const messages = [
      msg("system", "You are a helpful assistant"),
      msg("user", "Hello"),
      msg("assistant", "Hi there"),
    ];
    const result = chunk(messages);
    expect(result).toHaveLength(3);
    expect(result[0].messages[0].role).toBe("system");
    expect(result[0].messages).toHaveLength(1);
  });

  it("isolates system messages even between same-role messages", () => {
    const messages = [
      msg("user", "Before system"),
      msg("system", "System instruction"),
      msg("user", "After system"),
    ];
    const result = chunk(messages);
    expect(result).toHaveLength(3);
    expect(result[0].messages[0].content).toBe("Before system");
    expect(result[1].messages[0].role).toBe("system");
    expect(result[2].messages[0].content).toBe("After system");
  });

  it("enforces maxChunkSize", () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      msg("user", `Message ${i}`),
    );
    const result = chunk(messages, { maxChunkSize: 5 });
    expect(result).toHaveLength(4);
    expect(result[0].messages).toHaveLength(5);
    expect(result[3].messages).toHaveLength(5);
  });

  it("assigns sequential turn indices", () => {
    const messages = [
      msg("user", "Q1"),
      msg("assistant", "A1"),
      msg("user", "Q2"),
      msg("assistant", "A2"),
      msg("user", "Q3"),
    ];
    const result = chunk(messages);
    expect(result.map((c) => c.turnIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("produces deterministic chunk IDs for same input", () => {
    const messages = [
      msg("user", "Hello world"),
      msg("assistant", "Hi!"),
    ];
    const result1 = chunk(messages);
    const result2 = chunk(messages);
    expect(result1[0].id).toBe(result2[0].id);
    expect(result1[1].id).toBe(result2[1].id);
  });

  it("produces different chunk IDs for different content", () => {
    const a = chunk([msg("user", "Hello")]);
    const b = chunk([msg("user", "Goodbye")]);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it("preserves message metadata", () => {
    const messages: Message[] = [
      { role: "user", content: "test", metadata: { source: "cli" } },
    ];
    const result = chunk(messages);
    expect(result[0].messages[0].metadata).toEqual({ source: "cli" });
  });

  it("preserves message timestamps", () => {
    const ts = "2026-03-29T12:00:00Z";
    const messages: Message[] = [
      { role: "user", content: "test", timestamp: ts },
    ];
    const result = chunk(messages);
    expect(result[0].messages[0].timestamp).toBe(ts);
  });

  it("sets speakerTransitions to 0 for single-role chunks", () => {
    const messages = [msg("user", "A"), msg("user", "B")];
    const result = chunk(messages);
    expect(result[0].speakerTransitions).toBe(0);
  });
});
