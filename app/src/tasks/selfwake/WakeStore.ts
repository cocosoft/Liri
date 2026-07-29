/**
 * WakeStore — JSON 文件持久化的唤醒存储
 *
 * P0-1: 对标 openworker WakeStore — pending→due→fired 状态机。
 * 文件路径：~/.pyapp/data/selfwake/{sessionId}.json
 *
 * 并发安全：内部维护 Map<sessionId, Mutex>，确保同一文件读→改→写原子化。
 * markFired() 使用读-改-写三步（锁定 → 读取 → 修改 → 写入 → 解锁）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import type { WakeEntry } from './types';
import { cg3DataDir } from '../cg3Env';

export class WakeStore {
  private dir: string;
  /** 文件级并发锁：防止 CronScheduler.extra_tick 和 Agent sleep_for 同时写同一个文件 */
  private fileMutex = new Map<string, Promise<void>>();
  /** wakeId → sessionId 内存索引（用于 markFired 快速定位文件） */
  private wakeToSession = new Map<string, string>();

  constructor() {
    this.dir = cg3DataDir('selfwake');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  /** 获取文件锁，确保 read→modify→write 原子化 */
  private async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.fileMutex.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this.fileMutex.set(sessionId, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private filePath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  async save(sessionId: string, entries: WakeEntry[]): Promise<void> {
    return this.withLock(sessionId, async () => {
      writeFileSync(this.filePath(sessionId), JSON.stringify(entries, null, 2));
      for (const e of entries) {
        this.wakeToSession.set(e.id, sessionId);
      }
    });
  }

  async load(sessionId: string): Promise<WakeEntry[]> {
    return this.withLock(sessionId, async () => {
      const path = this.filePath(sessionId);
      if (!existsSync(path)) return [];
      return JSON.parse(readFileSync(path, 'utf-8'));
    });
  }

  /** 原子标记 fired：读→改→写 */
  async markFired(wakeId: string): Promise<void> {
    const sid = this.wakeToSession.get(wakeId);
    if (!sid) return;
    await this.withLock(sid, async () => {
      const path = this.filePath(sid);
      if (!existsSync(path)) return;
      const entries: WakeEntry[] = JSON.parse(readFileSync(path, 'utf-8'));
      const idx = entries.findIndex(e => e.id === wakeId);
      if (idx >= 0) {
        entries[idx].status = 'fired';
        entries[idx].firedAt = Date.now();
        writeFileSync(path, JSON.stringify(entries, null, 2));
      }
    });
  }

  /** 获取所有 pending/due 状态的唤醒条目 */
  async getAllPending(): Promise<WakeEntry[]> {
    const results: WakeEntry[] = [];
    const files = existsSync(this.dir) ? readdirSync(this.dir).filter(f => f.endsWith('.json')) : [];
    for (const f of files) {
      const sid = basename(f, '.json');
      const entries = await this.load(sid);
      for (const e of entries) {
        if (e.status === 'pending' || e.status === 'due') {
          results.push(e);
        }
      }
    }
    return results;
  }

  /** 获取到期的唤醒条目 */
  async getDueWakes(): Promise<WakeEntry[]> {
    const results: WakeEntry[] = [];
    const files = existsSync(this.dir) ? readdirSync(this.dir).filter(f => f.endsWith('.json')) : [];
    for (const f of files) {
      const sid = basename(f, '.json');
      const entries = await this.load(sid);
      for (const e of entries) {
        if ((e.status === 'pending' || e.status === 'due') && e.triggerAt && e.triggerAt <= Date.now()) {
          results.push(e);
        }
      }
    }
    return results;
  }

  /** 清理 fired 超过 maxAgeMs 的条目 */
  async gc(maxAgeMs = 24 * 3600_000): Promise<number> {
    let cleaned = 0;
    const cutoff = Date.now() - maxAgeMs;
    const files = existsSync(this.dir) ? readdirSync(this.dir).filter(f => f.endsWith('.json')) : [];
    for (const f of files) {
      const sid = basename(f, '.json');
      await this.withLock(sid, async () => {
        const path = this.filePath(sid);
        if (!existsSync(path)) return;
        const entries: WakeEntry[] = JSON.parse(readFileSync(path, 'utf-8'));
        const kept = entries.filter(e => e.status !== 'fired' || (e.firedAt && e.firedAt > cutoff));
        if (kept.length < entries.length) {
          cleaned += entries.length - kept.length;
          if (kept.length === 0) {
            unlinkSync(path);
            for (const e of entries) this.wakeToSession.delete(e.id);
          } else {
            writeFileSync(path, JSON.stringify(kept, null, 2));
          }
        }
      });
    }
    return cleaned;
  }

  /** 获取 wakeId 对应的 sessionId */
  getSessionFor(wakeId: string): string | undefined {
    return this.wakeToSession.get(wakeId);
  }
}
