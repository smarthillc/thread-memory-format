import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { StorageAdapter } from "../src/types.js";

export function adapterTestSuite(
  name: string,
  factory: () => Promise<{ adapter: StorageAdapter; cleanup: () => Promise<void> }>,
) {
  describe(`StorageAdapter: ${name}`, () => {
    let adapter: StorageAdapter;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const result = await factory();
      adapter = result.adapter;
      cleanup = result.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    it("write → read round-trip", async () => {
      const data = Buffer.from("hello world");
      await adapter.write("test-1", data);
      const result = await adapter.read("test-1");
      expect(Buffer.compare(result, data)).toBe(0);
    });

    it("list returns written IDs", async () => {
      await adapter.write("alpha", Buffer.from("a"));
      await adapter.write("beta", Buffer.from("b"));
      const ids = await adapter.list();
      expect(ids).toContain("alpha");
      expect(ids).toContain("beta");
    });

    it("delete removes entry", async () => {
      await adapter.write("to-delete", Buffer.from("x"));
      await adapter.delete("to-delete");
      const exists = await adapter.exists("to-delete");
      expect(exists).toBe(false);
    });

    it("exists returns true for existing items", async () => {
      await adapter.write("exists-test", Buffer.from("y"));
      expect(await adapter.exists("exists-test")).toBe(true);
    });

    it("exists returns false for non-existing items", async () => {
      expect(await adapter.exists("nope")).toBe(false);
    });

    it("read throws for non-existent items", async () => {
      await expect(adapter.read("missing")).rejects.toThrow(/not found/i);
    });

    it("overwrite on duplicate ID", async () => {
      await adapter.write("dup", Buffer.from("first"));
      await adapter.write("dup", Buffer.from("second"));
      const result = await adapter.read("dup");
      expect(result.toString()).toBe("second");
    });

    it("concurrent writes don't corrupt data", async () => {
      const writes = Array.from({ length: 10 }, (_, i) =>
        adapter.write(`concurrent-${i}`, Buffer.from(`data-${i}`)),
      );
      await Promise.all(writes);

      for (let i = 0; i < 10; i++) {
        const result = await adapter.read(`concurrent-${i}`);
        expect(result.toString()).toBe(`data-${i}`);
      }
    });

    it("handles large blobs (1MB)", async () => {
      const large = Buffer.alloc(1024 * 1024, 0xab);
      await adapter.write("large", large);
      const result = await adapter.read("large");
      expect(result.length).toBe(large.length);
      expect(Buffer.compare(result, large)).toBe(0);
    });
  });
}
