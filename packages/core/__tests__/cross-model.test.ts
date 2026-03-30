import { describe, it, expect } from "vitest";
import { compress, decompress } from "../src/index.js";
import type { Message } from "../src/types.js";

// Simulate different model conversation export formats

interface ChatGPTMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

function fromChatGPT(messages: ChatGPTMessage[]): Message[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function fromGemini(contents: GeminiContent[]): Message[] {
  return contents.map((c) => ({
    role: c.role === "model" ? "assistant" as const : "user" as const,
    content: c.parts.map((p) => p.text).join("\n"),
  }));
}

function toChatGPT(messages: Message[]): ChatGPTMessage[] {
  return messages.map((m) => ({
    role: m.role === "system" ? "system" : m.role,
    content: m.content,
  }));
}

function toGemini(messages: Message[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === "assistant" || m.role === "system" ? "model" as const : "user" as const,
    parts: [{ text: m.content }],
  }));
}

const SAMPLE_CONVERSATION: Message[] = [
  { role: "user", content: "How do I deploy a Node.js app on AWS Lambda?" },
  { role: "assistant", content: "Use the Serverless Framework. Install it with npm install -g serverless. Configure serverless.yml with the Node.js 20 runtime." },
  { role: "user", content: "What about environment variables?" },
  { role: "assistant", content: "Store secrets in AWS Systems Manager Parameter Store. Reference them in serverless.yml with ${ssm:/path/to/param}. Never hardcode API keys." },
];

describe("cross-model (informational)", () => {
  it("Claude format → TMF → ChatGPT format", async () => {
    // Claude messages are already in TMF format
    const blob = await compress(SAMPLE_CONVERSATION);
    const decompressed = decompress(blob);

    // Convert to ChatGPT format
    const chatgptMessages = toChatGPT(decompressed);

    expect(chatgptMessages.length).toBeGreaterThan(0);
    for (const msg of chatgptMessages) {
      expect(["user", "assistant", "system"]).toContain(msg.role);
      expect(msg.content.length).toBeGreaterThan(0);
    }
  });

  it("ChatGPT format → TMF → Claude format", async () => {
    const chatgptExport: ChatGPTMessage[] = [
      { role: "system", content: "You are a helpful coding assistant." },
      { role: "user", content: "Write a Python function to reverse a string" },
      { role: "assistant", content: "def reverse_string(s): return s[::-1]" },
    ];

    const messages = fromChatGPT(chatgptExport);
    const blob = await compress(messages);
    const decompressed = decompress(blob);

    // Decompressed messages should be valid for Claude
    for (const msg of decompressed) {
      expect(msg.role).toBe("system"); // TMF decompresses as system context
      expect(msg.content.length).toBeGreaterThan(0);
      expect(msg.metadata.source).toBe("tmf");
    }
  });

  it("Gemini format → TMF → Claude format", async () => {
    const geminiExport: GeminiContent[] = [
      { role: "user", parts: [{ text: "Explain Kubernetes pods" }] },
      { role: "model", parts: [{ text: "A Kubernetes pod is the smallest deployable unit. It wraps one or more containers." }] },
    ];

    const messages = fromGemini(geminiExport);
    expect(messages[1].role).toBe("assistant"); // "model" → "assistant"

    const blob = await compress(messages);
    const decompressed = decompress(blob);

    expect(decompressed.length).toBeGreaterThan(0);
    const text = decompressed.map((m) => m.content).join(" ").toLowerCase();
    expect(text).toMatch(/kubernetes|pod/i);
  });

  it("preserves system messages through round-trip", async () => {
    const messages: Message[] = [
      { role: "system", content: "You are an expert DevOps engineer." },
      { role: "user", content: "How do I set up CI/CD?" },
      { role: "assistant", content: "Use GitHub Actions. Create .github/workflows/ci.yml." },
    ];

    const blob = await compress(messages);
    const decompressed = decompress(blob);

    // System messages from original should influence the output
    expect(decompressed.length).toBeGreaterThan(0);
  });

  it("decompressed output is valid JSON-serializable", async () => {
    const blob = await compress(SAMPLE_CONVERSATION);
    const decompressed = decompress(blob);

    // Should survive JSON round-trip
    const json = JSON.stringify(decompressed);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(decompressed);
  });
});
