/**
 * Demo 命令模块入口
 * 离线模式下展示模拟对话预览
 */
import type { Command } from '@modules/commands/types';

const demoCommand: Command = {
  type: 'local',
  name: 'demo',
  description: '离线模式下展示 PY_APP 对话能力预览（模拟对话示例）',
  aliases: ['preview', 'example', 'demo-chat'],
  argumentHint: '[help]',
  load: () => import('./Demo.js').then((m) => m.default),
};

export { demoCommand };
