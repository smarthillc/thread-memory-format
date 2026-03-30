export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface Chunk {
  id: string;
  messages: Message[];
  turnIndex: number;
  speakerTransitions: number;
}

export type ImportanceTier = "critical" | "context" | "ambient";

export interface ScoredChunk extends Chunk {
  tier: ImportanceTier;
  score: number;
  signals: string[];
}

export interface Thread {
  id: string;
  label: string;
  chunkIds: string[];
  tier: ImportanceTier;
}

export interface ThreadSummary {
  threadId: string;
  label: string;
  tier: ImportanceTier;
  keyFacts: string[];
  entities: string[];
  decisions: string[];
  openQuestions: string[];
  turnRange: [number, number];
  chunkCount: number;
  revision: number;
}

export interface TmfBlob {
  version: 1;
  conversationId: string;
  createdAt: string;
  threads: ThreadSummary[];
  metadata: {
    totalTurns: number;
    totalTokensOriginal: number;
    totalTokensCompressed: number;
    compressionRatio: number;
  };
}

export interface ContextMessage {
  role: "system";
  content: string;
  metadata: {
    source: "tmf";
    threadId: string;
    tier: ImportanceTier;
    revision: number;
  };
}

export type Summarizer = (text: string, tier: ImportanceTier) => Promise<string>;

export interface CompressOptions {
  maxThreads?: number;
  similarityThreshold?: number;
  maxKeyFacts?: number;
  embeddings?: number[][];
  summarizer?: Summarizer;
}

export interface DecompressOptions {
  tierFilter?: ImportanceTier[];
  maxTokens?: number;
}

export interface ReviseOptions {
  maxSummaryTokens?: number;
}

export interface ThreadStatusReport {
  threadCount: number;
  threads: Array<{
    id: string;
    label: string;
    tier: ImportanceTier;
    revision: number;
    chunkCount: number;
    factCount: number;
  }>;
  compressionRatio: number;
}
