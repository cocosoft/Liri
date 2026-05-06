import type { CommandContext } from '@modules/commands/types';
export default {
  async call(
    args: string,
    _context: CommandContext
  ): Promise<{ type: 'text'; value: string }> {
    const statusInfo = `
PY_APP 系统状态
========================

命令系统: 运行中
  - 帮助命令: /help
  - 状态命令: /status
  - 清屏命令: /clear

运行时间: ${process.uptime().toFixed(2)}s
Node版本: ${process.version}
`;

    return { type: 'text', value: statusInfo.trim() };
  },
};
