// MIT License
// Copyright (c) 2026 190615273@qq.com

// TaskCreateListTool 空参数校验 + 单次调用数量限制测试
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  TaskCreateListTool,
  MAX_TASKS_PER_CALL,
} from '../../src/tools/TaskOrchestratorTools/TaskOrchestratorTools';
import { taskRegistry } from '../../src/tasks/TaskRegistry';

const tool = new TaskCreateListTool();

// ─── registry stub（避免真实创建 NoteTask / 污染全局注册表） ───
let createdDescs: string[] = [];
const origRegister = taskRegistry.registerNoteTask;
const origStats = taskRegistry.getTaskStats;

beforeEach(() => {
  createdDescs = [];
  taskRegistry.registerNoteTask = ((description: string) => {
    createdDescs.push(description);
    return {
      id: `note-${createdDescs.length}`,
      setMetadata: () => {},
    } as never;
  }) as typeof taskRegistry.registerNoteTask;
  taskRegistry.getTaskStats = (() => ({
    total: createdDescs.length,
    pending: createdDescs.length,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  })) as typeof taskRegistry.getTaskStats;
});

afterEach(() => {
  taskRegistry.registerNoteTask = origRegister;
  taskRegistry.getTaskStats = origStats;
});

async function callWith(tasks: unknown) {
  return tool.execute({ tasks } as Record<string, unknown>, {} as never);
}

function errorContent(result: Awaited<ReturnType<typeof callWith>>): string {
  const msg = result.newMessages?.[0];
  return String(msg?.content ?? '');
}

describe('TaskCreateListTool — 空参数校验', () => {
  it('拒绝空数组 tasks', async () => {
    const r = await callWith([]);
    expect(errorContent(r)).toContain('must be non-empty');
    expect(createdDescs.length).toBe(0);
  });

  it('拒绝非数组 tasks', async () => {
    const r = await callWith('not-an-array');
    expect(errorContent(r)).toContain('must be non-empty');
    expect(createdDescs.length).toBe(0);
  });

  it('拒绝缺失 tasks 字段', async () => {
    const r = await tool.execute({} as Record<string, unknown>, {} as never);
    expect(errorContent(r)).toContain('must be non-empty');
    expect(createdDescs.length).toBe(0);
  });

  it('拒绝全部为空的 description', async () => {
    const r = await callWith([
      { description: '' },
      { description: '   ' },
      { description: 123 },
    ]);
    expect(errorContent(r)).toContain('all task descriptions are empty');
    expect(createdDescs.length).toBe(0);
  });

  it('过滤空 description，只创建有效项并提示跳过数', async () => {
    const r = await callWith([
      { description: '  写周报  ' },
      { description: '' },
      { description: '发邮件' },
    ]);
    // 有效 2 个，跳过 1 个
    expect(r.data).toContain('Created 2 task(s)');
    expect(r.data).toContain('1 invalid empty task(s) were skipped');
    expect(createdDescs).toEqual(['写周报', '发邮件']); // trim 后创建
  });

  it('创建时对 description 做 trim', async () => {
    const r = await callWith([{ description: '  加空格任务  ' }]);
    expect(r.data).toContain('Created 1 task(s)');
    expect(createdDescs).toEqual(['加空格任务']);
  });
});

describe('TaskCreateListTool — 单次调用数量限制', () => {
  it(`拒绝超过 ${MAX_TASKS_PER_CALL} 个任务`, async () => {
    const many = Array.from({ length: MAX_TASKS_PER_CALL + 1 }, (_, i) => ({
      description: `任务 ${i}`,
    }));
    const r = await callWith(many);
    expect(errorContent(r)).toContain('too many tasks');
    expect(errorContent(r)).toContain(String(MAX_TASKS_PER_CALL));
    expect(createdDescs.length).toBe(0);
  });

  it(`允许恰好 ${MAX_TASKS_PER_CALL} 个任务`, async () => {
    const many = Array.from({ length: MAX_TASKS_PER_CALL }, (_, i) => ({
      description: `任务 ${i}`,
    }));
    const r = await callWith(many);
    expect(r.data).toContain(`Created ${MAX_TASKS_PER_CALL} task(s)`);
    expect(createdDescs.length).toBe(MAX_TASKS_PER_CALL);
  });
});
