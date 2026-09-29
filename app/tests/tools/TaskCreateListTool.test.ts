// MIT License
// Copyright (c) 2026 190615273@qq.com

// TaskCreateListTool 空参数校验 + 单次调用数量限制测试
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  TaskCreateListTool,
  MAX_TASKS_PER_CALL,
} from '../../src/tools/TaskOrchestratorTools/TaskOrchestratorTools';
import { taskRegistry } from '../../src/tasks/TaskRegistry';
import { pickTaskText } from '../../src/tools/utils/ToolUtils';
import { ToolExecutor } from '../../src/tools/ToolExecutor';

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

/** 成功分支的出参对象（2026-09-29 出参对象化：原为多行纯文本字符串） */
interface CreateListData {
  created: Array<{ task_id: string; description: string }>;
  total: number;
  pending: number;
  skipped: number;
}

function createdData(
  result: Awaited<ReturnType<typeof callWith>>
): CreateListData {
  return result.data as CreateListData;
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
    expect(createdData(r).created.map((c) => c.description)).toEqual([
      '写周报',
      '发邮件',
    ]);
    expect(createdData(r).skipped).toBe(1);
    expect(createdDescs).toEqual(['写周报', '发邮件']); // trim 后创建
  });

  it('创建时对 description 做 trim', async () => {
    const r = await callWith([{ description: '  加空格任务  ' }]);
    expect(createdData(r).created[0].description).toBe('加空格任务');
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
    expect(createdData(r).created).toHaveLength(MAX_TASKS_PER_CALL);
    expect(createdDescs.length).toBe(MAX_TASKS_PER_CALL);
  });
});

// ─────────────────────────────────────────────────────────────
// 2026-09-29 台账「另案 ④」：入参字段归一化 + 失败必须可判定
// ─────────────────────────────────────────────────────────────

describe('pickTaskText — 任务文本字段兜底链（单一实现）', () => {
  it('字符串直接 trim', () => {
    expect(pickTaskText('  写周报  ')).toBe('写周报');
  });

  it('对象按既有链兜底（content→name→title→task→subject→description→desc）', () => {
    expect(pickTaskText({ content: 'c' })).toBe('c');
    expect(pickTaskText({ name: 'n' })).toBe('n');
    expect(pickTaskText({ title: 't' })).toBe('t');
    expect(pickTaskText({ task: 'k' })).toBe('k');
    expect(pickTaskText({ subject: 's' })).toBe('s');
    expect(pickTaskText({ description: 'd' })).toBe('d');
    expect(pickTaskText({ desc: 'x' })).toBe('x');
  });

  it('链序：content 优先于 title（与 TodoWriteTool 既有链一致）', () => {
    expect(pickTaskText({ title: 'b', content: 'a' })).toBe('a');
  });

  it('全字段缺失 / 非字符串 ⇒ 空串（不臆造占位文本，CS04）', () => {
    expect(pickTaskText({})).toBe('');
    expect(pickTaskText({ description: '   ' })).toBe('');
    expect(pickTaskText({ description: 123 })).toBe('');
    expect(pickTaskText(null)).toBe('');
    expect(pickTaskText(undefined)).toBe('');
    expect(pickTaskText(42)).toBe('');
  });
});

describe('TaskCreateListTool — 另案 ④ 回归', () => {
  it('模型传 title / name（非 description）也能创建（原缺陷：全量被过滤成空）', async () => {
    const r = await callWith([{ title: '写周报' }, { name: '发邮件' }]);
    expect(createdData(r).created.map((c) => c.description)).toEqual([
      '写周报',
      '发邮件',
    ]);
    expect(createdData(r).skipped).toBe(0);
    expect(createdDescs).toEqual(['写周报', '发邮件']);
  });

  it('失败分支落 error 字段（此前只有 newMessages ⇒ 模型只看到 {}）', async () => {
    const r = await callWith([]);
    expect(r.data).toBeNull();
    expect(r.success).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.error).toContain('must be non-empty');
  });

  it('失败原因经真实 processResult 进入模型可见的错误通道', async () => {
    const tool = new TaskCreateListTool();
    const r = await tool.execute({ tasks: [{ description: '   ' }] } as Record<
      string,
      unknown
    >, {} as never);
    const block = new ToolExecutor().processResult(tool as never, r, 'call_x');
    // 模型侧表达式 `error || '{}'` 的组合行为由 ChatHelper.test.ts 的
    // `toToolResultRawText` 用例覆盖；此处守住"块 error 不再为空"这一前提。
    expect(block.result).toBeNull();
    expect(block.error).toContain('all task descriptions are empty');
  });
});
