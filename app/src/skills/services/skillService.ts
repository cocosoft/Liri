/**
 * 技能服务 — SkillRegistry 的轻量封装
 *
 * 提供对外兼容接口（SkillDefinition），内部委托 SkillRegistry 管理存储。
 * 额外职责：技能文件提取、自定义技能加载、市场技能管理。
 */

import { constants as fsConstants } from 'fs';
import { mkdir, open, readdir, readFile, stat } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, sep as pathSep } from 'path';
import { getConfigHomeDir } from '@modules/utils/envUtils';
import { Logger } from '@modules/monitoring';

const logger = new Logger({});

import type {
  SkillDefinition,
  SkillInfo,
  SkillExecutionResult,
  SkillServiceConfig,
} from '../types';
import type { ToolUseContext } from '@modules/context/types/ToolUseContext';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { SkillRegistry } from '../SkillRegistry';
import { SkillSource, SkillLoadMethod } from '../types';
import type { Skill } from '../types';

/**
 * 技能服务类
 *
 * 职责：
 * - 存储层委托给 SkillRegistry（不维护独立数组）
 * - 提供 SkillDefinition → Skill 的桥接转换
 * - 负责文件提取、自定义技能加载、市场管理
 */
export class SkillService {
  private config: SkillServiceConfig;
  private registry: SkillRegistry;

  /**
   * 构造函数
   * @param config 技能服务配置
   * @param registry 可选的 SkillRegistry 实例（不传则新建）
   */
  constructor(config: SkillServiceConfig = {}, registry?: SkillRegistry) {
    this.config = {
      skillsDir: config.skillsDir || join(getConfigHomeDir(), 'skills'),
      enableMarketplace: config.enableMarketplace ?? false,
      marketplaceApiUrl:
        config.marketplaceApiUrl ?? 'https://api.openliri.com/skills',
    };
    this.registry = registry ?? new SkillRegistry();
  }

  /**
   * 获取内部 Registry 实例
   */
  getRegistry(): SkillRegistry {
    return this.registry;
  }

  /**
   * 将 SkillDefinition 转换为统一 Skill 类型
   */
  private toSkill(definition: SkillDefinition): Skill {
    return {
      name: definition.name,
      description: definition.description,
      source: SkillSource.THIRD_PARTY,
      loadMethod: SkillLoadMethod.FILE_SYSTEM,
      loadedFrom: 'skill-service',
      aliases: definition.aliases,
      argumentHint: definition.argumentHint,
      whenToUse: definition.whenToUse,
      allowedTools: definition.allowedTools,
      userInvocable: definition.userInvocable ?? true,
      model: definition.model,
      agent: definition.agent,
      disableModelInvocation: definition.disableModelInvocation,
      context: definition.context,
      isEnabled: definition.isEnabled,
      impl: {
        kind: 'prompt',
        getPromptForCommand: async (args: any, toolUseContext: any) => {
          const result = await definition.getPromptForCommand(
            args,
            toolUseContext ?? args
          );
          return result.map((r: any) => ({
            type: r.type || 'text',
            text: r.text || String(r),
          }));
        },
      },
    };
  }

  /**
   * 注册技能
   * @param definition 技能定义
   */
  registerSkill(definition: SkillDefinition): void {
    const skill = this.toSkill(definition);
    this.registry.register(skill);
    logger.info(`Registered skill: ${definition.name}`);
  }

  /**
   * 注册多个技能
   * @param definitions 技能定义列表
   */
  registerSkills(definitions: SkillDefinition[]): void {
    const skills = definitions.map((d) => this.toSkill(d));
    this.registry.registerBatch(skills);
  }

  /**
   * 获取所有技能（以 SkillDefinition[] 形式返回）
   */
  getSkills(): SkillDefinition[] {
    return this.registry
      .getAll()
      .map((skill) => this.toDefinition(skill))
      .filter(Boolean) as SkillDefinition[];
  }

  /**
   * 将 Skill 转回 SkillDefinition（字段子集）
   */
  private toDefinition(skill: Skill): SkillDefinition | null {
    if (skill.impl.kind !== 'prompt') return null;

    const promptImpl = skill.impl;

    return {
      name: skill.name,
      description: skill.description,
      aliases: skill.aliases,
      whenToUse: skill.whenToUse,
      argumentHint: skill.argumentHint,
      allowedTools: skill.allowedTools,
      model: skill.model,
      disableModelInvocation: skill.disableModelInvocation,
      userInvocable: skill.userInvocable,
      isEnabled: skill.isEnabled,
      context: skill.context,
      agent: skill.agent,
      getPromptForCommand: async (args: string, context: any) => {
        return promptImpl.getPromptForCommand(args, context);
      },
    };
  }

  /**
   * 获取技能信息列表
   */
  getSkillInfos(): SkillInfo[] {
    return this.registry.getAll().map((skill) => ({
      name: skill.name,
      description: skill.description,
      aliases: skill.aliases || [],
      whenToUse: skill.whenToUse,
      argumentHint: skill.argumentHint,
      userInvocable: skill.userInvocable ?? true,
      source: 'bundled',
    }));
  }

  /**
   * 根据名称获取技能
   * @param name 技能名称
   */
  getSkill(name: string): SkillDefinition | undefined {
    const skill = this.registry.get(name);
    if (!skill) return undefined;
    return this.toDefinition(skill) ?? undefined;
  }

