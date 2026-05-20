import { BasePlatformAdapter, type PlatformType } from './BasePlatformAdapter';

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

export class ClaudeChannel extends BasePlatformAdapter {
  private lastMessage: ClaudeMessage | null = null;

  constructor(config?: Partial<ClaudeConfig>) {
    super('wechat' as PlatformType, {
      enabled: config?.enabled ?? false,
      apiKey: config?.apiKey,
      apiUrl: config?.apiUrl ?? 'https://api.anthropic.com/v1',
      organizationId: config?.organizationId,
      model: config?.model ?? 'claude-sonnet-4-20250514',
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as ClaudeConfig;
    if (!cfg.enabled || !cfg.apiKey) return false;

    this.connected = true;
    this.emitEvent('connected', { apiUrl: cfg.apiUrl });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('message_sent', {
      conversationId: target,
      text: truncated,
    });

    return true;
  }

  async sendSystemPrompt(content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emitEvent('system_prompt_sent', { text: content });

    return true;
  }

  handleIncomingMessage(message: ClaudeMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      id: message.id,
      content: message.content,
      role: message.role,
      conversationId: message.conversationId,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      apiUrl: (this._config as unknown as ClaudeConfig).apiUrl,
      model: (this._config as unknown as ClaudeConfig).model,
      capabilities: {
        textMessage: true,
        systemPrompt: true,
        multiTurnConversation: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const claudeChannel = new ClaudeChannel();
