/**
 * D2（2026-09-22）：事件日志实例 LRU + 快照释放
 *
 * 背景（真机实证）：`ChatManager._eventLogCache` 原先**只增不减**（仅在会话删除时移除）
 * ⇒ 每个"触碰过"的会话都常驻一份 `EventLogStorage`，其 `eventsSnapshot` 预算为
 * `min(10 000 事件, 200MB)`。实测会话 `session_muakhpqa5immlqko4ht` 全部事件在磁盘上
 * 仅 **4.07MB / 5418 条**，而读取窗口内 RSS 从 3.9GB 涨到 4.5GB、峰值 5.25GB。
 *
 * 修复后两条释放通路（本文件锁定）：
 *  ① **LRU 淘汰**：`_eventLogCache` 超上限（8）时淘汰最久未用实例，并释放其快照；
 *  ② **会话切换**：切换时释放**非当前会话**的快照（当前会话保留复用）。
 *
 * 释放顺序：先 `flushTextBuffer()`（Write-Ahead：缓冲正文不得因省内存而丢）
 * 再 `releaseMemory()`（清快照 + 窗口元数据，可重建、不改正确性）。
 *
 * 说明：`ChatManager` 的这些成员是私有的，本测试沿用仓库既有风格 —— 用最小 host 承载
 * 私有字段 + `Reflect` 取原型方法（不使用 `any` / `ts-ignore`）。
 */
import { describe, test, expect } from 'bun:test';
import { ChatManagerImpl } from '../../src/chat/ChatManager';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';

/** 承载私有字段的最小 host（原型方法经 Reflect 以它为 this 调用） */
interface CacheHost {
  _eventLogCache: Map<string, EventLogStorage>;
  sessionLifecycle: { switchSession: (id: string) => Promise<void> };
}

/** 与 ChatManager.EVENT_LOG_CACHE_MAX 对齐（用例的期望值来自契约，非实现常量直读） */
const MAX_CACHED = 8;

function makeHost(): CacheHost {
  // 关键：**继承真实原型** —— `_getOrCreateEventLog` 内部会调用
  // `this._evictOverflowEventLogs` 等兄弟私有方法，普通对象字面量取不到它们；
  // 走 `Object.create(prototype)` 即可在不跑重构造函数的前提下复用真实实现。
  const host = Object.create(ChatManagerImpl.prototype) as CacheHost;
  host._eventLogCache = new Map<string, EventLogStorage>();
  host.sessionLifecycle = { switchSession: async () => {} };
  return host;
}

type Fn = (this: unknown, ...args: unknown[]) => unknown;

function proto(name: string): Fn {
  const fn = Reflect.get(ChatManagerImpl.prototype, name) as Fn | undefined;
  if (!fn) throw new Error(`ChatManagerImpl.prototype.${name} 不存在`);
  return fn;
}

/** 调用私有 `_getOrCreateEventLog` */
function getOrCreate(host: CacheHost, sessionId: string): EventLogStorage {
  return Reflect.apply(proto('_getOrCreateEventLog'), host, [
    sessionId,
  ]) as EventLogStorage;
}

/** 调用私有 `switchSession`（真实方法，内部再委托 sessionLifecycle） */
async function switchSession(host: CacheHost, sessionId: string): Promise<void> {
  await (Reflect.apply(proto('switchSession'), host, [sessionId]) as Promise<void>);
}

