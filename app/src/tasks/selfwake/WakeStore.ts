/**
 * WakeStore — JSON 文件持久化的唤醒存储
 *
 * P0-1: 对标 openworker WakeStore — pending→due→fired 状态机。
 * 文件路径：~/.pyapp/data/selfwake/{sessionId}.json
 *
 * 并发安全：内部维护 Map<sessionId, Mutex>，确保同一文件读→改→写原子化。
 * markFired() 使用读-改-写三步（锁定 → 读取 → 修改 → 写入 → 解锁）。
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join, basename } from 'path';
import type { WakeEntry } from './types';
import { cg3DataDir, cg3Log } from '../cg3Env';
import { handleError } from '@openliri/infra/error';
// P2-1（2026-11-24，R09-013）：自唤醒状态转移落 `state/transition` 审计
import { emitStateTransitionAudit } from '@openliri/infra/state/engine/stateTransitionAudit';

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
  private async withLock<T>(
    sessionId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const prev = this.fileMutex.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    this.fileMutex.set(
      sessionId,
      prev.then(
        () => next,
        () => next
      )
    );
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
      try {
        writeFileSync(
          this.filePath(sessionId),
          JSON.stringify(entries, null, 2)
        );
        for (const e of entries) {
          this.wakeToSession.set(e.id, sessionId);
        }
      } catch (err) {
        handleError(err, { module: 'tasks:selfwake', action: 'saveWake' });
        throw err;
      }
    });
  }

  async load(sessionId: string): Promise<WakeEntry[]> {
    return this.withLock(sessionId, async () => {
      try {
        const path = this.filePath(sessionId);
        if (!existsSync(path)) return [];
        return JSON.parse(readFileSync(path, 'utf-8'));
      } catch (err) {
        handleError(err, { module: 'tasks:selfwake', action: 'loadWake' });
        return [];
      }
    });
  }

  /**
   * 从磁盘重建 `wakeId → sessionId` 内存索引。
   *
   * 为什么需要（台账 L-13 / `.trae/specs/selfwake-restart-recovery.md`）：`wakeToSession`
   * 仅由 `save()` 填充，**重启后为空** ⇒ `markFired`/`SelfWakeService._findEntry` 反查失败
   * ⇒ 到期唤醒**既不续跑、也不落 `fired`**（每 tick 空转）。该信息本就在磁盘文件名
   * （`{sessionId}.json`）里 ⇒ 可无损重建。
   */
  async rebuildIndex(): Promise<void> {
    if (!existsSync(this.dir)) return;
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const sid = basename(f, '.json');
      const entries = await this.load(sid);
      for (const e of entries) this.wakeToSession.set(e.id, sid);
    }
  }

  /** 解析 wakeId → sessionId；内存索引未命中时**先从磁盘重建**再试。 */
  private async resolveSessionId(wakeId: string): Promise<string | undefined> {
    const cached = this.wakeToSession.get(wakeId);
    if (cached) return cached;
    await this.rebuildIndex();
    return this.wakeToSession.get(wakeId);
  }

  /**
   * 在文件锁内对**单条**唤醒项做读-改-写（`changed !== false` 才落盘）。
   *
   * 未命中（索引/文件/条目任一缺失）⇒ `null`；读写异常 ⇒ `handleError` 后 `null`。
   * 抽出的原因：批次 2 新增 `tryMarkFiring` / `requeueAfterFailure` / `markFired`
   * 三处都是同一形态，避免各自复制锁与异常处理。
   */
  private async updateEntry<T>(
    wakeId: string,
    fn: (entry: WakeEntry) => { value: T; changed?: boolean }
  ): Promise<T | null> {
    const sid = await this.resolveSessionId(wakeId);
    if (!sid) return null;
    const sessionId: string = sid;
    try {
      return await this.withLock(sessionId, async () => {
        const path = this.filePath(sessionId);
        if (!existsSync(path)) return null;
        const entries: WakeEntry[] = JSON.parse(readFileSync(path, 'utf-8'));
        const entry = entries.find((e) => e.id === wakeId);
        if (!entry) return null;
        const before = entry.status;
        const { value, changed } = fn(entry);
        if (changed !== false)
          writeFileSync(path, JSON.stringify(entries, null, 2));
        // P2-1（R09-013）：**一次转移一处审计** —— 所有单条变更都经本函数，
        // 故在此统一按"写前/写后状态差异"落事件（未变更不落）。
        if (entry.status !== before) {
          emitStateTransitionAudit(sessionId, {
            machine: 'selfWake',
            from: before,
            to: entry.status,
            reason: 'wake_store_update',
            subjectId: wakeId,
          });
        }
        return value;
      });
    } catch (err) {
      await handleError(err, {
        module: 'tasks:selfwake',
        action: 'updateWakeEntry',
        context: { wakeId },
      });
      return null;
    }
  }

  /** 原子标记 fired：读→改→写（幂等：已是 fired 则不重复写） */
  async markFired(wakeId: string): Promise<void> {
    await this.updateEntry(wakeId, (entry) => {
      if (entry.status === 'fired') return { value: undefined, changed: false };
      entry.status = 'fired';
      entry.firedAt = Date.now();
      return { value: undefined };
    });
  }

  /**
   * 2026-11-24（批次 2 / A3）：CAS 抢锁 `pending|due → firing`。
   *
   * 为什么必须 CAS：同一到期条目会被 **cron tick 重扫**与**短时 timer** 两条路径同时
   * `fire()` ⇒ 双续跑（会话被推进两轮）。只有抢到 `firing` 的一方继续；其余返回 `busy`。
   *
   * 顺带收口"已到期"的条目：`expiresAt <= now` ⇒ 直接置 `expired`（不续跑）。
   */
  async tryMarkFiring(
    wakeId: string
  ): Promise<'acquired' | 'busy' | 'not_pending' | 'missing'> {
    const result = await this.updateEntry(wakeId, (entry) => {
      if (entry.status === 'firing')
        return { value: 'busy' as const, changed: false };
      if (entry.status !== 'pending' && entry.status !== 'due')
        return { value: 'not_pending' as const, changed: false };
      const now = Date.now();
      if (typeof entry.expiresAt === 'number' && entry.expiresAt <= now) {
        entry.status = 'expired';
        entry.expiredAt = now;
        return { value: 'not_pending' as const };
      }
      entry.status = 'firing';
      entry.firingAt = now;
      return { value: 'acquired' as const };
    });
    return result ?? 'missing';
  }

  /**
   * 2026-11-24（批次 2 / A3）：续跑失败 ⇒ `firing → pending`（`attempts+1`）；
   * 达到 `maxAttempts` ⇒ 转 `failed`（不再无限重试，`lastError` 可查）。
   *
   * 只有仍处于 `firing`（本次抢锁方持有）才生效 ⇒ 不会覆盖别人已推进的状态。
   */
  async requeueAfterFailure(
    wakeId: string,
    error: string,
    maxAttempts = 3
  ): Promise<'pending' | 'failed' | 'missing' | 'ignored'> {
    const result = await this.updateEntry(wakeId, (entry) => {
      if (entry.status !== 'firing')
        return { value: 'ignored' as const, changed: false };
      const attempts = (entry.attempts ?? 0) + 1;
      entry.attempts = attempts;
      entry.lastError = error;
      delete entry.firingAt;
      if (attempts >= maxAttempts) {
        entry.status = 'failed';
        entry.failedAt = Date.now();
        return { value: 'failed' as const };
      }
      entry.status = 'pending';
      return { value: 'pending' as const };
    });
    return result ?? 'missing';
  }

  /**
   * 2026-11-24（批次 2 / A3）：把 `pending|due` 且 `expiresAt` 已过的条目置 `expired`（返回条数）。
   *
   * 只对**外部条件类**（`completion` / `event`）写入 `expiresAt`：它们没有 `triggerAt`，
   * 触发源缺失时永不 due —— 过期扫描是它们唯一的收敛路径。
   */
  async expireStale(now = Date.now()): Promise<number> {
    let expired = 0;
    const files = existsSync(this.dir)
      ? readdirSync(this.dir).filter((f) => f.endsWith('.json'))
      : [];
    for (const f of files) {
      const sid = basename(f, '.json');
      await this.withLock(sid, async () => {
        try {
          const path = this.filePath(sid);
          if (!existsSync(path)) return;
          const entries: WakeEntry[] = JSON.parse(readFileSync(path, 'utf-8'));
          let changed = false;
          for (const e of entries) {
            if (
              (e.status === 'pending' || e.status === 'due') &&
              typeof e.expiresAt === 'number' &&
              e.expiresAt <= now
            ) {
              const from = e.status;
              e.status = 'expired';
              e.expiredAt = now;
              expired += 1;
              changed = true;
              // P2-1（R09-013）：批量扫描不经 `updateEntry` ⇒ 在此按条落审计。
              emitStateTransitionAudit(sid, {
                machine: 'selfWake',
                from,
                to: 'expired',
                reason: 'wake_expired',
                subjectId: e.id,
              });
            }
          }
          if (changed) writeFileSync(path, JSON.stringify(entries, null, 2));
        } catch (err) {
          await handleError(err, {
            module: 'tasks:selfwake',
            action: 'expireStaleWakes',
            context: { sessionId: sid },
          });
        }
      });
    }
    return expired;
  }

  /**
   * 2026-11-24（批次 2 / A3）：启动期把崩溃残留的 `firing` 复位为 `pending`（返回条数）。
   *
   * 单进程假定：`firing` 只可能由**本进程**持有；进程重启后残留者必然不会再被推进，
   * 若不复位就永远停在中间态（既不续跑、也不在等待投影里）—— 与 Inbox `processing` 同构。
   */
  async recoverStaleFiring(): Promise<number> {
    let recovered = 0;
    const files = existsSync(this.dir)
      ? readdirSync(this.dir).filter((f) => f.endsWith('.json'))
      : [];
    for (const f of files) {
      const sid = basename(f, '.json');
      await this.withLock(sid, async () => {
        try {
          const path = this.filePath(sid);
          if (!existsSync(path)) return;
          const entries: WakeEntry[] = JSON.parse(readFileSync(path, 'utf-8'));
          let changed = false;
          for (const e of entries) {
            if (e.status === 'firing') {
              e.status = 'pending';
              delete e.firingAt;
              recovered += 1;
              changed = true;
              // P2-1（R09-013）：启动期复位同样是一次真实转移（firing → pending）。
              emitStateTransitionAudit(sid, {
                machine: 'selfWake',
                from: 'firing',
                to: 'pending',
                reason: 'startup_recover_firing',
                subjectId: e.id,
              });
            }
          }
          if (changed) writeFileSync(path, JSON.stringify(entries, null, 2));
        } catch (err) {
          await handleError(err, {
            module: 'tasks:selfwake',
            action: 'recoverStaleFiringWakes',
            context: { sessionId: sid },
          });
        }
      });
    }
    return recovered;
  }

  /** 获取所有 pending/due 状态的唤醒条目 */
  async getAllPending(): Promise<WakeEntry[]> {
    const results: WakeEntry[] = [];
    const files = existsSync(this.dir)
      ? readdirSync(this.dir).filter((f) => f.endsWith('.json'))
      : [];
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
    const files = existsSync(this.dir)
      ? readdirSync(this.dir).filter((f) => f.endsWith('.json'))
      : [];
    for (const f of files) {
      const sid = basename(f, '.json');
      const entries = await this.load(sid);
      for (const e of entries) {
        if (
          (e.status === 'pending' || e.status === 'due') &&
          e.triggerAt &&
          e.triggerAt <= Date.now()
        ) {
          results.push(e);
        }
      }
    }
    return results;
  }

  /** 清理**终态**（`fired` / `failed` / `expired`）超过 maxAgeMs 的条目 */
  async gc(maxAgeMs = 24 * 3600_000): Promise<number> {
    let cleaned = 0;
    const cutoff = Date.now() - maxAgeMs;
    /** 终态进入时刻（批次 2 新增 `failed`/`expired` 后按各自时间戳裁剪） */
    const terminalAt = (e: WakeEntry): number =>
      e.firedAt ?? e.failedAt ?? e.expiredAt ?? 0;
    const isTerminal = (e: WakeEntry): boolean =>
      e.status === 'fired' || e.status === 'failed' || e.status === 'expired';
    const files = existsSync(this.dir)
      ? readdirSync(this.dir).filter((f) => f.endsWith('.json'))
      : [];
    for (const f of files) {
      const sid = basename(f, '.json');
      await this.withLock(sid, async () => {
        try {
          const path = this.filePath(sid);
          if (!existsSync(path)) return;
          const entries: WakeEntry[] = JSON.parse(readFileSync(path, 'utf-8'));
          const kept = entries.filter(
            (e) => !isTerminal(e) || terminalAt(e) > cutoff
          );
          if (kept.length < entries.length) {
            cleaned += entries.length - kept.length;
            if (kept.length === 0) {
              unlinkSync(path);
              for (const e of entries) this.wakeToSession.delete(e.id);
            } else {
              writeFileSync(path, JSON.stringify(kept, null, 2));
            }
          }
        } catch (err) {
          handleError(err, { module: 'tasks:selfwake', action: 'gcWake' });
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
