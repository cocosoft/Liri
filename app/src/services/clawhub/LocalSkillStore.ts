/**
 * LocalSkillStore
 * 本地技能存储管理，负责技能的持久化存储与索引维护。
 * 技能文件存储在 <PYAPP_HOME>/skills/ 目录下，通过 index.json 维护元数据索引。
 */

import { join, basename, extname } from 'path';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  rmSync,
  copyFileSync,
} from 'fs';
import { resolveUserSkillsDir } from '@modules/config/paths';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  InstalledSkill,
  ClawHubSkillMeta,
  SkillSearchResult,
} from './ClawHubAdapter';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * LocalSkillStore 配置
 */
export interface LocalSkillStoreConfig {
  /** 技能存储根目录 */
  skillsPath?: string;
}

/**
 * 技能索引文件结构
 */
interface SkillIndex {
  version: string;
  updatedAt: number;
  skills: Record<string, InstalledSkill>;
}

const INDEX_FILE = 'index.json';
const INDEX_VERSION = '1.0';

/**
 * LocalSkillStore
 * 管理本地技能目录，提供技能增删改查和索引维护能力。
 */
export class LocalSkillStore {
  private skillsPath: string;
  private index: SkillIndex = {
    version: INDEX_VERSION,
    updatedAt: Date.now(),
    skills: {},
  };
  private initialized = false;

  /**
   * 构造函数
   * @param config 存储配置
   */
  constructor(config: LocalSkillStoreConfig = {}) {
    this.skillsPath = config.skillsPath || resolveUserSkillsDir();
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
   * @returns 已安装技能列表
   */
  async getAllSkills(): Promise<InstalledSkill[]> {
    return Object.values(this.index.skills);
  }

  /**
   * 获取所有已安装技能（同步版本，用于回退加载器）
   * @returns 已安装技能列表
   */
  getAllSkillsSync(): InstalledSkill[] {
    return Object.values(this.index.skills);
  }

  /**
   * 根据 ID 获取技能
   * @param skillId 技能 ID
   * @returns 技能信息或 null
   */
  async getSkill(skillId: string): Promise<InstalledSkill | null> {
    return this.index.skills[skillId] || null;
  }

  /**
   * 添加技能到索引
   * @param skill 已安装的技能
   */
  async addSkill(skill: InstalledSkill): Promise<void> {
    this.index.skills[skill.meta.id] = skill;
    this.saveIndex();
  }

  /**
   * 更新技能索引
   * @param skillId 技能 ID
   * @param skill 更新后的技能信息
   */
  async updateSkill(skillId: string, skill: InstalledSkill): Promise<void> {
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
   * @returns 技能目录路径
   */
  getSkillInstallPath(skillId: string): string {
    return join(this.skillsPath, skillId);
  }

  /**
   * 在本地已安装技能中搜索
   * @param query 搜索关键词
   * @param options 搜索选项
   * @returns 搜索结果
   */
  async searchLocal(
    query: string,
    options?: { category?: string; tags?: string[] }
  ): Promise<SkillSearchResult[]> {
    const lowerQuery = query.toLowerCase();
    const skills = Object.values(this.index.skills);

    return skills
      .filter((skill) => {
        if (!skill.enabled) {
          return false;
        }

        const matchesQuery =
          !query ||
          skill.meta.name.toLowerCase().includes(lowerQuery) ||
          skill.meta.description.toLowerCase().includes(lowerQuery) ||
          skill.meta.tags?.some((tag) =>
            tag.toLowerCase().includes(lowerQuery)
          );

        const matchesCategory =
          !options?.category || skill.meta.category === options.category;

        const matchesTags =
          !options?.tags?.length ||
          options.tags.some((tag) => skill.meta.tags?.includes(tag));

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
   * @returns 序列化的技能数据
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
