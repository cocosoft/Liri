/**
 * D4 收敛回归：手动压缩路径必须与 CompactionOrchestrator **共用同一把锁**
 *
 * 背景（计划 §D4 审计结论②）：手动压缩（`/compact` + HTTP）走 `ContextCompactor →
 * CompactServiceImpl`，与自动主干 `CompactionOrchestrator`（A）**完全独立且此前不持锁**，
 * 两者可并发改写同一会话的消息集 = "互相覆盖"。
 *
 * 本测试锁定：① 正常路径持锁执行并在结束后释放；② 锁被占用（另一条路径正在压缩）时
 * **不做任何压缩动作**（不调用 performCompact），避免并发写回。
 *
 * 注意：锁实例注入到临时目录，**不触碰真实 `~/.pyapp/data`**。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextCompactor } from '../../src/chat/services/ContextCompactor';
import { CompactionLockStore } from '../../src/context/compaction/CompactionLockStore';
import type { SessionCurrentIdPort } from '../../src/chat/services/SessionLifecycleManager';
import type { CompactServiceImpl } from '../../src/services/compact/CompactService';
import type { ChatSession } from '../../src/chat/types/session';

let tmpDir: string;
let lockStore: CompactionLockStore;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'compact-lock-'));
  lockStore = new CompactionLockStore(tmpDir);
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

/** 造一个"能走到压缩逻辑"的门面：会话在内存 Map 中，compactService 全部打桩 */
function makeCompactor(sessionId: string, counter: { calls: number }) {
  const session = {
    id: sessionId,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'hello',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  } as unknown as ChatSession;

  const compactService = {
    performCompact: async () => {
      counter.calls += 1;
      return [{ id: 'artifact-1' }];
    },
    reinjectArtifacts: async () => undefined,
  } as unknown as CompactServiceImpl;

  return new ContextCompactor({
    compactService,
    chatSessions: new Map([[sessionId, session]]),
    currentSessionIdRef: { get: () => null } as unknown as SessionCurrentIdPort,
    lockStore,
  });
}

describe('D4 收敛：手动压缩与 A 共用压缩锁', () => {
  test('正常路径：持锁执行、返回产物、结束后释放锁', async () => {
    const counter = { calls: 0 };
    const compactor = makeCompactor('s-normal', counter);

    const artifacts = await compactor.compactSession('s-normal');

    expect(counter.calls).toBe(1);
    expect(artifacts).toHaveLength(1);
    // 结束后锁必须已释放：能再次获取
    const reAcquire = lockStore.tryAcquire('s-normal');
    expect(reAcquire).not.toBeNull();
    lockStore.release('s-normal', reAcquire as string);
  });

  test('锁被占用（另一条压缩路径进行中）→ 不做压缩动作、返回空产物', async () => {
    const counter = { calls: 0 };
    const compactor = makeCompactor('s-busy', counter);

    // 模拟 A（CompactionOrchestrator）已持有该会话的锁
    const held = lockStore.tryAcquire('s-busy');
    expect(held).not.toBeNull();

    const artifacts = await compactor.compactSession('s-busy');

    expect(counter.calls).toBe(0); // 关键：绝不并发写回
    expect(artifacts).toEqual([]);

    lockStore.release('s-busy', held as string);
  });

  test('异常路径也必须释放锁（否则会话被永久拒绝压缩）', async () => {
    const session = {
      id: 's-throw',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'x',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    } as unknown as ChatSession;
    const compactService = {
      performCompact: async () => {
        throw new Error('压缩内部失败');
      },
      reinjectArtifacts: async () => undefined,
    } as unknown as CompactServiceImpl;
    const compactor = new ContextCompactor({
      compactService,
      chatSessions: new Map([['s-throw', session]]),
      currentSessionIdRef: {
        get: () => null,
      } as unknown as SessionCurrentIdPort,
      lockStore,
    });

    await expect(compactor.compactSession('s-throw')).rejects.toThrow();

    const reAcquire = lockStore.tryAcquire('s-throw');
    expect(reAcquire).not.toBeNull();
    lockStore.release('s-throw', reAcquire as string);
  });
});
