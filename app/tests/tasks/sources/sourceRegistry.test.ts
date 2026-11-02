/**
 * P35 · Source / Trigger / Thread 回归
 *
 * 覆盖方案 §5 P35 的验收口径：
 * ① 同一事件重复投递 ⇒ 只生成 1 个 Trigger；
 * ② 同一 Thread 串行、期间到达的合并进下一批；不同 Thread 可并行；
 * ③ 读位点持久化：重启后从位点续读，不重放；
 * ④ `triggerId` 确定性（同输入同 id、不同类型不同 id）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SourceCursorStore } from '../../../src/tasks/sources/cursor';
import { SourceRegistry } from '../../../src/tasks/sources/registry';
import {
  asThreadKey,
  computeTriggerId,
  type EventSource,
  type InboundEvent,
  type ThreadKey,
  type Trigger,
} from '../../../src/tasks/sources/types';

interface MemorySource extends EventSource {
  emit(event: InboundEvent): void;
  disposed: boolean;
}

function memorySource(id: string): MemorySource {
  const handlers = new Set<(event: InboundEvent) => void | Promise<void>>();
  const source: MemorySource = {
    id,
    disposed: false,
    emit(event) {
      for (const handler of handlers) void handler(event);
    },
    async subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        source.disposed = true;
      };
    },
  };
  return source;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 轮询等待条件成立（避免固定 sleep 带来的抖动） */
async function until(
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('until: 等待超时');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

const THREAD_A = asThreadKey('fs', '/a');
const THREAD_B = asThreadKey('fs', '/b');

function event(
  over: Partial<InboundEvent> & { threadKey: ThreadKey }
): InboundEvent {
  return {
    externalId: 'evt-1',
    type: 'file_changed',
    payload: { path: '/a' },
    ...over,
  };
}

let dir: string;
let dbPath: string;
let store: SourceCursorStore | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'p35-sources-'));
  dbPath = join(dir, 'sources.db');
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

function openStore(): SourceCursorStore {
  store = new SourceCursorStore(dbPath);
  return store;
}

describe('computeTriggerId（确定性幂等键）', () => {
  it('同输入同 id；分隔符参与运算（(a,bc) 与 (ab,c) 不碰撞）', () => {
    const a = computeTriggerId('cron', {
      externalId: 'x@1',
      type: 'cron_tick',
    });
    const b = computeTriggerId('cron', {
      externalId: 'x@1',
      type: 'cron_tick',
    });
    expect(a).toBe(b);
    expect(
      computeTriggerId('cron', { externalId: 'a', type: 'cron_tick' })
    ).not.toBe(
      computeTriggerId('crona', { externalId: '', type: 'cron_tick' })
    );
  });

  it('事件类型不同 ⇒ 不同 id（同一外部 id 不漏去重）', () => {
    expect(
      computeTriggerId('s', { externalId: 'e', type: 'cron_tick' })
    ).not.toBe(
      computeTriggerId('s', { externalId: 'e', type: 'file_changed' })
    );
  });
});

