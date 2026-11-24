/**
 * SelfWakeService — 自唤醒核心服务
 *
 * P0-1: 双层精度触发机制
 *   - 短时 Timer（< tickInterval）：setTimeout 精确触发
 *   - 长时 Timer（≥ tickInterval）：CronScheduler.extra_tick 批量扫描
 */
import { randomUUID } from 'crypto';
import type { WakeEntry } from './types';
import { WakeKind } from './types';
import { WakeStore } from './WakeStore';
import { recordSelfWake, type SelfWakeAuditOutcome } from './SelfWakeAudit';
// 2026-11-24（批次 2 / A3）：外部条件类唤醒 TTL 与重试上限（阈值集中 `defaults.ts`）
import { MAX_FIRE_ATTEMPTS, WAKE_EXTERNAL_TTL_MS } from './defaults';
import { cg3Log } from '../cg3Env';
import { handleError } from '@openliri/infra/error';

/**
 * 阶段 A（N-26 修复）：会话唤醒执行器
 *
 * 由装配处注入（`ChatManager` 懒装配时注册），避免本模块直接依赖 chat 层造成循环依赖。
 * `fire()` 在标记 fired 后调用它，让被唤醒的会话**真正继续执行**。
 */
export type SelfWakeResumeHandler = (params: {
  sessionId: string;
  wakeId: string;
  kind: WakeKind;
  taskId: string;
  reason: string;
}) => Promise<{ ok: boolean; error?: string }>;

let selfWakeResumeHandler: SelfWakeResumeHandler | null = null;

/** 注册唤醒执行器（装配处调用；传 null 可卸载） */
export function setSelfWakeResumeHandler(
  handler: SelfWakeResumeHandler | null
): void {
  selfWakeResumeHandler = handler;
}

/** 供测试与观测：当前是否已装配唤醒执行器 */
export function hasSelfWakeResumeHandler(): boolean {
  return selfWakeResumeHandler !== null;
}

export class SelfWakeService {
  private wakeStore: WakeStore;
  private tickIntervalMs: number;
  private shortTimers = new Map<string, NodeJS.Timeout>();

  constructor(wakeStore: WakeStore, tickIntervalMs = 300_000) {
    this.wakeStore = wakeStore;
    this.tickIntervalMs = tickIntervalMs;
  }

  /**
   * 合并写：把新条目**追加**到该会话既有条目之后（而非整文件覆盖）。
   *
   * 2026-09-27（等待态可见性，Spec `wait-state-visibility.md` D8）：原实现四处登记都是
   * `wakeStore.save(sessionId, [entry])`，而 `WakeStore.save` 直接 `writeFileSync(entries)`
   * ⇒ 同会话存在**未触发**条目时会被**静默丢弃**（丢唤醒）。改为 load → 追加 → save；
   * `WakeStore` 内部有按 sessionId 的文件级互斥，故读-改-写仍原子。
   */
  private async appendEntry(entry: WakeEntry): Promise<void> {
    const existing = await this.wakeStore.load(entry.sessionId);
    await this.wakeStore.save(entry.sessionId, [...existing, entry]);
  }

  /** Agent 挂起指定秒数 */
  async sleepFor(
    sessionId: string,
    taskId: string,
    seconds: number
  ): Promise<WakeEntry> {
    if (seconds > 86400) {
      throw new Error('sleep_for max is 24h (86400 seconds)');
    }

    const entry: WakeEntry = {
      id: randomUUID(),
      kind: WakeKind.TIMER,
      status: 'pending',
      sessionId,
      taskId,
      triggerAt: Date.now() + seconds * 1000,
      createdAt: Date.now(),
    };

    // 短时 Timer（< tickInterval）：直接 setTimeout 精确触发
    if (seconds * 1000 < this.tickIntervalMs) {
      const timer = setTimeout(() => {
        this.fire(entry.id).catch((err) => {
          handleError(err, {
            module: 'tasks:selfwake',
            action: 'shortTimerFire',
            context: { wakeId: entry.id },
          });
        });
      }, seconds * 1000);
      this.shortTimers.set(entry.id, timer);
    }

    await this.appendEntry(entry);
    cg3Log('tasks:selfwake', 'info', 'sleepFor', {
      sessionId,
      taskId,
      seconds,
      wakeId: entry.id,
      shortTimer: seconds * 1000 < this.tickIntervalMs,
    });
    return entry;
  }

