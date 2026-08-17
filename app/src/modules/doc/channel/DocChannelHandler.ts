/**
 * doc 模块渠道感知处理器
 * 注入 ChannelManager，支持渠道内创建文档和发送文件
 */

import { getLogger } from '@modules/monitoring';
import { AppError } from '@modules/error';
const logger = getLogger('doc:channel');

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
   * G-12：显式未实现——原静默 log 返回成功属"假成功"，改为抛出明确错误
   */
  async createAndSend(
    channelId: string,
    args: { filename: string; content: string }
  ): Promise<void> {
    throw new AppError(
      '渠道内创建文档功能未实现',
      'UNIMPLEMENTED' as any,
      'MEDIUM' as any,
      'DOC_CHANNEL_UNIMPLEMENTED',
      { channelId, filename: args.filename }
    );
  }

  /**
   * 注册渠道感知工具到 ToolManager
   * G-12：未实现——不再输出"已注册"误导日志
   */
  registerTools(): void {
    logger.warn(
      '渠道感知工具未注册：DocChannelHandler 尚未接入 ToolManager（G-12）'
    );
  }
}
