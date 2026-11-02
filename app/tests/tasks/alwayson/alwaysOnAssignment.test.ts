/**
 * P34 · AlwaysOn 派工（Assignment）记录接线测试
 *
 * 覆盖：
 * ① `resolveAssignmentReportState` 的四类映射（失败 / 未执行 / 未达成 / 就绪）；
 * ② 一轮完整流水线（discovery → workspace → execution → report）里
 *    `recordAssignment` 被调用两次：先 `running`、后 `ended`，且 `assignmentId` 稳定；
 * ③ 未注入 `recordAssignment` ⇒ 编排行为不变（不报错）。
 */
import { describe, it, expect } from 'bun:test';

import {
  createAlwaysOnBridge,
  resolveAssignmentReportState,
  type AlwaysOnAssignmentRecord,
  type AlwaysOnBridgeDeps,
} from '../../../src/tasks/alwayson/AlwaysOnBridge';

const PLAN_JSON = JSON.stringify({
  summary: '检查并修复构建',
  riskLevel: 'low',
  actions: [{ type: 'inspect', description: '读取构建脚本' }],
});

function makeDeps(
  records: AlwaysOnAssignmentRecord[],
  over: Partial<AlwaysOnBridgeDeps> = {}
): AlwaysOnBridgeDeps {
  return {
    projectId: 'p-1',
    projectName: 'demo',
    projectPath: '/repo/demo',
    limits: { maxToolCalls: 10, timeoutMinutes: 1 },
    createSession: async () => 's-1',
    loadSession: async () => undefined,
    saveSession: async () => {},
    prepareWorkspace: async () => ({
      workspace: {
        cwd: '/repo/demo-wt',
        strategy: 'test',
        ref: { runId: 'r' },
      },
    }),
    finishWorkspace: async () => ({ diffBytes: 0 }),
    setSessionWorkspace: async () => {},
    sendPrompt: async () => PLAN_JSON,
    writeReport: async (planId) => `/tmp/${planId}.md`,
    notifyReport: async () => false,
    recordAssignment: async (rec) => {
      records.push(rec);
    },
    ...over,
  };
}

describe('P34 · 派工汇报状态映射', () => {
  it('执行失败 ⇒ failed（优先于其它判据）', () => {
    expect(
      resolveAssignmentReportState({
        success: false,
        skippedReason: 'not_git_repo_or_dirty',
      })
    ).toBe('failed');
  });

  it('未执行（工作区不可用）⇒ blocked', () => {
    expect(
      resolveAssignmentReportState({ success: true, skippedReason: 'dirty' })
    ).toBe('blocked');
  });

  it('自评未达成 ⇒ blocked', () => {
    expect(
      resolveAssignmentReportState({
        success: true,
        goalVerdict: 'not_achieved',
      })
    ).toBe('blocked');
  });

  it('成功且达成/未自评 ⇒ ready', () => {
    expect(
      resolveAssignmentReportState({ success: true, goalVerdict: 'achieved' })
    ).toBe('ready');
    expect(resolveAssignmentReportState({ success: true })).toBe('ready');
  });
});

describe('P34 · 一轮流水线记录两次派工', () => {
  it('先 running 后 ended(ready)，assignmentId 与 workItemId 一致', async () => {
    const records: AlwaysOnAssignmentRecord[] = [];
    const bridge = createAlwaysOnBridge(makeDeps(records));

    const plan = await bridge.discovery();
    expect(plan).not.toBeNull();
    await bridge.workspace(plan!);
    const result = await bridge.execution('/repo/demo-wt');
    await bridge.report(result);

    expect(records).toHaveLength(2);
    expect(records[0]!.state).toBe('running');
    expect(records[1]!.state).toBe('ended');
    expect(records[1]!.reportState).toBe('ready');
    expect(records[0]!.assignmentId).toBe(records[1]!.assignmentId);
    expect(records[0]!.workItemId).toBe(records[0]!.assignmentId);
    // P34：会话 id 随派工记录落库（产物归属反查链的中间环节）
    expect(records[0]!.sessionId).toBe('s-1');
    expect(records[1]!.sessionId).toBe('s-1');
    expect(records[1]!.endedAt).toBeGreaterThanOrEqual(records[0]!.startedAt);
  });

  it('未注入 recordAssignment ⇒ 流水线照常完成（零影响）', async () => {
    const bridge = createAlwaysOnBridge(
      makeDeps([], { recordAssignment: undefined })
    );
    const plan = await bridge.discovery();
    await bridge.workspace(plan!);
    const result = await bridge.execution('/repo/demo-wt');
    expect(await bridge.report(result)).toContain('AlwaysOn Execution Report');
  });
});