  /** Agent 挂起到指定时间 */
  async sleepUntil(
    sessionId: string,
    taskId: string,
    whenIso: string
  ): Promise<WakeEntry> {
    const when = new Date(whenIso).getTime();
    if (isNaN(when)) throw new Error(`Invalid ISO datetime: ${whenIso}`);
    const seconds = Math.ceil((when - Date.now()) / 1000);
    if (seconds < 0) throw new Error('sleep_until must be in the future');
    return this.sleepFor(sessionId, taskId, seconds);
  }

  /** 等待后台任务完成 */
  async wakeOnJob(
    sessionId: string,
    taskId: string,
    jobId: string
  ): Promise<WakeEntry> {
    const entry: WakeEntry = {
      id: randomUUID(),
      kind: WakeKind.COMPLETION,
      status: 'pending',
      sessionId,
      taskId,
      jobId,
      createdAt: Date.now(),
      // 批次 2 / A3：无触发源时不再永久 pending（24h 后由 expireStale 收敛为 expired）
      expiresAt: Date.now() + WAKE_EXTERNAL_TTL_MS,
    };
    await this.appendEntry(entry);
    cg3Log('tasks:selfwake', 'info', 'wakeOnJob', {
      sessionId,
      taskId,
      jobId,
      wakeId: entry.id,
    });
    return entry;
  }

  /** 等待 connector 事件 */
  async wakeOnEvent(
    sessionId: string,
    taskId: string,
    eventKey: string
  ): Promise<WakeEntry> {
    const entry: WakeEntry = {
      id: randomUUID(),
      kind: WakeKind.EVENT,
      status: 'pending',
      sessionId,
      taskId,
      eventKey,
      createdAt: Date.now(),
      // 批次 2 / A3：同 `wakeOnJob` —— 事件永不到达时 24h 后收敛为 expired
      expiresAt: Date.now() + WAKE_EXTERNAL_TTL_MS,
    };
    await this.appendEntry(entry);
    cg3Log('tasks:selfwake', 'info', 'wakeOnEvent', {
      sessionId,
      taskId,
      eventKey,
      wakeId: entry.id,
    });
    return entry;
  }

  /**
   * 获取到期应唤醒的条目（由 CronScheduler.extra_tick 调用）。
   *
   * 批次 2 / A3：扫描前先收口 `expiresAt` 已过的条目 —— 这是 `completion` / `event`
   * **唯一**的收敛路径（它们没有 `triggerAt`，永远进不了 `getDueWakes` 的结果集）。
   */
  async getDueWakes(): Promise<WakeEntry[]> {
    const expired = await this.wakeStore.expireStale();
    if (expired > 0) {
      cg3Log('tasks:selfwake', 'info', 'expireStale', { count: expired });
    }
    return this.wakeStore.getDueWakes();
  }

  /**
   * 按会话取"待触发"（`pending` | `due`）条目，按 `triggerAt` 升序（无 `triggerAt` 排最后）。
   *
   * 2026-09-27（等待态可见性 Spec D1）：只读；供 `GET /v1/sessions/:id/streaming` 的
   * `pendingWake` 字段使用。成本 = 读该会话 1 个 JSON 文件（`WakeStore.load`）。
   */
  async getPendingBySession(sessionId: string): Promise<WakeEntry[]> {
    const entries = await this.wakeStore.load(sessionId);
    return entries
      .filter((e) => e.status === 'pending' || e.status === 'due')
      .sort((a, b) => (a.triggerAt ?? Infinity) - (b.triggerAt ?? Infinity));
  }

