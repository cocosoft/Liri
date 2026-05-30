import { describe, it, expect } from 'bun:test';

describe('命令执行测试 (Phase 2)', () => {
  it('基本命令注册表应可用', async () => {
    const { commandRegistry } = await import('../../../src/commands/index.js');
    expect(commandRegistry).toBeDefined();
  });
});
