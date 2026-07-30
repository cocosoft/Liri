/**
 * 配对白名单存储
 * 持久化已批准的用户配对关系
 * 对齐 OpenClaw device-auth store
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const logger = new Logger({ level: LogLevel.INFO, module: 'channels:pairing' });

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
    this.ensureDir();
    this.load();
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
    list.push(pending);
    this.pending.set(channelId, list);
    return code;
  }

  async approve(channelId: string, userId: string): Promise<boolean> {
    this.ensureLoaded();
    if (await this.isApproved(channelId, userId)) return true;
    const users = this.users.get(channelId) || [];
    users.push({ userId, approvedAt: Date.now() });
    this.users.set(channelId, users);
    this.save();
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
    return this.approve(channelId, entry.userId);
  }

  async revoke(channelId: string, userId: string): Promise<boolean> {
    this.ensureLoaded();
    const users = this.users.get(channelId) || [];
    const filtered = users.filter((u) => u.userId !== userId);
    if (filtered.length === users.length) return false;
    this.users.set(channelId, filtered);
    this.save();
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

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private load(): void {
    try {
      const filePath = this.getFilePath();
      if (existsSync(filePath)) {
        const raw: Record<string, PairedUser[]> = JSON.parse(
          readFileSync(filePath, 'utf-8')
        );
        for (const [channel, users] of Object.entries(raw)) {
          this.users.set(channel, users);
        }
        logger.info(`已加载配对数据: ${Object.keys(raw).length} 个通道`);
      }
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'channels:policy',
        action: '加载配对数据失败',
      });
    }
    this.loaded = true;
  }

  private save(): void {
    try {
      const data: Record<string, PairedUser[]> = {};
      for (const [k, v] of this.users) {
        data[k] = v;
      }
      writeFileSync(this.getFilePath(), JSON.stringify(data, null, 2));
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'channels:policy',
        action: '保存配对数据失败',
      });
    }
  }
}
