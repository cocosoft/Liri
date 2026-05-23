import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

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
  private _model = 'claude-sonnet-4-20250514';

  readonly id = 'claude';
  readonly meta = CLAUDE_META;
  readonly capabilities = CLAUDE_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      apiKey: '',
      apiUrl: 'https://api.anthropic.com/v1',
      organizationId: '',
      model: 'claude-sonnet-4-20250514',
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
    this._model = (config['model'] as string) || 'claude-sonnet-4-20250514';

    this.eventBus.emit('connected', { apiUrl: this._apiUrl });
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.eventBus.emit('message:sent', {
      conversationId: target,
      text: content,
    });
    return { success: true };
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
    this.eventBus.emit('system_prompt_sent', { text: content });
    return true;
  }

  handleIncomingMessage(message: ClaudeMessage): void {
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
