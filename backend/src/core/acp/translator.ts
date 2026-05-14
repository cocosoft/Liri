import {
  AclMessage,
  AclAgentInfo,
} from './types.js';

export type TranslateFormat = 'json' | 'compact' | 'minimal';

export interface TranslateResult {
  format: TranslateFormat;
  content: string;
}

export type TranslateHandler = (message: AclMessage, targetFormat: TranslateFormat) => TranslateResult;

export class AclTranslator {
  private customHandlers: Map<string, TranslateHandler> = new Map();
  private systemName: string;

  constructor(systemName: string = 'ACP') {
    this.systemName = systemName;
  }

  translate(message: AclMessage, targetFormat: TranslateFormat = 'json'): TranslateResult {
    const handlerKey = `${targetFormat}`;

    if (this.customHandlers.has(handlerKey)) {
      const handler = this.customHandlers.get(handlerKey)!;
      return handler(message, targetFormat);
    }

    switch (targetFormat) {
      case 'json':
        return this.toJson(message);
      case 'compact':
        return this.toCompact(message);
      case 'minimal':
        return this.toMinimal(message);
      default:
        return this.toJson(message);
    }
  }

  registerFormat(name: string, handler: TranslateHandler): void {
    this.customHandlers.set(name, handler);
  }

  unregisterFormat(name: string): boolean {
    return this.customHandlers.delete(name);
  }

  listFormats(): string[] {
    return ['json', 'compact', 'minimal', ...Array.from(this.customHandlers.keys())];
  }

  toJson(message: AclMessage): TranslateResult {
    return {
      format: 'json',
      content: JSON.stringify(message, null, 2),
    };
  }

  toCompact(message: AclMessage): TranslateResult {
    const compact = {
      t: message.type,
      f: message.sender,
      to: message.target,
      p: message.payload,
      id: message.id,
      ts: message.timestamp,
    };

    return {
      format: 'compact',
      content: JSON.stringify(compact),
    };
  }

  toMinimal(message: AclMessage): TranslateResult {
    const summary = `[${this.systemName}] ${message.role}:${message.type}` +
      ` ${message.sender}${message.target ? ` -> ${message.target}` : ''}` +
      ` | ${JSON.stringify(message.payload).substring(0, 100)}`;

    return {
      format: 'minimal',
      content: summary,
    };
  }

  createAgentSummary(agent: AclAgentInfo): string {
    const caps = agent.capabilities.map((c) => `${c.name} v${c.version}`).join(', ');

    return [
      `Agent: ${agent.name} (${agent.id})`,
      `Version: ${agent.version}`,
      `Transport: ${agent.transport}${agent.endpoint ? ` @ ${agent.endpoint}` : ''}`,
      `Capabilities: ${caps || 'none'}`,
    ].join('\n');
  }

  createMessageDigest(messages: AclMessage[]): string {
    return messages.map((m) => {
      const preview = typeof m.payload === 'object'
        ? JSON.stringify(m.payload).substring(0, 80)
        : String(m.payload).substring(0, 80);

      return `[${new Date(m.timestamp).toISOString()}] ${m.role}:${m.type}` +
        ` ${m.sender} -> ${m.target || '*'}\n  ${preview}`;
    }).join('\n');
  }

  extractPayload<T = unknown>(message: AclMessage): T | undefined {
    if (message.payload === undefined || message.payload === null) {
      return undefined;
    }

    return message.payload as T;
  }
}
