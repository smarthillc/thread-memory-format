import { createHash } from "node:crypto";
import type { ScoredChunk, Thread, ImportanceTier } from "./types.js";

export interface DetectorOptions {
  similarityThreshold?: number;
  maxThreads?: number;
  embeddings?: number[][];
}

// Simple tokenizer: lowercase, split on non-alphanumeric, drop short tokens
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function chunkText(chunk: ScoredChunk): string {
  return chunk.messages.map((m) => m.content).join(" ");
}

// Extract named entities (capitalized words, technical terms)
const ENTITY_RE = /\b[A-Z][a-zA-Z0-9]*(?:[-_.][A-Za-z0-9]+)*\b/g;
const ENTITY_STOP = new Set([
  "I", "The", "This", "That", "It", "He", "She", "We", "They",
  "What", "How", "Why", "When", "Where", "Which", "Here", "There",
  "First", "Then", "Next", "Also", "But", "And", "Or", "If",
  "Yes", "No", "Ok", "Sure", "Thanks", "Hello", "Hi", "Hey",
  "For", "Use", "Don", "Set", "Let", "Now", "Back", "Good",
  "Actually", "Definitely", "Perfect", "Cool", "Great", "Start",
]);

function extractEntitiesFromText(text: string): Set<string> {
  const matches = text.match(ENTITY_RE) ?? [];
  return new Set(matches.filter((e) => !ENTITY_STOP.has(e)));
}

// Jaccard similarity between two sets
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// Build TF-IDF vectors for a set of documents
function buildTfidf(docs: string[][]): Map<string, number>[] {
  const n = docs.length;
  if (n === 0) return [];

  // Document frequency
  const df = new Map<string, number>();
  for (const tokens of docs) {
    const seen = new Set(tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  // TF-IDF per document
  return docs.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    const tfidf = new Map<string, number>();
    for (const [term, count] of tf) {
      const idf = Math.log(n / (df.get(term) ?? 1));
      tfidf.set(term, count * idf);
    }
    return tfidf;
  });
}

