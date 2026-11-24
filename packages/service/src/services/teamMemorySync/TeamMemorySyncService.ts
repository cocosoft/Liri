import type { Memory } from '@openliri/infra/memory/types/Memory';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';

const logger = getLogger('services:teamMemorySync');

/**
 * 团队记忆同步状态
 */
export interface TeamMemorySyncState {
  lastSync: Date;
  pendingSync: string[];
  failedSync: string[];
  syncCount: number;
  lastError?: string;
}

/**
 * 团队记忆同步服务接口
 */
export interface TeamMemorySyncService {
  // 同步团队记忆
  syncTeamMemory(): Promise<boolean>;

  // 获取同步状态
  getSyncState(): Promise<TeamMemorySyncState>;

  // 手动触发同步
  triggerSync(): Promise<boolean>;

  // 解决同步冲突
  resolveSyncConflict(
    memoryId: string,
    resolution: 'keep_local' | 'keep_remote'
  ): Promise<boolean>;

  // 获取团队记忆
  getTeamMemory(): Promise<Memory[]>;

  // 分享本地记忆到团队
  shareMemoryToTeam(memoryId: string): Promise<boolean>;

  // 从团队获取记忆
  getMemoryFromTeam(memoryId: string): Promise<Memory | null>;
}

/**
 * 团队记忆同步服务实现
 *
 * @deprecated **模拟实现，未接线，不产生任何真实网络同步**（P3-1 处置，2026-11-25）。
 * 各方法用 `setTimeout` 伪造延迟并返回成功，团队库始终为空数组。
 * 真实同步与冲突消解需单独立项（见 `.trae/specs/agent-memory-optimization.md` §8.6）。
 * 保留本实现仅为不打断既有引用/测试；**不得**把它当作"团队记忆同步"能力。
 */
export class TeamMemorySyncServiceImpl implements TeamMemorySyncService {
  /** 明确标记：本实现不做真实同步（供调用方/观测识别） */
  readonly simulated = true;

  constructor() {
    process.emitWarning(
      'TeamMemorySyncServiceImpl 是模拟实现（无真实同步），请勿当作团队记忆同步能力',
      'DeprecationWarning'
    );
  }

  /**
   * 同步状态
   */
  private syncState: TeamMemorySyncState = {
    lastSync: new Date(0),
    pendingSync: [],
    failedSync: [],
    syncCount: 0,
  };

  /**
   * 团队记忆存储
   */
  private teamMemory: Memory[] = [];

  /**
   * 同步团队记忆
   * @returns 是否同步成功
   */
  async syncTeamMemory(): Promise<boolean> {
    try {
      logger.info('[TeamMemorySync] (simulated) Starting sync...');

      // 模拟同步过程
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 更新同步状态
      this.syncState.lastSync = new Date();
      this.syncState.syncCount++;
      this.syncState.pendingSync = [];
      this.syncState.failedSync = [];

      logger.info(
        '[TeamMemorySync] (simulated) Sync completed — 未传输任何数据'
      );
      return true;
    } catch (error) {
      void handleError(error, {
        module: 'services:teamMemory',
        action: '同步团队记忆失败',
      });
      this.syncState.lastError = (error as Error).message;
      return false;
    }
  }

  /**
   * 获取同步状态
   * @returns 同步状态
   */
  async getSyncState(): Promise<TeamMemorySyncState> {
    return this.syncState;
  }

  /**
   * 手动触发同步
   * @returns 是否触发成功
   */
  async triggerSync(): Promise<boolean> {
    return this.syncTeamMemory();
  }

  /**
   * 解决同步冲突
   * @param memoryId 记忆ID
   * @param resolution 解决方案
   * @returns 是否解决成功
   */
  async resolveSyncConflict(
    memoryId: string,
    resolution: 'keep_local' | 'keep_remote'
  ): Promise<boolean> {
    try {
      logger.info(
        `[TeamMemorySync] (simulated) Resolving conflict for memory ${memoryId} with resolution: ${resolution}`
      );

      // 模拟冲突解决过程
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 从失败列表中移除
      const index = this.syncState.failedSync.indexOf(memoryId);
      if (index > -1) {
        this.syncState.failedSync.splice(index, 1);
      }

      return true;
    } catch (error) {
      void handleError(error, {
        module: 'services:teamMemory',
        action: '解决同步冲突失败',
      });
      return false;
    }
  }

  /**
   * 获取团队记忆
   * @returns 团队记忆列表
   */
  async getTeamMemory(): Promise<Memory[]> {
    return this.teamMemory;
  }

  /**
   * 分享本地记忆到团队
   * @param memoryId 记忆ID
   * @returns 是否分享成功
   */
  async shareMemoryToTeam(memoryId: string): Promise<boolean> {
    try {
      logger.info(`[TeamMemorySync] (simulated) Sharing memory ${memoryId}`);

      // 模拟分享过程
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 添加到待同步列表
      this.syncState.pendingSync.push(memoryId);

      return true;
    } catch (error) {
      void handleError(error, {
        module: 'services:teamMemory',
        action: '分享记忆到团队失败',
      });
      return false;
    }
  }

  /**
   * 从团队获取记忆
   * @param memoryId 记忆ID
   * @returns 记忆对象或null
   */
  async getMemoryFromTeam(memoryId: string): Promise<Memory | null> {
    try {
      logger.info(`[TeamMemorySync] (simulated) Getting memory ${memoryId}`);

      // 模拟获取过程
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 查找团队记忆
      const memory = this.teamMemory.find((mem) => mem.id === memoryId);

      return memory || null;
    } catch (error) {
      void handleError(error, {
        module: 'services:teamMemory',
        action: '从团队获取记忆失败',
      });
      return null;
    }
  }
}
