/**
 * SlackAdapter — Slack 平台适配器
 *
 * 参考实现，演示 PlatformAdapter 接口的使用方式。
 * 包装现有的 SlackChannel，提供标准 PlatformAdapter 接口。
 */

import {
  BasePlatformAdapter,
  type PlatformMessageEvent,
  type PlatformProcessingOutcome,
} from './PlatformAdapter.js';
import { SlackChannel } from '@modules/channels/slack';

/**
 * Slack 平台适配器
 *
 * 通过 PlatformAdapterBridge 可自动注册为 IChannelPlugin，
 * 也可直接使用 adapter.handleMessage() 处理回调。
 */
export class SlackAdapter extends BasePlatformAdapter {
  readonly name = 'Slack';
  readonly type = 'slack' as const;

  private channel: SlackChannel;

  constructor() {
    super();
    this.channel = new SlackChannel();
  }

  async setup(config: Record<string, unknown>): Promise<void> {
    const ok = await this.channel.connect();
    this._connected = ok;

    if (!ok) {
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
    return this.channel.sendMessage(target, text);
  }

  override getStatus(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      connected: this._connected,
      enabled: this._enabled,
    };
  }

  override get rawAdapter(): SlackChannel {
    return this.channel;
  }
}
