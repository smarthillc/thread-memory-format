import { describe, it, expect } from "vitest";
import { detect } from "../src/detector.js";
import { chunk } from "../src/chunker.js";
import { score } from "../src/scorer.js";
import type { Message, ScoredChunk } from "../src/types.js";

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

function scoredChunks(messages: Message[]): ScoredChunk[] {
  return chunk(messages).map((c) => score(c));
}

describe("detector", () => {
  it("returns empty array for empty input", () => {
    expect(detect([])).toEqual([]);
  });

  it("groups a single-topic conversation into fewer threads than chunks", () => {
    const chunks = scoredChunks([
      msg("user", "How do I set up PostgreSQL database server?"),
      msg("assistant", "First install PostgreSQL database server using your package manager for PostgreSQL"),
      msg("user", "What about PostgreSQL database configuration settings?"),
      msg("assistant", "The PostgreSQL database config file is at /etc/postgresql/ for PostgreSQL setup"),
      msg("user", "How do I create a new PostgreSQL database instance?"),
      msg("assistant", "Use createdb or CREATE DATABASE command in PostgreSQL to create a PostgreSQL database"),
    ]);
    const threads = detect(chunks);
    // TF-IDF should merge at least some chunks sharing "postgresql" / "database"
    expect(threads.length).toBeLessThan(chunks.length);
    // All chunks should be accounted for
    const allChunkIds = threads.flatMap((t) => t.chunkIds);
    expect(allChunkIds.length).toBe(chunks.length);
  });

  it("separates two clearly distinct topics", () => {
    const chunks = scoredChunks([
      msg("user", "How do I style React components with CSS modules?"),
      msg("assistant", "CSS modules scope styles locally to React components"),
      msg("user", "What about CSS-in-JS for React styling?"),
      msg("assistant", "styled-components is a popular CSS-in-JS library for React"),
      msg("user", "How do I configure nginx reverse proxy?"),
      msg("assistant", "nginx reverse proxy uses proxy_pass directive in server blocks"),
      msg("user", "What about nginx load balancing configuration?"),
      msg("assistant", "nginx upstream blocks define load balancing groups for server pools"),
    ]);
    const threads = detect(chunks);
    expect(threads.length).toBeGreaterThanOrEqual(2);
  });

  it("assigns every chunk to exactly one thread", () => {
    const chunks = scoredChunks([
      msg("user", "Setup Docker containers"),
      msg("assistant", "Docker compose for multi-container setup"),
      msg("user", "Configure Kubernetes pods"),
      msg("assistant", "Kubernetes deployment manifests define pod specs"),
      msg("user", "What about Terraform infrastructure?"),
      msg("assistant", "Terraform uses HCL for infrastructure as code"),
    ]);
    const threads = detect(chunks);
    const allChunkIds = threads.flatMap((t) => t.chunkIds);
    const uniqueIds = new Set(allChunkIds);
    // Every chunk assigned
    expect(allChunkIds.length).toBe(chunks.length);
    // No duplicates
    expect(uniqueIds.size).toBe(chunks.length);
  });

  it("bounds thread count to maxThreads", () => {
    // Create many distinct chunks
    const messages: Message[] = [];
    for (let i = 0; i < 100; i++) {
      const topic = `topic_${i}_unique_${Math.random().toString(36).slice(2)}`;
      messages.push(msg("user", `Tell me about ${topic} in detail`));
      messages.push(msg("assistant", `Here's info about ${topic}: it is very specific`));
    }
    const chunks = scoredChunks(messages);
    const threads = detect(chunks, { maxThreads: 10 });
    expect(threads.length).toBeLessThanOrEqual(10);
  });

  it("produces non-empty labels", () => {
    const chunks = scoredChunks([
      msg("user", "Tell me about TypeScript generics"),
      msg("assistant", "TypeScript generics enable type-safe abstractions"),
    ]);
    const threads = detect(chunks);
    for (const thread of threads) {
      expect(thread.label.length).toBeGreaterThan(0);
    }
  });

  it("uses provided embeddings when given", () => {
    const chunks = scoredChunks([
      msg("user", "Topic A content"),
      msg("assistant", "Response about A"),
      msg("user", "Topic B content"),
      msg("assistant", "Response about B"),
    ]);

    // Embeddings: first two chunks similar, last two similar
    const embeddings = [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0, 0, 1],
      [0, 0.1, 0.9],
    ];

    const threads = detect(chunks, { embeddings, similarityThreshold: 0.5 });
    expect(threads.length).toBe(2);
  });

  it("respects similarity threshold", () => {
    const chunks = scoredChunks([
      msg("user", "React hooks useState"),
      msg("assistant", "useState manages React component state"),
      msg("user", "Vue composition API ref"),
      msg("assistant", "ref in Vue composition API is like useState in React"),
    ]);

    // Very strict threshold → more threads
    const strict = detect(chunks, { similarityThreshold: 0.9 });
    // Very loose threshold → fewer threads
    const loose = detect(chunks, { similarityThreshold: 0.01 });

    expect(strict.length).toBeGreaterThanOrEqual(loose.length);
  });

  it("sets thread tier to highest chunk tier in the group", () => {
    const chunks = scoredChunks([
      msg("user", "Hello there!"),
      msg("assistant", "Let's go with Redis for our caching solution. Install Redis first."),
    ]);
    const threads = detect(chunks);
    // The second chunk should be critical (decision + instruction)
    // Thread tier should be the highest
    const hasDecisionThread = threads.some((t) => t.tier === "critical");
    expect(hasDecisionThread).toBe(true);
  });

  it("produces unique thread IDs", () => {
    const chunks = scoredChunks([
      msg("user", "Topic A"),
      msg("assistant", "About A"),
      msg("user", "Topic B"),
      msg("assistant", "About B"),
    ]);
    const threads = detect(chunks);
    const ids = threads.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
