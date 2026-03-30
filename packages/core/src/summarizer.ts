import type { ImportanceTier, Summarizer } from "./types.js";

/**
 * Creates a Claude API-based summarizer.
 * Requires ANTHROPIC_API_KEY in environment.
 */
export function createClaudeSummarizer(options?: {
  apiKey?: string;
  model?: string;
}): Summarizer {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = options?.model ?? "claude-haiku-4-5-20251001";

  if (!apiKey) {
    throw new Error("TMF: ANTHROPIC_API_KEY required for Claude summarizer");
  }

  return async (text: string, tier: ImportanceTier): Promise<string> => {
    const maxBullets = tier === "critical" ? 7 : tier === "context" ? 4 : 2;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `You are compressing conversation fragments for storage. This is an excerpt from a larger conversation between a user and an AI assistant. Even if short, extract what you can.

Summarize into ${maxBullets} bullet points or fewer. Each bullet should be a standalone fact. Focus on:
- Decisions made (tools, libraries, approaches chosen)
- Technical specifics (names, versions, URLs, numbers, commands)
- Action items or next steps
- Unresolved questions

If the excerpt is very short, just extract the key facts as bullets. Never say you need more context — just summarize what's there.

Excerpt:
${text}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`TMF Claude API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const result = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    return result;
  };
}
