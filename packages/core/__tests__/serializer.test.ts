import { describe, it, expect } from "vitest";
import { serialize, deserialize } from "../src/serializer.js";
import type { TmfBlob } from "../src/types.js";

function makeBlob(overrides?: Partial<TmfBlob>): TmfBlob {
  return {
    version: 1,
    conversationId: "test-123",
    createdAt: "2026-03-29T12:00:00Z",
    threads: [
      {
        threadId: "thread_abc",
        label: "test thread",
        tier: "context",
        keyFacts: ["fact one", "fact two"],
        entities: ["TypeScript"],
        decisions: [],
        openQuestions: [],
        turnRange: [0, 5],
        chunkCount: 3,
        revision: 0,
      },
    ],
    metadata: {
      totalTurns: 6,
      totalTokensOriginal: 1000,
      totalTokensCompressed: 200,
      compressionRatio: 5.0,
    },
    ...overrides,
  };
}

describe("serializer", () => {
  it("round-trips a valid blob", () => {
    const blob = makeBlob();
    const buffer = serialize(blob);
    const restored = deserialize(buffer);
    expect(restored).toEqual(blob);
  });

  it("produces output smaller than raw JSON", () => {
    const blob = makeBlob();
    const buffer = serialize(blob);
    const rawJson = JSON.stringify(blob);
    expect(buffer.length).toBeLessThan(Buffer.byteLength(rawJson, "utf-8"));
  });

  it("rejects invalid version number", () => {
    const blob = makeBlob();
    const json = JSON.stringify({ ...blob, version: 99 });
    const { gzipSync } = require("node:zlib");
    const buffer = gzipSync(Buffer.from(json, "utf-8"));
    expect(() => deserialize(buffer)).toThrow(/invalid blob/i);
  });

  it("rejects corrupt data (random bytes)", () => {
    const buffer = Buffer.from([0x00, 0xff, 0xfe, 0xab, 0x12]);
    expect(() => deserialize(buffer)).toThrow(/corrupt|decompress/i);
  });

  it("rejects missing required field", () => {
    const { gzipSync } = require("node:zlib");
    const invalid = { version: 1, conversationId: "test" };
    const buffer = gzipSync(Buffer.from(JSON.stringify(invalid), "utf-8"));
    expect(() => deserialize(buffer)).toThrow(/invalid blob/i);
  });

  it("handles empty threads array", () => {
    const blob = makeBlob({ threads: [] });
    const buffer = serialize(blob);
    const restored = deserialize(buffer);
    expect(restored.threads).toEqual([]);
  });

  it("handles blob with many threads", () => {
    const threads = Array.from({ length: 100 }, (_, i) => ({
      threadId: `thread_${i}`,
      label: `Thread ${i}`,
      tier: "context" as const,
      keyFacts: [`fact ${i}`],
      entities: [`Entity${i}`],
      decisions: [],
      openQuestions: [],
      turnRange: [i * 2, i * 2 + 1] as [number, number],
      chunkCount: 2,
      revision: 0,
    }));
    const blob = makeBlob({ threads });
    const buffer = serialize(blob);
    const restored = deserialize(buffer);
    expect(restored.threads).toHaveLength(100);
    expect(restored).toEqual(blob);
  });
});
