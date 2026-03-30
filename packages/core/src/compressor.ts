import type {
  ScoredChunk,
  Thread,
  ThreadSummary,
  ImportanceTier,
} from "./types.js";

export interface CompressorOptions {
  maxKeyFacts?: number;
  maxFactLength?: number;
}

const DECISION_RE =
  /\b(?:decided|let'?s go with|we'?ll use|choosing|going with|settled on|the answer is|conclusion|final answer|the solution is)\b/i;
const QUESTION_RE = /[^.!]*\?/g;
const ENTITY_RE = /\b[A-Z][a-zA-Z0-9]*(?:[-_.][A-Za-z0-9]+)*\b/g;

function sentenceSplit(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractEntities(text: string): string[] {
  const matches = text.match(ENTITY_RE) ?? [];
  // Filter out common English words that happen to start with uppercase
  const stopWords = new Set([
    "I", "The", "This", "That", "It", "He", "She", "We", "They",
    "What", "How", "Why", "When", "Where", "Which", "Here", "There",
    "First", "Then", "Next", "Also", "But", "And", "Or", "If",
    "Yes", "No", "Ok", "Sure", "Thanks", "Hello", "Hi", "Hey",
  ]);
  const unique = [...new Set(matches)].filter((e) => !stopWords.has(e));
  return unique;
}

function extractDecisions(text: string): string[] {
  const sentences = sentenceSplit(text);
  return sentences
    .filter((s) => DECISION_RE.test(s))
    .map((s) => s.slice(0, 200));
}

function extractOpenQuestions(
  text: string,
  decisions: string[],
): string[] {
  const questions: string[] = [];
  let match;
  const re = new RegExp(QUESTION_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const q = match[0].trim();
    if (q.length > 10) {
      questions.push(q.slice(0, 200));
    }
  }
  // Filter out questions that were answered (appear near a decision)
  const decisionText = decisions.join(" ").toLowerCase();
  return questions.filter((q) => {
    const keywords = q
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    const answered = keywords.some((kw) => decisionText.includes(kw));
    return !answered;
  });
}

function extractKeyFacts(
  text: string,
  maxFacts: number,
  maxLength: number,
): string[] {
  const sentences = sentenceSplit(text);
  // Score sentences by informativeness heuristics
  const scored = sentences.map((s) => {
    let score = 0;
    if (s.match(ENTITY_RE)) score += 2;
    if (s.includes(":")) score += 1;
    if (s.match(/\d/)) score += 1;
    if (s.match(/```/)) score += 2;
    if (s.length > 30) score += 1;
    if (s.length < 10) score -= 2;
    return { sentence: s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, maxFacts)
    .map((s) => s.sentence.slice(0, maxLength))
    .filter((s) => s.length > 0);
}

export function compressThread(
  thread: Thread,
  chunks: ScoredChunk[],
  options: CompressorOptions = {},
): ThreadSummary {
  const { maxKeyFacts = 20, maxFactLength = 200 } = options;

  // Gather all text from the thread's chunks
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));
  const threadChunks = thread.chunkIds
    .map((id) => chunkMap.get(id))
    .filter((c): c is ScoredChunk => c !== undefined);

  const fullText = threadChunks
    .map((c) => c.messages.map((m) => m.content).join("\n"))
    .join("\n\n");

  const entities = extractEntities(fullText);
  const decisions = extractDecisions(fullText);
  const openQuestions = extractOpenQuestions(fullText, decisions);

  let keyFacts: string[];
  if (thread.tier === "ambient") {
    keyFacts = [fullText.slice(0, 100)].filter((s) => s.length > 0);
  } else {
    keyFacts = extractKeyFacts(fullText, maxKeyFacts, maxFactLength);
  }

  const turnIndices = threadChunks.map((c) => c.turnIndex);
  const turnRange: [number, number] = [
    Math.min(...turnIndices),
    Math.max(...turnIndices),
  ];

  return {
    threadId: thread.id,
    label: thread.label,
    tier: thread.tier,
    keyFacts,
    entities,
    decisions,
    openQuestions,
    turnRange,
    chunkCount: threadChunks.length,
    revision: 0,
  };
}
