export interface QAHandler {
  name: string;
  patterns: RegExp[];
  priority: number;
  handle(input: string): { response: string; confidence: number } | null;
}

export interface QAEngineResult {
  response: string;
  confidence: number;
  handler: string;
}

export class SimpleQAEngine {
  private handlers: QAHandler[] = [];

  registerHandler(handler: QAHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => b.priority - a.priority);
  }

  registerHandlers(handlers: QAHandler[]): void {
    for (const handler of handlers) {
      this.registerHandler(handler);
    }
  }

  process(input: string): QAEngineResult | null {
    for (const handler of this.handlers) {
      for (const pattern of handler.patterns) {
        if (pattern.test(input)) {
          const result = handler.handle(input);
          if (result !== null) {
            return {
              response: result.response,
              confidence: result.confidence,
              handler: handler.name,
            };
          }
          break;
        }
      }
    }
    return null;
  }

  getHandlerCount(): number {
    return this.handlers.length;
  }

  clearHandlers(): void {
    this.handlers = [];
  }
}
