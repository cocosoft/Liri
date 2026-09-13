/**
 * SkillTool 注册表同步单测（2026-08-06 / Skill 系统加强后续）
 *
 * 验证 SkillTool 能从真实 SkillRegistry 同步技能（含 skillify 等 bundled 技能），
 * 且 prompt 型技能执行时返回 impl.getPromptForCommand 的真实内容（非 placeholder）。
 * P3-7b（2026-09-02）：技能不存在但同名系统工具存在 → 返回引导直接调用工具。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { SkillTool } from '../SkillTool';
import { getToolRegistry } from '@modules/tools/ToolRegistry';
import type { Tool } from '../../types/Tool';

let tool: SkillTool;

beforeAll(async () => {
  // 初始化内置技能到真实 SkillRegistry（正常流程由 init.ts 启动时调用）
  const { initBuiltinSkills } =
    await import('@modules/constants/systemPromptSections');
  await initBuiltinSkills();
  tool = new SkillTool();
});

describe('SkillTool 注册表同步', () => {
  it('同步后包含 skillify / update-config / simplify 等 bundled 技能', async () => {
    // execute 触发懒同步
    await tool.execute({ name: 'stuck', arguments: {} });
    const names = tool.getAllSkills().map((s) => s.name);
    expect(names).toContain('skillify');
    expect(names).toContain('update-config');
    expect(names).toContain('simplify');
    expect(names).toContain('remember');
  });

  it('prompt 型技能执行返回真实内容（非 placeholder）', async () => {
    const result = await tool.execute({ name: 'skillify', arguments: {} });
    expect(result.status).toBe('success');
    const output = String(result.output);
    expect(output).toContain('[Prompt Skill: skillify]');
    expect(output).toContain('Skillify — Capture Process as Skill');
    expect(output).not.toContain('This is a placeholder');
  });

  it('保留硬编码内置技能（debug / file-explorer）', async () => {
    await tool.execute({ name: 'stuck', arguments: {} });
    const names = tool.getAllSkills().map((s) => s.name);
    expect(names).toContain('debug');
    expect(names).toContain('file-explorer');
  });

  describe('P3-7b 同名工具引导（2026-09-02）', () => {
    // 用不存在的技能名 + 同名注册工具，验证引导消息（不污染全局注册表）
    const fakeToolName = 'p37b_todo_write';
    let preExisting = false;

    beforeAll(() => {
      const registry = getToolRegistry();
      preExisting = registry.getTool(fakeToolName) !== undefined;
      if (!preExisting) {
        registry.registerTools([
          {
            name: fakeToolName,
            description: 'Write task tracking entries',
            params: [
              {
                name: 'action',
                type: 'string',
                description: 'write|update|complete',
                required: true,
              },
            ],
            execute: async () => ({ status: 'success' }),
          } as unknown as Tool,
        ]);
      }
    });

    afterAll(() => {
      if (!preExisting) {
        getToolRegistry().unregisterTool(fakeToolName);
      }
    });

    it('技能不存在但同名工具存在 → 返回引导"直接调用该工具"', () => {
      const v = tool.validateInput({ name: fakeToolName });
      expect(v.result).toBe(false);
      expect(v.message).toContain(fakeToolName);
      expect(v.message).toContain('是系统工具');
      expect(v.message).toContain('请直接调用该工具');
    });

    it('技能不存在且无同名工具 → 返回原 not found', () => {
      const v = tool.validateInput({ name: 'p37b_no_such_skill' });
      expect(v.result).toBe(false);
      expect(v.message).toBe(`Skill 'p37b_no_such_skill' not found`);
    });
  });
});
