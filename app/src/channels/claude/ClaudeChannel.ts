import { EventEmitter } from 'events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({
  module: 'channels:claude:ClaudeChannel',
  level: LogLevel.INFO,
});

export interface ClaudeConfig {
  enabled: boolean;
  apiKey?: string;
  apiUrl?: string;
  organizationId?: string;
  model?: string;
}

export interface ClaudeMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  conversationId: string;
  timestamp: string;
}

const CLAUDE_META: ChannelMeta = {
  id: 'claude',
  displayName: 'Claude',
  vendor: 'Anthropic',
  vendorSite: 'https://anthropic.com',
  icon: '🤖',
  markdownCapable: true,
  maxMessageLength: 100000,
  supportedMessageTypes: ['text', 'markdown'],
};

const CLAUDE_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: false,
  threading: true,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: false,
};

export class ClaudeChannel extends BaseChannelPlugin {
  private eventBus = new EventEmitter();
  private _apiKey = '';
  private _apiUrl = 'https://api.anthropic.com/v1';
  private _organizationId = '';
  private _model = '';

  readonly id = 'claude';
  readonly meta = CLAUDE_META;
  readonly capabilities = CLAUDE_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      apiKey: '',
      apiUrl: 'https://api.anthropic.com/v1',
      organizationId: '',
      model: '',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['apiKey']) errors.push('缺少 apiKey');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this._apiKey = (config['apiKey'] as string) || '';
    this._apiUrl =
      (config['apiUrl'] as string) || 'https://api.anthropic.com/v1';
    this._organizationId = (config['organizationId'] as string) || '';
    this._model = (config['model'] as string) || '';

    this.eventBus.emit('connected', { apiUrl: this._apiUrl });
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      const baseUrl = this._apiUrl.replace(/\/$/, '');
      const resp = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this._apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this._model,
          max_tokens: 1024,
          messages: [{ role: 'user', content }],
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `Anthropic API 错误: ${err}` };
      }
      const data = (await resp.json()) as { content: Array<{ text: string }> };
      const replyText = data.content?.map((c) => c.text).join('\n') || '';
      this.eventBus.emit('message_received', {
        conversationId: target,
        content: replyText,
        role: 'assistant',
      });
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:claude',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'Claude: sendImage 未实现' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'Claude: sendFile 未实现' };
  }

  async sendSystemPrompt(content: string): Promise<boolean> {
    try {
      const baseUrl = this._apiUrl.replace(/\/$/, '');
      const resp = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this._apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this._model,
          max_tokens: 1024,
          system: content,
          messages: [{ role: 'user', content: 'OK' }],
        }),
      });
      if (!resp.ok) {
        this.logger.warn(
          `Anthropic system prompt API 错误: ${await resp.text()}`
        );
        return false;
      }
      return true;
    } catch (e) {
      await handleError(e, {
        module: 'channels:claude',
        action: 'sendSystemPrompt',
      });
      this.logger.warn(`Anthropic system prompt 失败: ${e}`);
      return false;
    }
  }

  incomingCustomMessage(message: ClaudeMessage): void {
    this.eventBus.emit('message_received', {
      id: message.id,
      content: message.content,
      role: message.role,
      conversationId: message.conversationId,
    });
  }
}

export const claudeChannel = new ClaudeChannel();

export function createClaudeChannel(): IChannelPlugin {
  return claudeChannel;
}

export const claudeChannelPlugin = claudeChannel;