  /**
   * 执行技能
   * @param name 技能名称
   * @param args 技能参数
   * @param context 工具使用上下文
   */
  async executeSkill(
    name: string,
    args: string,
    context: ToolUseContext
  ): Promise<SkillExecutionResult> {
    try {
      const skill = this.registry.get(name);
      if (!skill) {
        return {
          success: false,
          result: null,
          error: `Skill ${name} not found`,
        };
      }

      // 检查技能是否启用
      if (skill.isEnabled && !skill.isEnabled()) {
        return {
          success: false,
          result: null,
          error: `Skill ${name} is disabled`,
        };
      }

      // 执行技能（prompt 模式）
      let prompt: { type: string; text: string }[] = [];
      if (skill.impl.kind === 'prompt') {
        prompt = await skill.impl.getPromptForCommand(args, context);
      } else if (skill.impl.kind === 'executable') {
        const result = await skill.impl.execute(context);
        return {
          success: true,
          result: { prompt: [{ type: 'text', text: String(result) }] },
        };
      }

      return {
        success: true,
        result: { prompt },
      };
    } catch (error) {
      logger.error(`Error executing skill ${name}:`, { error: String(error) });
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 提取技能文件
   * @param skillName 技能名称
   * @param files 技能文件
   */
  private async extractSkillFiles(
    skillName: string,
    files: Record<string, string>
  ): Promise<string | undefined> {
    const skillsDir = this.config.skillsDir;
    if (!skillsDir) {
      return undefined;
    }
    const dir = join(skillsDir, skillName);
    try {
      await this.writeSkillFiles(dir, files);
      return dir;
    } catch (error) {
      logger.error(`Failed to extract skill files for ${skillName}:`, {
        error: String(error),
      });
      return undefined;
    }
  }

  /**
   * 写入技能文件
   * @param dir 目标目录
   * @param files 文件内容
   */
  private async writeSkillFiles(
    dir: string,
    files: Record<string, string>
  ): Promise<void> {
    const byParent = new Map<string, [string, string][]>();
    for (const [relPath, content] of Object.entries(files)) {
      const target = this.resolveSkillFilePath(dir, relPath);
      const parent = dirname(target);
      const entry: [string, string] = [target, content];
      const group = byParent.get(parent);
      if (group) group.push(entry);
      else byParent.set(parent, [entry]);
    }

    await Promise.all(
      [...byParent].map(async ([parent, entries]) => {
        await mkdir(parent, { recursive: true, mode: 0o700 });
        await Promise.all(entries.map(([p, c]) => this.safeWriteFile(p, c)));
      })
    );
  }

  /**
   * 安全写入文件
   * @param path 文件路径
   * @param content 文件内容
   */
  private async safeWriteFile(path: string, content: string): Promise<void> {
    const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
    const SAFE_WRITE_FLAGS =
      process.platform === 'win32'
        ? 'wx'
        : fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          O_NOFOLLOW;

    const fh = await open(path, SAFE_WRITE_FLAGS, 0o600);
    try {
      await fh.writeFile(content, 'utf8');
    } finally {
      await fh.close();
    }
  }

  /**
   * 解析技能文件路径
   * @param baseDir 基础目录
   * @param relPath 相对路径
   */
  private resolveSkillFilePath(baseDir: string, relPath: string): string {
    const normalized = normalize(relPath);
    if (
      isAbsolute(normalized) ||
      normalized.split(pathSep).includes('..') ||
      normalized.split('/').includes('..')
    ) {
      throw new AppError(
        `Skill file path escapes skill dir: ${relPath}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return join(baseDir, normalized);
  }

  /**
   * 加载自定义技能
   */
  async loadCustomSkills(): Promise<void> {
    try {
      const skillsDir = this.config.skillsDir;
      if (!skillsDir) {
        return;
      }
      const statResult = await stat(skillsDir);
      if (!statResult.isDirectory()) {
        return;
      }

      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = join(skillsDir, entry.name);
          await this.loadSkillFromDir(skillDir);
        }
      }
    } catch (error) {
      logger.error('Failed to load custom skills:', { error: String(error) });
    }
  }

  /**
   * 从目录加载技能
   * @param skillDir 技能目录
   */
  private async loadSkillFromDir(skillDir: string): Promise<void> {
    try {
      const manifestPath = join(skillDir, 'manifest.json');
      const manifestContent = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestContent);

      logger.info(`Loaded custom skill from ${skillDir}: ${manifest.name}`);
    } catch (error) {
      logger.error(`Failed to load skill from ${skillDir}:`, {
        error: String(error),
      });
    }
  }

  /**
   * 从市场获取技能
   */
  async getMarketplaceSkills(): Promise<SkillInfo[]> {
    if (!this.config.enableMarketplace) {
      return [];
    }

    try {
      logger.debug('Fetching skills from marketplace');
      return [];
    } catch (error) {
      logger.error('Failed to fetch marketplace skills:', {
        error: String(error),
      });
      return [];
    }
  }

  /**
   * 安装市场技能
   * @param skillId 技能ID
   */
  async installMarketplaceSkill(skillId: string): Promise<boolean> {
    if (!this.config.enableMarketplace) {
      return false;
    }

    try {
      logger.info(`Installing marketplace skill: ${skillId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to install marketplace skill ${skillId}:`, {
        error: String(error),
      });
      return false;
    }
  }

  /**
   * 卸载技能
   * @param skillName 技能名称
   */
  async uninstallSkill(skillName: string): Promise<boolean> {
    try {
      if (!this.registry.has(skillName)) {
        return false;
      }
      this.registry.unregister(skillName);
      logger.info(`Uninstalled skill: ${skillName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to uninstall skill ${skillName}:`, {
        error: String(error),
      });
      return false;
    }
  }
}

/**
 * 创建技能服务实例
 * @param config 技能服务配置
 * @param registry 可选的 SkillRegistry 实例
 */
export function createSkillService(
  config: SkillServiceConfig = {},
  registry?: SkillRegistry
): SkillService {
  return new SkillService(config, registry);
}

const skillService = createSkillService();
export default skillService;
