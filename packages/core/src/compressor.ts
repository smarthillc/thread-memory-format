import type {
  ScoredChunk,
  Thread,
  ThreadSummary,
  ImportanceTier,
} from "./types.js";

import type { Summarizer } from "./types.js";

export interface CompressorOptions {
  maxKeyFacts?: number;
  maxFactLength?: number;
  summarizer?: Summarizer;
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
  const stopWords = new Set([
    "I", "The", "This", "That", "It", "He", "She", "We", "They",
    "What", "How", "Why", "When", "Where", "Which", "Here", "There",
    "First", "Then", "Next", "Also", "But", "And", "Or", "If",
    "Yes", "No", "Ok", "Sure", "Thanks", "Hello", "Hi", "Hey",
    "For", "Use", "Don", "Set", "Let", "Now", "Back", "Good",
    "Actually", "Definitely", "Perfect", "Cool", "Great", "Start",
    "You", "Your", "Our", "My", "Not", "So", "Very", "Just",
    "Like", "Well", "Still", "Even", "Much", "Most", "Some",
    "All", "Each", "Every", "Both", "Many", "Few", "More",
    "Store", "Combine", "Should", "Would", "Could", "May",
    "Render", "Filter", "Priority",
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

// Sentences that are conversational filler, not informative
const FILLER_RE = /^(?:good call|back to|actually|one more|perfect|yeah|ok|sure|cool|great|definitely|what about|let me|should I|can you|how do)/i;

function extractKeyFacts(
  text: string,
  maxFacts: number,
  maxLength: number,
): string[] {
  const sentences = sentenceSplit(text);
  // Score sentences by informativeness — be selective
  const scored = sentences
    .filter((s) => s.length > 15) // Drop very short fragments
    .filter((s) => !FILLER_RE.test(s)) // Drop conversational filler
    .map((s) => {
      let score = 0;
      const entityCount = (s.match(ENTITY_RE) ?? []).length;
      if (entityCount >= 2) score += 3; // Multiple entities = very informative
      else if (entityCount >= 1) score += 1;
      if (s.includes(":")) score += 1;  // Structured info
      if (s.match(/\d/)) score += 1;    // Contains numbers/specifics
      if (s.match(/```/)) score += 2;   // Code
      if (DECISION_RE.test(s)) score += 2; // Decision
      if (s.length > 80) score += 1;    // Substantial content
      if (s.length > 200) score -= 1;   // Too long, probably a wall of text
      return { sentence: s, score };
    });
  scored.sort((a, b) => b.score - a.score);
  // Keep only high-scoring facts (score >= 2 means at least one strong signal)
  const filtered = scored.filter((s) => s.score >= 2);
  const selected = filtered.length > 0 ? filtered : scored.slice(0, 3);
  return selected
    .slice(0, maxFacts)
    .map((s) => s.sentence.slice(0, maxLength))
    .filter((s) => s.length > 0);
}

export async function compressThread(
  thread: Thread,
  chunks: ScoredChunk[],
  options: CompressorOptions = {},
): Promise<ThreadSummary> {
  const { maxKeyFacts = 20, maxFactLength = 200, summarizer } = options;

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
  if (summarizer && thread.tier !== "ambient") {
    // LLM-based summarization — much higher quality compression
    const summary = await summarizer(fullText, thread.tier);
    keyFacts = summary
      .split("\n")
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, maxKeyFacts);
  } else if (thread.tier === "ambient") {
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
