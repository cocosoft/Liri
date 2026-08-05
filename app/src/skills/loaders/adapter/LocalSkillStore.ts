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
 * LocalSkillStore（泛型版）
 * 通用本地技能存储管理，负责第三方技能的持久化存储与索引维护。
 * 通过泛型参数 T 适配不同市场的内部技能格式。
 * 技能文件存储在 <skillsPath>/ 目录下，通过 index.json 维护元数据索引。
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolveUserSkillsDir } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import type { InstalledThirdPartySkill, LocalSkillSearchResult } from './types';

const logger = new Logger({
  module: 'skills:localStore',
  level: LogLevel.INFO,
});

/**
 * 技能索引文件结构
 */
interface SkillIndex {
  version: string;
  updatedAt: number;
  skills: Record<string, InstalledThirdPartySkill>;
}

const INDEX_FILE = 'index.json';
const INDEX_VERSION = '1.0';

/**
 * 搜索字段提取器
 * 各适配器提供此函数，从内部技能格式中提取搜索所需字段。
 */
export type SearchFieldExtractor<
  T extends InstalledThirdPartySkill = InstalledThirdPartySkill,
> = (skill: T) => {
  name: string;
  description: string;
  tags?: string[];
  category?: string;
  id: string;
};

/**
 * 默认搜索字段提取器（直接从 meta 中提取）
 */
function defaultSearchExtractor(
  skill: InstalledThirdPartySkill
): ReturnType<SearchFieldExtractor> {
  return {
    id: skill.meta.id,
    name: skill.meta.name,
    description: skill.meta.description,
    tags: skill.meta.tags,
    category: skill.meta.category,
  };
}

/**
 * LocalSkillStore 配置
 */
export interface LocalSkillStoreConfig {
  /** 技能存储根目录 */
  skillsPath?: string;
}

/**
 * LocalSkillStore
 * 泛型本地技能存储，管理第三方技能目录。
 * 参数 T 为适配器内部技能类型（需满足 InstalledThirdPartySkill 约束）。
 */
export class LocalSkillStore<
  T extends InstalledThirdPartySkill = InstalledThirdPartySkill,
