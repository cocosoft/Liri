/**
 * SlackAdapter — Slack 平台适配器
 *
 * 参考实现，演示 PlatformAdapter 接口的使用方式。
 * 包装现有的 SlackChannelPlugin，提供标准 PlatformAdapter 接口。
 */

import {
  BasePlatformAdapter,
  type PlatformMessageEvent,
  type PlatformProcessingOutcome,
} from './PlatformAdapter.js';
import { slackChannelPlugin } from '@modules/channels/slack';

/**
 * Slack 平台适配器
 *
 * 通过 PlatformAdapterBridge 可自动注册为 IChannelPlugin，
 * 也可直接使用 adapter.handleMessage() 处理回调。
 */
export class SlackAdapter extends BasePlatformAdapter {
  readonly name = 'Slack';
  readonly type = 'slack' as const;

  constructor() {
    super();
  }

  async setup(config: Record<string, unknown>): Promise<void> {
    const channelConfig = {
      botToken: config['botToken'],
      appToken: config['appToken'],
      signingSecret: config['signingSecret'],
      channels: config['channels'] || [],
    };
    await slackChannelPlugin.lifecycle.connect(channelConfig);
    this._connected = true;
    const status = slackChannelPlugin.lifecycle.getStatus();
    if (!status.connected) {
      throw new Error('Slack 连接失败：请检查 botToken 配置');
    }
  }

  async handleMessage(
    event: PlatformMessageEvent
  ): Promise<PlatformProcessingOutcome> {
    if (event.isDirectMessage) {
      return { handled: true };
    }
    return { handled: true };
  }

  async sendMessage(target: string, text: string): Promise<boolean> {
    const result = await slackChannelPlugin.outbound.sendText(target, text);
    return result.success;
  }

  override getStatus(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      connected: this._connected,
      enabled: this._enabled,
    };
  }
}
