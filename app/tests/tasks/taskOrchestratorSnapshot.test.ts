/**
 * U-14：TaskOrchestrator（PDCA/Plan 引擎）实现可选 `ISnapshotCapable`。
 *
 * 覆盖：
 * ① `isSnapshotCapable()` 探测为 true；
 * ② freeze 后新建的计划在 resume 后消失（快照覆盖内存态）；
 * ③ 恢复后 stepIndex 可用（`markStepRunning` 能命中步骤）；
 * ④ 恢复不写盘（快照是内存冻结，不是新的持久化事实）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TaskOrchestrator } from '../../src/tasks/TaskOrchestrator.js';
import { isSnapshotCapable } from '../../src/utils/toolContract/Tool.js';

const dirs: string[] = [];

function makeOrchestrator(): { orchestrator: TaskOrchestrator; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'liri-task-orch-snapshot-'));
  dirs.push(dir);
  const orchestrator = new TaskOrchestrator();
  orchestrator.setPlansDir(dir);
  return { orchestrator, dir };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('U-14 TaskOrchestrator snapshot capability', () => {
  it('声明并可被 isSnapshotCapable 探测', () => {
    const { orchestrator } = makeOrchestrator();
    expect(orchestrator.snapshotCapable).toBe(true);
    expect(isSnapshotCapable(orchestrator)).toBe(true);
  });

  it('freeze → 新建计划 → resume：快照覆盖内存态且 stepIndex 可用', () => {
    const { orchestrator } = makeOrchestrator();
    const first = orchestrator.createPlan(
      'first plan',
      ['step-a', 'step-b'],
      'session-1',
      ['task-a', 'task-b']
    );

    const handle = orchestrator.freezeForSuspend();
    const second = orchestrator.createPlan(
      'second plan',
      ['step-c'],
      'session-2',
      ['task-c']
    );
    expect(orchestrator.getPlan(second.id)).toBeDefined();

    orchestrator.resumeFromSnapshot(handle);

    expect(orchestrator.getPlan(second.id)).toBeUndefined();
    expect(orchestrator.getPlan(first.id)).toBeDefined();
    // stepIndex 已重建：markStepRunning 能按 stepId 命中
    const running = orchestrator.markStepRunning(first.steps[0].id);
    expect(running?.status).toBe('running');
  });

  it('恢复不写盘（目录文件数不因 resume 增加）', () => {
    const { orchestrator, dir } = makeOrchestrator();
    orchestrator.createPlan('p', ['s'], 'sess', ['t']);
    const before = readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    const handle = orchestrator.freezeForSuspend();
    orchestrator.resumeFromSnapshot(handle);
    const after = readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    expect(after).toBe(before);
  });

  it('按会话冻结：只恢复目标会话的计划，其它会话原样保留', () => {
    const { orchestrator } = makeOrchestrator();
    const mine = orchestrator.createPlan('mine', ['step-a'], 'session-1', [
      'task-a',
    ]);
    const other = orchestrator.createPlan('other', ['step-b'], 'session-2', [
      'task-b',
    ]);

    const handle = orchestrator.freezeForSuspend({ sessionId: 'session-1' });
    expect(handle.mode).toBe('session');
    expect(handle.sessionId).toBe('session-1');
    expect((handle.plans as unknown[]).length).toBe(1);

    // 冻结后：本会话新增计划 + 旧计划推进；其它会话也新增
    const spawned = orchestrator.createPlan(
      'spawned',
      ['step-c'],
      'session-1',
      ['task-c']
    );
    orchestrator.markStepRunning(mine.steps[0].id);
    const other2 = orchestrator.createPlan('other-2', ['step-d'], 'session-2', [
      'task-d',
    ]);

    orchestrator.resumeFromSnapshot(handle);

    // 本会话回到快照：快照后新建的计划被移除、步骤状态回滚
    expect(orchestrator.getPlan(mine.id)).toBeDefined();
    expect(orchestrator.getPlan(spawned.id)).toBeUndefined();
    expect(orchestrator.getPlan(mine.id)?.steps[0].status).toBe('pending');
    // stepIndex 已重建：能按 stepId 命中本会话的计划
    expect(orchestrator.markStepRunning(mine.steps[0].id)?.status).toBe(
      'running'
    );
    // 其它会话完全不受影响
    expect(orchestrator.getPlan(other.id)).toBeDefined();
    expect(orchestrator.getPlan(other2.id)).toBeDefined();
  });

  it('作用域句柄缺 sessionId ⇒ 显式报错', () => {
    const { orchestrator } = makeOrchestrator();
    expect(() =>
      orchestrator.resumeFromSnapshot({
        kind: 'task-orchestrator',
        mode: 'session',
        plans: [],
      })
    ).toThrow('invalid task-orchestrator snapshot handle');
  });

  it('非法句柄显式报错', () => {
    const { orchestrator } = makeOrchestrator();
    expect(() => orchestrator.resumeFromSnapshot({ kind: 'wrong' })).toThrow(
      'invalid task-orchestrator snapshot handle'
    );
  });
});
