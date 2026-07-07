/**
 * 边缘工具测试覆盖补充
 * 测试 CronCreateTool（cron 表达式校验）、TaskCreateTool（任务创建边界）、UtilityTools 边缘功能
 */
import { describe, it, expect } from 'bun:test';
import { CronCreateTool } from '../ChronosTool/CronCreateTool';
import { TaskCreateTool } from '../TaskTool/TaskCreateTool';
import { InMemoryTaskStorage } from '../TaskTool/TaskStorage';

describe('CronCreateTool 边缘校验', () => {
  const tool = CronCreateTool.create();

  it('应拒绝空 expression 参数', () => {
    const result = tool.validateInput?.({
      name: 'test',
      expression: '',
      prompt: 'test',
    });
    expect(result).toBeDefined();
    expect(result!.result).toBe(false);
  });

  it('expression 非空即可通过校验', () => {
    const result = tool.validateInput?.({
      name: 'test',
      expression: '0 8 * * *',
      prompt: 'test',
    });
    expect(result).toBeDefined();
    expect(result!.result).toBe(true);
  });

  it('应拒绝缺失 prompt 参数', () => {
    const result = tool.validateInput?.({
      name: 'test',
      expression: '0 * * * *',
    });
    expect(result).toBeDefined();
    expect(result!.result).toBe(false);
  });

  it('应接受有效 cron 表达式', () => {
    const result = tool.validateInput?.({
      name: 'test task',
      expression: '0 * * * *',
      prompt: 'test prompt',
    });
    expect(result).toBeDefined();
    expect(result!.result).toBe(true);
  });

  it('应接受每5分钟 cron 表达式', () => {
    const result = tool.validateInput?.({
      name: 'status check',
      expression: '*/5 * * * *',
      prompt: 'check status',
    });
    expect(result).toBeDefined();
    expect(result!.result).toBe(true);
  });

  it('isEnabled 应返回 true', () => {
    expect(tool.isEnabled?.()).toBe(true);
  });

  it('isReadOnly 应返回 false', () => {
    expect(tool.isReadOnly?.()).toBe(false);
  });

  it('isDestructive 应返回 false', () => {
    expect(tool.isDestructive?.()).toBe(false);
  });

  it('isConcurrencySafe 应返回 true', () => {
    expect(tool.isConcurrencySafe?.()).toBe(true);
  });

  it('应暴露正确的工具名称和别称', () => {
    expect(tool.name).toBe('cron_create');
    expect(tool.aliases).toContain('schedule');
    expect(tool.aliases).toContain('cron_add');
    expect(tool.description).toContain('scheduled');
  });

  it('参数应包含 name/expression/prompt/schedule_mode', () => {
    const paramNames = tool.params.map((p) => p.name);
    expect(paramNames).toContain('name');
    expect(paramNames).toContain('expression');
    expect(paramNames).toContain('prompt');
    expect(paramNames).toContain('schedule_mode');
  });
});

describe('TaskCreateTool 边界校验', () => {
  it('应拒绝空 subject', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    const result = tool.validateInput({ subject: '' });
    expect(result.result).toBe(false);
    expect(result.message).toContain('subject is required');
  });

  it('应拒绝缺失 subject', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    const result = tool.validateInput({});
    expect(result.result).toBe(false);
  });

  it('应拒绝超过 500 字符的 subject', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    const result = tool.validateInput({ subject: 'x'.repeat(501) });
    expect(result.result).toBe(false);
    expect(result.message).toContain('500');
  });

  it('应接受最短有效 subject', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    const result = tool.validateInput({ subject: 'a' });
    expect(result.result).toBe(true);
  });

  it('应接受 500 字符以内的 subject', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    const result = tool.validateInput({ subject: 'x'.repeat(500) });
    expect(result.result).toBe(true);
  });

  it('应成功创建最小任务（仅 subject）', async () => {
    const storage = new InMemoryTaskStorage();
    const tool = new TaskCreateTool(storage);
    const result = await tool.execute({ subject: 'test task' });

    expect(result).toBeDefined();
    const tasks = await storage.list();
    expect(tasks.length).toBe(1);
    expect(tasks[0].subject).toBe('test task');
  });

  it('应成功创建带描述的任务', async () => {
    const storage = new InMemoryTaskStorage();
    const tool = new TaskCreateTool(storage);
    const result = await tool.execute({
      subject: 'task with description',
      description: 'This is a detailed task description',
    });

    expect(result).toBeDefined();
    const tasks = await storage.list();
    expect(tasks.length).toBe(1);
    expect(tasks[0].description).toBe('This is a detailed task description');
  });

  it('应成功创建带元数据的任务', async () => {
    const storage = new InMemoryTaskStorage();
    const tool = new TaskCreateTool(storage);
    const result = await tool.execute({
      subject: 'task with metadata',
      metadata: { priority: 'high', source: 'test' },
    });

    expect(result).toBeDefined();
    const tasks = await storage.list();
    expect(tasks[0].metadata).toEqual({ priority: 'high', source: 'test' });
  });

  it('getInfo 应返回正确的工具信息', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    const info = tool.getInfo();
    expect(info.name).toBe('TaskCreate');
    expect(info.enabled).toBe(true);
    expect(info.readOnly).toBe(false);
    expect(info.destructive).toBe(false);
  });

  it('userFacingName 应返回带 subject 的可读名称', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    expect(tool.userFacingName({ subject: 'my task' })).toBe(
      'Create Task: my task'
    );
  });

  it('userFacingName 无参数时应返回工具名', () => {
    const tool = new TaskCreateTool(new InMemoryTaskStorage());
    expect(tool.userFacingName({})).toBe('TaskCreate');
  });
});
