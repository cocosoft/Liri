/**
 * doc 编排工作流 Provider（P0-1 接入点第二刀）：把 `office:workflow` 的执行路径接入 seam。
 *
 * 与生产同构：**真实** `DocOrchestrator` + **真实** `WorkflowEngine` + **真实** run 记录装配器；
 * 仅最外层的工具执行器是边界替身（真实 doc/mail/calendar 工具依赖 MCP/OfficeCLI/邮箱配置）。
 *
 * 覆盖：定义与 `DocOrchestrator.workflows` 同源 / 成功路径（步骤序 + 账本 + run 记录）/
 * 失败路径（归因）/ 未知工作流 / 未注入执行器。
 */

import { describe, it, expect } from 'bun:test';

import {
  WorkflowEngine,
  createRunRecordCollector,
} from '../../../src/modules/workflow/index.js';
import { DocOrchestrator } from '../../../src/modules/doc/orchestration/DocOrchestrator.js';
import {
  DOC_ORCHESTRATOR_PROVIDER_ID,
  DocOrchestratorProvider,
} from '../../../src/modules/doc/orchestration/DocOrchestratorProvider.js';

/** 组装 seam：桩执行器按序记录被调用的工具名；`failOn` 命中时返回失败状态 */
function setup(options: { failOn?: string } = {}) {
  const calls: string[] = [];
  const orchestrator = new DocOrchestrator();
  orchestrator.setToolExecutor(async (tool) => {
    calls.push(tool);
    if (options.failOn === tool) {
      return { status: 'failure', error: `${tool} 失败` };
    }
    return { status: 'success', output: `${tool} 完成` };
  });

  const engine = new WorkflowEngine();
  engine.registerProvider(new DocOrchestratorProvider(orchestrator));
  return { engine, calls };
}

describe('DocOrchestratorProvider', () => {
  it('定义与 DocOrchestrator.workflows 同源：工作流名一致、步骤 id = 工具名', () => {
    const { engine } = setup();

    expect(engine.listWorkflows().map((w) => w.name)).toEqual(
      DocOrchestrator.getAvailableWorkflows()
    );
    expect(
      engine.listWorkflows().every((w) => w.providerId === DOC_ORCHESTRATOR_PROVIDER_ID)
    ).toBe(true);
    // 注册期已通过 validate()（id 唯一 / 依赖存在 / 无环）—— 构造 setup() 未抛即证明
    const meetingToAll = new DocOrchestratorProvider(
      new DocOrchestrator()
    ).listWorkflows().find((w) => w.name === 'meeting-to-all');
    expect(meetingToAll?.steps.map((s) => s.id)).toEqual([
      'calendar:list',
      'doc:create-docx',
      'mail:send',
    ]);
    // 链式依赖：编排器顺序推进 ⇒ 归因有边可循（否则根因候选恒为空）
    expect(meetingToAll?.steps.map((s) => s.dependsOn ?? [])).toEqual([
      [],
      ['calendar:list'],
      ['doc:create-docx'],
    ]);
  });

  it('成功路径：按声明序调用工具，账本与 run 记录逐条配对', async () => {
    const { engine, calls } = setup();
    const { observer, record } = createRunRecordCollector();

    const result = await engine.execute(
      'send-report',
      { meetingTitle: '周会' },
      { observer }
    );

    expect(result.stopReason).toBe('completed');
    expect(result.completedSteps).toEqual(['doc:create-docx', 'mail:send']);
    expect(calls).toEqual(['doc:create-docx', 'mail:send']);

    expect(record.start?.workflow).toBe('send-report');
    expect(record.start?.providerId).toBe(DOC_ORCHESTRATOR_PROVIDER_ID);
    expect(record.end?.stopReason).toBe('completed');
    expect(record.steps?.map((item) => [item.start.stepId, item.end?.outcome])).toEqual([
      ['doc:create-docx', 'completed'],
      ['mail:send', 'completed'],
    ]);
    // 运行时结论：成功路径不给根因候选
    expect(record.end?.rootCauseCandidates).toBeUndefined();
  });

  it('失败路径：定位到失败步骤并给出上游根因候选（P0-2 端到端）', async () => {
    const { engine, calls } = setup({ failOn: 'doc:create-docx' });
    const { observer, record } = createRunRecordCollector();

    const result = await engine.execute('meeting-to-all', {}, { observer });

    expect(result.stopReason).toBe('error');
    expect(result.error).toContain('doc:create-docx');
    // 首个失败即终止：后续步骤不再被调用
    expect(calls).toEqual(['calendar:list', 'doc:create-docx']);
    expect(result.completedSteps).toEqual(['calendar:list']);

    expect(record.end?.failedStep).toBe('doc:create-docx');
    expect(record.end?.rootCauseCandidates?.map((c) => c.nodeId)).toEqual([
      'calendar:list',
    ]);
    // 失败步骤的账本条目为 failed，成功的前序步骤为 completed
    expect(record.steps?.map((item) => [item.start.stepId, item.end?.outcome])).toEqual([
      ['calendar:list', 'completed'],
      ['doc:create-docx', 'failed'],
    ]);
  });

  it('未知工作流：返回 error 而不抛（与既有编排器语义一致）', async () => {
    const { engine, calls } = setup();

    const result = await engine.execute('no-such-workflow', {});

    expect(result.stopReason).toBe('error');
    expect(result.completedSteps).toEqual([]);
    expect(result.error).toContain('no-such-workflow');
    expect(calls).toEqual([]);
  });

  it('未注入工具执行器：返回 error（不假成功）', async () => {
    const engine = new WorkflowEngine();
    engine.registerProvider(new DocOrchestratorProvider(new DocOrchestrator()));

    const result = await engine.execute('send-report', {});

    expect(result.stopReason).toBe('error');
    expect(result.completedSteps).toEqual([]);
    expect(result.error).toContain('未注入工具执行器');
  });
});