/** 给实例塞一份"存在快照"的痕迹（仅用于断言释放是否发生） */
function seedSnapshot(log: EventLogStorage, size = 3): void {
  Reflect.set(log, 'eventsSnapshot', [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  Reflect.set(log, 'snapshotCosts', new Array(size).fill(1));
  Reflect.set(log, 'snapshotMinSeq', 1);
}

function snapshotOf(log: EventLogStorage): unknown {
  return Reflect.get(log, 'eventsSnapshot');
}

/** 等一次宏任务：淘汰/切换的释放是异步进行的（`void ... .catch()`） */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('D2：_eventLogCache LRU', () => {
  test('同一会话复用同一实例（命中即复用）', () => {
    const host = makeHost();
    const first = getOrCreate(host, 's1');
    const second = getOrCreate(host, 's1');
    expect(second).toBe(first);
    expect(host._eventLogCache.size).toBe(1);
  });

  test(`超过上限（${MAX_CACHED}）⇒ 淘汰最久未用者，容量恒受控`, () => {
    const host = makeHost();
    for (let i = 1; i <= MAX_CACHED; i++) getOrCreate(host, `s${i}`);
    expect(host._eventLogCache.size).toBe(MAX_CACHED);

    getOrCreate(host, `s${MAX_CACHED + 1}`); // 触发淘汰

    expect(host._eventLogCache.size).toBe(MAX_CACHED);
    const keys = [...host._eventLogCache.keys()].map((k) => k.split(':')[1]);
    expect(keys).not.toContain('s1'); // 最旧被淘汰
    expect(keys).toContain(`s${MAX_CACHED + 1}`);
  });

  test('命中会刷新"最近使用"（淘汰的是次旧者，不是被访问者）', () => {
    const host = makeHost();
    for (let i = 1; i <= MAX_CACHED; i++) getOrCreate(host, `s${i}`);
    getOrCreate(host, 's1'); // 命中 ⇒ 移到队尾

    getOrCreate(host, 's9'); // 触发淘汰

    const keys = [...host._eventLogCache.keys()].map((k) => k.split(':')[1]);
    expect(keys).toContain('s1'); // 被访问者保留
    expect(keys).not.toContain('s2'); // 次旧者被淘汰
  });

  test('淘汰时释放该实例的事件快照（RSS 常驻因此有界）', async () => {
    const host = makeHost();
    const oldest = getOrCreate(host, 's1');
    seedSnapshot(oldest);
    for (let i = 2; i <= MAX_CACHED; i++) getOrCreate(host, `s${i}`);

    expect(snapshotOf(oldest)).not.toBeNull();
    getOrCreate(host, 's9'); // 触发淘汰（释放异步进行）
    await tick();

    expect(snapshotOf(oldest)).toBeNull();
    expect(Reflect.get(oldest, 'snapshotCosts')).toEqual([]);
  });

  test('上限内不淘汰、不误释放', async () => {
    const host = makeHost();
    const log = getOrCreate(host, 's1');
    seedSnapshot(log);
    for (let i = 2; i <= MAX_CACHED; i++) getOrCreate(host, `s${i}`);
    await tick();

    expect(host._eventLogCache.size).toBe(MAX_CACHED);
    expect(snapshotOf(log)).not.toBeNull();
  });
});

describe('D2：会话切换释放非当前会话快照', () => {
  test('切换 ⇒ 非当前会话快照被释放、当前会话保留、切换动作仍被委托', async () => {
    const host = makeHost();
    const switched: string[] = [];
    host.sessionLifecycle.switchSession = async (id: string) => {
      switched.push(id);
    };
    const s1 = getOrCreate(host, 's1');
    const s2 = getOrCreate(host, 's2');
    const s3 = getOrCreate(host, 's3');
    [s1, s2, s3].forEach((l) => seedSnapshot(l));

    await switchSession(host, 's2');

    expect(switched).toEqual(['s2']); // 委托未被破坏
    expect(snapshotOf(s2)).not.toBeNull(); // 当前会话保留
    expect(snapshotOf(s1)).toBeNull(); // 非当前会话释放
    expect(snapshotOf(s3)).toBeNull();
  });

  test('切换释放后仍可复用（实例未丢，仅快照按需重建）', async () => {
    const host = makeHost();
    const log = getOrCreate(host, 's1');
    seedSnapshot(log);
    await switchSession(host, 's2');

    expect(getOrCreate(host, 's1')).toBe(log); // 仍是同一实例
    expect(snapshotOf(log)).toBeNull(); // 但快照已释放
  });
});

describe('D2：EventLogStorage.releaseMemory 契约', () => {
  test('清空快照与窗口元数据（同步、无 IO）', () => {
    const log = new EventLogStorage('session_d2', 'default');
    seedSnapshot(log);

    log.releaseMemory();

    expect(snapshotOf(log)).toBeNull();
    expect(Reflect.get(log, 'snapshotCosts')).toEqual([]);
    expect(Reflect.get(log, 'snapshotBytes')).toBe(0);
    expect(Reflect.get(log, 'snapshotMinSeq')).toBe(0);
    // 允许重新评估快照资格（否则释放后永久不再建快照）
    expect(Reflect.get(log, 'snapshotIneligible')).toBe(false);
    expect(Reflect.get(log, 'snapshotCooldownUntil')).toBe(0);
  });

  test('幂等：连续释放无副作用', () => {
    const log = new EventLogStorage('session_d2b', 'default');
    seedSnapshot(log);
    log.releaseMemory();
    log.releaseMemory();
    expect(snapshotOf(log)).toBeNull();
  });
});
