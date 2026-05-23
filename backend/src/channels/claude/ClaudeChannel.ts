import { EventEmitter } from 'node:events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelStatus,
  SendResult,
  InteractiveCard,
  ResolvedSender,
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

export class ClaudeChannel extends EventEmitter {
  private config: ClaudeConfig;
  private connected: boolean = false;

  constructor(config?: Partial<ClaudeConfig>) {
    super();

    this.config = {
      enabled: config?.enabled ?? false,
      apiKey: config?.apiKey,
      apiUrl: config?.apiUrl ?? 'https://api.anthropic.com/v1',
      organizationId: config?.organizationId,
      model: config?.model ?? 'claude-sonnet-4-20250514',
    };
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled || !this.config.apiKey) return false;

    this.connected = true;
    this.emit('connected', { apiUrl: this.config.apiUrl });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { conversationId: target, text: content });

    return true;
  }

  async sendSystemPrompt(content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('system_prompt_sent', { text: content });

    return true;
  }

  handleIncomingMessage(message: ClaudeMessage): void {
    this.emit('message_received', {
      id: message.id,
      content: message.content,
      role: message.role,
      conversationId: message.conversationId,
    });
  }
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

export const claudeChannel = new ClaudeChannel();

export function createClaudeChannel(): IChannelPlugin {
  return {
    id: 'claude',
    meta: CLAUDE_META,
    capabilities: CLAUDE_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['apiKey']) errors.push('缺少 apiKey');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          apiKey: '',
          apiUrl: 'https://api.anthropic.com/v1',
          organizationId: '',
          model: 'claude-sonnet-4-20250514',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await claudeChannel.connect();
      },
      async disconnect(): Promise<void> {
        await claudeChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: claudeChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: claudeChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await claudeChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        return this.sendText(target, content);
      },
      async sendImage(_target: string, _imageUrl: string): Promise<SendResult> {
        return { success: false, error: 'Claude: sendImage 未实现' };
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'Claude: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'Claude: sendInteractive 未实现' };
      },
    },

    security: {
      dmPolicy: 'open',
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 3,
      async resolveSender(
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> {
        return {
          userId: (sender['userId'] as string) || 'unknown',
          displayName: (sender['senderName'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const claudeChannelPlugin = createClaudeChannel();
