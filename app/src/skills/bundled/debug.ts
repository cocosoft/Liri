/**
 * Debug技能
 */

import { registerBundledSkill } from './bundledSkills';
import type { SkillService } from '../services/skillService';

/**
 * 注册Debug技能
 * @param skillService 技能服务实例
 */
export default function registerDebugSkill(skillService: SkillService): void {
  registerBundledSkill(skillService, {
    name: 'debug',
    description: '调试当前会话中的问题——分析错误、日志和异常',
    aliases: ['troubleshoot', '调试'],
    whenToUse: '当用户遇到错误、异常或意外行为需要诊断时使用',
    argumentHint: '[问题描述]',
    userInvocable: true,
    async getPromptForCommand(args, context) {
      const issue = args || '用户未描述具体问题。请提供通用的调试帮助。';

      return [
        '# 调试技能',
        '',
        '帮助用户调试当前会话中遇到的问题。',
        '',
        '## 问题描述',
        '',
        issue,
        '',
        '## 调试步骤',
        '',
        '### 1. 理解问题',
        '- 确认问题的具体表现（错误信息、意外输出、崩溃等）',
        '- 确定问题是否可重现',
        '- 了解问题出现的上下文和环境',
        '',
        '### 2. 收集信息',
        '- 检查相关的错误日志和输出',
        '- 查看配置文件和设置',
        '- 确认运行环境和依赖版本',
        '',
        '### 3. 定位根因',
        '- 分析错误堆栈跟踪',
        '- 隔离问题的范围（最近变更、特定输入、特定环境）',
        '- 使用二分法缩小问题范围',
        '',
        '### 4. 制定修复方案',
        '- 提供明确的修复步骤',
        '- 解释每个修复的原理',
        '- 提供验证修复是否有效的方法',
        '',
        '## 调试技巧',
        '',
        '- **启用日志**：增加详细日志输出来追踪执行流程',
        '- **边界测试**：测试边界条件和边缘情况',
        '- **环境隔离**：在隔离环境中重现问题',
        '- **版本对比**：比较最近变更前后的行为差异',
        '',
        '请基于以上框架提供系统性的调试帮助。',
      ];
    },
  });
}
