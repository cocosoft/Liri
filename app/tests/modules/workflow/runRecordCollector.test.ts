/**
 * run 记录装配器（P0-1 接入点第二刀）：observer → WorkflowRunRecord 的忠实装配。
 *
 * 覆盖：正常配对顺序 / 未配对 end 被丢弃（不合成）/ run 级回填。
 */

import { describe, it, expect } from 'bun:test';

import { createRunRecordCollector } from '../../../src/modules/workflow/index.js';
import type {
  WorkflowStepEndInfo,
  WorkflowStepStartInfo,
} from '../../../src/modules/workflow/index.js';

const start = (stepId: string): WorkflowStepStartInfo => ({
  runId: 'wf_1_1',
  stepId,
  tool: stepId,
  description: `${stepId} 步骤`,
  startedAt: 1000,
});

const end = (
  stepId: string,
  outcome: 'completed' | 'failed' = 'completed'
): WorkflowStepEndInfo => ({
  runId: 'wf_1_1',
  stepId,
  tool: stepId,
  description: `${stepId} 步骤`,
  durationMs: 12,
  outcome,
  ...(outcome === 'completed' ? {} : { error: '出错了' }),
});

describe('createRunRecordCollector', () => {
  it('run 级 start/end 与成员级逐条配对，顺序与回调顺序一致', () => {
    const { observer, record } = createRunRecordCollector();

    observer.onRunStart?.({
      runId: 'wf_1_1',
      workflow: 'send-report',
      providerId: 'doc-orchestrator',
      steps: ['a', 'b'],
      startedAt: 1000,
    });
    observer.onStepStart?.(start('a'));
    observer.onStepEnd?.(end('a'));
    observer.onStepStart?.(start('b'));
    observer.onStepEnd?.(end('b', 'failed'));
    observer.onRunEnd?.({
      runId: 'wf_1_1',
      workflow: 'send-report',
      providerId: 'doc-orchestrator',
      stopReason: 'error',
      completedSteps: ['a'],
      failedStep: 'b',
      error: '出错了',
      durationMs: 24,
    });

    expect(record.start?.workflow).toBe('send-report');
    expect(record.end?.stopReason).toBe('error');
    expect(record.steps?.map((item) => item.start.stepId)).toEqual(['a', 'b']);
    expect(record.steps?.map((item) => item.end?.outcome)).toEqual([
      'completed',
      'failed',
    ]);
    expect(record.steps?.[1].end?.error).toBe('出错了');
  });

  it('未配对 start 的 end 被丢弃（不合成条目 —— CS06）', () => {
    const { observer, record } = createRunRecordCollector();

    observer.onStepEnd?.(end('ghost'));

    expect(record.steps).toEqual([]);
  });

  it('同一 stepId 的第二次 end 不会覆盖已回填的条目', () => {
    const { observer, record } = createRunRecordCollector();

    observer.onStepStart?.(start('a'));
    observer.onStepEnd?.(end('a'));
    observer.onStepEnd?.(end('a', 'failed'));

    expect(record.steps).toHaveLength(1);
    expect(record.steps?.[0].end?.outcome).toBe('completed');
  });
});
