import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

export interface MatrixConfig {
  enabled: boolean;
  homeserverUrl?: string;
  accessToken?: string;
  userId?: string;
  autoJoinRooms: boolean;
}

export interface MatrixMessage {
  eventId: string;
  sender: string;
  roomId: string;
  content: { body: string; msgtype: string };
  originServerTs: number;
}

const MATRIX_META: ChannelMeta = {
  id: 'matrix',
  displayName: 'Matrix',
  vendor: 'Matrix.org',
  vendorSite: 'https://matrix.org',
  icon: '🧩',
  markdownCapable: true,
  maxMessageLength: 65536,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown'],
};

const MATRIX_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

export class MatrixChannel extends BaseChannelPlugin {
  private eventBus = new EventEmitter();
  private _homeserverUrl = '';
  private _accessToken = '';
  private _userId = '';
  private _autoJoinRooms = false;

  readonly id = 'matrix';
  readonly meta = MATRIX_META;
  readonly capabilities = MATRIX_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      homeserverUrl: '',
      accessToken: '',
      userId: '',
      autoJoinRooms: false,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['homeserverUrl']) errors.push('缺少 homeserverUrl');
    if (!config['accessToken']) errors.push('缺少 accessToken');
    if (!config['userId']) errors.push('缺少 userId');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this._homeserverUrl = (config['homeserverUrl'] as string) || '';
    this._accessToken = (config['accessToken'] as string) || '';
    this._userId = (config['userId'] as string) || '';
    this._autoJoinRooms = (config['autoJoinRooms'] as boolean) ?? false;

    this.eventBus.emit('connected', {
      homeserverUrl: this._homeserverUrl,
      userId: this._userId,
    });
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.eventBus.emit('message:sent', {
      roomId: target,
      msgtype: 'm.text',
      body: content,
    });
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
    return { success: false, error: 'Matrix: sendFile 未实现' };
  }

  handleIncomingMessage(message: MatrixMessage): void {
    this.eventBus.emit('message_received', {
      sender: message.sender,
      roomId: message.roomId,
      body: message.content.body,
      eventId: message.eventId,
    });
  }
}

export const matrixChannel = new MatrixChannel();

export function createMatrixChannel(): IChannelPlugin {
  return matrixChannel;
}

export const matrixChannelPlugin = matrixChannel;
