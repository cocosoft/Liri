/**
 * SkillLifecycleManager — 技能生命周期管理器
 *
 * 对标 Hermes curator.py 的自动状态转换逻辑。
 * 管理 agent 创建的技能的生命周期状态，
 * 基于使用时间戳自动在 active/stale/archived 间转换。
 *
 * 约束：
 *   1. 仅操作 agent 创建的技能
 *   2. 永不自动删除 — 最多归档（可恢复）
 *   3. Pinned 技能跳过所有自动转换
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

export enum SkillLifecycleState {
  ACTIVE = 'active',
  STALE = 'stale',
  ARCHIVED = 'archived',
}

export interface SkillLifecycleEntry {
  name: string;
  state: SkillLifecycleState;
  pinned: boolean;
  createdAt: number;
  lastActivityAt: number | null;
  archivedAt: number | null;
}

export interface LifecycleConfig {
  staleAfterDays: number;
  archiveAfterDays: number;
}

export interface LifecycleTransitionResult {
  markedStale: number;
  archived: number;
  reactivated: number;
  checked: number;
}

const DEFAULT_LIFECYCLE_CONFIG: Required<LifecycleConfig> = {
  staleAfterDays: 30,
  archiveAfterDays: 90,
};

function lifecycleFilePath(): string {
  return join(resolvePyappHome(), 'memory', 'skill-lifecycle.json');
}

function loadLifecycleData(): Map<string, SkillLifecycleEntry> {
  const path = lifecycleFilePath();
  const map = new Map<string, SkillLifecycleEntry>();
  if (!existsSync(path)) {
    return map;
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const arr: SkillLifecycleEntry[] = JSON.parse(raw);
    for (const entry of arr) {
      map.set(entry.name, entry);
    }
  } catch (e) {
    logger.warn('Failed to read skill lifecycle data', { error: String(e) });
  }
  return map;
}

function saveLifecycleData(entries: Map<string, SkillLifecycleEntry>): void {
  const path = lifecycleFilePath();
  try {
    const dir = path.substring(0, path.lastIndexOf('\\'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const arr = Array.from(entries.values());
    writeFileSync(path, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('Failed to save skill lifecycle data', { error: String(e) });
  }
}

export class SkillLifecycleManager {
  private entries: Map<string, SkillLifecycleEntry>;
  private config: LifecycleConfig;

  constructor(config: Partial<LifecycleConfig> = {}) {
    this.config = { ...DEFAULT_LIFECYCLE_CONFIG, ...config };
    this.entries = loadLifecycleData();
  }

  registerSkill(name: string, createdAt: number = Date.now()): void {
    if (!this.entries.has(name)) {
      this.entries.set(name, {
        name,
        state: SkillLifecycleState.ACTIVE,
        pinned: false,
        createdAt,
        lastActivityAt: null,
        archivedAt: null,
      });
      saveLifecycleData(this.entries);
    }
  }

  recordActivity(name: string, timestamp: number = Date.now()): void {
    const entry = this.entries.get(name);
    if (entry) {
      entry.lastActivityAt = timestamp;
      if (entry.state === SkillLifecycleState.STALE) {
        entry.state = SkillLifecycleState.ACTIVE;
      }
      saveLifecycleData(this.entries);
    }
  }

  setPinned(name: string, pinned: boolean): void {
    const entry = this.entries.get(name);
    if (entry) {
      entry.pinned = pinned;
      saveLifecycleData(this.entries);
    }
  }

  isPinned(name: string): boolean {
    return this.entries.get(name)?.pinned ?? false;
  }

  getState(name: string): SkillLifecycleState | undefined {
    return this.entries.get(name)?.state;
  }

  setState(name: string, state: SkillLifecycleState): void {
    const entry = this.entries.get(name);
    if (entry) {
      entry.state = state;
      if (state === SkillLifecycleState.ARCHIVED) {
        entry.archivedAt = Date.now();
      }
      saveLifecycleData(this.entries);
    }
  }

  getEntry(name: string): SkillLifecycleEntry | undefined {
    return this.entries.get(name);
  }

  getAllEntries(): SkillLifecycleEntry[] {
    return Array.from(this.entries.values());
  }

  getActiveEntries(): SkillLifecycleEntry[] {
    return this.getAllEntries().filter(
      (e) => e.state === SkillLifecycleState.ACTIVE
    );
  }

  getStaleEntries(): SkillLifecycleEntry[] {
    return this.getAllEntries().filter(
      (e) => e.state === SkillLifecycleState.STALE
    );
  }

  getArchivedEntries(): SkillLifecycleEntry[] {
    return this.getAllEntries().filter(
      (e) => e.state === SkillLifecycleState.ARCHIVED
    );
  }

  removeSkill(name: string): boolean {
    const removed = this.entries.delete(name);
    if (removed) {
      saveLifecycleData(this.entries);
    }
    return removed;
  }

  applyAutomaticTransitions(
    now: number = Date.now()
  ): LifecycleTransitionResult {
    const staleCutoff = now - this.config.staleAfterDays * 24 * 60 * 60 * 1000;
    const archiveCutoff =
      now - this.config.archiveAfterDays * 24 * 60 * 60 * 1000;

    const result: LifecycleTransitionResult = {
      markedStale: 0,
      archived: 0,
      reactivated: 0,
      checked: 0,
    };

    for (const [, entry] of this.entries) {
      if (entry.pinned) {
        continue;
      }

      result.checked++;
      const anchor = entry.lastActivityAt ?? entry.createdAt;

      if (
        anchor <= archiveCutoff &&
        entry.state !== SkillLifecycleState.ARCHIVED
      ) {
        entry.state = SkillLifecycleState.ARCHIVED;
        entry.archivedAt = now;
        result.archived++;
      } else if (
        anchor <= staleCutoff &&
        entry.state === SkillLifecycleState.ACTIVE
      ) {
        entry.state = SkillLifecycleState.STALE;
        result.markedStale++;
      } else if (
        anchor > staleCutoff &&
        entry.state === SkillLifecycleState.STALE
      ) {
        entry.state = SkillLifecycleState.ACTIVE;
        result.reactivated++;
      }
    }

    saveLifecycleData(this.entries);
    return result;
  }
}
