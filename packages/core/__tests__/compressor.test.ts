import { describe, it, expect } from "vitest";
import { compressThread } from "../src/compressor.js";
import { chunk } from "../src/chunker.js";
import { score } from "../src/scorer.js";
import { detect } from "../src/detector.js";
import type { Message, ScoredChunk, Thread } from "../src/types.js";

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

function pipeline(messages: Message[]) {
  const chunks = chunk(messages).map((c) => score(c));
  const threads = detect(chunks);
  return { chunks, threads };
}

describe("compressor", () => {
  it("produces a summary with keyFacts for a critical thread", async () => {
    const { chunks, threads } = pipeline([
      msg("user", "Which database should we use?"),
      msg("assistant", "Let's go with PostgreSQL. It supports JSONB and has great performance."),
    ]);
    const summary = await compressThread(threads[0], chunks);
    expect(summary.keyFacts.length).toBeGreaterThan(0);
    expect(summary.revision).toBe(0);
  });

  it("extracts entities from thread content", async () => {
    const { chunks, threads } = pipeline([
      msg("user", "Tell me about TypeScript and React"),
      msg("assistant", "TypeScript works great with React. You can use Next.js for SSR."),
    ]);
    const summary = await compressThread(threads[0], chunks);
    expect(summary.entities).toContain("TypeScript");
    expect(summary.entities).toContain("React");
  });

  it("extracts decisions from thread content", async () => {
    const chunks = chunk([
      msg("user", "Should we use Redis or Memcached?"),
      msg("assistant", "Let's go with Redis for caching. It supports persistence and pub/sub."),
    ]).map((c) => score(c));
    // Manually construct a single thread containing all chunks
    const thread: Thread = {
      id: "test",
      label: "caching",
      chunkIds: chunks.map((c) => c.id),
      tier: "critical",
    };
    const summary = await compressThread(thread, chunks);
    expect(summary.decisions.length).toBeGreaterThan(0);
    expect(summary.decisions[0]).toMatch(/Redis/i);
  });

  it("detects open questions without answers", async () => {
    const { chunks, threads } = pipeline([
      msg("user", "Should we implement websockets for real-time updates?"),
      msg("assistant", "That's a good question. We need to think about the infrastructure implications."),
    ]);
    const summary = await compressThread(threads[0], chunks);
    expect(summary.openQuestions.length).toBeGreaterThan(0);
  });

  it("caps keyFacts at maxKeyFacts", async () => {
    // Create a long conversation with many facts
    const messages: Message[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(msg("user", `Question ${i} about feature ${i}`));
      messages.push(msg("assistant", `Feature ${i} uses Component${i}. It connects to Service${i}. The endpoint is /api/v${i}.`));
    }
    const chunks = chunk(messages).map((c) => score(c));
    const thread: Thread = {
      id: "test",
      label: "features",
      chunkIds: chunks.map((c) => c.id),
      tier: "context",
    };
    const summary = await compressThread(thread, chunks, { maxKeyFacts: 20 });
    expect(summary.keyFacts.length).toBeLessThanOrEqual(20);
  });

  it("computes correct turnRange", async () => {
    const chunks: ScoredChunk[] = [
      { id: "a", messages: [msg("user", "Q1")], turnIndex: 3, speakerTransitions: 0, tier: "context", score: 0.5, signals: ["neutral"] },
      { id: "b", messages: [msg("assistant", "A1")], turnIndex: 7, speakerTransitions: 0, tier: "context", score: 0.5, signals: ["neutral"] },
      { id: "c", messages: [msg("user", "Q2")], turnIndex: 12, speakerTransitions: 0, tier: "context", score: 0.5, signals: ["neutral"] },
    ];
    const thread: Thread = { id: "test", label: "test", chunkIds: ["a", "b", "c"], tier: "context" };
    const summary = await compressThread(thread, chunks);
    expect(summary.turnRange).toEqual([3, 12]);
  });

  it("sets revision to 0 for new compressions", async () => {
    const { chunks, threads } = pipeline([
      msg("user", "Hello"),
      msg("assistant", "Hi there"),
    ]);
    const summary = await compressThread(threads[0], chunks);
    expect(summary.revision).toBe(0);
  });

  it("produces minimal summary for ambient threads", async () => {
    const chunks: ScoredChunk[] = [
      { id: "a", messages: [msg("user", "Hey!")], turnIndex: 0, speakerTransitions: 0, tier: "ambient", score: 0.1, signals: ["greeting"] },
      { id: "b", messages: [msg("assistant", "Hello!")], turnIndex: 1, speakerTransitions: 0, tier: "ambient", score: 0.1, signals: ["greeting"] },
    ];
    const thread: Thread = { id: "test", label: "greetings", chunkIds: ["a", "b"], tier: "ambient" };
    const summary = await compressThread(thread, chunks);
    // Ambient gets truncated summary, not full extraction
    expect(summary.keyFacts.length).toBeLessThanOrEqual(1);
  });

  it("sets correct chunkCount", async () => {
    const { chunks, threads } = pipeline([
      msg("user", "Q1"),
      msg("assistant", "A1"),
      msg("user", "Q2"),
      msg("assistant", "A2"),
    ]);
    for (const thread of threads) {
      const summary = await compressThread(thread, chunks);
      expect(summary.chunkCount).toBe(thread.chunkIds.length);
    }
  });

  it("uses thread label in summary", async () => {
    const { chunks, threads } = pipeline([
      msg("user", "Tell me about Kubernetes deployments"),
      msg("assistant", "Kubernetes deployments manage pod replicas."),
    ]);
    const summary = await compressThread(threads[0], chunks);
    expect(summary.label).toBe(threads[0].label);
  });
});
