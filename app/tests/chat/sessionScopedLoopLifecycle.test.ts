/**
 * 会话级循环对象生命周期回归（2026-10-19，源码排查报告 D1 / D2 / D6）。
 *
 * 修复前的缺陷（静态取证结论，见 `_bug_report.md`）：
 *  - **D1**：`deleteSession` 只注销进程级注册表，`_taorLoops` / `_planDrivenLoops`
 *    全仓无 `.delete`/`.clear` ⇒ 每个已删会话永久占用一条 TAORLoop + 一条 PlanDrivenLoop；
 *  - **D2**：扩容续跑实例的缓存键带 `::turnsXn` 后缀，而注册键是裸 `sessionId`
 *    ⇒ 扩容实例在端点/steering 上失联，却永久留在缓存里；
 *  - **D6**：`flushAllCheckpoints` 直接遍历 `_taorLoops.values()` ⇒ 同一会话的多个实例
 *    会被并发 flush 两次。
 *
 * 本文件用**真实 `ChatManagerImpl`** 锁定三条契约：
 *  ① 删除会话后，该会话的**全部**缓存键（含 `::turnsXn`）与 PDL 条目被回收；
 *  ② 端点（`handleListCheckpoints`）指向**最近一次取用**的实例（扩容实例可达）；
 *  ③ `flushAllCheckpoints` 对同一会话只 flush 一次。
 */
import { describe, expect, it } from 'bun:test';
import type http from 'http';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import { handleListCheckpoints } from '../../src/infrastructure/http/handlers/checkpoint-handlers';
import type { TAORLoop } from '../../src/query/TAORLoop.js';

/** 私有成员访问（同 `taorLoopResumeWiring.test.ts` 的 Testable 写法） */
type ChatManagerInternals = {
  _getOrCreateTAORLoop(
    sessionId: string,
    opts?: { maxTurnsMultiplier?: number }
  ): TAORLoop;
  _taorLoops: Map<string, TAORLoop>;
  _planDrivenLoops: Map<string, unknown>;
  _registeredTaorSessions: Map<string, Set<string>>;
  _unregisterAllTaorLoops(): void;
};

const internals = (cm: ChatManagerImpl): ChatManagerInternals =>
  cm as unknown as ChatManagerInternals;

function makeReq(url: string, method = 'GET'): http.IncomingMessage {
  return { url, method, headers: {} } as unknown as http.IncomingMessage;
}

function makeRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    headersSent: false,
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

/** 以 handler 行为探测该会话在进程级注册表中的端口（未注册 ⇒ `{checkpoints: []}`） */
async function registryCheckpoints(
  sessionId: string
): Promise<Record<string, unknown>> {
  const { res, read } = makeRes();
  await handleListCheckpoints(
    makeReq(`/v1/sessions/${sessionId}/checkpoints`),
    res
  );
  return read().body;
}

describe('会话级循环对象生命周期（D1/D2/D6）', () => {
  it('D2：扩容实例被取用后，端点指向它（不再被基础实例覆盖）', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'loop-lifecycle-x2';
    const base = internals(cm)._getOrCreateTAORLoop(sid);
    base.getCheckpointsForSession = async () => [{ id: 'base' }] as never;

    const expanded = internals(cm)._getOrCreateTAORLoop(sid, {
      maxTurnsMultiplier: 2,
    });
    expect(expanded).not.toBe(base);
    expanded.getCheckpointsForSession = async () => [{ id: 'x2' }] as never;

    // 修复前：注册只在「首次创建」发生 ⇒ 扩容实例不登记，端点仍返回 base 的检查点。
    expect(await registryCheckpoints(sid)).toEqual({
      checkpoints: [{ id: 'x2' }],
    });

    internals(cm)._unregisterAllTaorLoops();
  });

  it('D1：删除会话回收全部缓存键（含 ::turnsXn）与 PlanDrivenLoop', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'loop-lifecycle-delete';
    internals(cm)._getOrCreateTAORLoop(sid);
    internals(cm)._getOrCreateTAORLoop(sid, { maxTurnsMultiplier: 2 });
    // PDL 的完整构建依赖真实 TAOR 上下文，此处只验证「会话级 Map 被回收」这一契约
    internals(cm)._planDrivenLoops.set(sid, { stub: true });

    expect(internals(cm)._taorLoops.size).toBe(2);
    expect(internals(cm)._registeredTaorSessions.size).toBe(1);

    // 无落盘会话时拆除可能抛错 —— 注销必须是**第一步**（与拆除结果解耦）
    await cm.deleteSession(sid).catch(() => {});

    expect(internals(cm)._taorLoops.size).toBe(0);
    expect(internals(cm)._planDrivenLoops.size).toBe(0);
    expect(internals(cm)._registeredTaorSessions.size).toBe(0);
    expect(await registryCheckpoints(sid)).toEqual({ checkpoints: [] });
  });

  it('D6：同一会话多个实例只 flush 一次', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'loop-lifecycle-flush';
    const base = internals(cm)._getOrCreateTAORLoop(sid);
    const expanded = internals(cm)._getOrCreateTAORLoop(sid, {
      maxTurnsMultiplier: 2,
    });

    let flushCalls = 0;
    base.flushCheckpoint = async () => {
      flushCalls++;
    };
    expanded.flushCheckpoint = async () => {
      flushCalls++;
    };

    await cm.flushAllCheckpoints();
    expect(flushCalls).toBe(1);

    internals(cm)._unregisterAllTaorLoops();
  });
});
