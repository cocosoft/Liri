/**
 * GreetCommand 命令实现
 * 根据名称生成个性化问候
 */

import type { Command, CommandContext } from '../../../src/commands/types';

export class GreetCommand implements Command {
  /**
   * 命令名称
   */
  name = 'greet';
  
  /**
   * 命令描述
   */
  description = '生成个性化问候';
  
  /**
   * 命令使用方法
   */
  usage = 'greet <name>';
  
  /**
   * 命令别名
   */
  aliases = ['g'];

  /**
   * 执行命令
   */
  async execute(context: CommandContext): Promise<void> {
    const args = context.args;
    if (args.length === 0) {
      console.log('请提供名称: greet <name>');
      return;
    }

    const name = args[0];
    const hour = new Date().getHours();
    let greeting = '你好';

    if (hour < 12) greeting = '早上好';
    else if (hour < 18) greeting = '下午好';
    else greeting = '晚上好';

    console.log(`${greeting}, ${name}! 欢迎使用 Liri。`);
  }
}