  /**
   * 启动期补偿：把**已过期但仍 `pending`** 的 `timer` 条目补触发一次（返回条数）。
   *
   * B（2026-11-19 真机根因）：`sleepFor(< tickInterval)` 只在**进程内**建 `setTimeout`，
   * 进程重启（含 `bun --watch` 热重载）后 timer 丢失，条目永远停在 `pending`
   * ⇒ `GET /v1/sessions/:id/streaming` 持续回 `pendingWake` ⇒ 前端「⏳ 等待中」常驻
   * （任务早已完成也照样显示）。
   *
   * **补触发**只认 `kind='timer'`：`completion` / `event` 等的是外部条件（job / connector
   * 事件），没有触发源就不该续跑；它们由 `expiresAt`（批次 2）在到期时收敛为 `expired`。
   * 是否真的续跑由执行器自行二次校验（`goal-startup` / `plan-startup` 均"陈旧即作废"），
   * 故补触发不会造成重复推进。
   */
  async recoverOverdueWakes(now = Date.now()): Promise<number> {
    // 批次 2 / A3：先把崩溃残留的 `firing` 复位（单进程假定，重启后无人会推进它），
    // 再收口 `expiresAt` 已过的条目 —— 两件都必须在"取待触发列表"之前完成，
    // 否则残留 `firing` 既不续跑、也不在等待投影里（永久中间态）。
    const resetFiring = await this.wakeStore.recoverStaleFiring();
    const expired = await this.wakeStore.expireStale(now);
    if (resetFiring > 0 || expired > 0) {
      cg3Log('tasks:selfwake', 'info', 'recoverNormalized', {
        resetFiring,
        expired,
      });
    }
    const all = await this.wakeStore.getAllPending();
    const overdue = all.filter(
      (e) =>
        e.kind === WakeKind.TIMER &&
        typeof e.triggerAt === 'number' &&
        e.triggerAt <= now
    );
    for (const e of overdue) {
      await this.fire(e.id);
    }
    if (overdue.length > 0) {
      cg3Log('tasks:selfwake', 'info', 'recoverOverdue', {
        count: overdue.length,
      });
    }
    return overdue.length;
  }

  /**
   * 启动期清理：删除 `fired` 超过 `maxAgeMs`（默认 24h）的条目，文件空了即删文件（返回条数）。
   *
   * C（2026-11-19）：`WakeStore.gc()` 此前**无调用点** ⇒ `selfwake/*.json` 无限堆积。
   */
  async collectGarbage(maxAgeMs?: number): Promise<number> {
    return this.wakeStore.gc(maxAgeMs);
  }

  /**
   * 触发一条唤醒并**真正唤醒会话**。
   *
   * 阶段 A（N-26）：原实现只 `markFired`（"空唤醒"）。本版（批次 2 / A3）改为
   * **先 CAS 抢锁 → 执行续跑 → 成功才落 `fired`**：
   *
   * - 修复前序「先 `markFired` 再续跑」⇒ 续跑失败也记为已唤醒，唤醒被**静默吞掉**
   *   （且 tick 不再重扫，没有第二次机会）。
   * - 现在失败回 `pending`（`attempts+1`），下次 tick 自动重试；累计 `MAX_FIRE_ATTEMPTS`
   *   次仍失败 ⇒ 转 `failed` 并留 `lastError`（不再无限重试，状态可观测）。
   * - 并发 `fire()`（cron tick 重扫 + 短时 timer）由 `tryMarkFiring` 的
   *   `pending|due → firing` CAS 互斥，只有一方能续跑。
   */
  async fire(wakeId: string): Promise<void> {
    // 清理短时 timer
    const timer = this.shortTimers.get(wakeId);
    if (timer) {
      clearTimeout(timer);
      this.shortTimers.delete(wakeId);
    }

    const entry = await this._findEntry(wakeId);
    if (!entry) {
      // 事件信封的 `sessionId` 必填，而此分支拿不到 `sessionId` ⇒ 无法落 `session/wake`
      // （见 `eventPayloads.ts` 的 `session/wake` 注释）；保持日志可观测。
      cg3Log('tasks:selfwake', 'warn', 'fire:entry_not_found', { wakeId });
      return;
    }
    if (
      entry.status === 'fired' ||
      entry.status === 'firing' ||
      entry.status === 'failed' ||
      entry.status === 'expired'
    ) {
      // 幂等 / 终态：已触发过、正在触发、或已失败/过期 ⇒ 不再续跑
      cg3Log('tasks:selfwake', 'info', 'fire:skipped_terminal', {
        wakeId,
        status: entry.status,
      });
      return;
    }

    // CAS 抢锁：并发 fire（tick 重扫 + 短时 timer）只允许一方继续
    const acquired = await this.wakeStore.tryMarkFiring(wakeId);
    if (acquired !== 'acquired') {
      cg3Log('tasks:selfwake', 'info', 'fire:cas_skipped', {
        wakeId,
        result: acquired,
      });
      return;
    }

    if (!selfWakeResumeHandler) {
      cg3Log('tasks:selfwake', 'warn', 'fire:resume_handler_absent', {
        wakeId,
        sessionId: entry.sessionId,
        kind: entry.kind,
      });
      // T-⑥12：可判定节点入事件（log-only 审计，可回放）——"发出但无人接"同样要留痕
      await this._requeueAfterFailure(
        wakeId,
        entry,
        'resume handler absent',
        'handler_absent'
      );
      return;
    }

    try {
      const res = await selfWakeResumeHandler({
        sessionId: entry.sessionId,
        wakeId,
        kind: entry.kind,
        taskId: entry.taskId,
        reason: `selfwake:${entry.kind}`,
      });
      if (!res.ok) {
        const error = res.error ?? 'unknown';
        cg3Log('tasks:selfwake', 'warn', 'fire:resume_failed', {
          wakeId,
          sessionId: entry.sessionId,
          error,
        });
        await this._requeueAfterFailure(wakeId, entry, error, 'resume_failed');
        return;
      }

      // 续跑成功后才落终态（顺序不可颠倒：先 fired 会让失败唤回被静默吞掉）
      await this.wakeStore.markFired(wakeId);
      cg3Log('tasks:selfwake', 'info', 'fire:resumed', {
        wakeId,
        sessionId: entry.sessionId,
        kind: entry.kind,
      });
      await recordSelfWake({
        sessionId: entry.sessionId,
        wakeId,
        kind: entry.kind,
        taskId: entry.taskId,
        outcome: 'resumed',
      });
    } catch (err) {
      cg3Log('tasks:selfwake', 'error', 'fire:resume_threw', {
        wakeId,
        error: String(err),
      });
      // 执行器抛错 ⇒ 会话未继续，与 `resume_failed` 同类
      await this._requeueAfterFailure(
        wakeId,
        entry,
        String(err),
        'resume_failed'
      );
    }
  }

