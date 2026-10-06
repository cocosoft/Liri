/**
 * taor/MemoryCheckpointStorage.ts — TAOR 检查点**内存**存储实现
 *
 * 由 `query/TAORLoop.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §42）：**只搬不改**。
 * ⚠️ 生产默认实现为 `DBTAORCheckpointStorage`（见宿主构造函数）；本类为
 * 「无持久化」的实现，供测试/临时运行使用。
 */

import type { TAORCheckpoint, TAORCheckpointStorage } from '../types.js';

/**
 * 内存检查点存储（默认实现）
 */
export class MemoryCheckpointStorage implements TAORCheckpointStorage {
  private checkpoints: Map<string, TAORCheckpoint> = new Map();

  async save(checkpoint: TAORCheckpoint): Promise<string> {
    this.checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint.id;
  }

  async load(id: string): Promise<TAORCheckpoint | null> {
    return this.checkpoints.get(id) || null;
  }

  async findBySessionId(sessionId: string): Promise<TAORCheckpoint[] | null> {
    const found = Array.from(this.checkpoints.values()).filter(
      (c) => c.sessionId === sessionId
    );
    return found.length > 0
      ? found.sort((a, b) => b.createdAt - a.createdAt)
      : null;
  }

  async delete(id: string): Promise<boolean> {
    return this.checkpoints.delete(id);
  }

  async cleanup(expireTime: number): Promise<number> {
    let count = 0;
    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.createdAt < expireTime) {
        this.checkpoints.delete(id);
        count++;
      }
    }
    return count;
  }

  async getLatestIncomplete(sessionId: string): Promise<TAORCheckpoint | null> {
    const found = await this.findBySessionId(sessionId);
    return found?.[0] ?? null;
  }

  async getPendingSessions(): Promise<string[]> {
    return Array.from(
      new Set(Array.from(this.checkpoints.values()).map((c) => c.sessionId))
    );
  }

  async deleteSession(sessionId: string): Promise<number> {
    let count = 0;
    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.sessionId === sessionId) {
        this.checkpoints.delete(id);
        count++;
      }
    }
    return count;
  }
}
