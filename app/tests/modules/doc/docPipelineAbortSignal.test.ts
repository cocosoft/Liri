// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * doc 编排工具**透传会话中止信号**（P1-19 ⑤「传输行」守卫，2026-10-05）
 *
 * 背景：取消通道早已存在（`ToolExecutionService` 把会话级 `abortController` 注入工具上下文，
 * 由用户停止 / SSE 断连触发），但两个编排工具此前调 seam 时只传 `observer` ⇒ 取消永不生效。
 * 本测试锁定修复后的**传输行**：已中止的 controller 必须在**引擎入口短路**为 `cancelled`，
 * 且**不进入 Provider**（若信号未透传，Provider 会被调用并返回 completed）。
 *
 * 用已导出的 `createDocPipelineTool()` 覆盖 —— `office:workflow` 为**同源同形的三行透传**。
 * 确定性：不经模型、不依赖 OfficeCLI（stub provider 顶替 doc_pipeline 定义）。
 */

import { describe, it, expect, afterAll } from 'bun:test';

import { createDocPipelineTool } from '../../../src/modules/doc/pipeline/DocPipelineTool';
import { DOC_PIPELINE_WORKFLOW } from '../../../src/modules/doc/workflow/DocWorkflowProvider';
import {
  getWorkflowEngine,
  type WorkflowDefinition,
  type WorkflowProvider,
  type WorkflowRunResult,
} from '../../../src/modules/workflow/index.js';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { ToolUseContext } from '../../../src/tools/types/Tool';

const PROVIDER_ID = 'stub-doc-pipeline-signal';

/** 桩 Provider：顶替 `doc_pipeline` 定义，只计数 + 返回可判定结果 */
class StubProvider implements WorkflowProvider {
  readonly providerId = PROVIDER_ID;
  executeCalled = 0;

  /** `delayMs > 0` 时模拟"运行中"（供 grace=0 的即时结算用例） */
  constructor(private readonly delayMs = 0) {}

  listWorkflows(): WorkflowDefinition[] {
    return [
      {
        name: DOC_PIPELINE_WORKFLOW,
        description: '桩（信号透传验证）',
        steps: [{ id: 's1', tool: 's1', description: '步骤 1' }],
      },
    ];
  }

  async execute(): Promise<WorkflowRunResult> {
    this.executeCalled += 1;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return {
      stopReason: 'completed',
      completedSteps: ['s1'],
      // 工具成功分支要求 value.filePath 非空（见 DocPipelineTool 成功判定）
      value: { filePath: '/tmp/stub.docx', format: 'docx' },
    };
  }
}

const INPUT: Record<string, unknown> = {
  topic: '信号透传验证',
  format: 'docx',
  nodes: [{ title: '第一节', content: '正文' }],
};

function makeContext(abortController: AbortController): ToolUseContext {
  return {
    toolName: 'office:doc-pipeline',
    toolInput: INPUT,
    sessionId: 'session_signal_test',
    abortController,
  } as unknown as ToolUseContext;
}

function installStub(delayMs = 0): StubProvider {
  const engine = getWorkflowEngine();
  engine.unregisterProvider(PROVIDER_ID);
  const stub = new StubProvider(delayMs);
  engine.registerProvider(stub);
  return stub;
}

/** 等待条件成立（上限 2s，避免竞态下无限等待） */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterAll(() => {
  getWorkflowEngine().unregisterProvider(PROVIDER_ID);
});

describe('doc 编排工具透传会话中止信号（P1-19 ⑤ 传输行守卫）', () => {
  it('已中止的会话 controller ⇒ 引擎入口短路为 cancelled，且不进入 Provider', async () => {
    const stub = installStub();
    const controller = new AbortController();
    controller.abort();

    const result = await createDocPipelineTool().execute(
      INPUT,
      makeContext(controller)
    );

    // 信号已透传 ⇒ pre-check 短路，Provider 完全不被调用
    expect(stub.executeCalled).toBe(0);
    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(result.output)).toContain('取消');
  });

  it('对照组：未中止 ⇒ 正常进入 Provider 并 completed', async () => {
    const stub = installStub();
    const controller = new AbortController();

    const result = await createDocPipelineTool().execute(
      INPUT,
      makeContext(controller)
    );

    expect(stub.executeCalled).toBe(1);
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(String(result.output)).toContain('/tmp/stub.docx');
  });

  it('运行中中止 ⇒ grace=0 立即结算 cancelled（不再等默认 5000ms 宽限）', async () => {
    const stub = installStub(150); // Provider 需 150ms 才结束
    const controller = new AbortController();

    const pending = createDocPipelineTool().execute(
      INPUT,
      makeContext(controller)
    );
    // 等 Provider 真正进入（此后中止 ⇒ 落在"运行中"而非 pre-check）
    await waitFor(() => stub.executeCalled === 1);
    controller.abort();
    const result = await pending;

    // 若工具未传 gracePeriodMs（默认 5000ms）⇒ Provider 会在 150ms 内先返回 ⇒ 结果取胜（ERROR 而非取消）
    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(result.output)).toContain('取消');
  });
});
