/**
 * Teammate管理器
 * 管理多个teammate的生命周期
 * */

import type { Message } from '../chat/types/message';
import {
  TeammateBackend,
  TeammateConfig,
  TeammateHandle,
  TeammateBackendType,
  TeammateStatus,
  MessageHandler,
} from './backends/TeammateBackend';
import { InProcessTeammateBackend } from './backends/InProcessTeammateBackend';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getTaskConcurrencyLimits } from '../tasks/limits';

const logger = getLogger('subagent:teammateManager');

export interface TeamManagerConfig {
  maxTeammates?: number;
  defaultBackendType?: TeammateBackendType;
  enableMessageBroadcast?: boolean;
  enableStatusTracking?: boolean;
}

export interface TeamMember {
  handle: TeammateHandle;
  joinedAt: number;
  lastActiveAt: number;
  messageCount: number;
}

export class TeammateManager {
  private backends: Map<TeammateBackendType, TeammateBackend> = new Map();
  private activeTeammates: Map<string, TeammateHandle> = new Map();
  private teamMembers: Map<string, TeamMember> = new Map();
  private messageHistory: Map<string, Message[]> = new Map();
  private config: TeamManagerConfig;
  private globalMessageHandlers: Set<MessageHandler> = new Set();

  constructor(config: TeamManagerConfig = {}) {
    this.config = {
      // 1-4（2026-09-03）：默认值收敛到 tasks/limits.ts（env TASK_MAX_TEAMMATES）；显式 config 仍优先
      maxTeammates: getTaskConcurrencyLimits().maxTeammates,
      defaultBackendType: 'in_process',
      enableMessageBroadcast: true,
      enableStatusTracking: true,
      ...config,
    };

    this.registerBuiltInBackends();
  }

  private registerBuiltInBackends(): void {
    this.registerBackend('in_process', new InProcessTeammateBackend());
  }

  registerBackend(type: TeammateBackendType, backend: TeammateBackend): void {
    if (this.backends.has(type)) {
      logger.warning(`Backend type ${type} already registered, replacing...`);
    }
    this.backends.set(type, backend);
  }

