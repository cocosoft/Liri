/**
 * Subagent 命令模块入口
 * 管理多个 Agent 定义，支持从不同源加载 .md 配置文件
 */
import type { Command } from '@modules/commands/types';

const subagentCommand: Command = {
  type: 'local',
  name: 'subagent',
  description: '管理多个 Agent 实例，支持从不同源加载',
  aliases: ['agent', 'agents'],
  argumentHint: '[list|info|create|delete|--json|help]',
  whenToUse: '当你需要管理多个 Agent 实例时',
  load: () => import('./Subagent.js').then(m => m.default),
};

// 保留 agentCommand 别名导出以兼容旧引用
export { subagentCommand };
export { subagentCommand as agentCommand };
export default subagentCommand;
