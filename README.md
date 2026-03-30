# Thread Memory Format (TMF)

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Stateless compression pipeline for AI conversation memory. You compress your conversations, you store them wherever you want.

## The problem

AI conversation history is siloed, model-specific, and provider-controlled. Switch providers and your context is gone. Hit a token limit and the model forgets everything. There is no portable format for what actually matters in a conversation -- the decisions, the facts, the open questions.

TMF fixes this. It compresses conversations into a portable `.tmf` blob that you own and store however you want. No vendor lock-in. No cloud dependency. Just structured memory you control.

## How it works

```
Messages --> Chunk --> Score --> Thread --> Compress --> .tmf blob --> Your Storage
                                                          |
                                                    [Claude summarizer]
                                                       (optional)
```

1. **Chunk** -- Groups messages into logical exchange units
2. **Score** -- Assigns importance tiers: `critical`, `context`, `ambient`
3. **Thread** -- Detects topic threads across chunks
4. **Compress** -- Extracts key facts, decisions, entities, open questions per thread
5. **Serialize** -- Packs into a compact binary `.tmf` blob
6. **Store** -- Write it wherever you want (local FS, S3, your own DB)

## Quick start

```bash
pnpm add @tmf/core
```

```typescript
import { compress, decompress } from "@tmf/core";

const messages = [
  { role: "user", content: "We should use Postgres for the database." },
  { role: "assistant", content: "Good call. I'll set up the schema with pgvector for embeddings." },
  { role: "user", content: "Add a users table and a documents table." },
  { role: "assistant", content: "Done. Users has id, email, created_at. Documents has id, user_id, content, embedding." },
];

// Compress
const blob = await compress(messages);
console.log(blob.metadata.compressionRatio); // e.g. 3.2x

// Decompress -- get structured context back
const context = decompress(blob);
// Returns system messages with key facts, decisions, entities per thread

// Filter by importance
const critical = decompress(blob, { tierFilter: ["critical"] });

// Cap token budget
const budget = decompress(blob, { maxTokens: 500 });
```

## Claude summarizer (optional)

For higher-quality compression, plug in the Claude summarizer. It uses Claude Haiku to generate summaries instead of the built-in extractive approach.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

```typescript
import { compress, createClaudeSummarizer } from "@tmf/core";

const summarizer = createClaudeSummarizer();
const blob = await compress(messages, { summarizer });
```

You can also pass a specific model or API key directly:

```typescript
const summarizer = createClaudeSummarizer({
  apiKey: "sk-ant-...",
  model: "claude-haiku-4-5-20251001",
});
```

## MCP server

TMF ships an MCP server so Claude Desktop (or any MCP client) can compress and recall conversations directly.

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tmf": {
      "command": "npx",
      "args": ["@tmf/mcp-server"]
    }
  }
}
```

The server exposes four tools:

| Tool | Description |
|------|-------------|
| `tmf_compress` | Compress messages into a `.tmf` blob |
| `tmf_decompress` | Decompress a blob back into context messages |
| `tmf_revise` | Append new messages to an existing blob |
| `tmf_thread_status` | Inspect threads, tiers, and compression stats |

Blobs are stored locally at `~/.tmf/storage/` by default.

## Storage adapters

TMF separates compression from storage. The `@tmf/storage` package provides adapters:

```typescript
import { LocalAdapter, MemoryAdapter } from "@tmf/storage";
import { serialize, deserialize } from "@tmf/core";

// Local filesystem (default for MCP server)
const local = new LocalAdapter("/path/to/storage");

// In-memory (testing)
const memory = new MemoryAdapter();

// Write/read
const buffer = serialize(blob);
await local.write("conversation-123", buffer);
const loaded = deserialize(await local.read("conversation-123"));
```

Bring your own adapter by implementing the `StorageAdapter` interface:

```typescript
import type { StorageAdapter } from "@tmf/storage";

class S3Adapter implements StorageAdapter {
  async write(id: string, data: Buffer): Promise<void> { /* ... */ }
  async read(id: string): Promise<Buffer> { /* ... */ }
  async list(): Promise<string[]> { /* ... */ }
  async delete(id: string): Promise<void> { /* ... */ }
  async exists(id: string): Promise<boolean> { /* ... */ }
}
```

## Architecture

```
packages/
  core/        @tmf/core       Compression engine (chunk, score, detect, compress, serialize)
  storage/     @tmf/storage    Pluggable storage adapters (local FS, in-memory)
  mcp-server/  @tmf/mcp-server MCP tools for Claude Desktop integration
```

- **Zero runtime dependencies** in core (only zod for schema validation)
- **Stateless pipeline** -- compress and decompress are pure functions (no DB, no server)
- **Binary format** -- `.tmf` blobs are compact serialized buffers
- **Tiered importance** -- `critical` / `context` / `ambient` lets you control what gets recalled
- **Revisable** -- append new messages to an existing blob without full recompression

## Contributing

```bash
git clone https://github.com/smarthillc/thread-memory-format.git
cd thread-memory-format
pnpm install
pnpm test        # vitest, 116 tests
pnpm type-check  # tsc --build
pnpm build       # tsup across all packages
```

PRs welcome. Keep tests passing, keep types clean.

## License

[MIT](LICENSE) -- SmartHill LLC
