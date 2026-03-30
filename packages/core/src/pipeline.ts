import { randomUUID } from "node:crypto";
import type {
  Message,
  TmfBlob,
  ContextMessage,
  CompressOptions,
  DecompressOptions,
  ThreadStatusReport,
  ImportanceTier,
} from "./types.js";
import { chunk } from "./chunker.js";
import { score } from "./scorer.js";
import { detect } from "./detector.js";
import { compressThread } from "./compressor.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function compress(
  messages: Message[],
  options: CompressOptions = {},
): TmfBlob {
  const { maxThreads = 50, similarityThreshold, maxKeyFacts, embeddings } = options;

  const chunks = chunk(messages);
  const scored = chunks.map((c) => score(c));
  const threads = detect(scored, { maxThreads, similarityThreshold, embeddings });

  const summaries = threads.map((t) =>
    compressThread(t, scored, { maxKeyFacts }),
  );

  const totalTokensOriginal = messages.reduce(
    (acc, m) => acc + estimateTokens(m.content),
    0,
  );
  const totalTokensCompressed = summaries.reduce((acc, s) => {
    const text = [
      s.label,
      ...s.keyFacts,
      ...s.entities,
      ...s.decisions,
      ...s.openQuestions,
    ].join(" ");
    return acc + estimateTokens(text);
  }, 0);

  return {
    version: 1,
    conversationId: randomUUID(),
    createdAt: new Date().toISOString(),
    threads: summaries,
    metadata: {
      totalTurns: chunks.length,
      totalTokensOriginal,
      totalTokensCompressed,
      compressionRatio:
        totalTokensCompressed > 0
          ? totalTokensOriginal / totalTokensCompressed
          : 1,
    },
  };
}

function formatThread(summary: import("./types.js").ThreadSummary): string {
  const parts: string[] = [];
  parts.push(`## ${summary.label} [${summary.tier}]`);

  if (summary.keyFacts.length > 0) {
    parts.push("### Key Facts");
    for (const fact of summary.keyFacts) {
      parts.push(`- ${fact}`);
    }
  }

  if (summary.decisions.length > 0) {
    parts.push("### Decisions");
    for (const d of summary.decisions) {
      parts.push(`- ${d}`);
    }
  }

  if (summary.entities.length > 0) {
    parts.push(`### Entities: ${summary.entities.join(", ")}`);
  }

  if (summary.openQuestions.length > 0) {
    parts.push("### Open Questions");
    for (const q of summary.openQuestions) {
      parts.push(`- ${q}`);
    }
  }

  return parts.join("\n");
}

export function decompress(
  blob: TmfBlob,
  options: DecompressOptions = {},
): ContextMessage[] {
  const { tierFilter, maxTokens } = options;

  let threads = blob.threads;

  // Filter by tier if specified
  if (tierFilter && tierFilter.length > 0) {
    const allowed = new Set<ImportanceTier>(tierFilter);
    threads = threads.filter((t) => allowed.has(t.tier));
  }

  // Sort: critical first, then context, then ambient
  const tierOrder: Record<ImportanceTier, number> = {
    critical: 0,
    context: 1,
    ambient: 2,
  };
  threads = [...threads].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  const messages: ContextMessage[] = [];
  let tokensUsed = 0;

  for (const thread of threads) {
    const content = formatThread(thread);
    const tokenCount = estimateTokens(content);

    if (maxTokens && tokensUsed + tokenCount > maxTokens) {
      break;
    }

    messages.push({
      role: "system",
      content,
      metadata: {
        source: "tmf",
        threadId: thread.threadId,
        tier: thread.tier,
        revision: thread.revision,
      },
    });
    tokensUsed += tokenCount;
  }

  return messages;
}

export function threadStatus(blob: TmfBlob): ThreadStatusReport {
  return {
    threadCount: blob.threads.length,
    threads: blob.threads.map((t) => ({
      id: t.threadId,
      label: t.label,
      tier: t.tier,
      revision: t.revision,
      chunkCount: t.chunkCount,
      factCount: t.keyFacts.length,
    })),
    compressionRatio: blob.metadata.compressionRatio,
  };
}
