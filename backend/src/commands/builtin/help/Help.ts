import { commandRegistry } from '@modules/commands/registry/index.js';

export default {
  async call(args: string) {
    if (args) {
      const cmd = commandRegistry.getCommand(args);
      if (cmd) {
        const aliases = cmd.aliases?.length
          ? ` (别名: ${cmd.aliases.join(', ')})`
          : '';
        return {
          type: 'text' as const,
          value: `命令: /${cmd.name}${aliases}\n描述: ${cmd.description}${cmd.argumentHint ? `\n用法: /${cmd.name} ${cmd.argumentHint}` : ''}`,
        };
      }
      return { type: 'text' as const, value: `未找到命令: /${args}` };
    }

    const commands = commandRegistry.getVisible();
    const cmdList = commands
      .map((cmd) => `  /${cmd.name.padEnd(12)} - ${cmd.description}`)
      .join('\n');

    return {
      type: 'text' as const,
      value: `可用命令列表:\n\n${cmdList}\n\n使用 /<命令名> 或 /help <命令名> 获取更多信息`,
    };
  },
};
