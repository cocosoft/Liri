// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SkillUsageTracker — 技能使用遥测（P2-2，2026-09-02，对标 hermes skill_usage）
 *
 * 记录技能查看（skill_view）与执行（Skill）次数，持久化到 ~/.pyapp/data/skills-usage.json。
 * 为未来技能生命周期治理（active→stale→archived 策展，对标 hermes curator）提供数据基础。
 * 轻量实现：内存 Map + 防抖落盘（500ms）+ 启动加载；遥测失败不影响技能功能（CS03）。
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { resolveDataDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('skills:usage');

/** 单技能使用记录 */
export interface SkillUsageRecord {
  /** 技能名 */
  skillName: string;
  /** 查看次数（skill_view 实际加载成功） */
  viewCount: number;
  /** 执行次数（Skill 工具执行成功） */
  useCount: number;
  /** 首次记录时间戳 */
  firstUsedAt: number;
  /** 最近查看时间戳 */
  lastViewedAt?: number;
  /** 最近执行时间戳 */
  lastUsedAt?: number;
}

/** 遥测侧车文件路径：~/.pyapp/data/skills-usage.json */
function usageFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'skills-usage.json');
}

/**
 * 技能使用遥测（单例）
 */
class SkillUsageTracker {
  private records = new Map<string, SkillUsageRecord>();
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** 启动/首次访问时加载持久化数据 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(usageFilePath(), 'utf-8');
      const data = JSON.parse(raw) as Record<string, SkillUsageRecord>;
      for (const [name, rec] of Object.entries(data)) {
        if (rec && typeof rec.skillName === 'string') {
          this.records.set(name, rec);
        }
      }
    } catch {
      // 文件不存在或损坏 → 空数据（遥测非关键，CS03）
    }
  }

  /** 记录一次技能查看（skill_view 实际加载成功） */
  async bumpView(skillName: string): Promise<void> {
    if (!skillName) return;
    await this.ensureLoaded();
    const rec = this.records.get(skillName) ?? {
      skillName,
      viewCount: 0,
      useCount: 0,
      firstUsedAt: Date.now(),
    };
    rec.viewCount += 1;
    rec.lastViewedAt = Date.now();
    this.records.set(skillName, rec);
    this.scheduleSave();
  }

  /** 记录一次技能执行（Skill 工具执行成功） */
  async bumpUse(skillName: string): Promise<void> {
    if (!skillName) return;
    await this.ensureLoaded();
    const rec = this.records.get(skillName) ?? {
      skillName,
      viewCount: 0,
      useCount: 0,
      firstUsedAt: Date.now(),
    };
    rec.useCount += 1;
    rec.lastUsedAt = Date.now();
    this.records.set(skillName, rec);
    this.scheduleSave();
  }

  /** 读取全部使用记录（按 skillName 排序） */
  async getAll(): Promise<SkillUsageRecord[]> {
    await this.ensureLoaded();
    return [...this.records.values()].sort((a, b) =>
      a.skillName.localeCompare(b.skillName)
    );
  }

  /** 读取单技能记录（无则 undefined） */
  async get(skillName: string): Promise<SkillUsageRecord | undefined> {
    await this.ensureLoaded();
    return this.records.get(skillName);
  }

  /** 防抖落盘（500ms；进程退出前 flush） */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, 500);
  }

  /** 立即落盘（幂等；失败仅告警不阻断） */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.loaded) return;
    try {
      const file = usageFilePath();
      await mkdir(dirname(file), { recursive: true });
      const data: Record<string, SkillUsageRecord> = {};
      for (const [name, rec] of this.records) data[name] = rec;
      await writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('技能使用遥测落盘失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** 全局单例 */
export const skillUsageTracker = new SkillUsageTracker();
