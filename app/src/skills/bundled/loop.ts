/**
 * Loop技能
 * 用于循环执行任务，基于CC源码 cc_code/backend/skills/bundled/loop.ts 实现
 */

import { registerBundledSkill } from './bundledSkills';
import type { SkillService } from '../services/skillService';

/**
 * 注册Loop技能
 * @param skillService 技能服务实例
 */
export default function registerLoopSkill(skillService: SkillService): void {
  registerBundledSkill(skillService, {
    name: 'loop',
    description: '按固定间隔重复执行提示词或斜杠命令（如 /loop 5m /foo）',
    aliases: ['定时', '重复'],
    whenToUse: '当用户需要设置定时任务、轮询状态或重复执行某个操作时使用',
    argumentHint: '[间隔] <提示词>',
    userInvocable: true,
    async getPromptForCommand(args, context) {
      const trimmed = (args || '').trim();
      if (!trimmed) {
        return [
          '用法: /loop [间隔] <提示词>',
          '',
          '按固定间隔重复执行提示词或斜杠命令。',
          '',
          '间隔格式: Ns, Nm, Nh, Nd（如 5m、30m、2h、1d）。最小粒度1分钟。',
          '未指定间隔时默认10分钟。',
          '',
          '示例:',
          '  /loop 5m /check-status',
          '  /loop 30m 检查部署状态',
          '  /loop 1h /daily-report',
          '  /loop 检查部署状态          （默认10分钟）',
          '  /loop every 20m 检查部署    （自然语言间隔）',
        ];
      }
      return [
        '# /loop — 调度循环提示词',
        '',
        '从以下输入中解析出 `[间隔] <提示词…>`。',
        '',
        '## 输入',
        '',
        trimmed,
        '',
        '## 指令',
        '',
        '1. 从输入中解析间隔和提示词',
        '2. 按指定间隔调度提示词',
        '3. 立即执行一次提示词',
      ];
    },
  });
}
