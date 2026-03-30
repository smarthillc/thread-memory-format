import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adapterTestSuite } from "./adapter-suite.js";
import { LocalAdapter } from "../src/local.js";

adapterTestSuite("local", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmf-test-"));
  return {
    adapter: new LocalAdapter(dir),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
});
