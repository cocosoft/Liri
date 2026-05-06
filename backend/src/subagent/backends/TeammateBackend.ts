/**
 * Teammate后端接口
 * 定义不同类型teammate的通用接口
 *
 * 基于CC源码 cc_code/backend/utils/swarm/backends/ 实现
 */

import type { Message } from '@modules/chat/types/message';
import type { SubAgent, SubAgentConfig } from '@modules/subagent/types/SubAgent';

export interface TeammateConfig {
  name: string;
  model?: string;
  description?: string;
  capabilities?: string[];
  memoryLimit?: number;
  systemPrompt?: string;
  tools?: any[];
}

export interface TeammateHandle {
  id: string;
  name: string;
  backend: TeammateBackend;
  agent: SubAgent;
  config: TeammateConfig;
  status: TeammateStatus;
  createdAt: number;
}

export type MessageHandler = (message: Message) => void;
export type TeammateStatusHandler = (status: TeammateStatus) => void;

export type TeammateStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export type TeammateBackendType = 'in_process' | 'tmux' | 'iterm' | 'pane';

export interface TeammateBackend {
  readonly type: TeammateBackendType;

  spawn(config: TeammateConfig): Promise<TeammateHandle>;

  kill(handle: TeammateHandle): Promise<void>;

  sendMessage(handle: TeammateHandle, message: Message): Promise<void>;

  onMessage(handle: TeammateHandle, callback: MessageHandler): void;

  offMessage(handle: TeammateHandle, callback: MessageHandler): void;

  getStatus(handle: TeammateHandle): Promise<TeammateStatus>;

  onStatusChange(handle: TeammateHandle, callback: TeammateStatusHandler): void;

  restart(handle: TeammateHandle): Promise<void>;

  isHealthy(handle: TeammateHandle): Promise<boolean>;
}

export interface TeammateBackendFactory {
  createBackend(type: TeammateBackendType): TeammateBackend;
  getSupportedTypes(): TeammateBackendType[];
}

export abstract class BaseTeammateBackend implements TeammateBackend {
  abstract readonly type: TeammateBackendType;

  protected handles: Map<string, TeammateHandle> = new Map();
  protected messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  protected statusHandlers: Map<string, Set<TeammateStatusHandler>> = new Map();

  async spawn(config: TeammateConfig): Promise<TeammateHandle> {
    const id = `${this.type}-${config.name}-${Date.now()}`;
    const handle: TeammateHandle = {
      id,
      name: config.name,
      backend: this,
      agent: null as any,
      config,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.handles.set(id, handle);
    this.messageHandlers.set(id, new Set());
    this.statusHandlers.set(id, new Set());

    this.updateStatus(handle, 'starting');

    try {
      const agent = await this.createAgent(config);
      handle.agent = agent;
      this.updateStatus(handle, 'running');
      return handle;
    } catch (error) {
      this.updateStatus(handle, 'error');
      throw error;
    }
  }

  async kill(handle: TeammateHandle): Promise<void> {
    this.updateStatus(handle, 'stopping');

    try {
      if (handle.agent) {
        await handle.agent.stop?.();
      }
      this.handles.delete(handle.id);
      this.messageHandlers.delete(handle.id);
      this.statusHandlers.delete(handle.id);
      this.updateStatus(handle, 'stopped');
    } catch (error) {
      this.updateStatus(handle, 'error');
      throw error;
    }
  }

  async sendMessage(handle: TeammateHandle, message: Message): Promise<void> {
    if (!handle.agent) {
      throw new Error(`Teammate ${handle.id} has no agent`);
    }

    const agent = handle.agent as any;
    if (typeof agent.sendMessage === 'function') {
      await agent.sendMessage(message);
    } else if (typeof agent.handleMessage === 'function') {
      await agent.handleMessage(message);
    }
  }

  onMessage(handle: TeammateHandle, callback: MessageHandler): void {
    const handlers = this.messageHandlers.get(handle.id);
    if (handlers) {
      handlers.add(callback);
    }
  }

  offMessage(handle: TeammateHandle, callback: MessageHandler): void {
    const handlers = this.messageHandlers.get(handle.id);
    if (handlers) {
      handlers.delete(callback);
    }
  }

  async getStatus(handle: TeammateHandle): Promise<TeammateStatus> {
    return handle.status;
  }

  onStatusChange(
    handle: TeammateHandle,
    callback: TeammateStatusHandler
  ): void {
    const handlers = this.statusHandlers.get(handle.id);
    if (handlers) {
      handlers.add(callback);
    }
  }

  async restart(handle: TeammateHandle): Promise<void> {
    this.updateStatus(handle, 'stopping');

    if (handle.agent) {
      await handle.agent.stop?.();
    }

    this.updateStatus(handle, 'starting');

    try {
      const agent = await this.createAgent(handle.config);
      handle.agent = agent;
      this.updateStatus(handle, 'running');
    } catch (error) {
      this.updateStatus(handle, 'error');
      throw error;
    }
  }

  async isHealthy(handle: TeammateHandle): Promise<boolean> {
    if (handle.status !== 'running') {
      return false;
    }

    if (!handle.agent) {
      return false;
    }

    const agent = handle.agent as any;
    if (typeof agent.isHealthy === 'function') {
      return agent.isHealthy();
    }

    return true;
  }

  protected abstract createAgent(config: TeammateConfig): Promise<SubAgent>;

  protected updateStatus(handle: TeammateHandle, status: TeammateStatus): void {
    handle.status = status;
    const handlers = this.statusHandlers.get(handle.id);
    if (handlers) {
      handlers.forEach((callback) => callback(status));
    }
  }

  protected notifyMessage(handle: TeammateHandle, message: Message): void {
    const handlers = this.messageHandlers.get(handle.id);
    if (handlers) {
      handlers.forEach((callback) => callback(message));
    }
  }

  protected getHandle(id: string): TeammateHandle | undefined {
    return this.handles.get(id);
  }

  protected getAllHandles(): TeammateHandle[] {
    return Array.from(this.handles.values());
  }
}
