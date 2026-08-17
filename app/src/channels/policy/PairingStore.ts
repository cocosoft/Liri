/**
 * 配对白名单存储
 * 持久化已批准的用户配对关系
 * 对齐 OpenClaw device-auth store
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';

const logger = getLogger('channels:pairing');

interface PairedUser {
  userId: string;
  approvedAt: number;
}

interface PendingPairing {
  code: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

import { resolvePairingsDir } from '@modules/core';

export class PairingStore {
  private storeDir: string;
  private users: Map<string, PairedUser[]> = new Map();
  private pending: Map<string, PendingPairing[]> = new Map();
  private loaded = false;

  constructor(storeDir?: string) {
    this.storeDir = storeDir || resolvePairingsDir();
    // DEEP-16：构造仅确保目录存在，不再同步读盘；加载推迟到 ensureLoaded()
    this.ensureDir();
  }

  async isApproved(channelId: string, userId: string): Promise<boolean> {
    this.ensureLoaded();
    const users = this.users.get(channelId) || [];
    return users.some((u) => u.userId === userId);
  }

  async generateCode(
    channelId: string,
    userId: string,
    timeoutMs: number
  ): Promise<string> {
    this.ensureLoaded();
    const code = randomBytes(4).toString('hex').slice(0, 8).toUpperCase();
    const pending: PendingPairing = {
      code,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + timeoutMs,
    };
    const list = this.pending.get(channelId) || [];
    // DEEP-15：清理该用户已过期/旧的 pending 码，避免无限增长
    const now = Date.now();
    const filtered = list.filter(
      (p) => now < p.expiresAt && p.userId !== userId
    );
    filtered.push(pending);
    this.pending.set(channelId, filtered);
    await this.savePending();
    return code;
  }

  async approve(channelId: string, userId: string): Promise<boolean> {
    this.ensureLoaded();
    if (await this.isApproved(channelId, userId)) return true;
    const users = this.users.get(channelId) || [];
    users.push({ userId, approvedAt: Date.now() });
    this.users.set(channelId, users);
    await this.save();
    logger.info(`配对已批准: ${channelId}/${userId}`);
    return true;
  }

  async approveByCode(channelId: string, code: string): Promise<boolean> {
    this.ensureLoaded();
    const list = this.pending.get(channelId) || [];
    const idx = list.findIndex(
      (p) => p.code === code && Date.now() < p.expiresAt
    );
    if (idx === -1) {
      logger.warning(`无效或已过期的配对码: ${code}`);
      return false;
    }
    const entry = list[idx];
    list.splice(idx, 1);
    this.pending.set(channelId, list);
    // DEEP-15：消费掉的配对码同步落盘
    await this.savePending();
    return this.approve(channelId, entry.userId);
  }

  async revoke(channelId: string, userId: string): Promise<boolean> {
    this.ensureLoaded();
    const users = this.users.get(channelId) || [];
    const filtered = users.filter((u) => u.userId !== userId);
    if (filtered.length === users.length) return false;
    this.users.set(channelId, filtered);
    await this.save();
    logger.info(`配对已撤销: ${channelId}/${userId}`);
    return true;
  }

  listApproved(channelId: string): string[] {
    this.ensureLoaded();
    const users = this.users.get(channelId) || [];
    return users.map((u) => u.userId);
  }

  listPending(
    channelId: string
  ): Array<{ code: string; userId: string; expiresAt: number }> {
    this.ensureLoaded();
    const now = Date.now();
    const list = this.pending.get(channelId) || [];
    return list
      .filter((p) => now < p.expiresAt)
      .map(({ code, userId, expiresAt }) => ({ code, userId, expiresAt }));
  }

  private getFilePath(): string {
    return join(this.storeDir, 'approved-pairings.json');
  }

  /** DEEP-15：pending 配对码落盘文件（配对码重启不丢失，CLI 与消息路径共享） */
  private getPendingFilePath(): string {
    return join(this.storeDir, 'pending-pairings.json');
  }

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private ensureLoaded(): void {
    // DEEP-16：首次访问时异步加载，避免在消息处理路径上同步读盘阻塞事件循环
    if (!this.loaded) {
      this.loaded = true;
      this.load().catch((error) =>
        handleError(error instanceof Error ? error : new Error(String(error)), {
          module: 'channels:policy',
          action: '加载配对数据失败',
        })
      );
    }
  }

  private async load(): Promise<void> {
    try {
      const filePath = this.getFilePath();
      if (existsSync(filePath)) {
        const raw: Record<string, PairedUser[]> = JSON.parse(
          await readFile(filePath, 'utf-8')
        );
        for (const [channel, users] of Object.entries(raw)) {
          this.users.set(channel, users);
        }
        logger.info(`已加载配对数据: ${Object.keys(raw).length} 个通道`);
      }
      // DEEP-15：恢复 pending 配对码
      await this.loadPending();
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'channels:policy',
        action: '加载配对数据失败',
      });
    }
  }

  /** DEEP-15：持久化 pending 配对码（DEEP-16：异步写盘，不阻塞事件循环） */
  private async savePending(): Promise<void> {
    try {
      const data: Record<
        string,
        Array<{
          code: string;
          userId: string;
          createdAt: number;
          expiresAt: number;
        }>
      > = {};
      for (const [k, v] of this.pending) {
        const now = Date.now();
        data[k] = v.filter((p) => p.expiresAt > now);
      }
      await writeFile(this.getPendingFilePath(), JSON.stringify(data, null, 2));
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'channels:policy',
        action: '保存 pending 配对码失败',
      });
    }
  }

  /** DEEP-15：从磁盘恢复 pending 配对码（DEEP-16：异步读盘） */
  private async loadPending(): Promise<void> {
    try {
      const filePath = this.getPendingFilePath();
      if (existsSync(filePath)) {
        const raw: Record<
          string,
          Array<{
            code: string;
            userId: string;
            createdAt: number;
            expiresAt: number;
          }>
        > = JSON.parse(await readFile(filePath, 'utf-8'));
        const now = Date.now();
        for (const [channel, list] of Object.entries(raw)) {
          const valid = list.filter((p) => p.expiresAt > now);
          if (valid.length > 0) {
            this.pending.set(channel, valid);
          }
        }
      }
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'channels:policy',
        action: '加载 pending 配对码失败',
      });
    }
  }

  private async save(): Promise<void> {
    try {
      const data: Record<string, PairedUser[]> = {};
      for (const [k, v] of this.users) {
        data[k] = v;
      }
      await writeFile(this.getFilePath(), JSON.stringify(data, null, 2));
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'channels:policy',
        action: '保存配对数据失败',
      });
    }
  }
}

// DEEP-1/BUG-3：进程内共享单例
// 所有 DmPolicyEngine 实例共享同一 PairingStore，确保配对状态（approved + pending）
// 在消息路径与 CLI 路径之间一致，且配对尝试计数不被重置。
let pairingStoreInstance: PairingStore | null = null;

/** 获取 PairingStore 单例（进程内共享，跨 DmPolicyEngine 实例） */
export function getPairingStore(): PairingStore {
  if (!pairingStoreInstance) {
    pairingStoreInstance = new PairingStore();
  }
  return pairingStoreInstance;
}
