/**
 * P2-1k —— S3「回滚轮次启动」只读性判定 + 动作契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1k；实现见
 * `src/chat/orchestrator/streamMessageRollbackRound.ts`。
 *
 * 锁定（对应 2026-09-02「全量基线扫描阻塞 ⇒ SSE 断流」事故防御）：
 * 1. **fail-safe 只读性判据**：工具未实现 `isReadOnly`（含工具不存在 / 注册表缺失）⇒ 视为**写**；
 *    `isReadOnly() === true` ⇒ 只读；
 * 2. 存在写操作工具 ⇒ `startRollbackRound(sessionId, roundId)`；全只读 ⇒ **不**调用。
 */
import { describe, expect, it } from 'bun:test';

import { maybeStartRollbackRound } from '../../../src/chat/orchestrator/streamMessageRollbackRound.js';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';

type FakeTool = { isReadOnly?: () => boolean };

function fakeHost(tools: Record<string, FakeTool> | null) {
  const started: Array<{ sessionId: string; roundId: number }> = [];
  const getTool = (name: string) => {
    const map = tools;
    return map === null ? undefined : map[name];
  };
  const host = {
    // `null` 表示**注册表缺失**（`getToolRegistry()` 返回 `undefined`）
    getToolRegistry: () => (tools === null ? undefined : { getTool }),
    startRollbackRound: (sessionId: string, roundId: number) => {
      started.push({ sessionId, roundId });
      return Promise.resolve();
    },
  } as unknown as ChatOrchestratorHost;
  return { host, started };
}

const run = (
  tools: Record<string, FakeTool> | null,
  toolCalls: Array<{ name?: string }>
) => {
  const { host, started } = fakeHost(tools);
  return maybeStartRollbackRound({
    host,
    sessionId: 's1',
    toolCalls,
    roundId: 42,
  }).then(() => started);
};

describe('P2-1k S3 回滚轮次启动 · 只读性判定 + 动作', () => {
  it('工具**未实现** `isReadOnly` ⇒ 视为写 ⇒ 启动基线扫描', async () => {
    const started = await run({ bash: {} }, [{ name: 'bash' }]);
    expect(started).toEqual([{ sessionId: 's1', roundId: 42 }]);
  });

  it('`isReadOnly() === false` ⇒ 写 ⇒ 启动', async () => {
    const started = await run({ bash: { isReadOnly: () => false } }, [
      { name: 'bash' },
    ]);
    expect(started).toHaveLength(1);
  });

  it('全部 `isReadOnly() === true` ⇒ 只读 ⇒ **不**启动', async () => {
    const started = await run(
      {
        file_read: { isReadOnly: () => true },
        grep: { isReadOnly: () => true },
      },
      [{ name: 'file_read' }, { name: 'grep' }]
    );
    expect(started).toEqual([]);
  });

  it('混合：只读 + 写 ⇒ 启动（只要存在写）', async () => {
    const started = await run(
      {
        file_read: { isReadOnly: () => true },
        bash: { isReadOnly: () => false },
      },
      [{ name: 'file_read' }, { name: 'bash' }]
    );
    expect(started).toHaveLength(1);
  });

  it('工具不存在 / 注册表缺失 ⇒ 视为写（fail-safe，宁可多扫不可漏扫）', async () => {
    const missingTool = await run({}, [{ name: 'unknown_tool' }]);
    expect(missingTool).toHaveLength(1);

    const noRegistry = await run(null, [{ name: 'bash' }]);
    expect(noRegistry).toHaveLength(1);
  });
});
