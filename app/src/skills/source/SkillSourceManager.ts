/**
 * SkillSourceManager 多技能源管理器
 * 管理来自不同源的技能集合，支持动态加载和源切换
 */
import fs from 'node:fs';
import path from 'node:path';

import { SkillLoader } from '../loaders/SkillLoader.js';
import type { Skill } from '../types/index.js';

/**
 * 技能源定义
 */
export interface SkillSourceEntry {
  name: string;
  type: string;
  basePath: string;
  enabled: boolean;
  priority: number;
  skills: Skill[];
}

/**
 * 加载结果
 */
export interface SkillSourceLoadResult {
  sourceName: string;
  loaded: number;
  failed: number;
  errors: string[];
}

/**
 * 源优先级
 */
export interface SourcePriority {
  sourceName: string;
  priority: number;
}

/**
 * 多技能源管理器
 */
export class SkillSourceManager {
  private sources: Map<string, SkillSourceEntry> = new Map();
  private loader: SkillLoader;

  constructor(loader: SkillLoader) {
    this.loader = loader;
  }

  /**
   * 注册技能源
   */
  registerSource(
    name: string,
    type: string,
    basePath: string,
    priority: number = 100
  ): void {
    this.sources.set(name, {
      name,
      type,
      basePath,
      enabled: true,
      priority,
      skills: [],
    });
  }

  /**
   * 注销技能源
   */
  unregisterSource(name: string): boolean {
    return this.sources.delete(name);
  }

  /**
   * 加载指定源的所有技能
   */
  async loadSource(name: string): Promise<SkillSourceLoadResult> {
    const source = this.sources.get(name);
    if (!source) {
      return { sourceName: name, loaded: 0, failed: 0, errors: ['源未注册'] };
    }

    if (!source.enabled) {
      return { sourceName: name, loaded: 0, failed: 0, errors: [] };
    }

    const errors: string[] = [];
    let loaded = 0;
    let failed = 0;

    try {
      if (fs.existsSync(source.basePath)) {
        const files = fs.readdirSync(source.basePath);

        for (const file of files) {
          if (
            !file.endsWith('.ts') &&
            !file.endsWith('.js') &&
            !file.endsWith('.md')
          )
            continue;

          try {
            const skills = await this.loader.loadSkills();
            for (const skill of skills) {
              source.skills.push(skill);
              loaded++;
            }
          } catch (err) {
            failed++;
            errors.push(
              `${file}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }
    } catch (err) {
      errors.push(
        `加载源 ${name} 失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { sourceName: name, loaded, failed, errors };
  }

  /**
   * 加载所有已启用的源
   */
  async loadAll(): Promise<SkillSourceLoadResult[]> {
    const results: SkillSourceLoadResult[] = [];
    const sorted = this.getEnabledSources();

    for (const source of sorted) {
      const result = await this.loadSource(source.name);
      results.push(result);
    }

    return results;
  }

  /**
   * 获取所有技能（按优先级排序）
   */
  getAllSkills(): Skill[] {
    const sorted = this.getEnabledSources();
    const all: Skill[] = [];

    for (const source of sorted) {
      all.push(...source.skills);
    }

    return all;
  }

  /**
   * 根据名称查找技能
   */
  findSkill(name: string): Skill | undefined {
    const sorted = this.getEnabledSources();

    for (const source of sorted) {
      const skill = source.skills.find(
        (s) => s.name === name || (s.aliases || []).includes(name)
      );
      if (skill) return skill;
    }

    return undefined;
  }

  /**
   * 启用/禁用技能源
   */
  setSourceEnabled(name: string, enabled: boolean): boolean {
    const source = this.sources.get(name);
    if (!source) return false;
    source.enabled = enabled;
    return true;
  }

  /**
   * 设置源优先级
   */
  setPriority(name: string, priority: number): boolean {
    const source = this.sources.get(name);
    if (!source) return false;
    source.priority = priority;
    return true;
  }

  /**
   * 获取已注册的源列表
   */
  getSources(): SkillSourceEntry[] {
    return Array.from(this.sources.values());
  }

  /**
   * 获取启用的源（按优先级排序）
   */
  private getEnabledSources(): SkillSourceEntry[] {
    return Array.from(this.sources.values())
      .filter((s) => s.enabled)
      .sort((a, b) => a.priority - b.priority);
  }
}
