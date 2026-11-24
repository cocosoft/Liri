// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-F（2026-11-24，真机 `pdca_mwupjxor`）：阶段链任务的检查点读模型必须透出 `stages`。
 *
 * 原实现只认顶层 `steps`（plan），阶段链把进度放在 `stages[]` ⇒ 前端拿到「无步骤快照」
 * 空态，抽屉（唯一详情来源）对阶段链等于没有详情。本文件锁死读模型的透出口径：
 * - 有 stages ⇒ 原样返回 + `currentStage`；
 * - 无 stages ⇒ 不返回该字段（旧数据行为不变）；
 * - 不得因 stages 而伪造 plan（两种进度模型互斥）。
 */

import { describe, expect, test, beforeEach, afterAll, spyOn } from 'bun:test';
import http from 'http';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI');
const { handlePdcaStatus } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

type Ck = Record<string, unknown> & { taskId: string };

let checkpoints: Map<string, Ck>;

function installPort(): void {
  const port = {
    readPdcaCheckpoint: async (taskId: string) =>
      checkpoints.get(taskId) ?? null,
    getPdcaOrchestrator: async () => null,
    getPdcaStatusSets: async () => ({
      terminal: new Set(['completed', 'failed', 'abort']),
      terminalPhases: new Set(['completed', 'failed', 'abort']),
      active: new Set(['started', 'running']),
      awaitingApprovalPhases: new Set([
        'plan_pending',
        'stage_awaiting_approval',
      ]),
    }),
  };
  getCoreAPISpy.mockReturnValue({
    getTaskOpsPort: async () => port,
  } as never);
}

function createRes(): {
  res: http.ServerResponse;
  read: () => Record<string, unknown>;
} {
  const out = { body: '', status: 0 };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => JSON.parse(out.body) as Record<string, unknown>,
  };
}

async function getStatus(taskId: string): Promise<Record<string, unknown>> {
  const created = createRes();
  await handlePdcaStatus(
    {} as unknown as http.IncomingMessage,
    created.res,
    taskId
  );
  return created.read();
}

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  checkpoints = new Map();
  getCoreAPISpy.mockReset();
  installPort();
});

describe('P2-F：阶段链读模型透出 stages', () => {
  test('checkpoint 带 stages ⇒ 原样返回 + currentStage，且不伪造 plan', async () => {
    checkpoints.set('pdca_stage_chain', {
      taskId: 'pdca_stage_chain',
      sessionId: 'sess-p2f',
      phase: 'execute',
      status: 'started',
      currentStage: 'design',
      stages: [
        { id: 'requirement', status: 'completed', steps: [] },
        { id: 'design', status: 'running', approvalInboxId: 'inbox_1' },
        { id: 'delivery', status: 'pending' },
      ],
    });

    const body = await getStatus('pdca_stage_chain');

    expect(Array.isArray(body.stages)).toBe(true);
    expect(body.stages).toHaveLength(3);
    expect(body.currentStage).toBe('design');
    // 两种进度模型互斥：阶段链不得凭空出现 steps-based plan
    expect(body.plan).toBeUndefined();
    expect(body.phase).toBe('execute');
  });

  test('checkpoint 无 stages ⇒ 不返回该字段（旧数据行为不变）', async () => {
    checkpoints.set('pdca_plain', {
      taskId: 'pdca_plain',
      sessionId: 'sess-p2f',
      phase: 'execute',
      status: 'started',
      steps: [{ id: 'step_1', status: 'completed', description: 'x' }],
    });

    const body = await getStatus('pdca_plain');

    expect(body.stages).toBeUndefined();
    expect(body.currentStage).toBeUndefined();
    expect(body.plan).toBeDefined();
  });
});