> {
  private skillsPath: string;
  private index: SkillIndex = {
    version: INDEX_VERSION,
    updatedAt: Date.now(),
    skills: {},
  };
  private initialized = false;
  private searchExtractor: SearchFieldExtractor<T>;

  /**
   * 构造函数
   * @param config 存储配置
   * @param searchExtractor 搜索字段提取器（可选，默认从 meta 提取）
   */
  constructor(
    config: LocalSkillStoreConfig = {},
    searchExtractor?: SearchFieldExtractor<T>
  ) {
    this.skillsPath = config.skillsPath || resolveUserSkillsDir();
    this.searchExtractor =
      searchExtractor || (defaultSearchExtractor as SearchFieldExtractor<T>);
  }

  /**
   * 初始化存储
   * 确保目录存在，并加载已有索引
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.ensureDirectory();
      this.loadIndex();
      this.initialized = true;
      logger.debug(`LocalSkillStore 初始化完成: ${this.skillsPath}`);
    } catch (error) {
      logger.error('LocalSkillStore 初始化失败', error as Error);
      throw error;
    }
  }

  /**
   * 确保技能目录存在
   */
  private ensureDirectory(): void {
    if (!existsSync(this.skillsPath)) {
      mkdirSync(this.skillsPath, { recursive: true });
    }
  }

  /**
   * 加载索引文件
   */
  private loadIndex(): void {
    const indexPath = join(this.skillsPath, INDEX_FILE);
    if (existsSync(indexPath)) {
      try {
        const content = readFileSync(indexPath, 'utf-8');
        this.index = JSON.parse(content);
        logger.debug(
          `已加载技能索引，共 ${Object.keys(this.index.skills).length} 个技能`
        );
      } catch (error) {
        logger.warn('技能索引文件损坏，将重新创建', error as Error);
        this.index = {
          version: INDEX_VERSION,
          updatedAt: Date.now(),
          skills: {},
        };
      }
    }
  }

  /**
   * 保存索引文件
   */
  private saveIndex(): void {
    this.index.updatedAt = Date.now();
    const indexPath = join(this.skillsPath, INDEX_FILE);
    writeFileSync(indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
  }

  /**
   * 获取技能存储路径
   */
  getSkillsPath(): string {
    return this.skillsPath;
  }

  /**
   * 获取所有已安装技能
   */
  async getAllSkills(): Promise<T[]> {
    return Object.values(this.index.skills) as T[];
  }

  /**
   * 获取所有已安装技能（同步版本，用于回退加载器）
   */
  getAllSkillsSync(): T[] {
    return Object.values(this.index.skills) as T[];
  }

  /**
   * 根据 ID 获取技能
   * @param skillId 技能 ID
   */
  async getSkill(skillId: string): Promise<T | null> {
    return (this.index.skills[skillId] as T) || null;
  }

  /**
   * 添加技能到索引
   * @param skill 已安装的技能
   */
  async addSkill(skill: T): Promise<void> {
    this.index.skills[skill.meta.id] = skill;
    this.saveIndex();
  }

  /**
   * 更新技能索引
   * @param skillId 技能 ID
   * @param skill 更新后的技能信息
   */
  async updateSkill(skillId: string, skill: T): Promise<void> {
    if (this.index.skills[skillId]) {
      this.index.skills[skillId] = skill;
      this.saveIndex();
    }
  }

  /**
   * 从索引中移除技能
   * @param skillId 技能 ID
   */
  async removeSkill(skillId: string): Promise<void> {
    delete this.index.skills[skillId];
    this.saveIndex();
  }

  /**
   * 设置技能启用/禁用状态
   * @param skillId 技能 ID
   * @param enabled 是否启用
   */
  async setEnabled(skillId: string, enabled: boolean): Promise<void> {
    const skill = this.index.skills[skillId];
    if (skill) {
      skill.enabled = enabled;
      this.saveIndex();
    }
  }

  /**
   * 获取技能的安装目录路径
   * @param skillId 技能 ID
   */
  getSkillInstallPath(skillId: string): string {
    // 4.3：仓库形态 skillId（github:owner/repo 等）含 `:`/`/`，在 Windows 下为非法路径字符，
    // 统一映射为 `_`（如 github:owner/repo → github_owner_repo），保证目录可创建。
    const safeId = skillId.replace(/[:\/\\]/g, '_');
    return join(this.skillsPath, safeId);
  }

  /**
   * 在本地已安装技能中搜索
   * @param query 搜索关键词
   * @param options 搜索选项
   */
  async searchLocal(
    query: string,
    options?: { category?: string; tags?: string[] }
  ): Promise<LocalSkillSearchResult[]> {
    const lowerQuery = query.toLowerCase();
    const skills = Object.values(this.index.skills) as T[];

    return skills
      .filter((skill) => {
        if (!skill.enabled) {
          return false;
        }

        const fields = this.searchExtractor(skill);

        const matchesQuery =
          !query ||
          fields.name.toLowerCase().includes(lowerQuery) ||
          fields.description.toLowerCase().includes(lowerQuery) ||
          fields.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery));

        const matchesCategory =
          !options?.category || fields.category === options.category;

        const matchesTags =
          !options?.tags?.length ||
          options.tags.some((tag) => fields.tags?.includes(tag));

        return matchesQuery && matchesCategory && matchesTags;
      })
      .map((skill) => ({
        skill: skill.meta,
        source: 'builtin',
        installed: true,
      }));
  }

  /**
   * 导出已安装技能数据
   */
  exportData(): string {
    return JSON.stringify(this.index, null, 2);
  }

  /**
   * 导入技能数据
   * @param data JSON 格式的技能数据
   */
  importData(data: string): void {
    try {
      const imported = JSON.parse(data) as SkillIndex;
      if (imported.version && imported.skills) {
        Object.assign(this.index.skills, imported.skills);
        this.saveIndex();
        logger.info(`已导入 ${Object.keys(imported.skills).length} 个技能数据`);
      }
    } catch (error) {
      logger.error('技能数据导入失败', error as Error);
      throw new Error('技能数据格式无效');
    }
  }
}
