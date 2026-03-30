import { createHash } from "node:crypto";
import type { Message, Chunk } from "./types.js";

export interface ChunkOptions {
  maxChunkSize?: number;
}

function chunkId(messages: Message[]): string {
  const hash = createHash("sha256");
  for (const msg of messages) {
    hash.update(msg.role);
    hash.update(msg.content);
  }
  return hash.digest("hex").slice(0, 16);
}

export function chunk(
  messages: Message[],
  options: ChunkOptions = {},
): Chunk[] {
  const { maxChunkSize = Infinity } = options;
  if (messages.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: Message[] = [];
  let turnIndex = 0;

  function flush() {
    if (current.length === 0) return;
    const transitions = new Set(current.map((m) => m.role)).size - 1;
    chunks.push({
      id: chunkId(current),
      messages: [...current],
      turnIndex,
      speakerTransitions: transitions,
    });
    turnIndex++;
    current = [];
  }

  for (const msg of messages) {
    // System messages always get their own chunk
    if (msg.role === "system") {
      flush();
      current.push(msg);
      flush();
      continue;
    }

    // New chunk on role change
    if (current.length > 0 && msg.role !== current[current.length - 1].role) {
      flush();
    }

    current.push(msg);

    // Enforce max chunk size
    if (current.length >= maxChunkSize) {
      flush();
    }
  }

  flush();
  return chunks;
}
