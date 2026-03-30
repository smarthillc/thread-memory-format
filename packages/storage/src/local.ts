import { readFile, writeFile, readdir, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import type { StorageAdapter } from "./types.js";

export class LocalAdapter implements StorageAdapter {
  constructor(private directory: string) {}

  private path(id: string): string {
    // Sanitize id to prevent path traversal
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.directory, `${safe}.tmf`);
  }

  async write(id: string, data: Buffer): Promise<void> {
    await writeFile(this.path(id), data);
  }

  async read(id: string): Promise<Buffer> {
    try {
      return await readFile(this.path(id));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`TMF Storage: item "${id}" not found`);
      }
      throw err;
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.directory);
      return files
        .filter((f) => f.endsWith(".tmf"))
        .map((f) => f.replace(/\.tmf$/, ""));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.path(id));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`TMF Storage: item "${id}" not found`);
      }
      throw err;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      await access(this.path(id));
      return true;
    } catch {
      return false;
    }
  }
}
