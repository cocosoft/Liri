import { EventEmitter } from 'events';

export interface MockMessage {
  id: string;
  channelId: string;
  content: string;
  sender: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MockChannelConfig {
  id: string;
  name: string;
  type: string;
  simulateLatency?: number;
  errorRate?: number;
}

export class MockChannel extends EventEmitter {
  public readonly config: MockChannelConfig;
  public messages: MockMessage[] = [];
  public isConnected: boolean = false;
  private messageCounter: number = 0;

  constructor(config: MockChannelConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<boolean> {
    this.isConnected = true;
    this.emit('connected', { channelId: this.config.id });

    return true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.emit('disconnected', { channelId: this.config.id });
  }

  async sendMessage(
    content: string,
    sender: string = 'test-user'
  ): Promise<MockMessage> {
    await this.simulateLatency();

    if (this.shouldSimulateError()) {
      throw new Error(`Simulated error on channel ${this.config.id}`);
    }

    const message: MockMessage = {
      id: `msg-${++this.messageCounter}`,
      channelId: this.config.id,
      content,
      sender,
      timestamp: Date.now(),
    };

    this.messages.push(message);
    this.emit('message:sent', message);

    return message;
  }

  async receiveMessage(): Promise<MockMessage | null> {
    await this.simulateLatency();

    if (this.messages.length === 0) {
      return null;
    }

    return this.messages[this.messages.length - 1];
  }

  async receiveAllMessages(): Promise<MockMessage[]> {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
    this.emit('messages:cleared');
  }

  simulateIncoming(
    content: string,
    sender: string = 'external-user'
  ): MockMessage {
    const message: MockMessage = {
      id: `incoming-${++this.messageCounter}`,
      channelId: this.config.id,
      content,
      sender,
      timestamp: Date.now(),
    };

    this.messages.push(message);
    this.emit('message:received', message);

    return message;
  }

  private async simulateLatency(): Promise<void> {
    if (this.config.simulateLatency && this.config.simulateLatency > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.simulateLatency)
      );
    }
  }

  private shouldSimulateError(): boolean {
    if (!this.config.errorRate || this.config.errorRate <= 0) {
      return false;
    }

    return Math.random() < this.config.errorRate;
  }
}
