import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

export interface SignalConfig {
  enabled: boolean;
  account?: string;
  phoneNumber?: string;
  signalCliPath?: string;
}

export interface SignalMessage {
  source: string;
  sourceNumber: string;
  sourceName?: string;
  message: string;
  timestamp: number;
  groupId?: string;
}

const SIGNAL_META: ChannelMeta = {
  id: 'signal',
  displayName: 'Signal',
  vendor: 'Signal Messenger',
  vendorSite: 'https://signal.org',
  icon: '🔒',
  markdownCapable: false,
  maxMessageLength: 2000,
  supportedMessageTypes: ['text', 'image', 'file'],
};

const SIGNAL_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: false,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

export class SignalChannel extends BaseChannelPlugin {
  private eventBus = new EventEmitter();
  private _account = '';
  private _phoneNumber = '';
  private _signalCliPath = 'signal-cli';

  readonly id = 'signal';
  readonly meta = SIGNAL_META;
  readonly capabilities = SIGNAL_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      account: '',
      phoneNumber: '',
      signalCliPath: 'signal-cli',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['account']) errors.push('缺少 account');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this._account = (config['account'] as string) || '';
    this._phoneNumber = (config['phoneNumber'] as string) || '';
    this._signalCliPath = (config['signalCliPath'] as string) || 'signal-cli';

    this.eventBus.emit('connected', { account: this._account });
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.eventBus.emit('message:sent', { target, content });
    return { success: true };
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, `[图片] ${imageUrl}`);
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'Signal: sendFile 未实现' };
  }

  handleIncomingMessage(message: SignalMessage): void {
    this.eventBus.emit('message_received', {
      source: message.source,
      sourceNumber: message.sourceNumber,
      content: message.message,
      groupId: message.groupId,
    });
  }
}

export const signalChannel = new SignalChannel();

export function createSignalChannel(): IChannelPlugin {
  return signalChannel;
}

export const signalChannelPlugin = signalChannel;
