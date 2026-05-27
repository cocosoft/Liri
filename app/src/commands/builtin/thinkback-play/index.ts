/**
 * 思考回放播放命令
 * 回放 AI 思考过程动画（隐藏命令，由 thinkback 技能内部调用）
 */
import type { Command } from '@modules/commands/types';

/**
 * thinkback-play 命令定义
 */
const thinkbackPlayCommand: Command = {
  type: 'local',
  name: 'thinkback-play',
  description: '回放思考过程动画',
  isHidden: true,
  userInvocable: false,
  argumentHint: '<思考记录ID>',
  load: () => import('./ThinkbackPlay.js').then((m) => m.default),
};

export { thinkbackPlayCommand };
