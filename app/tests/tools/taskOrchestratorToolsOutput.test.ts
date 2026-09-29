// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 出参对象化回归（2026-09-29，`specs/task-orchestrator-tools-output-object.md`）
 *
 * 覆盖 4 条不变量：
 *  1. 三个**活**工具的出口 `data` 已从"人类可读纯文本"变为**对象**；
 *  2. 该对象**通过**各自 `outputSchema`（契约真在生效，非摆设）；
 *  3. 把对象改坏 ⇒ 校验器**必报**（证明"真的校验了"）；
 *  4. `ToolExecutor.processResult` 的读取面修正：`data` 缺省时回退 `result`；
 *     `data` 有值时行为**不变**（`{"a":1}` 逐字符一致）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  TaskCreateListTool,
  TaskGetListTool,
  TaskUpdateStatusTool,
} from '../../src/tools/TaskOrchestratorTools/TaskOrchestratorTools';
import {
  CreateTaskListOutputSchema,
  GetTaskListOutputSchema,
  UpdateTaskStatusOutputSchema,
} from '../../src/tools/TaskOrchestratorTools/schemas';
import { taskRegistry } from '../../src/tasks/TaskRegistry';
import {
  ToolExecutor,
  validateToolOutputShape,
} from '../../src/tools/ToolExecutor';
import type { Tool } from '../../src/tools/types/Tool';
import type { ToolResult } from '../../src/tools/types/ToolResult';

/** 校验器实参派生的 schema 形态（不用 `unknown` 绕过契约） */
type OutputSchemaParam = NonNullable<
  Parameters<typeof validateToolOutputShape>[0]['outputSchema']
>;

const EMPTY_STATS = {
  total: 0,
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
};

// ─── registry stub（与 TaskCreateListTool.test.ts 同范式：不污染全局注册表） ───
const origRegisterNoteTask = taskRegistry.registerNoteTask;
const origGetTaskStats = taskRegistry.getTaskStats;
const origGetAllTaskInfos = taskRegistry.getAllTaskInfos;
const origGetTask = taskRegistry.getTask;

beforeEach(() => {
  taskRegistry.registerNoteTask = ((description: string) => ({
    id: `note-${description}`,
    setMetadata: () => {},
  })) as unknown as typeof taskRegistry.registerNoteTask;
  taskRegistry.getTaskStats = (() => ({
    ...EMPTY_STATS,
    total: 1,
    pending: 1,
  })) as typeof taskRegistry.getTaskStats;
  taskRegistry.getAllTaskInfos = (() => [
    { id: 'note-1', description: '写周报', displayStatus: 'pending' },
  ]) as unknown as typeof taskRegistry.getAllTaskInfos;
  // 非 NoteTask 实例 ⇒ 工具内部跳过 setStatusDirect，仅验证出口形态
  taskRegistry.getTask = (() => ({})) as unknown as typeof taskRegistry.getTask;
});

afterEach(() => {
  taskRegistry.registerNoteTask = origRegisterNoteTask;
  taskRegistry.getTaskStats = origGetTaskStats;
  taskRegistry.getAllTaskInfos = origGetAllTaskInfos;
  taskRegistry.getTask = origGetTask;
});

