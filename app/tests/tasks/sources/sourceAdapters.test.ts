/**
 * P35 · 两个来源适配器（cron / 文件信号）
 *
 * 只测**翻译**与**订阅转发**：不启动真实 cron 引擎、不触碰真实文件系统
 * （`fsSignalSource` 仅验证空路径下订阅/释放不抛错）。
 */
import { describe, it, expect } from 'bun:test';

import {
  CRON_SOURCE_ID,
  createCronSource,
  cronTickToInbound,
  type CronTick,
} from '../../../src/tasks/sources/cronSource';
import {
  FS_SOURCE_ID,
  createFsSignalSource,
  fileSignalToInbound,
} from '../../../src/tasks/sources/fsSignalSource';
import { computeTriggerId } from '../../../src/tasks/sources/types';

describe('cronSource', () => {
  const tick: CronTick = {
    jobId: 'job-1',
    firedAt: 1_700_000_000_000,
    name: '日报',
    message: '生成日报',
  };

  it('翻译：线程键 = cron:<jobId>，位点 = firedAt', () => {
    const event = cronTickToInbound(tick);
    expect(event.threadKey).toBe('cron:job-1');
    expect(event.externalId).toBe('job-1@1700000000000');
    expect(event.type).toBe('cron_tick');
    expect(event.cursor).toBe(tick.firedAt);
    expect(event.payload).toEqual({
      jobId: 'job-1',
      name: '日报',
      message: '生成日报',
    });
  });

  it('同一 firedAt 重投 ⇒ 同一 triggerId（交给 registry 去重）', () => {
    const a = cronTickToInbound(tick);
    const b = cronTickToInbound({ ...tick });
    expect(computeTriggerId('cron', a)).toBe(computeTriggerId('cron', b));
  });

  it('订阅转发 + disposer 生效', async () => {
    const handlers = new Set<(t: CronTick) => void>();
    const feed = {
      subscribe(handler: (t: CronTick) => void) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const source = createCronSource({ feed });
    expect(source.id).toBe(CRON_SOURCE_ID);

    const seen: string[] = [];
    const dispose = await source.subscribe((event) => {
      seen.push(event.externalId);
    });
    for (const handler of handlers) handler(tick);
    expect(seen).toEqual(['job-1@1700000000000']);
    expect(handlers.size).toBe(1);

    dispose();
    expect(handlers.size).toBe(0);
  });
});

describe('fsSignalSource', () => {
  it('翻译：线程键 = fs:<path>，位点 = 观测时刻', () => {
    const event = fileSignalToInbound({
      path: '/repo/src/a.ts',
      kind: 'change',
      at: 42,
    });
    expect(event.threadKey).toBe('fs:/repo/src/a.ts');
    expect(event.externalId).toBe('/repo/src/a.ts@42');
    expect(event.type).toBe('file_changed');
    expect(event.cursor).toBe(42);
    expect(event.payload).toEqual({ path: '/repo/src/a.ts', kind: 'change' });
  });

  it('空监听路径下订阅/释放不抛错（不启动真实 watcher 句柄）', async () => {
    const source = createFsSignalSource({ watchPaths: [], debounceMs: 10 });
    expect(source.id).toBe(FS_SOURCE_ID);
    const dispose = await source.subscribe(() => {});
    dispose();
    source.stop();
  });
});
