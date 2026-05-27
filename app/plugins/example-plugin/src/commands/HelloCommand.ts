/**
 * HelloCommand 命令实现
 * 显示欢迎信息和系统状态
 */

import type { Command, CommandContext } from '../../../src/commands/types';

export class HelloCommand implements Command {
  /**
   * 命令名称
   */
  name = 'hello';
  
  /**
   * 命令描述
   */
  description = '显示欢迎信息和系统状态';
  
  /**
   * 命令别名
   */
  aliases = ['h', 'welcome'];

  /**
   * 执行命令
   */
  async execute(context: CommandContext): Promise<void> {
    console.log('=== PY_APP 欢迎使用 ===');
    console.log('版本: 1.0.0');
    console.log('插件: example-plugin');
    console.log('状态: 运行中');
  }
}
