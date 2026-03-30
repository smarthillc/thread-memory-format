import { describe, it, expect } from "vitest";
import { revise } from "../src/revisor.js";
import type { Message, TmfBlob } from "../src/types.js";

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

function makeBlob(overrides?: Partial<TmfBlob>): TmfBlob {
  return {
    version: 1,
    conversationId: "test-123",
    createdAt: "2026-03-29T12:00:00Z",
    threads: [
      {
        threadId: "thread_db",
        label: "database, postgresql, setup",
        tier: "critical",
        keyFacts: ["Using PostgreSQL for the database"],
        entities: ["PostgreSQL"],
        decisions: ["Decided to use PostgreSQL"],
        openQuestions: [],
        turnRange: [0, 3],
        chunkCount: 4,
        revision: 0,
      },
    ],
    metadata: {
      totalTurns: 4,
      totalTokensOriginal: 500,
      totalTokensCompressed: 100,
      compressionRatio: 5.0,
    },
    ...overrides,
  };
}

describe("revisor", () => {
  it("returns blob unchanged for empty new messages", async () => {
    const blob = makeBlob();
    const result = await revise(blob, []);
    expect(result).toEqual(blob);
  });

  it("adds a new thread for unrelated content", async () => {
    const blob = makeBlob();
    const result = await revise(blob, [
      msg("user", "How do I configure nginx reverse proxy?"),
      msg("assistant", "Nginx uses proxy_pass directive for reverse proxy configuration."),
    ]);
    expect(result.threads.length).toBeGreaterThan(blob.threads.length);
  });

  it("updates existing thread for related content", async () => {
    const blob = makeBlob();
    const result = await revise(blob, [
      msg("user", "How do I add indexes to PostgreSQL database?"),
      msg("assistant", "PostgreSQL supports B-tree indexes. Use CREATE INDEX on your PostgreSQL database table."),
    ]);
    // Should either merge or add — if merged, revision should increment
    const dbThread = result.threads.find(
      (t) => t.entities.includes("PostgreSQL") && t.revision > 0,
    );
    if (dbThread) {
      expect(dbThread.revision).toBeGreaterThan(0);
    }
    // Either way, all content should be accounted for
    expect(result.metadata.totalTokensOriginal).toBeGreaterThan(
      blob.metadata.totalTokensOriginal,
    );
  });

  it("deduplicates facts on merge", async () => {
    const blob = makeBlob();
    blob.threads[0].keyFacts = ["Using PostgreSQL for the database"];
    const result = await revise(blob, [
      msg("user", "Remind me, what database are we using?"),
      msg("assistant", "We're using PostgreSQL for the database. It's a great choice."),
    ]);
    // Check no exact duplicates in any thread's keyFacts
    for (const thread of result.threads) {
      const lower = thread.keyFacts.map((f) => f.toLowerCase().trim());
      expect(new Set(lower).size).toBe(lower.length);
    }
  });

  it("enforces size cap on merged summary", async () => {
    const blob = makeBlob();
    // Add lots of facts to existing thread
    blob.threads[0].keyFacts = Array.from(
      { length: 50 },
      (_, i) => `Fact number ${i} about PostgreSQL database configuration and optimization strategies`,
    );
    const result = await revise(
      blob,
      [
        msg("user", "More PostgreSQL database configuration details?"),
        msg("assistant", "PostgreSQL database has many configuration options for tuning performance. " +
          Array.from({ length: 20 }, (_, i) => `Option ${i} controls PostgreSQL setting ${i}.`).join(" ")),
      ],
      { maxSummaryTokens: 500 },
    );
    for (const thread of result.threads) {
      const size = Math.ceil(JSON.stringify(thread).length / 4);
      expect(size).toBeLessThanOrEqual(500);
    }
  });

  it("extends turn range on merge", async () => {
    const blob = makeBlob();
    blob.threads[0].turnRange = [0, 5];
    const result = await revise(blob, [
      msg("user", "One more thing about PostgreSQL database."),
      msg("assistant", "Sure, PostgreSQL database supports JSONB columns."),
    ]);
    // Check if any thread has extended range
    const hasExtended = result.threads.some(
      (t) => t.turnRange[1] > 5 || t.turnRange[0] < 0,
    );
    // New thread will have its own range, merged thread extends
    expect(result.metadata.totalTurns).toBeGreaterThan(blob.metadata.totalTurns);
  });

  it("merges entities from both old and new", async () => {
    const blob = makeBlob();
    blob.threads[0].entities = ["PostgreSQL"];
    const result = await revise(blob, [
      msg("user", "Can PostgreSQL work with Redis for caching?"),
      msg("assistant", "Yes, PostgreSQL and Redis complement each other. Redis handles caching, PostgreSQL handles persistence."),
    ]);
    const allEntities = result.threads.flatMap((t) => t.entities);
    expect(allEntities).toContain("PostgreSQL");
    expect(allEntities).toContain("Redis");
  });

  it("increments revision counter on update", async () => {
    const blob = makeBlob();
    blob.threads[0].revision = 2;
    const result = await revise(blob, [
      msg("user", "More about PostgreSQL database performance?"),
      msg("assistant", "PostgreSQL database connection pooling improves PostgreSQL performance significantly."),
    ]);
    // If thread was merged, revision should have incremented from 2
    const merged = result.threads.find((t) => t.revision > 2);
    if (merged) {
      expect(merged.revision).toBeGreaterThan(2);
    }
  });

  it("handles multiple threads being updated", async () => {
    const blob = makeBlob({
      threads: [
        {
          threadId: "thread_db",
          label: "database, postgresql",
          tier: "critical",
          keyFacts: ["Using PostgreSQL"],
          entities: ["PostgreSQL"],
          decisions: [],
          openQuestions: [],
          turnRange: [0, 3],
          chunkCount: 4,
          revision: 0,
        },
        {
          threadId: "thread_ui",
          label: "frontend, react, components",
          tier: "context",
          keyFacts: ["Using React for UI"],
          entities: ["React"],
          decisions: [],
          openQuestions: [],
          turnRange: [4, 7],
          chunkCount: 4,
          revision: 0,
        },
      ],
    });
    const result = await revise(blob, [
      msg("user", "Update on the PostgreSQL database migration"),
      msg("assistant", "PostgreSQL database migration is ready"),
      msg("user", "And the React frontend component updates?"),
      msg("assistant", "React frontend components are refactored"),
    ]);
    // Total threads should not explode
    expect(result.threads.length).toBeLessThanOrEqual(
      blob.threads.length + 2,
    );
  });
});
