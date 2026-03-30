import { describe, it, expect } from "vitest";
import { compress, decompress, chunk, score, detect } from "../src/index.js";
import type { Message } from "../src/types.js";

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

// Extract capitalized words as entities (simplified)
function extractEntities(text: string): Set<string> {
  const STOP = new Set([
    "I", "The", "This", "That", "It", "He", "She", "We", "They",
    "What", "How", "Why", "When", "Where", "Which", "Here", "There",
    "First", "Then", "Next", "Also", "But", "And", "Or", "If",
    "Yes", "No", "Ok", "Sure", "Thanks", "Hello", "Hi", "Hey",
    "For", "Use", "Let", "Now", "Back", "Good", "Set", "Don",
  ]);
  const matches = text.match(/\b[A-Z][a-zA-Z0-9]*(?:[-_.][A-Za-z0-9]+)*\b/g) ?? [];
  return new Set(matches.filter((e) => !STOP.has(e)));
}

const MULTI_TOPIC_CONVERSATION: Message[] = [
  msg("user", "We need to set up PostgreSQL for the main database"),
  msg("assistant", "PostgreSQL is a solid choice. Let's go with version 16. Install it with brew install postgresql@16."),
  msg("user", "What about Redis for caching?"),
  msg("assistant", "Redis works great for caching. Use Redis 7.x with the ioredis client library. Configure maxmemory-policy as allkeys-lru."),
  msg("user", "Now let's talk about the React frontend"),
  msg("assistant", "For React, I'd recommend Next.js 14 with the App Router. Use TypeScript for type safety. Install with npx create-next-app@14."),
  msg("user", "Should we use Tailwind or CSS Modules?"),
  msg("assistant", "Let's go with Tailwind CSS. It's faster for prototyping. Install tailwindcss and autoprefixer."),
  msg("user", "Back to the database — how do we handle migrations?"),
  msg("assistant", "For PostgreSQL migrations, use Drizzle ORM. It has type-safe schema definitions and generates SQL migrations automatically."),
  msg("user", "What about deploying everything?"),
  msg("assistant", "Deploy the Next.js app on Vercel. PostgreSQL on Neon (serverless Postgres). Redis on Upstash (serverless Redis). All three have generous free tiers."),
];

describe("quality (informational)", () => {
  it("retains >60% of named entities from critical-tier content", async () => {
    // Extract entities from original
    const originalText = MULTI_TOPIC_CONVERSATION.map((m) => m.content).join("\n");
    const originalEntities = extractEntities(originalText);

    // Compress and decompress
    const blob = await compress(MULTI_TOPIC_CONVERSATION);
    const output = decompress(blob);
    const outputText = output.map((m) => m.content).join("\n");
    const outputEntities = extractEntities(outputText);

    // Calculate retention
    let retained = 0;
    for (const entity of originalEntities) {
      if (outputEntities.has(entity) || outputText.includes(entity)) {
        retained++;
      }
    }
    const retentionRate = originalEntities.size > 0 ? retained / originalEntities.size : 1;

    console.log(`  Entity retention: ${retained}/${originalEntities.size} (${(retentionRate * 100).toFixed(1)}%)`);
    console.log(`  Original entities: ${[...originalEntities].join(", ")}`);
    console.log(`  Retained: ${[...outputEntities].join(", ")}`);

    expect(retentionRate).toBeGreaterThan(0.6);
  });

  it("intra-thread similarity > inter-thread similarity", async () => {
    const chunks = chunk(MULTI_TOPIC_CONVERSATION).map((c) => score(c));
    const threads = detect(chunks);

    if (threads.length < 2) {
      // Can't compute inter-thread similarity with < 2 threads
      return;
    }

    // Simple token overlap as similarity proxy
    function tokenOverlap(a: string, b: string): number {
      const tokensA = new Set(a.toLowerCase().split(/\W+/).filter((t) => t.length > 2));
      const tokensB = new Set(b.toLowerCase().split(/\W+/).filter((t) => t.length > 2));
      let intersection = 0;
      for (const t of tokensA) if (tokensB.has(t)) intersection++;
      const union = tokensA.size + tokensB.size - intersection;
      return union > 0 ? intersection / union : 0;
    }

    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    // Intra-thread: average similarity between chunks within the same thread
    let intraSum = 0;
    let intraCount = 0;
    for (const thread of threads) {
      const threadChunks = thread.chunkIds.map((id) => chunkMap.get(id)!);
      for (let i = 0; i < threadChunks.length; i++) {
        for (let j = i + 1; j < threadChunks.length; j++) {
          const textA = threadChunks[i].messages.map((m) => m.content).join(" ");
          const textB = threadChunks[j].messages.map((m) => m.content).join(" ");
          intraSum += tokenOverlap(textA, textB);
          intraCount++;
        }
      }
    }

    // Inter-thread: average similarity between chunks in different threads
    let interSum = 0;
    let interCount = 0;
    for (let ti = 0; ti < threads.length; ti++) {
      for (let tj = ti + 1; tj < threads.length; tj++) {
        const chunksA = threads[ti].chunkIds.map((id) => chunkMap.get(id)!);
        const chunksB = threads[tj].chunkIds.map((id) => chunkMap.get(id)!);
        for (const a of chunksA) {
          for (const b of chunksB) {
            const textA = a.messages.map((m) => m.content).join(" ");
            const textB = b.messages.map((m) => m.content).join(" ");
            interSum += tokenOverlap(textA, textB);
            interCount++;
          }
        }
      }
    }

    const intraSim = intraCount > 0 ? intraSum / intraCount : 0;
    const interSim = interCount > 0 ? interSum / interCount : 0;

    console.log(`  Intra-thread similarity: ${intraSim.toFixed(4)}`);
    console.log(`  Inter-thread similarity: ${interSim.toFixed(4)}`);

    expect(intraSim).toBeGreaterThanOrEqual(interSim);
  });

  it("thread count is reasonable for multi-topic conversations", async () => {
    const blob = await compress(MULTI_TOPIC_CONVERSATION);
    console.log(`  Detected ${blob.threads.length} threads for ${MULTI_TOPIC_CONVERSATION.length} messages`);
    // Should have 2-5 threads for a 3-topic conversation
    expect(blob.threads.length).toBeGreaterThanOrEqual(2);
    expect(blob.threads.length).toBeLessThanOrEqual(6);
  });
});
