import type { CommandContext } from '@modules/commands/types';

export default {
  async call(args: string, context: CommandContext): Promise<{ type: 'skip' }> {
    process.stdout.write('\x1b[2J\x1b[H');

    context.onDone?.('屏幕已清空', { display: 'system' });

    return { type: 'skip' };
  },
};
