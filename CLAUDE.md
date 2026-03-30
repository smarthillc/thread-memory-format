# TMF Development Guide

## Commands
- `pnpm test` — run all 116 tests (vitest)
- `pnpm type-check` — tsc --build across all packages
- `pnpm build` — tsup build for all 3 packages
- `pnpm test:watch` — vitest in watch mode
- `pnpm test:coverage` — coverage report

## Architecture
Three packages in `packages/`:
- `core` (@tmf/core) — pure compression engine, zero I/O, zero network
- `storage` (@tmf/storage) — pluggable storage adapters
- `mcp-server` (@tmf/mcp-server) — MCP tools wrapping core + storage

## Key Rules
- Core package MUST remain pure — no I/O, no network, no filesystem
- All public functions in core are async (to support optional LLM summarizer)
- Every new function gets tests before or alongside implementation
- Use Zod schemas for external input validation (serializer + MCP boundaries)
- Tests use vitest. Property-based tests use fast-check with async properties.
- The workspace uses aliases in vitest.config.ts to resolve @tmf/* packages to source

## Test Structure
- Unit tests: `packages/*/\__tests__/*.test.ts` (blocking CI)
- Property tests: `properties.test.ts` (blocking CI)
- Round-trip: `roundtrip.test.ts` (blocking CI)
- Quality/benchmarks/cross-model: informational, don't block CI
- Storage adapters use a shared parameterized test suite in `adapter-suite.ts`

## Compression Pipeline
Messages → chunk() → score() → detect() → compressThread() → serialize()
- chunk: groups by turn boundaries
- score: heuristic importance (critical/context/ambient)
- detect: TF-IDF + entity Jaccard similarity + agglomerative clustering
- compressThread: extractive (default) or LLM summarizer (optional)
- serialize: gzipped JSON with Zod validation
