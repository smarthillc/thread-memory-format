import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import type { TmfBlob } from "./types.js";

const ThreadSummarySchema = z.object({
  threadId: z.string(),
  label: z.string(),
  tier: z.enum(["critical", "context", "ambient"]),
  keyFacts: z.array(z.string()),
  entities: z.array(z.string()),
  decisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  turnRange: z.tuple([z.number(), z.number()]),
  chunkCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});

const TmfBlobSchema = z.object({
  version: z.literal(1),
  conversationId: z.string(),
  createdAt: z.string(),
  threads: z.array(ThreadSummarySchema),
  metadata: z.object({
    totalTurns: z.number().int().nonnegative(),
    totalTokensOriginal: z.number().int().nonnegative(),
    totalTokensCompressed: z.number().int().nonnegative(),
    compressionRatio: z.number().nonnegative(),
  }),
});

export function serialize(blob: TmfBlob): Buffer {
  const json = JSON.stringify(blob);
  return gzipSync(Buffer.from(json, "utf-8"));
}

export function deserialize(data: Buffer): TmfBlob {
  let json: string;
  try {
    const decompressed = gunzipSync(data);
    json = decompressed.toString("utf-8");
  } catch {
    throw new Error("TMF: failed to decompress data — corrupt or not gzipped");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("TMF: failed to parse JSON — corrupt data");
  }

  const result = TmfBlobSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`TMF: invalid blob — ${issues}`);
  }

  return result.data as TmfBlob;
}
