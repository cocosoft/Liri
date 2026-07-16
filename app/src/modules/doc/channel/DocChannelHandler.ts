/**
 * doc 模块渠道感知处理器
 * 注入 ChannelManager，支持渠道内创建文档和发送文件
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'doc:channel',
  level: LogLevel.INFO,
});

/**
 * doc 模块渠道处理器
 * 通过 DI 注入 ChannelManager 实例
 */
export class DocChannelHandler {
  // TODO: 注入 ChannelManager 实例
  // private channelManager: ChannelManager;

  constructor(/* channelManager: ChannelManager */) {
    // this.channelManager = channelManager;
  }

  /**
   * 渠道内创建文档并发送文件预览
   */
  async createAndSend(
    channelId: string,
    args: { filename: string; content: string }
  ): Promise<void> {
    logger.info('渠道文档创建', { channelId, filename: args.filename });
    // TODO: MCP 创建 + sendFile 实现
  }

  /**
   * 注册渠道感知工具到 ToolManager
   */
  registerTools(): void {
    logger.info('DocChannelHandler 工具已注册');
    // TODO: ToolManager.registerTool('doc:send-to-channel', ...)
  }
}
