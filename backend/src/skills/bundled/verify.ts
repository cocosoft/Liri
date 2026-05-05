/**
 * Verify技能
 * 用于验证结果正确性，基于CC源码 cc_code/backend/skills/bundled/verify.ts 实现
 */

import { registerBundledSkill } from './bundledSkills';
import type { SkillService } from '../services/skillService';

/**
 * 注册Verify技能
 * @param skillService 技能服务实例
 */
export default function registerVerifySkill(skillService: SkillService): void {
  registerBundledSkill(skillService, {
    name: 'verify',
    description: '验证代码变更的正确性——运行测试、检查边界条件、确认行为符合预期',
    aliases: ['验证', 'check'],
    whenToUse: '当用户需要验证代码变更是否正确、测试是否通过或行为是否符合预期时使用',
    argumentHint: '[要验证的变更或结果描述]',
    userInvocable: true,
    async getPromptForCommand(args, context) {
      const target = (args || '').trim();

      return [
        '# 验证技能',
        '',
        '验证代码变更或结果的正确性。',
        ...(target ? ['', `## 验证目标`, '', target] : []),
        '',
        '## 验证维度',
        '',
        '### 1. 功能正确性',
        '- 代码是否实现了预期的功能？',
        '- 是否覆盖了正常路径和边界条件？',
        '- 输入验证和错误处理是否完善？',
        '',
        '### 2. 测试覆盖',
        '- 是否有单元测试覆盖核心逻辑？',
        '- 边界条件和异常情况是否有测试？',
        '- 测试是否通过？',
        '',
        '### 3. 代码质量',
        '- 是否存在潜在的bug或逻辑错误？',
        '- 代码是否遵循项目约定和最佳实践？',
        '- 是否有资源泄漏（内存、文件句柄、连接等）？',
        '',
        '### 4. 副作用检查',
        '- 变更是否影响其他模块？',
        '- 是否存在竞态条件或并发问题？',
        '- 向后兼容性是否被破坏？',
        '',
        '## 验证流程',
        '',
        '1. **理解变更**：明确变更的目标和范围',
        '2. **运行测试**：执行相关测试套件',
        '3. **代码审查**：检查逻辑正确性和代码质量',
        '4. **边界测试**：验证边缘情况和异常输入',
        '5. **集成检查**：确认变更与系统其他部分兼容',
        '6. **总结报告**：输出验证结果和发现的问题',
      ];
    },
  });
}
