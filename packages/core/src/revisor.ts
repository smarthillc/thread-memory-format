import type {
  Message,
  TmfBlob,
  ThreadSummary,
  ScoredChunk,
  Thread,
} from "./types.js";
import { chunk } from "./chunker.js";
import { score } from "./scorer.js";
import { detect } from "./detector.js";
import { compressThread } from "./compressor.js";

export interface ReviseOptions {
  maxSummaryTokens?: number;
  similarityThreshold?: number;
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function summarySize(summary: ThreadSummary): number {
  return estimateTokens(JSON.stringify(summary));
}

function overlapScore(existing: ThreadSummary, newThread: Thread, newChunks: ScoredChunk[]): number {
  const existingTerms = new Set([
    ...existing.label.toLowerCase().split(/\W+/),
    ...existing.entities.map((e) => e.toLowerCase()),
  ]);

  const newText = newChunks
    .filter((c) => newThread.chunkIds.includes(c.id))
    .map((c) => c.messages.map((m) => m.content).join(" "))
    .join(" ");
  const newTerms = newText.toLowerCase().split(/\W+/).filter((t) => t.length > 2);

  let matches = 0;
  for (const term of newTerms) {
    if (existingTerms.has(term)) matches++;
  }
  return newTerms.length > 0 ? matches / newTerms.length : 0;
}

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((item) => {
    const key = item.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trimSummary(summary: ThreadSummary, maxTokens: number): ThreadSummary {
  const result = { ...summary };
  // Trim keyFacts from the end until under budget
  while (summarySize(result) > maxTokens && result.keyFacts.length > 1) {
    result.keyFacts = result.keyFacts.slice(0, -1);
  }
  return result;
}

export function revise(
  existing: TmfBlob,
  newMessages: Message[],
  options: ReviseOptions = {},
): TmfBlob {
  const { maxSummaryTokens = 2000, similarityThreshold = 0.08 } = options;

  if (newMessages.length === 0) return existing;

  // Process new messages through the pipeline
  const newChunks = chunk(newMessages).map((c) => score(c));
  const newThreads = detect(newChunks, { similarityThreshold });

  // Copy existing threads
  const updatedThreads = [...existing.threads];
  const matched = new Set<number>();

  for (const newThread of newThreads) {
    // Find best matching existing thread
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < updatedThreads.length; i++) {
      const s = overlapScore(updatedThreads[i], newThread, newChunks);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore > 0.1) {
      // Merge into existing thread
      const existingSummary = updatedThreads[bestIdx];
      const newSummary = compressThread(newThread, newChunks);

      const merged: ThreadSummary = {
        ...existingSummary,
        keyFacts: dedup([...existingSummary.keyFacts, ...newSummary.keyFacts]),
        entities: dedup([...existingSummary.entities, ...newSummary.entities]),
        decisions: dedup([...existingSummary.decisions, ...newSummary.decisions]),
        openQuestions: dedup([...existingSummary.openQuestions, ...newSummary.openQuestions]),
        turnRange: [
          Math.min(existingSummary.turnRange[0], newSummary.turnRange[0]),
          Math.max(existingSummary.turnRange[1], newSummary.turnRange[1]),
        ],
        chunkCount: existingSummary.chunkCount + newSummary.chunkCount,
        revision: existingSummary.revision + 1,
        tier:
          existingSummary.tier === "critical" || newSummary.tier === "critical"
            ? "critical"
            : existingSummary.tier === "context" || newSummary.tier === "context"
              ? "context"
              : "ambient",
      };

      updatedThreads[bestIdx] = trimSummary(merged, maxSummaryTokens);
      matched.add(bestIdx);
    } else {
      // Add as new thread
      const newSummary = compressThread(newThread, newChunks);
      updatedThreads.push(trimSummary(newSummary, maxSummaryTokens));
    }
  }

  // Compute new metadata
  const totalTokensCompressed = updatedThreads.reduce(
    (acc, t) => acc + summarySize(t),
    0,
  );
  const newTokens = newMessages.reduce(
    (acc, m) => acc + estimateTokens(m.content),
    0,
  );
  const totalTokensOriginal = existing.metadata.totalTokensOriginal + newTokens;
  const totalTurns = existing.metadata.totalTurns + newChunks.length;

  return {
    ...existing,
    threads: updatedThreads,
    metadata: {
      totalTurns,
      totalTokensOriginal,
      totalTokensCompressed,
      compressionRatio:
        totalTokensCompressed > 0
          ? totalTokensOriginal / totalTokensCompressed
          : 1,
    },
  };
}
