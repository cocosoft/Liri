/**
 * 简化版 Example plugin for Liri
 * 使用 createPlugin 辅助函数，减少样板代码
 */

import { createPlugin } from '../../../src/plugins/utils/createPlugin';
import { HelloCommand } from './commands/HelloCommand';
import { StatusCommand } from './commands/StatusCommand';
import { GreetCommand } from './commands/GreetCommand';
import { FileInfoTool } from './tools/FileInfoTool';
import { DirSizeTool } from './tools/DirSizeTool';
import { SystemInfoTool } from './tools/SystemInfoTool';

export default createPlugin({
  metadata: {
    name: 'example-plugin',
    version: '1.0.0',
    description: 'An example plugin for Liri with commands and tools',
    author: 'Liri Team',
    type: 'tool'
  },

  async initialize(context) {
    context.log('info', 'Example plugin initialized');

    for (const tool of [FileInfoTool, DirSizeTool, SystemInfoTool]) {
      context.registerTool(tool);
    }

    for (const command of [new HelloCommand(), new StatusCommand(), new GreetCommand()]) {
      context.registerCommand(command);
    }
  },

  async start() {
    console.log('Example plugin started');
  },

  async stop() {
    console.log('Example plugin stopped');
  }
});
