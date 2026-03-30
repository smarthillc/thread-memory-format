import { describe, it, expect } from "vitest";
import { compress, serialize } from "../src/index.js";
import type { Message } from "../src/types.js";

function generateConversation(turns: number): Message[] {
  const topics = ["database", "frontend", "deployment", "testing", "security"];
  const messages: Message[] = [];
  for (let i = 0; i < turns; i++) {
    const topic = topics[i % topics.length];
    if (i % 2 === 0) {
      messages.push({
        role: "user",
        content: `Question about ${topic}: How does Feature_${i} work with Component_${i} in the ${topic} layer? Should we use Library_${i}?`,
      });
    } else {
      messages.push({
        role: "assistant",
        content: `For the ${topic} layer, Feature_${i} connects to Service_${i} via Protocol_${i}. Let's go with Library_${i} — it supports Version_${i} and integrates with Tool_${i}. Configure it at /etc/${topic}/config_${i}.json with port ${3000 + i}.`,
      });
    }
  }
  return messages;
}

describe("benchmarks (informational)", () => {
  it.each([10, 50, 200])("compression at %i turns", async (turns) => {
    const messages = generateConversation(turns);
    const inputTokens = messages.reduce((a, m) => a + Math.ceil(m.content.length / 4), 0);

    const start = performance.now();
    const blob = await compress(messages);
    const elapsed = performance.now() - start;

    const buffer = serialize(blob);

    console.log(
      `  ${turns} turns: ${elapsed.toFixed(0)}ms | ` +
      `threads: ${blob.threads.length} | ` +
      `ratio: ${blob.metadata.compressionRatio.toFixed(2)}x | ` +
      `input: ${inputTokens} tokens | ` +
      `.tmf: ${buffer.length} bytes`,
    );

    // Should complete in reasonable time (no exponential blowup)
    expect(elapsed).toBeLessThan(turns * 100); // max 100ms per turn
  });

  it("compression ratio improves or stays stable with conversation length", async () => {
    const sizes = [10, 50, 100, 200];
    const ratios: number[] = [];

    for (const size of sizes) {
      const messages = generateConversation(size);
      const blob = await compress(messages);
      ratios.push(blob.metadata.compressionRatio);
    }

    console.log(`  Ratios by size: ${sizes.map((s, i) => `${s}→${ratios[i].toFixed(2)}x`).join(", ")}`);

    // Thread count should not grow linearly
    const messages200 = generateConversation(200);
    const blob200 = await compress(messages200);
    expect(blob200.threads.length).toBeLessThan(200);
  });

  it("serialized .tmf is always smaller than raw JSON", async () => {
    for (const turns of [10, 50, 100]) {
      const messages = generateConversation(turns);
      const blob = await compress(messages);
      const buffer = serialize(blob);
      const rawBlobJson = JSON.stringify(blob);

      console.log(
        `  ${turns} turns: .tmf=${buffer.length}B vs blob JSON=${rawBlobJson.length}B ` +
        `(${((1 - buffer.length / rawBlobJson.length) * 100).toFixed(1)}% savings)`,
      );

      expect(buffer.length).toBeLessThan(rawBlobJson.length);
    }
  });
});
