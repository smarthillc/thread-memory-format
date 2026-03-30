export interface StorageAdapter {
  write(id: string, data: Buffer): Promise<void>;
  read(id: string): Promise<Buffer>;
  list(): Promise<string[]>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}
