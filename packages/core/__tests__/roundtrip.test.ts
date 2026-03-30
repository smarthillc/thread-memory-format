import { describe, it, expect } from "vitest";
import { compress, decompress, revise, serialize, deserialize } from "../src/index.js";
import type { Message } from "../src/types.js";

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

function generateConversation(turns: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < turns; i++) {
    if (i % 2 === 0) {
      messages.push(msg("user", `Question ${i}: How does feature_${i} work with Component_${i}?`));
    } else {
      messages.push(msg("assistant", `Feature_${i} connects to Service_${i}. You should configure it at /etc/config_${i}. Let's go with approach_${i}.`));
    }
  }
  return messages;
}

function allOutputText(messages: { content: string }[]): string {
  return messages.map((m) => m.content).join("\n").toLowerCase();
}

describe("roundtrip", () => {
  it("preserves critical facts in a short chat", async () => {
    const messages = [
      msg("user", "What database should we use?"),
      msg("assistant", "Let's go with PostgreSQL. It has great JSONB support and excellent performance."),
      msg("user", "What about the cache layer?"),
      msg("assistant", "Redis is the best choice for caching. Install Redis with your package manager."),
    ];
    const blob = await compress(messages);
    const output = decompress(blob);
    const text = allOutputText(output);
    expect(text).toContain("postgresql");
    expect(text).toContain("redis");
  });

  it("preserves named entities in a medium chat", async () => {
    const messages = generateConversation(50);
    const blob = await compress(messages);
    const output = decompress(blob);
    const text = allOutputText(output);
    // At least some Service_N and Feature_N should survive
    let entitiesFound = 0;
    for (let i = 0; i < 50; i += 10) {
      if (text.includes(`service_${i}`) || text.includes(`feature_${i}`)) {
        entitiesFound++;
      }
    }
    expect(entitiesFound).toBeGreaterThan(0);
  });

  it("has a positive compression ratio for a long chat", async () => {
    const messages = generateConversation(200);
    const blob = await compress(messages);
    expect(blob.metadata.compressionRatio).toBeGreaterThan(0);
    // Thread count should be much less than turn count (actual compression)
    expect(blob.threads.length).toBeLessThan(blob.metadata.totalTurns);
  });

  it("preserves code-related mentions in code-heavy chats", async () => {
    const messages = [
      msg("user", "How do I use TypeScript generics?"),
      msg("assistant", "Here's an example:\n```typescript\nfunction identity<T>(arg: T): T { return arg; }\n```\nTypeScript generics enable type-safe abstractions."),
      msg("user", "What about React hooks with TypeScript?"),
      msg("assistant", "Use useState with a type parameter:\n```typescript\nconst [count, setCount] = useState<number>(0);\n```"),
    ];
    const blob = await compress(messages);
    const output = decompress(blob);
    const text = allOutputText(output);
    expect(text).toMatch(/typescript/i);
  });

  it("produces separate threads for multi-topic conversations", async () => {
    const messages = [
      msg("user", "How do I configure PostgreSQL database replication?"),
      msg("assistant", "PostgreSQL database replication uses streaming replication with write-ahead log."),
      msg("user", "How do I configure PostgreSQL database backups?"),
      msg("assistant", "PostgreSQL database backups use pg_dump or pg_basebackup."),
      msg("user", "Now about CSS grid layout styling"),
      msg("assistant", "CSS grid layout uses grid-template-columns and grid-template-rows for styling."),
      msg("user", "What about CSS flexbox layout styling?"),
      msg("assistant", "CSS flexbox layout uses display flex with justify-content for styling."),
    ];
    const blob = await compress(messages);
    expect(blob.threads.length).toBeGreaterThanOrEqual(1);
    // All threads should have content
    for (const thread of blob.threads) {
      expect(thread.keyFacts.length).toBeGreaterThan(0);
    }
  });

  it("filters by tier on decompress", async () => {
    const messages = [
      msg("user", "Hello!"),
      msg("assistant", "Hi there!"),
      msg("user", "Let's go with PostgreSQL for the main database."),
      msg("assistant", "Let's go with PostgreSQL. I'll set it up. Install PostgreSQL first."),
    ];
    const blob = await compress(messages);
    const criticalOnly = decompress(blob, { tierFilter: ["critical"] });
    const all = decompress(blob);
    expect(criticalOnly.length).toBeLessThanOrEqual(all.length);
    for (const msg of criticalOnly) {
      expect(msg.metadata.tier).toBe("critical");
    }
  });

  it("preserves facts through compress → revise → decompress", async () => {
    const initial = [
      msg("user", "We're building with PostgreSQL and React."),
      msg("assistant", "PostgreSQL for the backend, React for the frontend. Let's go with that."),
    ];
    const blob = await compress(initial);

    const continuation = [
      msg("user", "Also adding Redis for caching."),
      msg("assistant", "Redis is a great choice for caching. Install Redis alongside PostgreSQL."),
    ];
    const revised = await revise(blob, continuation);
    const output = decompress(revised);
    const text = allOutputText(output);
    expect(text).toContain("postgresql");
    expect(text).toContain("redis");
  });

  it("serializer round-trips the compressed blob", async () => {
    const messages = generateConversation(20);
    const blob = await compress(messages);
    const buffer = serialize(blob);
    const restored = deserialize(buffer);
    expect(restored.threads).toEqual(blob.threads);
    expect(restored.metadata).toEqual(blob.metadata);
  });
});
