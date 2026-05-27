/**
 * 技能管理器
 * 负责加载和管理应用的技能
 */

import fs from 'fs';
import path from 'path';
import { resolveUserSkillsDir } from '@modules/config/paths';
import { profileCheckpoint } from '../utils/startupProfiler.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { getSkillCurator } from './SkillCurator';
import { SkillProvenanceTracker } from './SkillProvenanceTracker';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 技能接口
 */
export interface Skill {
  name: string;
  description: string;
  version: string;
  author: string;
  dependencies?: string[];
  config?: Record<string, unknown>;
  execute: (args: any[], context?: SkillContext) => Promise<unknown>;
  init?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

/**
 * 技能上下文
 */
export interface SkillContext {
  config: Record<string, unknown>;
  logger: {
    info: (message: string) => void;
    error: (message: string, error?: Error) => void;
    debug: (message: string) => void;
  };
  [key: string]: any;
}

/**
 * 技能状态
 */
export enum SkillState {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  INITIALIZED = 'initialized',
  FAILED = 'failed',
}

/**
 * 技能信息
 */
export interface SkillInfo {
  skill: Skill;
  state: SkillState;
  error?: string;
  metadata: {
    path: string;
    type: 'builtin' | 'user';
    loadedAt: number;
  };
}

/**
 * 技能管理器
 */
export class SkillManager {
  private skills: Map<string, SkillInfo> = new Map();
  private skillsDir: string;
  private builtinSkillsDir: string;
  private skillConfigs: Map<string, Record<string, unknown>> = new Map();

  constructor() {
    // 技能目录
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.skillsDir = resolveUserSkillsDir();
    this.builtinSkillsDir = path.join(__dirname, 'builtin');
  }

  /**
   * 初始化技能管理器
   */
  async initialize(): Promise<void> {
    profileCheckpoint('skill_manager_initialize_start');
    // 确保技能目录存在
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }

    // 加载技能配置
    profileCheckpoint('skill_manager_load_configs_start');
    await this.loadSkillConfigs();
    profileCheckpoint('skill_manager_load_configs_end');

    // 加载内置技能
    profileCheckpoint('skill_manager_load_builtin_skills_start');
    await this.loadBuiltinSkills();
    profileCheckpoint('skill_manager_load_builtin_skills_end');

    // 加载用户技能
    profileCheckpoint('skill_manager_load_user_skills_start');
    await this.loadUserSkills();
    profileCheckpoint('skill_manager_load_user_skills_end');

    // 初始化技能
    profileCheckpoint('skill_manager_initialize_skills_start');
    await this.initializeSkills();
    profileCheckpoint('skill_manager_initialize_skills_end');

    // 同步到 SkillHub 并启动策展器
    this.syncToSkillHub();
    getSkillCurator().startScheduler();
    profileCheckpoint('skill_manager_initialize_end');
  }

  private syncToSkillHub(): void {
    const provenance = new SkillProvenanceTracker();
    for (const [name, info] of this.skills) {
      provenance.track(
        name,
        info.metadata?.type === 'builtin' ? 'builtin' : 'user'
      );
    }
  }

