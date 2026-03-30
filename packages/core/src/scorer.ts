import type { Chunk, ScoredChunk, ImportanceTier } from "./types.js";

export interface ScorerOptions {
  criticalThreshold?: number;
  contextThreshold?: number;
}

const DECISION_PATTERNS = [
  /\b(?:decided|let'?s go with|we'?ll use|choosing|the answer is|going with|settled on|picked)\b/i,
  /\b(?:conclusion|therefore|in summary|final answer|the solution is)\b/i,
];

const INSTRUCTION_PATTERNS = [
  /\b(?:you should|make sure|always|never|must|don'?t forget|remember to|be sure to)\b/i,
  /\b(?:install|configure|set up|run|execute|deploy|create|add|remove)\b\s/i,
];

const ERROR_RESOLUTION_PATTERNS = [
  /\b(?:fixed|resolved|the (?:issue|problem|bug) was|solved|that fixed it|working now)\b/i,
  /\b(?:the fix is|root cause|the error was)\b/i,
];

const QUESTION_PATTERNS = [
  /\?$/m,
  /\b(?:how do|what is|why does|can you|should I|where is|when does|which one)\b/i,
];

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/;
const URL_PATTERN = /https?:\/\/\S+/;
const FILE_PATH_PATTERN = /(?:~\/|\.\/|\/[\w-]+\/)\S+\.\w+/;

const GREETING_PATTERNS = [
  /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|howdy|what'?s up)\b/i,
];

const ACK_PATTERNS = [
  /^(?:ok|okay|got it|thanks|thank you|sure|sounds good|perfect|great|nice|cool|understood|alright|yep|yes|no problem|will do)[\s,.!]*$/i,
  /^(?:thanks|thank you|ok|okay|got it)[,.]?\s*(?:got it|thanks|thank you|sounds good|perfect|great|will do)[\s.!]*$/i,
];

function textOf(chunk: Chunk): string {
  return chunk.messages.map((m) => m.content).join("\n");
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function score(
  chunk: Chunk,
  options: ScorerOptions = {},
): ScoredChunk {
  const { criticalThreshold = 0.7, contextThreshold = 0.3 } = options;
  const text = textOf(chunk);
  const signals: string[] = [];
  let raw = 0;

  // Critical signals — each alone should reach critical threshold
  if (matchesAny(text, DECISION_PATTERNS)) {
    signals.push("decision");
    raw += 0.75;
  }
  if (matchesAny(text, INSTRUCTION_PATTERNS)) {
    signals.push("instruction");
    raw += 0.7;
  }
  if (matchesAny(text, ERROR_RESOLUTION_PATTERNS)) {
    signals.push("error_resolution");
    raw += 0.75;
  }

  // Context signals — each alone should reach context threshold
  if (CODE_BLOCK_PATTERN.test(text)) {
    signals.push("has_code");
    raw += 0.5;
  }
  if (matchesAny(text, QUESTION_PATTERNS)) {
    signals.push("has_question");
    raw += 0.35;
  }
  if (URL_PATTERN.test(text) || FILE_PATH_PATTERN.test(text)) {
    signals.push("has_reference");
    raw += 0.35;
  }

  // Ambient signals (negative)
  if (matchesAny(text, GREETING_PATTERNS) && text.length < 100) {
    signals.push("greeting");
    raw -= 0.5;
  }
  if (matchesAny(text, ACK_PATTERNS)) {
    signals.push("acknowledgment");
    raw -= 0.6;
  }

  // Fallback signal if nothing matched
  if (signals.length === 0) {
    signals.push("neutral");
    raw = 0.5;
  }

  const finalScore = Math.max(0, Math.min(1, raw));

  let tier: ImportanceTier;
  if (finalScore >= criticalThreshold) {
    tier = "critical";
  } else if (finalScore >= contextThreshold) {
    tier = "context";
  } else {
    tier = "ambient";
  }

  return {
    ...chunk,
    tier,
    score: finalScore,
    signals,
  };
}
