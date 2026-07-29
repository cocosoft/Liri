// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 技能溯源追踪器
 * 追踪技能来源、安装版本、更新时间等信息
 * 内存缓存 + DB 持久化双重存储
 */

import type { SkillDB } from './persistence/SkillDB';
import type { SkillRegistry } from './SkillRegistry';
import { SkillSource } from './types/index';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'skills:SkillProvenanceTracker',
  level: LogLevel.INFO,
});

export type ProvenanceSource =
  | 'builtin'
  | 'user'
  | 'plugin'
  | 'hub'
  | 'external';

export interface SkillProvenanceEntry {
  skillName: string;
  source: ProvenanceSource;
  sourceUrl?: string;
  sourceVersion?: string;
  installedAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}

/**
 * 技能溯源追踪器
 * 内存缓存 + DB 持久化双重存储
 */
export class SkillProvenanceTracker {
  private entries: Map<string, SkillProvenanceEntry> = new Map();
  private skillDB: SkillDB | null;
  private dbInitialized = false;

  /**
   * @param skillDB 可选的 DB 持久化实例
   */
  constructor(skillDB?: SkillDB) {
    this.skillDB = skillDB ?? null;
  }

  /**
   * 从 DB 加载溯源记录
   */
  async loadFromDB(): Promise<void> {
    if (!this.skillDB || this.dbInitialized) return;

    try {
      const loaded = await this.skillDB.loadAllProvenance();
      this.entries = loaded;
      this.dbInitialized = true;
    } catch (err) {
      // DB 不可用时继续使用纯内存模式

      handleError(err, {
        module: 'skills:SkillProvenanceTracker',
        action: 'loadProvenance',
      });
    }
  }

  /**
   * 订阅 SkillRegistry 事件自动追踪
   */
  subscribeToRegistry(registry: SkillRegistry): void {
    registry.on('registered', (_event, skill) => {
      if (skill) {
        this.track(
          skill.name,
          skill.source === SkillSource.THIRD_PARTY ? 'external' : 'builtin',
          {
            sourceVersion: skill.version,
          }
        );
      }
    });

    registry.on('unregistered', (_event, skill) => {
      if (skill) {
        this.remove(skill.name);
      }
    });

    registry.on('cleared', () => {
      this.clear();
    });
  }

  /**
   * 记录或更新技能溯源
   */
  track(
    skillName: string,
    source: ProvenanceSource,
    options: {
      sourceUrl?: string;
      sourceVersion?: string;
      metadata?: Record<string, string>;
    } = {}
  ): void {
    const now = Date.now();
    const existing = this.entries.get(skillName);

    const entry: SkillProvenanceEntry = {
      skillName,
      source,
      sourceUrl: options.sourceUrl,
      sourceVersion: options.sourceVersion,
      metadata: options.metadata,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };

    this.entries.set(skillName, entry);

    // 异步持久化到 DB
    if (this.skillDB) {
      // @ignore-catch — 异步持久化溯源到DB，fire-and-forget非关键路径
      this.skillDB.saveProvenance(entry).catch(() => {});
    }
  }

  /**
   * 获取指定技能的溯源信息
   */
  getProvenance(skillName: string): SkillProvenanceEntry | undefined {
    return this.entries.get(skillName);
  }

  /**
   * 获取所有溯源信息
   */
  getAllProvenances(): SkillProvenanceEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * 按来源类型筛选
   */
  getBySource(source: ProvenanceSource): SkillProvenanceEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.source === source);
  }

  /**
   * 删除溯源记录
   */
  remove(skillName: string): boolean {
    const removed = this.entries.delete(skillName);

    if (removed && this.skillDB) {
      // @ignore-catch — 异步从DB删除溯源，fire-and-forget非关键路径
      this.skillDB.deleteProvenance(skillName).catch(() => {});
    }

    return removed;
  }

  /**
   * 清除所有溯源码
   */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * 全局溯源追踪器实例
 */
let globalProvenanceTracker: SkillProvenanceTracker | null = null;

/**
 * 获取全局技能溯源追踪器
 * @param skillDB 可选的 DB 持久化实例
 * @returns SkillProvenanceTracker 实例
 */
export function getSkillProvenanceTracker(
  skillDB?: SkillDB
): SkillProvenanceTracker {
  if (!globalProvenanceTracker) {
    globalProvenanceTracker = new SkillProvenanceTracker(skillDB);
  }

  return globalProvenanceTracker;
}

/**
 * 兼容旧版：默认全局实例
 */
export const skillProvenanceTracker = new SkillProvenanceTracker();
