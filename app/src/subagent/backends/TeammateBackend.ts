/**
 * Teammate后端接口
 * 定义不同类型teammate的通用接口
 * */

import type { Message } from '@modules/chat/types/message';
import type {
  SubAgent,
  SubAgentConfig,
} from '@modules/subagent/types/SubAgent';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('subagent\backends\TeammateBackend');

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
      agent: null as unknown as SubAgent,
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
      // BUG 7 修复（2026-08-27）：createAgent 失败时清理已注册的 handle
      //（原残留：manager 因 await 抛错不持有，backend 内部 Map 永久残留）
      this.updateStatus(handle, 'error');
      this.handles.delete(handle.id);
      this.messageHandlers.delete(handle.id);
      this.statusHandlers.delete(handle.id);
      throw error;
    }
  }

  async kill(handle: TeammateHandle): Promise<void> {
    this.updateStatus(handle, 'stopping');

    try {
      if (handle.agent) {
        await handle.agent.stop?.();
      }
      // BUG 14 修复（2026-08-27）：先发 stopped 事件再删 statusHandlers——
      // 原顺序导致 TeammateManager.handleStatusChange 永远收不到 stopped
      this.updateStatus(handle, 'stopped');
      this.handles.delete(handle.id);
      this.messageHandlers.delete(handle.id);
      this.statusHandlers.delete(handle.id);
    } catch (error) {
      this.updateStatus(handle, 'error');
      throw error;
    }
  }

  async sendMessage(handle: TeammateHandle, message: Message): Promise<void> {
    if (!handle.agent) {
      throw new AppError(
        `Teammate ${handle.id} has no agent`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const agent = handle.agent as any;
    if (typeof agent.sendMessage === 'function') {
      await agent.sendMessage(message);
    } else if (typeof agent.handleMessage === 'function') {
      await agent.handleMessage(message);
    } else {
      // BUG 10 修复（2026-08-27）：无消息处理函数时抛错而非静默成功
      throw new AppError(
        `Teammate ${handle.name} 不支持消息投递（无 sendMessage/handleMessage）`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
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
