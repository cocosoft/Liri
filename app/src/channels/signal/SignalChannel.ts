import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { SIGNAL_SERVICE_URL, SIGNAL_SITE_URL } from '../constants';
const logger = getLogger('channels:signal:SignalChannel');

const execFileAsync = promisify(execFile);

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

/**
 * `signal-cli` 发送命令的参数（**上游 CLI 契约**，2026-11-01 抽出以便单测）。
 *
 * 形状：`signal-cli -a <account> send -m <message> <target>`；改参数顺序/旗标
 * 等于改上游契约，必须同步改本函数与 `signalStub.test.ts`。
 */
export function buildSignalSendArgs(
  account: string,
  message: string,
  target: string
): string[] {
  return ['-a', account, 'send', '-m', message, target];
}

const SIGNAL_META: ChannelMeta = {
  id: 'signal',
  displayName: 'Signal',
  vendor: 'Signal Messenger',
  vendorSite: SIGNAL_SITE_URL,
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
      signalServiceUrl: SIGNAL_SERVICE_URL,
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
    if (!this._account) {
      // 2026-11-01：缺 account 时 `signal-cli -a ''` 必然失败 —— 提前如实失败，不调起 CLI
      return { success: false, error: 'Signal 未连接：缺少 account' };
    }
    try {
      await execFileAsync(
        this._signalCliPath,
        buildSignalSendArgs(this._account, content, target)
      );
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:signal',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: `Signal CLI 错误: ${e}` };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    if (!this._account) {
      return { success: false, error: 'Signal 未连接：缺少 account' };
    }
    try {
      await execFileAsync(
        this._signalCliPath,
        buildSignalSendArgs(this._account, `[图片] ${imageUrl}`, target)
      );
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:signal',
        action: 'sendImageMessage',
        context: { target },
      });
      return { success: false, error: `Signal CLI 错误: ${e}` };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    try {
      await execFileAsync(this._signalCliPath, [
        '-a',
        this._account,
        'send',
        '-m',
        '',
        '-a',
        filePath,
        target,
      ]);
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:signal',
        action: 'sendFileMessage',
        context: { target, filePath },
      });
      return { success: false, error: `Signal CLI 错误: ${e}` };
    }
  }

  incomingCustomMessage(message: SignalMessage): void {
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
