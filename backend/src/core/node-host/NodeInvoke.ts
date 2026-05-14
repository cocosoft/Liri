import { EventEmitter } from 'events';
import { InvokeRequest, InvokeResponse, NodeDefinition } from './types.js';
import { ExecPolicy, execPolicy } from './ExecPolicy.js';

export interface NodeInvokeHandler {
  canHandle(nodeId: string, operation: string): boolean;
  invoke(request: InvokeRequest): Promise<unknown>;
}

export class NodeInvoke extends EventEmitter {
  private nodes: Map<string, NodeDefinition> = new Map();
  private handlers: Map<string, NodeInvokeHandler> = new Map();
  private execPolicy: ExecPolicy;

  constructor(policy?: ExecPolicy) {
    super();
    this.execPolicy = policy || execPolicy;
  }

  registerNode(definition: NodeDefinition): void {
    this.nodes.set(definition.id, definition);
    this.emit('node:registered', definition);
  }

  unregisterNode(nodeId: string): boolean {
    const existed = this.nodes.delete(nodeId);

    if (existed) {
      this.emit('node:unregistered', nodeId);
    }

    return existed;
  }

  getNode(nodeId: string): NodeDefinition | undefined {
    return this.nodes.get(nodeId);
  }

  listNodes(type?: string): NodeDefinition[] {
    const all = Array.from(this.nodes.values());

    if (type) {
      return all.filter((n) => n.type === type);
    }

    return all;
  }

  registerHandler(pattern: string, handler: NodeInvokeHandler): void {
    this.handlers.set(pattern, handler);
    this.emit('handler:registered', { pattern, handler });
  }

  unregisterHandler(pattern: string): boolean {
    return this.handlers.delete(pattern);
  }

  async invoke(request: InvokeRequest): Promise<InvokeResponse> {
    const startTime = Date.now();

    const node = this.nodes.get(request.nodeId);

    if (!node) {
      return {
        success: false,
        requestId: this.generateRequestId(),
        error: `Node ${request.nodeId} not found`,
        durationMs: Date.now() - startTime,
        nodeId: request.nodeId,
      };
    }

    const handler = this.findHandler(request.nodeId, request.operation);

    if (!handler) {
      return {
        success: false,
        requestId: this.generateRequestId(),
        error: `No handler for ${request.nodeId}/${request.operation}`,
        durationMs: Date.now() - startTime,
        nodeId: request.nodeId,
      };
    }

    const check = this.execPolicy.canExecute(request.nodeId);

    if (!check.allowed) {
      return {
        success: false,
        requestId: this.generateRequestId(),
        error: check.reason || 'Execution not allowed',
        durationMs: Date.now() - startTime,
        nodeId: request.nodeId,
      };
    }

    this.emit('invoke:before', request);

    const result = await this.execPolicy.execute(
      request.nodeId,
      () => handler.invoke(request),
      { timeoutOverride: request.timeout }
    );

    const response: InvokeResponse = {
      success: result.success,
      requestId: this.generateRequestId(),
      result: result.result,
      error: result.error,
      durationMs: result.durationMs,
      nodeId: request.nodeId,
    };

    this.emit('invoke:after', response);

    return response;
  }

  getMetrics(nodeId: string): {
    nodeFound: boolean;
    handlerFound: boolean;
    canExecute: boolean;
  } {
    return {
      nodeFound: this.nodes.has(nodeId),
      handlerFound: this.findHandler(nodeId, '') !== undefined,
      canExecute: this.execPolicy.canExecute(nodeId).allowed,
    };
  }

  private findHandler(
    nodeId: string,
    operation: string
  ): NodeInvokeHandler | undefined {
    const exactMatchKey = `${nodeId}/${operation}`;

    for (const [pattern, handler] of this.handlers) {
      if (pattern === nodeId || pattern === exactMatchKey) {
        return handler;
      }
    }

    if (this.handlers.has('*')) {
      return this.handlers.get('*');
    }

    for (const [pattern, handler] of this.handlers) {
      if (nodeId.startsWith(pattern)) {
        if (handler.canHandle(nodeId, operation)) {
          return handler;
        }
      }
    }

    return undefined;
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export const nodeInvoke = new NodeInvoke();