describe('SourceRegistry · 幂等', () => {
  it('同一事件重复投递 ⇒ 只生成 1 个 Trigger、只处理 1 次', async () => {
    const s = openStore();
    const batches: Trigger[][] = [];
    const registry = new SourceRegistry({
      store: s,
      handleTriggers: async (_k, triggers) => {
        batches.push([...triggers]);
      },
    });
    const source = memorySource('fs-src');
    registry.register(source);
    await registry.start();

    const e = event({ threadKey: THREAD_A, externalId: 'dup-1', cursor: 100 });
    source.emit(e);
    source.emit(e);
    await until(() => batches.length > 0);
    await new Promise((r) => setTimeout(r, 20));

    expect(batches.flat()).toHaveLength(1);
    expect(await s.countTriggers('fs-src')).toBe(1);
    await registry.stop();
  });

  it('跨重启仍按 triggerId 去重（位点前进也不重复）', async () => {
    const first = openStore();
    const seen1: string[] = [];
    const r1 = new SourceRegistry({
      store: first,
      handleTriggers: async (_k, triggers) => {
        seen1.push(...triggers.map((t) => t.externalId));
      },
    });
    const src1 = memorySource('src2');
    r1.register(src1);
    await r1.start();
    src1.emit(event({ threadKey: THREAD_A, externalId: 'same', cursor: 10 }));
    await until(() => seen1.length === 1);
    await r1.stop();
    first.close();

    const second = openStore();
    const seen2: string[] = [];
    const r2 = new SourceRegistry({
      store: second,
      handleTriggers: async (_k, triggers) => {
        seen2.push(...triggers.map((t) => t.externalId));
      },
    });
    const src2 = memorySource('src2');
    r2.register(src2);
    await r2.start();
    // 位点 11 > 10 ⇒ 位点过滤放行；但 triggerId 相同 ⇒ 必须被幂等拦住
    src2.emit(event({ threadKey: THREAD_A, externalId: 'same', cursor: 11 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(seen2).toHaveLength(0);
    expect(await second.countTriggers('src2')).toBe(1);
    await r2.stop();
  });
});

describe('SourceRegistry · 串行与合并', () => {
  it('同 Thread：处理期间到达的事件合并成下一批（不并发）', async () => {
    const s = openStore();
    const gate = deferred();
    const batches: string[][] = [];
    const registry = new SourceRegistry({
      store: s,
      handleTriggers: async (_k, triggers) => {
        batches.push(triggers.map((t) => t.externalId));
        await gate.promise;
      },
    });
    const source = memorySource('src');
    registry.register(source);
    await registry.start();

    source.emit(event({ threadKey: THREAD_A, externalId: 'e1', cursor: 1 }));
    await until(() => batches.length === 1);

    source.emit(event({ threadKey: THREAD_A, externalId: 'e2', cursor: 2 }));
    source.emit(event({ threadKey: THREAD_A, externalId: 'e3', cursor: 3 }));
    await new Promise((r) => setTimeout(r, 30));
    // 第一批未放行 ⇒ 第二批不得开始
    expect(batches).toEqual([['e1']]);

    gate.resolve();
    await until(() => batches.length === 2);
    expect(batches[1]).toEqual(['e2', 'e3']);
    await registry.stop();
  });

  it('不同 Thread 并行：A 阻塞时 B 照常处理', async () => {
    const s = openStore();
    const gateA = deferred();
    const started: string[] = [];
    const registry = new SourceRegistry({
      store: s,
      handleTriggers: async (threadKey) => {
        started.push(threadKey);
        if (threadKey === THREAD_A) await gateA.promise;
      },
    });
    const source = memorySource('src');
    registry.register(source);
    await registry.start();

    source.emit(event({ threadKey: THREAD_A, externalId: 'a1', cursor: 1 }));
    await until(() => started.length === 1);
    source.emit(event({ threadKey: THREAD_B, externalId: 'b1', cursor: 1 }));
    await until(() => started.length === 2);

    expect(started).toEqual([THREAD_A, THREAD_B]);
    gateA.resolve();
    await registry.stop();
  });
});

describe('SourceRegistry · 读位点', () => {
  it('重启后从位点续读：位点之前的事件不重放', async () => {
    const first = openStore();
    const seen1: string[] = [];
    const r1 = new SourceRegistry({
      store: first,
      handleTriggers: async (_k, triggers) => {
        seen1.push(...triggers.map((t) => t.externalId));
      },
    });
    const src1 = memorySource('cron');
    r1.register(src1);
    await r1.start();
    src1.emit(event({ threadKey: THREAD_A, externalId: 'e10', cursor: 10 }));
    src1.emit(event({ threadKey: THREAD_A, externalId: 'e20', cursor: 20 }));
    await until(() => seen1.length === 2);
    await r1.stop();
    first.close();

    const second = openStore();
    const seen2: string[] = [];
    const r2 = new SourceRegistry({
      store: second,
      handleTriggers: async (_k, triggers) => {
        seen2.push(...triggers.map((t) => t.externalId));
      },
    });
    const src2 = memorySource('cron');
    r2.register(src2);
    await r2.start();
    src2.emit(event({ threadKey: THREAD_A, externalId: 'e20', cursor: 20 }));
    src2.emit(event({ threadKey: THREAD_A, externalId: 'e30', cursor: 30 }));
    await until(() => seen2.length === 1);

    expect(seen2).toEqual(['e30']);
    await r2.stop();
  });

  it('位点只前进不回退（乱序重投不会把位点拉回）', async () => {
    const s = openStore();
    await s.writeCursor('src', THREAD_A, 50, 1);
    await s.writeCursor('src', THREAD_A, 30, 2);
    expect(await s.readCursor('src', THREAD_A)).toBe(50);
  });
});

describe('SourceRegistry · 生命周期', () => {
  it('start 后 cancel 全部订阅；启动后登记新来源抛错', async () => {
    const s = openStore();
    const registry = new SourceRegistry({
      store: s,
      handleTriggers: async () => {},
    });
    const source = memorySource('src');
    registry.register(source);
    await registry.start();

    expect(() => registry.register(memorySource('late'))).toThrow();
    await registry.stop();
    expect(source.disposed).toBe(true);
  });

  it('处理方抛错不重投（台账保留，避免毒丸循环）', async () => {
    const s = openStore();
    let calls = 0;
    const registry = new SourceRegistry({
      store: s,
      handleTriggers: async () => {
        calls++;
        throw new Error('boom');
      },
    });
    const source = memorySource('src');
    registry.register(source);
    await registry.start();
    source.emit(event({ threadKey: THREAD_A, externalId: 'bad', cursor: 1 }));
    await until(() => calls === 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
    expect(await s.countTriggers('src')).toBe(1);
    await registry.stop();
  });
});