  /**
   * 加载技能配置
   */
  private async loadSkillConfigs(): Promise<void> {
    const configDir = path.join(this.skillsDir, 'configs');
    if (fs.existsSync(configDir)) {
      const configFiles = fs.readdirSync(configDir);
      for (const file of configFiles) {
        if (file.endsWith('.json')) {
          try {
            const configPath = path.join(configDir, file);
            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configContent);
            const skillName = path.basename(file, '.json');
            this.skillConfigs.set(skillName, config);
          } catch (error) {
            logger.error(`Error loading skill config ${file}:`, { error });
          }
        }
      }
    }
  }

  /**
   * 加载内置技能
   */
  private async loadBuiltinSkills(): Promise<void> {
    if (fs.existsSync(this.builtinSkillsDir)) {
      const skillFiles = fs.readdirSync(this.builtinSkillsDir);

      // 并行加载技能
      const loadPromises = skillFiles
        .filter((file) => file.endsWith('.js') || file.endsWith('.ts'))
        .map((file) =>
          this.loadSkill(path.join(this.builtinSkillsDir, file), 'builtin')
        );

      await Promise.allSettled(loadPromises);
    }
  }

  /**
   * 加载用户技能
   */
  private async loadUserSkills(): Promise<void> {
    if (fs.existsSync(this.skillsDir)) {
      const skillFiles = fs.readdirSync(this.skillsDir);

      // 并行加载技能
      const loadPromises = skillFiles
        .filter(
          (file) =>
            (file.endsWith('.js') || file.endsWith('.ts')) && file !== 'configs'
        )
        .map((file) => this.loadSkill(path.join(this.skillsDir, file), 'user'));

      await Promise.allSettled(loadPromises);
    }
  }

  /**
   * 加载单个技能
   */
  private async loadSkill(
    skillPath: string,
    type: 'builtin' | 'user'
  ): Promise<void> {
    try {
      const skillModule = await import(skillPath);
      const skill = skillModule.default;

      if (skill && this.isValidSkill(skill)) {
        const skillInfo: SkillInfo = {
          skill,
          state: SkillState.LOADED,
          metadata: {
            path: skillPath,
            type,
            loadedAt: Date.now(),
          },
        };
        this.skills.set(skill.name, skillInfo);
        logger.info(`Loaded ${type} skill: ${skill.name}`);
      }
    } catch (error) {
      const skillName = path.basename(skillPath, path.extname(skillPath));
      logger.error(`Error loading ${type} skill ${skillName}:`, { error });
      const skillInfo: SkillInfo = {
        skill: {
          name: skillName,
          description: 'Failed to load',
          version: '1.0.0',
          author: 'Unknown',
          execute: async () => {
            throw new AppError(
              'Skill failed to load',
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          },
        },
        state: SkillState.FAILED,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          path: skillPath,
          type,
          loadedAt: Date.now(),
        },
      };
      this.skills.set(skillName, skillInfo);
    }
  }

  /**
   * 初始化技能
   */
  private async initializeSkills(): Promise<void> {
    // 按依赖顺序初始化技能
    const skillsToInitialize = Array.from(this.skills.values()).filter(
      (info) => info.state === SkillState.LOADED
    );

    // 简单的依赖排序（实际项目中可能需要更复杂的拓扑排序）
    for (const skillInfo of skillsToInitialize) {
      await this.initializeSkill(skillInfo);
    }
  }

  /**
   * 初始化单个技能
   */
  private async initializeSkill(skillInfo: SkillInfo): Promise<void> {
    try {
      skillInfo.state = SkillState.LOADING;

      // 检查依赖
      if (skillInfo.skill.dependencies) {
        for (const dependency of skillInfo.skill.dependencies) {
          const depSkillInfo = this.skills.get(dependency);
          if (!depSkillInfo) {
            throw new AppError(
              `Dependency ${dependency} not found`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }
          if (
            depSkillInfo.state !== SkillState.INITIALIZED &&
            depSkillInfo.state !== SkillState.LOADED
          ) {
            await this.initializeSkill(depSkillInfo);
          }
        }
      }

      // 获取技能配置
      const config = this.skillConfigs.get(skillInfo.skill.name) || {};
      skillInfo.skill.config = { ...config, ...skillInfo.skill.config };

      // 初始化技能
      if (skillInfo.skill.init) {
        await skillInfo.skill.init();
      }

      skillInfo.state = SkillState.INITIALIZED;
      logger.info(`Initialized skill: ${skillInfo.skill.name}`);
    } catch (error) {
      logger.error(`Error initializing skill ${skillInfo.skill.name}:`, {
        error,
      });
      skillInfo.state = SkillState.FAILED;
      skillInfo.error = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * 验证技能是否有效
   */
  private isValidSkill(skill: any): skill is Skill {
    return (
      typeof skill === 'object' &&
      skill !== null &&
      typeof skill.name === 'string' &&
      typeof skill.description === 'string' &&
      typeof skill.version === 'string' &&
      typeof skill.author === 'string' &&
      typeof skill.execute === 'function'
    );
  }

  /**
   * 获取所有技能
   */
  getSkills(): Map<string, SkillInfo> {
    return new Map(this.skills);
  }

  /**
   * 获取技能
   */
  getSkill(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  /**
   * 添加技能
   */
  async addSkill(
    skill: Skill,
    type: 'builtin' | 'user' = 'user'
  ): Promise<void> {
    const skillInfo: SkillInfo = {
      skill,
      state: SkillState.LOADED,
      metadata: {
        path: 'runtime-added',
        type,
        loadedAt: Date.now(),
      },
    };
    this.skills.set(skill.name, skillInfo);
    await this.initializeSkill(skillInfo);
  }

  /**
   * 移除技能
   */
  async removeSkill(name: string): Promise<void> {
    const skillInfo = this.skills.get(name);
    if (skillInfo) {
      // 关闭技能
      if (skillInfo.skill.shutdown) {
        try {
          await skillInfo.skill.shutdown();
        } catch (error) {
          logger.error(`Error shutting down skill ${name}:`, { error });
        }
      }
      this.skills.delete(name);
      logger.info(`Removed skill: ${name}`);
    }
  }

  /**
   * 执行技能
   */
  async executeSkill(
    name: string,
    args: any[],
    context?: Partial<SkillContext>
  ): Promise<unknown> {
    profileCheckpoint(`skill_execute_${name}_start`);
    const skillInfo = this.skills.get(name);
    if (!skillInfo) {
      throw new AppError(
        `Skill ${name} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (skillInfo.state !== SkillState.INITIALIZED) {
      throw new AppError(
        `Skill ${name} is not initialized (state: ${skillInfo.state})`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 构建技能上下文
    const defaultContext: SkillContext = {
      config: skillInfo.skill.config || {},
      logger: {
        info: (message: string) => logger.info(`[${name}] ${message}`),
        error: (message: string, error?: Error) =>
          logger.error(`[${name}] ${message}`, { error }),
        debug: (message: string) => logger.debug(`[${name}] ${message}`),
      },
    };

    const finalContext = { ...defaultContext, ...context };

    try {
      const result = await skillInfo.skill.execute(args, finalContext);
      profileCheckpoint(`skill_execute_${name}_end`);
      return result;
    } catch (error) {
      profileCheckpoint(`skill_execute_${name}_end`);
      logger.error(`Error executing skill ${name}:`, { error });
      throw error;
    }
  }

  /**
   * 重新加载技能
   */
  async reloadSkill(name: string): Promise<void> {
    const skillInfo = this.skills.get(name);
    if (skillInfo) {
      await this.removeSkill(name);
      await this.loadSkill(skillInfo.metadata.path, skillInfo.metadata.type);
    }
  }

  /**
   * 重新加载所有技能
   */
  async reloadAllSkills(): Promise<void> {
    const skillsToReload = Array.from(this.skills.values());
    for (const skillInfo of skillsToReload) {
      await this.reloadSkill(skillInfo.skill.name);
    }
  }

  /**
   * 获取技能状态
   */
  getSkillState(name: string): SkillState | undefined {
    return this.skills.get(name)?.state;
  }

  /**
   * 关闭技能管理器
   */
  async shutdown(): Promise<void> {
    for (const skillInfo of this.skills.values()) {
      if (skillInfo.skill.shutdown) {
        try {
          await skillInfo.skill.shutdown();
        } catch (error) {
          logger.error(`Error shutting down skill ${skillInfo.skill.name}:`, {
            error,
          });
        }
      }
    }
    this.skills.clear();
    this.skillConfigs.clear();
  }
}

/**
 * 全局技能管理器实例
 */
let skillManager: SkillManager | null = null;

/**
 * 获取技能管理器
 */
export function getSkillManager(): Promise<SkillManager> {
  if (!skillManager) {
    skillManager = new SkillManager();
  }
  return Promise.resolve(skillManager);
}

export default getSkillManager;