  /**
   * 2026-11-24（批次 2 / A3）：续跑失败收口 —— 回 `pending` 重试，或达上限转 `failed`。
   *
   * 审计仍用既有 `resume_failed` / `handler_absent`（`session/wake` 载荷是闭集，
   * 不为本批次扩事件类型）；耗尽重试时把原因写进 `error` 字段，可区分"本次失败"与"已放弃"。
   */
  private async _requeueAfterFailure(
    wakeId: string,
    entry: WakeEntry,
    error: string,
    outcome: SelfWakeAuditOutcome
  ): Promise<void> {
    const next = await this.wakeStore.requeueAfterFailure(
      wakeId,
      error,
      MAX_FIRE_ATTEMPTS
    );
    const exhausted = next === 'failed';
    cg3Log(
      'tasks:selfwake',
      exhausted ? 'error' : 'warn',
      exhausted ? 'fire:retry_exhausted' : 'fire:requeued',
      {
        wakeId,
        sessionId: entry.sessionId,
        attempts: (entry.attempts ?? 0) + 1,
        next,
        error,
      }
    );
    await recordSelfWake({
      sessionId: entry.sessionId,
      wakeId,
      kind: entry.kind,
      taskId: entry.taskId,
      outcome,
      error: exhausted ? `exhausted(${MAX_FIRE_ATTEMPTS}): ${error}` : error,
    });
  }

  /** 按 wakeId 反查条目（sessionId 由 WakeStore 的内存索引提供） */
  private async _findEntry(wakeId: string): Promise<WakeEntry | null> {
    let sessionId = this.wakeStore.getSessionFor(wakeId);
    if (!sessionId) {
      // 重启后内存索引为空 ⇒ 先从磁盘重建再查（L-13 / selfwake-restart-recovery.md）
      await this.wakeStore.rebuildIndex();
      sessionId = this.wakeStore.getSessionFor(wakeId);
    }
    if (!sessionId) return null;
    const entries = await this.wakeStore.load(sessionId);
    return entries.find((e) => e.id === wakeId) ?? null;
  }

  /** 停止所有短时 timer（优雅关闭） */
  destroy(): void {
    for (const timer of this.shortTimers.values()) {
      clearTimeout(timer);
    }
    this.shortTimers.clear();
  }
}
