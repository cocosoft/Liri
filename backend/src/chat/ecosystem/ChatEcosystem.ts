import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export interface ExtensionPoint {
  name: string;
  description: string;
  handlers: Set<ExtensionHandler>;
}

export type ExtensionHandler = (context: unknown) => Promise<unknown> | unknown;

export interface Extension {
  id: string;
  name: string;
  version: string;
  description: string;
  hooks: Record<string, ExtensionHandler>;
  priority: number;
}

export interface EcosystemEvent {
  type: string;
  source: string;
  data: unknown;
  timestamp: number;
}

export interface EcosystemMetrics {
  totalExtensions: number;
  totalHooks: number;
  totalEvents: number;
  eventsByType: Record<string, number>;
  activeExtensions: number;
  uptime: number;
}

export type EventListener = (event: EcosystemEvent) => void;

export interface IChatEcosystem {
  registerExtension(extension: Extension): void;
  unregisterExtension(id: string): boolean;
  getExtension(id: string): Extension | null;
  getExtensionsByHook(hookName: string): Extension[];
  executeHook(hookName: string, context: unknown): Promise<unknown[]>;
  emitEvent(type: string, source: string, data: unknown): void;
  onEvent(listener: EventListener): () => void;
  getMetrics(): EcosystemMetrics;
}

export class ChatEcosystem implements IChatEcosystem {
  private extensions: Map<string, Extension> = new Map();
  private extensionPoints: Map<string, ExtensionPoint> = new Map();
  private eventListeners: Set<EventListener> = new Set();
  private events: EcosystemEvent[] = [];
  private startTime: number = Date.now();
  private maxEvents: number;

  constructor(maxEvents: number = 1000) {
    this.maxEvents = maxEvents;
    this.registerDefaultExtensionPoints();
  }

  private registerDefaultExtensionPoints(): void {
    this.ensureExtensionPoint(
      'beforeSendMessage',
      'Called before a message is sent'
    );
    this.ensureExtensionPoint(
      'afterSendMessage',
      'Called after a message is sent'
    );
    this.ensureExtensionPoint(
      'beforeProcessStream',
      'Called before stream processing starts'
    );
    this.ensureExtensionPoint('onStreamChunk', 'Called for each stream chunk');
    this.ensureExtensionPoint(
      'afterProcessStream',
      'Called after stream processing completes'
    );
    this.ensureExtensionPoint(
      'beforeToolExecute',
      'Called before a tool execution'
    );
    this.ensureExtensionPoint(
      'afterToolExecute',
      'Called after a tool execution'
    );
    this.ensureExtensionPoint(
      'beforeSecurityCheck',
      'Called before security check'
    );
    this.ensureExtensionPoint(
      'afterSecurityCheck',
      'Called after security check'
    );
    this.ensureExtensionPoint(
      'onSessionCreated',
      'Called when a session is created'
    );
    this.ensureExtensionPoint('onSessionEnded', 'Called when a session ends');
  }

  private ensureExtensionPoint(name: string, description: string): void {
    if (!this.extensionPoints.has(name)) {
      this.extensionPoints.set(name, {
        name,
        description,
        handlers: new Set(),
      });
    }
  }

  registerExtension(extension: Extension): void {
    if (this.extensions.has(extension.id)) {
      throw new AppError(
        `Extension already registered: ${extension.id}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const sorted = [...this.extensions.values()].sort(
      (a, b) => b.priority - a.priority
    );
    this.extensions.set(extension.id, extension);

    for (const [hookName, handler] of Object.entries(extension.hooks)) {
      this.ensureExtensionPoint(
        hookName,
        `Hook from extension: ${extension.name}`
      );
      this.extensionPoints.get(hookName)!.handlers.add(handler);
    }

    this.emitEvent('extension.registered', 'ecosystem', {
      extensionId: extension.id,
      name: extension.name,
    });
  }

  unregisterExtension(id: string): boolean {
    const extension = this.extensions.get(id);
    if (!extension) return false;

    for (const [hookName, handler] of Object.entries(extension.hooks)) {
      const point = this.extensionPoints.get(hookName);
      if (point) {
        point.handlers.delete(handler);
      }
    }

    this.extensions.delete(id);
    this.emitEvent('extension.unregistered', 'ecosystem', { extensionId: id });
    return true;
  }

  getExtension(id: string): Extension | null {
    return this.extensions.get(id) || null;
  }

  getExtensionsByHook(hookName: string): Extension[] {
    const results: Extension[] = [];
    for (const [, extension] of this.extensions) {
      if (extension.hooks[hookName]) {
        results.push(extension);
      }
    }
    return results.sort((a, b) => b.priority - a.priority);
  }

  async executeHook(hookName: string, context: unknown): Promise<unknown[]> {
    const point = this.extensionPoints.get(hookName);
    if (!point) return [];

    const sortedExtensions = this.getExtensionsByHook(hookName);
    const results: unknown[] = [];

    for (const ext of sortedExtensions) {
      const handler = ext.hooks[hookName];
      if (handler) {
        try {
          const result = await handler(context);
          results.push({ extensionId: ext.id, result });
        } catch (error) {
          results.push({
            extensionId: ext.id,
            error: (error as Error).message,
          });
        }
      }
    }

    this.emitEvent('hook.executed', 'ecosystem', {
      hookName,
      resultCount: results.length,
    });
    return results;
  }

  emitEvent(type: string, source: string, data: unknown): void {
    const event: EcosystemEvent = {
      type,
      source,
      data,
      timestamp: Date.now(),
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  getMetrics(): EcosystemMetrics {
    const eventsByType: Record<string, number> = {};
    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    return {
      totalExtensions: this.extensions.size,
      totalHooks: [...this.extensionPoints.values()].reduce(
        (sum, p) => sum + p.handlers.size,
        0
      ),
      totalEvents: this.events.length,
      eventsByType,
      activeExtensions: this.extensions.size,
      uptime: Date.now() - this.startTime,
    };
  }
}

export const chatEcosystem = new ChatEcosystem();
