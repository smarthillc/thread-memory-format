import type { StorageAdapter } from "./types.js";

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, Buffer>();

  async write(id: string, data: Buffer): Promise<void> {
    this.store.set(id, Buffer.from(data));
  }

  async read(id: string): Promise<Buffer> {
    const data = this.store.get(id);
    if (!data) {
      throw new Error(`TMF Storage: item "${id}" not found`);
    }
    return Buffer.from(data);
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) {
      throw new Error(`TMF Storage: item "${id}" not found`);
    }
    this.store.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }
}
