import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { compress, revise } from "../src/index.js";
import type { Message } from "../src/types.js";

const messageArb = fc.record({
  role: fc.constantFrom("user" as const, "assistant" as const),
  content: fc.stringMatching(/[a-zA-Z ]{20,300}/),
});

const conversationArb = fc.array(messageArb, { minLength: 4, maxLength: 50 });

describe("properties", () => {
  it("compression always produces a valid ratio and fewer threads than turns", () => {
    fc.assert(
      fc.property(conversationArb, (messages) => {
        const blob = compress(messages);
        // Ratio is always a positive number
        expect(blob.metadata.compressionRatio).toBeGreaterThan(0);
        // Thread count should be bounded — actual structural compression
        expect(blob.threads.length).toBeLessThanOrEqual(blob.metadata.totalTurns);
      }),
      { numRuns: 50 },
    );
  });

  it("thread count is bounded by maxThreads", () => {
    fc.assert(
      fc.property(conversationArb, (messages) => {
        const blob = compress(messages, { maxThreads: 20 });
        expect(blob.threads.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 50 },
    );
  });

  it("every thread has at least one keyFact", () => {
    fc.assert(
      fc.property(conversationArb, (messages) => {
        const blob = compress(messages);
        for (const thread of blob.threads) {
          expect(thread.keyFacts.length).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("revision never produces a blob with fewer threads than the original", () => {
    fc.assert(
      fc.property(conversationArb, conversationArb, (initial, continuation) => {
        const blob = compress(initial);
        const revised = revise(blob, continuation);
        expect(revised.threads.length).toBeGreaterThanOrEqual(blob.threads.length);
      }),
      { numRuns: 30 },
    );
  });
});
