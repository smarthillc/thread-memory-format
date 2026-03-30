import { adapterTestSuite } from "./adapter-suite.js";
import { MemoryAdapter } from "../src/memory.js";

adapterTestSuite("memory", async () => ({
  adapter: new MemoryAdapter(),
  cleanup: async () => {},
}));