function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, val] of a) {
    normA += val * val;
    const bVal = b.get(term);
    if (bVal !== undefined) {
      dot += val * bVal;
    }
  }
  for (const val of b.values()) {
    normB += val * val;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function cosineSimEmbeddings(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Agglomerative clustering (single-linkage)
function agglomerativeClusters(
  simMatrix: number[][],
  threshold: number,
  maxClusters: number,
): number[][] {
  const n = simMatrix.length;
  // Start with each item in its own cluster
  const clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const active = new Set(Array.from({ length: n }, (_, i) => i));

  while (active.size > 1) {
    // Find most similar pair of active clusters
    let bestSim = -Infinity;
    let bestI = -1;
    let bestJ = -1;
    const activeArr = [...active];

    for (let ai = 0; ai < activeArr.length; ai++) {
      for (let aj = ai + 1; aj < activeArr.length; aj++) {
        const ci = activeArr[ai];
        const cj = activeArr[aj];
        // Average-linkage similarity between clusters
        let sum = 0;
        let count = 0;
        for (const ii of clusters[ci]) {
          for (const jj of clusters[cj]) {
            sum += simMatrix[ii][jj];
            count++;
          }
        }
        const avgSim = sum / count;
        if (avgSim > bestSim) {
          bestSim = avgSim;
          bestI = ci;
          bestJ = cj;
        }
      }
    }

    // If over maxClusters, always merge (force down to max)
    // If under maxClusters, only merge if similarity is above threshold
    if (active.size <= maxClusters && bestSim < threshold) break;

    // Merge bestJ into bestI
    clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
    active.delete(bestJ);
  }

  return [...active].map((i) => clusters[i]);
}

// Generate a readable label for a cluster using named entities first, falling back to distinctive terms
function labelForCluster(
  chunks: ScoredChunk[],
  clusterIndices: number[],
  allTokens: string[][],
  allEntities: Set<string>[],
): string {
  // Prefer entity-based labels — they're the actual proper nouns
  const clusterEntityFreq = new Map<string, number>();
  for (const idx of clusterIndices) {
    for (const ent of allEntities[idx]) {
      clusterEntityFreq.set(ent, (clusterEntityFreq.get(ent) ?? 0) + 1);
    }
  }

  // Score entities: prefer frequent within cluster AND distinctive (not in every cluster)
  const globalEntityFreq = new Map<string, number>();
  for (const entities of allEntities) {
    for (const ent of entities) {
      globalEntityFreq.set(ent, (globalEntityFreq.get(ent) ?? 0) + 1);
    }
  }

  const entityScores: [string, number][] = [];
  for (const [ent, cFreq] of clusterEntityFreq) {
    const gFreq = globalEntityFreq.get(ent) ?? 1;
    // Boost entities that are frequent in this cluster but rare globally
    entityScores.push([ent, (cFreq * cFreq) / gFreq]);
  }
  entityScores.sort((a, b) => b[1] - a[1]);

  const topEntities = entityScores.slice(0, 3).map(([e]) => e);
  if (topEntities.length > 0) {
    return topEntities.join(" + ");
  }

  // Fallback to TF-IDF terms
  const clusterFreq = new Map<string, number>();
  for (const idx of clusterIndices) {
    for (const t of allTokens[idx]) {
      clusterFreq.set(t, (clusterFreq.get(t) ?? 0) + 1);
    }
  }
  const globalFreq = new Map<string, number>();
  for (const tokens of allTokens) {
    for (const t of tokens) {
      globalFreq.set(t, (globalFreq.get(t) ?? 0) + 1);
    }
  }
  const scores: [string, number][] = [];
  for (const [term, cFreq] of clusterFreq) {
    const gFreq = globalFreq.get(term) ?? 1;
    scores.push([term, cFreq / gFreq]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const topTerms = scores.slice(0, 3).map(([t]) => t);
  return topTerms.join(" + ") || "general";
}

function threadId(label: string, index: number): string {
  const hash = createHash("sha256");
  hash.update(label);
  hash.update(String(index));
  return "thread_" + hash.digest("hex").slice(0, 12);
}

export function detect(
  chunks: ScoredChunk[],
  options: DetectorOptions = {},
): Thread[] {
  const { similarityThreshold = 0.08, maxThreads = 50, embeddings } = options;
  if (chunks.length === 0) return [];

  const n = chunks.length;

  // Build similarity matrix
  let simMatrix: number[][];

  // Extract entities per chunk for entity-based similarity boosting
  const chunkEntities = chunks.map((c) => extractEntitiesFromText(chunkText(c)));

  if (embeddings && embeddings.length === n) {
    // Use provided embeddings + entity boost
    simMatrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 1;
        const embSim = cosineSimEmbeddings(embeddings[i], embeddings[j]);
        const entSim = jaccardSimilarity(chunkEntities[i], chunkEntities[j]);
        return embSim * 0.6 + entSim * 0.4;
      }),
    );
  } else {
    // Blend TF-IDF + entity Jaccard similarity
    const allTokens = chunks.map((c) => tokenize(chunkText(c)));
    const vectors = buildTfidf(allTokens);
    simMatrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 1;
        const tfidfSim = cosineSimilarity(vectors[i], vectors[j]);
        const entSim = jaccardSimilarity(chunkEntities[i], chunkEntities[j]);
        // Entity overlap is a strong signal — weight it heavily
        return tfidfSim * 0.4 + entSim * 0.6;
      }),
    );
  }

  const clusters = agglomerativeClusters(simMatrix, similarityThreshold, maxThreads);

  const allTokens = chunks.map((c) => tokenize(chunkText(c)));

  return clusters.map((indices, clusterIdx) => {
    const label = labelForCluster(chunks, indices, allTokens, chunkEntities);
    const chunkIds = indices.map((i) => chunks[i].id);
    const highestTier = indices.reduce<ImportanceTier>((best, idx) => {
      const tier = chunks[idx].tier;
      if (tier === "critical") return "critical";
      if (tier === "context" && best !== "critical") return "context";
      return best;
    }, "ambient");

    return {
      id: threadId(label, clusterIdx),
      label,
      chunkIds,
      tier: highestTier,
    };
  });
}
