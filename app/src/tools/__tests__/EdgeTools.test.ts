/**
 * 边缘工具测试覆盖补充
 * 测试 CronCreateTool（cron 表达式校验）
 *
 * ⚠️ 沿革（2026-09-29，D-15）：原有一组 `TaskCreateTool 边界校验`（**11 例**）随
 * `TaskTool/TaskCreateTool.ts` 一并删除 —— 该类**未注册进运行时注册表、无生产消费者**，
 * 且 `TaskTool/TaskStorage.ts` 的唯一消费者就是它 ⇒ 该测试此前在**测死代码**。
 */
import { describe, it, expect } from 'bun:test';
import { CronCreateTool } from '../ChronosTool/CronCreateTool';

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
