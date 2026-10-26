/**
 * F8（2026-10-27）：重读收敛守卫改为**增量进展**判据。
 *
 * 来源：Liri 报告 P2-2 —— 守卫只按"累计 5 次重读"判定，长任务里"边做边查"
 *（持续产出文件、同时回看同一份源码）也会被判空转并注入收尾指令。
 *
 * 不变量：
 * 1. 期间**无**新产物 ⇒ 仍按 5 次阈值注入一次 steering（原有防空转能力保留）；
 * 2. 期间**有**新产物（`completedWork` 增长）⇒ 计数重置，不注入。
 */
import { describe, expect, it } from 'bun:test';

import { ToolResultPostProcess } from '../../src/chat/toolResultPostProcess.js';
import type { ToolResultPostProcessDeps } from '../../src/chat/toolResultPostProcess.js';

type Probe = {
  _detectReadReExplore: (tc: {
    name: string;
    input?: Record<string, unknown>;
  }) => void;
};

function makeProc(): {
  probe: Probe;
  steerings: string[];
  completedWork: string[];
} {
  const steerings: string[] = [];
  const completedWork: string[] = [];
  const deps = {
    getCtx: () => ({ session: { id: 's-f8' } }),
    getLoopState: () => ({
      toolTurnCount: 1,
      loopDetected: null,
      completedToolNames: [],
      totalCompletedToolCount: 0,
      completedToolCallIds: [],
      assistantMessage: null,
      llmCallCount: 0,
    }),
    getActiveToolRoundMessageId: () => 'm-1',
    pushSteering: (text: string) => steerings.push(text),
    getCompletedWork: () => completedWork,
    recordPendingTodo: () => {},
  } as unknown as ToolResultPostProcessDeps;

  const proc = new ToolResultPostProcess(deps) as unknown as Probe;
  return { probe: proc, steerings, completedWork };
}

const readCall = {
  name: 'file_read',
  input: { file_path: 'E:/repo/app/src/x.ts' },
};

describe('F8：重读守卫按增量进展判定', () => {
  it('无新产物时，累计 5 次仍注入一次收敛提示', () => {
    const { probe, steerings } = makeProc();
    for (let i = 0; i < 5; i++) probe._detectReadReExplore(readCall);
    expect(steerings).toHaveLength(1);
    expect(steerings[0]).toContain('累计 5 次');
  });

  it('每次都伴随新产物 ⇒ 不算空转，不注入', () => {
    const { probe, steerings, completedWork } = makeProc();
    for (let i = 0; i < 8; i++) {
      completedWork.push(`已保存 out-${i}.txt`);
      probe._detectReadReExplore(readCall);
    }
    expect(steerings).toHaveLength(0);
  });

  it('第 5 次前出现新产物 ⇒ 计数重置，不注入', () => {
    const { probe, steerings, completedWork } = makeProc();
    for (let i = 0; i < 4; i++) probe._detectReadReExplore(readCall);
    completedWork.push('已保存 deliverable.md');
    probe._detectReadReExplore(readCall);
    expect(steerings).toHaveLength(0);
  });
});
