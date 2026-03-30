import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  compress,
  decompress,
  revise,
  threadStatus,
  serialize,
  deserialize,
} from "@tmf/core";
import type { Message, ImportanceTier } from "@tmf/core";
import type { StorageAdapter } from "@tmf/storage";
import { LocalAdapter } from "@tmf/storage";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function createTools(storage: StorageAdapter) {
  const server = new McpServer(
    { name: "tmf", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.tool(
    "tmf_compress",
    "Compress a conversation into a portable .tmf blob",
    {
      messages: z.array(MessageSchema),
      conversationId: z.string().optional(),
    },
    async ({ messages, conversationId }) => {
      try {
        const blob = await compress(messages as Message[]);
        if (conversationId) {
          blob.conversationId = conversationId;
        }
        const buffer = serialize(blob);
        await storage.write(blob.conversationId, buffer);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                blobId: blob.conversationId,
                threadCount: blob.threads.length,
                compressionRatio: blob.metadata.compressionRatio,
                totalTurns: blob.metadata.totalTurns,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "tmf_decompress",
    "Decompress a .tmf blob into context messages",
    {
      blobId: z.string(),
      tierFilter: z.array(z.enum(["critical", "context", "ambient"])).optional(),
      maxTokens: z.number().optional(),
    },
    async ({ blobId, tierFilter, maxTokens }) => {
      try {
        const buffer = await storage.read(blobId);
        const blob = deserialize(buffer);
        const messages = decompress(blob, {
          tierFilter: tierFilter as ImportanceTier[] | undefined,
          maxTokens,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(messages),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "tmf_revise",
    "Add new messages to an existing compressed conversation",
    {
      blobId: z.string(),
      newMessages: z.array(MessageSchema),
    },
    async ({ blobId, newMessages }) => {
      try {
        const buffer = await storage.read(blobId);
        const blob = deserialize(buffer);
        const revised = await revise(blob, newMessages as Message[]);
        const newBuffer = serialize(revised);
        await storage.write(blobId, newBuffer);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                blobId,
                threadCount: revised.threads.length,
                compressionRatio: revised.metadata.compressionRatio,
                revised: true,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "tmf_thread_status",
    "Get diagnostic info about a compressed conversation's threads",
    {
      blobId: z.string(),
    },
    async ({ blobId }) => {
      try {
        const buffer = await storage.read(blobId);
        const blob = deserialize(buffer);
        const status = threadStatus(blob);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(status),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// CLI entry point
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain || process.argv.includes("--stdio")) {
  const dir = join(homedir(), ".tmf", "storage");
  mkdirSync(dir, { recursive: true });
  const storage = new LocalAdapter(dir);
  const server = createTools(storage);
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