describe('TaskOrchestratorTools 出参对象化', () => {
  it('create_task_list：出口为对象且通过契约；改坏必报', async () => {
    const tool = new TaskCreateListTool();
    const outputSchema: OutputSchemaParam = CreateTaskListOutputSchema;
    expect(tool.outputSchema).toBe(CreateTaskListOutputSchema);

    const r = await tool.execute(
      { tasks: [{ description: '写周报' }] },
      {} as never
    );
    expect(typeof r.data).toBe('object');
    expect(r.data).toMatchObject({
      created: [{ task_id: 'note-写周报', description: '写周报' }],
      total: 1,
      pending: 1,
      skipped: 0,
    });

    expect(
      validateToolOutputShape({ name: 'create_task_list', outputSchema }, r)
    ).toBeNull();

    const good = r.data as { total: number };
    const broken = { ...(r.data as object), total: String(good.total) };
    expect(
      validateToolOutputShape({ name: 'create_task_list', outputSchema }, {
        data: broken,
      } as ToolResult)
    ).not.toBeNull();
  });

  it('update_task_status：出口为对象且通过契约；改坏必报', async () => {
    const tool = new TaskUpdateStatusTool();
    const outputSchema: OutputSchemaParam = UpdateTaskStatusOutputSchema;
    expect(tool.outputSchema).toBe(UpdateTaskStatusOutputSchema);

    const r = await tool.execute(
      { task_id: 'note-1', status: 'completed' },
      {} as never
    );
    expect(r.data).toMatchObject({
      task_id: 'note-1',
      status: 'completed',
      success: true,
      message: 'Updated task note-1 to completed',
    });

    expect(
      validateToolOutputShape({ name: 'update_task_status', outputSchema }, r)
    ).toBeNull();

    const broken = { ...(r.data as object), success: 'yes' };
    expect(
      validateToolOutputShape({ name: 'update_task_status', outputSchema }, {
        data: broken,
      } as ToolResult)
    ).not.toBeNull();
  });

  it('get_task_list：出口为对象且通过契约；改坏必报', async () => {
    const tool = new TaskGetListTool();
    const outputSchema: OutputSchemaParam = GetTaskListOutputSchema;
    expect(tool.outputSchema).toBe(GetTaskListOutputSchema);

    const r = await tool.execute({}, {} as never);
    expect(r.data).toMatchObject({
      count: 1,
      stats: { pending: 1, in_progress: 0, completed: 0, failed: 0, cancelled: 0 },
      tasks: [{ task_id: 'note-1', description: '写周报', status: 'pending' }],
    });

    expect(
      validateToolOutputShape({ name: 'get_task_list', outputSchema }, r)
    ).toBeNull();

    const broken = { ...(r.data as object), count: 'one' };
    expect(
      validateToolOutputShape({ name: 'get_task_list', outputSchema }, {
        data: broken,
      } as ToolResult)
    ).not.toBeNull();
  });

  it('get_task_list：空列表分支同形态（否则会被契约判为不合规）', async () => {
    taskRegistry.getAllTaskInfos = (() => []) as unknown as typeof taskRegistry.getAllTaskInfos;
    const outputSchema: OutputSchemaParam = GetTaskListOutputSchema;

    const r = await new TaskGetListTool().execute({}, {} as never);
    expect((r.data as { tasks: unknown[] }).tasks).toEqual([]);
    expect(
      validateToolOutputShape({ name: 'get_task_list', outputSchema }, r)
    ).toBeNull();
  });
});

describe('ToolExecutor.processResult 读取面（2026-09-29 修正）', () => {
  const executor = new ToolExecutor();
  const fakeTool = { name: 'demo' } as unknown as Tool;

  it('data 有值 ⇒ 行为与修正前逐字符一致', () => {
    const block = executor.processResult(
      fakeTool,
      { data: { a: 1 } } as ToolResult,
      'c1'
    );
    expect(block.result).toEqual({ a: 1 });
    expect(block.output).toBe('{"a":1}');
  });

  it('字符串 data ⇒ 保持既有原样透传（不被多套一层）', () => {
    const block = executor.processResult(
      fakeTool,
      { data: 'plain' } as ToolResult,
      'c2'
    );
    expect(block.result).toBe('plain');
    expect(block.output).toBe('plain');
  });

  it('仅填 result（data 缺省）⇒ 块 result/output 不再为空', () => {
    const block = executor.processResult(
      fakeTool,
      { result: { b: 2 } } as ToolResult,
      'c3'
    );
    expect(block.result).toEqual({ b: 2 });
    expect(block.output).toBe('{"b":2}');
  });

  it('data 显式为 null ⇒ 不被 result 顶替（失败分支语义不变）', () => {
    const block = executor.processResult(
      fakeTool,
      { data: null, result: { c: 3 } } as ToolResult,
      'c4'
    );
    expect(block.result).toBeNull();
  });
});