  async spawnTeammate(
    type: TeammateBackendType,
    config: TeammateConfig
  ): Promise<TeammateHandle> {
    if (
      this.activeTeammates.size >=
      (this.config.maxTeammates ?? getTaskConcurrencyLimits().maxTeammates)
    ) {
      throw new AppError(
        `Maximum number of teammates (${this.config.maxTeammates}) reached`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const backend = this.backends.get(type);
    if (!backend) {
      throw new AppError(
        `Backend type ${type} not registered`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const existingTeammate = this.findTeammateByName(config.name);
    if (existingTeammate) {
      throw new AppError(
        `Teammate with name ${config.name} already exists`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const handle = await backend.spawn(config);
    this.activeTeammates.set(handle.id, handle);

    this.teamMembers.set(handle.id, {
      handle,
      joinedAt: Date.now(),
      lastActiveAt: Date.now(),
      messageCount: 0,
    });

    this.messageHistory.set(handle.id, []);

    if (this.config.enableStatusTracking) {
      backend.onStatusChange(handle, (status) => {
        this.handleStatusChange(handle.id, status);
      });
    }

    logger.info(`Teammate ${config.name} (${type}) spawned successfully`);
    return handle;
  }

  async killTeammate(teammateId: string): Promise<void> {
    const handle = this.activeTeammates.get(teammateId);
    if (!handle) {
      throw new AppError(
        `Teammate ${teammateId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    try {
      await handle.backend.kill(handle);
    } finally {
      // kill 异常路径清理（2026-08-27）：agent.stop 抛错时也确保不残留
      this.activeTeammates.delete(teammateId);
      this.teamMembers.delete(teammateId);
      this.messageHistory.delete(teammateId);
    }

    logger.info(`Teammate ${teammateId} terminated`);
  }

  async sendMessageToTeammate(
    teammateId: string,
    message: Message
  ): Promise<void> {
    // 缺陷 1 修复（2026-08-26）：先按 ID 精确匹配，未命中再按名字回退——
    // SendMessageTool 投递时 to 是接收者名字（如 "worker"），而 teammate ID 含
    // 时间戳不可预测（inprocess-worker-<ts>），原仅 get(id) 恒失败（假投递）
    const handle =
      this.activeTeammates.get(teammateId) ??
      this.findTeammateByName(teammateId);
    if (!handle) {
      throw new AppError(
        `Teammate ${teammateId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await handle.backend.sendMessage(handle, message);
    // BUG 8 修复（2026-08-27）：统计按 handle.id 更新——原用传入的 teammateId
    //（名字）作 key，teamMembers 以 handle.id 为 key，lastActiveAt/messageCount 永不更新
    this.updateLastActive(handle.id);
    this.recordMessage(handle.id, message);
  }

  async broadcastMessage(message: Message): Promise<void> {
    if (!this.config.enableMessageBroadcast) {
      throw new AppError(
        'Message broadcast is disabled',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const promises = Array.from(this.activeTeammates.values()).map((handle) =>
      handle.backend.sendMessage(handle, message).catch((error) => {
        logger.error(`Failed to send broadcast to ${handle.name}:`, { error });
      })
    );

    await Promise.allSettled(promises);
    this.globalMessageHandlers.forEach((handler) => handler(message));
  }

  async broadcastMessageExcluding(
    message: Message,
    excludeTeammateId: string
  ): Promise<void> {
    const promises = Array.from(this.activeTeammates.values())
      .filter((handle) => handle.id !== excludeTeammateId)
      .map((handle) =>
        handle.backend.sendMessage(handle, message).catch((error) => {
          logger.error(`Failed to send message to ${handle.name}:`, { error });
        })
      );

    await Promise.allSettled(promises);
  }

  async terminateAll(): Promise<void> {
    const teammateIds = Array.from(this.activeTeammates.keys());
    await Promise.allSettled(teammateIds.map((id) => this.killTeammate(id)));

    logger.info(`All ${teammateIds.length} teammates terminated`);
  }

  onTeammateMessage(teammateId: string, callback: MessageHandler): void {
    const handle = this.activeTeammates.get(teammateId);
    if (!handle) {
      throw new AppError(
        `Teammate ${teammateId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    handle.backend.onMessage(handle, callback);
  }

  onGlobalMessage(callback: MessageHandler): () => void {
    this.globalMessageHandlers.add(callback);
    return () => {
      this.globalMessageHandlers.delete(callback);
    };
  }

  getTeammate(teammateId: string): TeammateHandle | undefined {
    return this.activeTeammates.get(teammateId);
  }

  getTeammateByName(name: string): TeammateHandle | undefined {
    return this.findTeammateByName(name);
  }

  getActiveTeammates(): TeammateHandle[] {
    return Array.from(this.activeTeammates.values());
  }

  getTeamMembers(): TeamMember[] {
    return Array.from(this.teamMembers.values());
  }

  getTeammateCount(): number {
    return this.activeTeammates.size;
  }

  async getTeammateStatus(teammateId: string): Promise<TeammateStatus> {
    const handle = this.activeTeammates.get(teammateId);
    if (!handle) {
      throw new AppError(
        `Teammate ${teammateId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return handle.backend.getStatus(handle);
  }

  async restartTeammate(teammateId: string): Promise<void> {
    const handle = this.activeTeammates.get(teammateId);
    if (!handle) {
      throw new AppError(
        `Teammate ${teammateId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await handle.backend.restart(handle);
    logger.info(`Teammate ${teammateId} restarted`);
  }

  getMessageHistory(teammateId: string): Message[] {
    return this.messageHistory.get(teammateId) || [];
  }

  private findTeammateByName(name: string): TeammateHandle | undefined {
    for (const handle of this.activeTeammates.values()) {
      if (handle.name === name) {
        return handle;
      }
    }
    return undefined;
  }

  private updateLastActive(teammateId: string): void {
    const member = this.teamMembers.get(teammateId);
    if (member) {
      member.lastActiveAt = Date.now();
    }
  }

  private recordMessage(teammateId: string, message: Message): void {
    const member = this.teamMembers.get(teammateId);
    if (member) {
      member.messageCount++;
    }

    const history = this.messageHistory.get(teammateId);
    if (history) {
      history.push(message);

      const maxHistorySize = 1000;
      if (history.length > maxHistorySize) {
        history.shift();
      }
    }
  }

  private handleStatusChange(teammateId: string, status: TeammateStatus): void {
    logger.info(`Teammate ${teammateId} status changed to ${status}`);

    if (status === 'stopped' || status === 'error') {
      this.activeTeammates.delete(teammateId);
      this.teamMembers.delete(teammateId);
      // N2 修复（2026-08-27）：非 killTeammate 路径（agent 自发停止）同样清理
      // messageHistory——原只删 activeTeammates/teamMembers，Map 残留
      this.messageHistory.delete(teammateId);
    }
  }

  isHealthy(teammateId: string): boolean {
    const handle = this.activeTeammates.get(teammateId);
    if (!handle) {
      return false;
    }

    if (handle.status !== 'running') {
      return false;
    }

    return true;
  }

  getTeamHealth(): {
    total: number;
    healthy: number;
    unhealthy: number;
    details: Record<string, boolean>;
  } {
    const details: Record<string, boolean> = {};
    let healthy = 0;

    for (const [id, handle] of this.activeTeammates) {
      const isHealthy = this.isHealthy(id);
      details[id] = isHealthy;
      if (isHealthy) {
        healthy++;
      }
    }

    return {
      total: this.activeTeammates.size,
      healthy,
      unhealthy: this.activeTeammates.size - healthy,
      details,
    };
  }
}

let globalTeammateManager: TeammateManager | null = null;

export function getTeammateManager(): TeammateManager {
  if (!globalTeammateManager) {
    globalTeammateManager = new TeammateManager();
  }
  return globalTeammateManager;
}

export function setTeammateManager(manager: TeammateManager): void {
  globalTeammateManager = manager;
}
