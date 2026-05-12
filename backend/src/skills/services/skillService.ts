/**
 * 技能服务
 * 提供技能加载和管理功能
 */

import { constants as fsConstants } from 'fs';
import { mkdir, open, readdir, readFile, stat } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, sep as pathSep } from 'path';
import { getConfigHomeDir } from '@modules/utils/envUtils';
import { logError, logInfo, logDebug } from '@modules/utils/logger';
import type {
  SkillDefinition,
  SkillInfo,
  SkillExecutionResult,
  SkillServiceConfig,
} from '../models/types';
import type { ToolUseContext } from '@modules/context/types/ToolUseContext';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

// 内部技能注册表
const skills: SkillDefinition[] = [];

/**
 * 技能服务类
 */
export class SkillService {
  private config: SkillServiceConfig;

  /**
   * 构造函数
   * @param config 技能服务配置
   */
  constructor(config: SkillServiceConfig = {}) {
    this.config = {
      skillsDir: config.skillsDir || join(getConfigHomeDir(), 'skills'),
      enableMarketplace: config.enableMarketplace ?? false,
      marketplaceApiUrl:
        config.marketplaceApiUrl ?? 'https://api.pyapp.dev/skills',
    };
  }

  /**
   * 注册技能
   * @param definition 技能定义
   */
  registerSkill(definition: SkillDefinition): void {
    // 检查技能是否已存在
    const existingSkill = skills.find(
      (skill) => skill.name === definition.name
    );
    if (existingSkill) {
      logInfo(`Skill ${definition.name} already registered, overwriting`);
      const index = skills.indexOf(existingSkill);
      skills[index] = definition;
    } else {
      skills.push(definition);
      logInfo(`Registered skill: ${definition.name}`);
    }
  }

  /**
   * 注册多个技能
   * @param definitions 技能定义列表
   */
  registerSkills(definitions: SkillDefinition[]): void {
    definitions.forEach((definition) => this.registerSkill(definition));
  }

  /**
   * 获取所有技能
   */
  getSkills(): SkillDefinition[] {
    return [...skills];
  }

  /**
   * 获取技能信息列表
   */
  getSkillInfos(): SkillInfo[] {
    return skills.map((skill) => ({
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
    return skills.find(
      (skill) =>
        skill.name === name || (skill.aliases && skill.aliases.includes(name))
    );
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
      const skill = this.getSkill(name);
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

      // 提取技能文件
      let skillRoot: string | undefined;
      if (skill.files && Object.keys(skill.files).length > 0) {
        skillRoot = await this.extractSkillFiles(skill.name, skill.files);
      }

      // 获取技能提示
      const prompt = await skill.getPromptForCommand(args, context);

      // 执行技能（这里简化处理，实际实现需要调用AI模型）
      return {
        success: true,
        result: {
          prompt,
          skillRoot,
        },
      };
    } catch (error) {
      logError(`Error executing skill ${name}:`, error);
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
      logError(`Failed to extract skill files for ${skillName}:`, error);
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
    // 按父目录分组
    const byParent = new Map<string, [string, string][]>();
    for (const [relPath, content] of Object.entries(files)) {
      const target = this.resolveSkillFilePath(dir, relPath);
      const parent = dirname(target);
      const entry: [string, string] = [target, content];
      const group = byParent.get(parent);
      if (group) group.push(entry);
      else byParent.set(parent, [entry]);
    }

    // 创建目录并写入文件
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
      logError('Failed to load custom skills:', error);
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

      // 这里简化处理，实际实现需要加载技能的JavaScript/TypeScript文件
      // 并注册技能
      logInfo(`Loaded custom skill from ${skillDir}: ${manifest.name}`);
    } catch (error) {
      logError(`Failed to load skill from ${skillDir}:`, error);
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
      // 这里简化处理，实际实现需要调用市场API
      logDebug('Fetching skills from marketplace');
      return [];
    } catch (error) {
      logError('Failed to fetch marketplace skills:', error);
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
      // 这里简化处理，实际实现需要调用市场API下载和安装技能
      logInfo(`Installing marketplace skill: ${skillId}`);
      return true;
    } catch (error) {
      logError(`Failed to install marketplace skill ${skillId}:`, error);
      return false;
    }
  }

  /**
   * 卸载技能
   * @param skillName 技能名称
   */
  async uninstallSkill(skillName: string): Promise<boolean> {
    try {
      // 从注册表中移除技能
      const index = skills.findIndex((skill) => skill.name === skillName);
      if (index === -1) {
        return false;
      }

      skills.splice(index, 1);
      logInfo(`Uninstalled skill: ${skillName}`);
      return true;
    } catch (error) {
      logError(`Failed to uninstall skill ${skillName}:`, error);
      return false;
    }
  }
}

/**
 * 创建技能服务实例
 * @param config 技能服务配置
 */
export function createSkillService(
  config: SkillServiceConfig = {}
): SkillService {
  return new SkillService(config);
}

// 导出默认服务实例
const skillService = createSkillService();
export default skillService;
