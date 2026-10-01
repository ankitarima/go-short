import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Where uploaded files (QR logos) live. Only this interface is used by the app, so S3 / MinIO / R2 /
 * Spaces adapters can be added later without touching callers.
 */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Keys under a prefix with their last-modified time (used by cleanup jobs). */
  list(prefix: string): Promise<Array<{ key: string; modifiedAt: Date }>>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/** Keys are validated, never joined blindly: no `..`, no absolute paths, no escaping the base directory. */
export class LocalStorageProvider implements StorageProvider {
  private readonly base: string;
  constructor(basePath: string) {
    this.base = resolve(basePath);
  }

  private path(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//'))
      throw new Error('Invalid storage key');
    const p = resolve(join(this.base, key));
    if (!p.startsWith(this.base + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async list(prefix: string): Promise<Array<{ key: string; modifiedAt: Date }>> {
    const { readdir } = await import('node:fs/promises');
    const out: Array<{ key: string; modifiedAt: Date }> = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(join(dir, e.name), childRel);
        else out.push({ key: childRel, modifiedAt: (await stat(join(dir, e.name))).mtime });
      }
    };
    const start = this.path(prefix.replace(/\/$/, ''));
    await walk(start, prefix.replace(/\/$/, ''));
    return out;
  }
}
