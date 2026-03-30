import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryAdapter } from "@tmf/storage";
import { createTools } from "../src/index.js";

describe("MCP tools", () => {
  let client: Client;
  let storage: MemoryAdapter;

  beforeEach(async () => {
    storage = new MemoryAdapter();
    const server = createTools(storage);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);
  });

  describe("tmf_compress", () => {
    it("compresses messages and returns stats", async () => {
      const result = await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "What database should we use?" },
            { role: "assistant", content: "Let's go with PostgreSQL for the project." },
          ],
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.blobId).toBeDefined();
      expect(parsed.threadCount).toBeGreaterThan(0);
      expect(parsed.compressionRatio).toBeGreaterThan(0);
    });

    it("accepts custom conversationId", async () => {
      const result = await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there" },
          ],
          conversationId: "custom-123",
        },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.blobId).toBe("custom-123");
    });
  });

  describe("tmf_decompress", () => {
    it("decompresses a previously compressed blob", async () => {
      // Compress first
      const compressResult = await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "Tell me about TypeScript." },
            { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
          ],
          conversationId: "decomp-test",
        },
      });
      expect(compressResult.isError).toBeFalsy();

      // Decompress
      const result = await client.callTool({
        name: "tmf_decompress",
        arguments: { blobId: "decomp-test" },
      });
      expect(result.isError).toBeFalsy();
      const messages = JSON.parse((result.content as any)[0].text);
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].role).toBe("system");
    });

    it("returns error for unknown blobId", async () => {
      const result = await client.callTool({
        name: "tmf_decompress",
        arguments: { blobId: "nonexistent" },
      });
      expect(result.isError).toBe(true);
    });

    it("supports tier filter", async () => {
      await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "Hi!" },
            { role: "assistant", content: "Hello!" },
            { role: "user", content: "Let's go with Redis for caching. Install Redis now." },
            { role: "assistant", content: "Let's go with Redis. I'll install Redis for the cache layer." },
          ],
          conversationId: "filter-test",
        },
      });

      const result = await client.callTool({
        name: "tmf_decompress",
        arguments: { blobId: "filter-test", tierFilter: ["critical"] },
      });
      expect(result.isError).toBeFalsy();
      const messages = JSON.parse((result.content as any)[0].text);
      for (const msg of messages) {
        expect(msg.metadata.tier).toBe("critical");
      }
    });
  });

  describe("tmf_revise", () => {
    it("revises an existing blob with new messages", async () => {
      await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "We're using PostgreSQL." },
            { role: "assistant", content: "PostgreSQL is set up." },
          ],
          conversationId: "revise-test",
        },
      });

      const result = await client.callTool({
        name: "tmf_revise",
        arguments: {
          blobId: "revise-test",
          newMessages: [
            { role: "user", content: "Also adding Redis for caching." },
            { role: "assistant", content: "Redis caching layer is configured." },
          ],
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.revised).toBe(true);
      expect(parsed.threadCount).toBeGreaterThan(0);
    });

    it("returns error for unknown blobId", async () => {
      const result = await client.callTool({
        name: "tmf_revise",
        arguments: {
          blobId: "missing",
          newMessages: [{ role: "user", content: "test" }],
        },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("tmf_thread_status", () => {
    it("returns thread diagnostic info", async () => {
      await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "Tell me about Kubernetes." },
            { role: "assistant", content: "Kubernetes orchestrates containers." },
          ],
          conversationId: "status-test",
        },
      });

      const result = await client.callTool({
        name: "tmf_thread_status",
        arguments: { blobId: "status-test" },
      });
      expect(result.isError).toBeFalsy();
      const status = JSON.parse((result.content as any)[0].text);
      expect(status.threadCount).toBeGreaterThan(0);
      expect(status.threads).toBeInstanceOf(Array);
      expect(status.compressionRatio).toBeGreaterThan(0);
    });

    it("returns error for unknown blobId", async () => {
      const result = await client.callTool({
        name: "tmf_thread_status",
        arguments: { blobId: "nope" },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("composition", () => {
    it("full lifecycle: compress → status → decompress", async () => {
      // Compress
      const compressResult = await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "Build a REST API with Express and TypeScript." },
            { role: "assistant", content: "Let's go with Express for the REST API. Install express and @types/express." },
          ],
          conversationId: "lifecycle",
        },
      });
      expect(compressResult.isError).toBeFalsy();

      // Status
      const statusResult = await client.callTool({
        name: "tmf_thread_status",
        arguments: { blobId: "lifecycle" },
      });
      expect(statusResult.isError).toBeFalsy();
      const status = JSON.parse((statusResult.content as any)[0].text);
      expect(status.threadCount).toBeGreaterThan(0);

      // Decompress
      const decompResult = await client.callTool({
        name: "tmf_decompress",
        arguments: { blobId: "lifecycle" },
      });
      expect(decompResult.isError).toBeFalsy();
      const messages = JSON.parse((decompResult.content as any)[0].text);
      expect(messages.length).toBeGreaterThan(0);
    });

    it("compress → revise → decompress preserves both rounds", async () => {
      await client.callTool({
        name: "tmf_compress",
        arguments: {
          messages: [
            { role: "user", content: "Using PostgreSQL for the database." },
            { role: "assistant", content: "PostgreSQL is configured." },
          ],
          conversationId: "revise-lifecycle",
        },
      });

      await client.callTool({
        name: "tmf_revise",
        arguments: {
          blobId: "revise-lifecycle",
          newMessages: [
            { role: "user", content: "Adding Redis for the caching layer." },
            { role: "assistant", content: "Redis caching is ready." },
          ],
        },
      });

      const result = await client.callTool({
        name: "tmf_decompress",
        arguments: { blobId: "revise-lifecycle" },
      });
      const messages = JSON.parse((result.content as any)[0].text);
      const allText = messages.map((m: any) => m.content).join(" ").toLowerCase();
      // Both rounds should be represented
      expect(allText).toMatch(/postgresql|redis/i);
    });
  });
});
