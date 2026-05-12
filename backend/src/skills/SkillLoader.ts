/**
 * 技能加载器
 * 负责加载和解析技能定义
 */

import type { Skill, SkillManifest } from '../types/skill';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

export class SkillLoader {
  /**
   * 加载单个技能
   * @param skillPath 技能路径
   * @returns 加载的技能
   */
  async load(skillPath: string): Promise<Skill> {
    try {
      // 读取技能manifest
      const manifestPath = join(skillPath, 'manifest.json');
      if (!existsSync(manifestPath)) {
        throw new AppError(
          `Manifest file not found at ${manifestPath}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const manifestContent = readFileSync(manifestPath, 'utf8');
      const manifest: SkillManifest = JSON.parse(manifestContent);

      // 读取技能实现
      const skillPathIndex = join(skillPath, 'index.ts');
      const skillPathJs = join(skillPath, 'index.js');
      let skillImplementation;

      if (existsSync(skillPathIndex)) {
        // 动态导入TypeScript文件
        skillImplementation = await import(skillPathIndex);
      } else if (existsSync(skillPathJs)) {
        // 动态导入JavaScript文件
        skillImplementation = await import(skillPathJs);
      } else {
        throw new AppError(
          `Skill implementation not found at ${skillPath}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      // 检查技能实现是否有效
      if (
        !skillImplementation ||
        typeof skillImplementation.execute !== 'function'
      ) {
        throw new AppError(
          `Invalid skill implementation: missing execute function`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      // 构建技能对象
      const skill: Skill = {
        manifest,
        execute: skillImplementation.execute,
        validate: skillImplementation.validate,
        cleanup: skillImplementation.cleanup,
      };

      return skill;
    } catch (error) {
      throw new AppError(
        `Failed to load skill from ${skillPath}: ${error}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 加载多个技能
   * @param skillPaths 技能路径数组
   * @returns 加载的技能数组
   */
  async loadAll(skillPaths: string[]): Promise<Skill[]> {
    const skills: Skill[] = [];

    for (const path of skillPaths) {
      try {
        const skill = await this.load(path);
        skills.push(skill);
      } catch (error) {
        logger.error(`Error loading skill ${path}:`, { error });
        // 继续加载其他技能
      }
    }

    return skills;
  }

  /**
   * 加载目录中的所有技能
   * @param skillsDir 技能目录
   * @returns 加载的技能数组
   */
  async loadFromDirectory(skillsDir: string): Promise<Skill[]> {
    const skillPaths: string[] = [];

    try {
      const { readdirSync, existsSync, statSync } = await import('fs');
      const { join } = await import('path');

      if (!existsSync(skillsDir)) {
        return [];
      }

      const entries = readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(skillsDir, entry.name);
          // 检查是否包含manifest.json
          if (existsSync(join(skillPath, 'manifest.json'))) {
            skillPaths.push(skillPath);
          }
        }
      }
    } catch (error) {
      logger.error(`Error reading skills directory ${skillsDir}:`, { error });
      return [];
    }

    return this.loadAll(skillPaths);
  }
}
