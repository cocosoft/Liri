/**
 * SkillConverter
 * 技能格式转换器，负责在 ClawHub 技能格式与 PY_APP 插件系统格式之间进行双向转换。
 * 支持 claw.json（主流）、skill.yaml 两种清单格式的解析与生成。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { PluginRegistration } from '@modules/plugins/types/PluginTypes';
import { PluginState } from '@modules/plugins/types/PluginTypes';
import type { InstalledSkill, ClawHubSkillMeta } from './ClawHubAdapter';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * claw.json 清单文件结构
 */
interface ClawJsonManifest {
  claw: string;
  skill: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license?: string;
    category?: string;
    tags?: string[];
    icon?: string;
    readme?: string;
    dependencies?: string[];
    permissions?: string[];
    /** 入口文件路径 */
    entry?: string;
    /** 主文件路径 */
    main?: string;
    /** 执行的钩子 */
    hooks?: Record<string, string>;
    /** 技能配置 */
    config?: Record<string, unknown>;
  };
}

/**
 * ClawHub 权限声明 → PY_APP 权限检查映射
 */
const CLAWHUB_TO_PYAPP_PERMISSIONS: Record<string, string> = {
  network: 'network:request',
  filesystem: 'filesystem:read',
  browser: 'browser:launch',
  shell: 'shell:execute',
  notifications: 'notifications:send',
  vault: 'vault:read',
  voice: 'voice:capture',
};

/**
 * SkillConverter
 * 支持 ClawHub 与 PY_APP 内部格式的互转。
 */
export class SkillConverter {
  /**
   * 构造函数
   */
  constructor() {
    // 无额外初始化
  }

  /**
   * 将 claw.json 内容解析为 ClawHubSkillMeta
   * @param content claw.json 的字符串内容
   * @returns 标准化的技能元数据
   */
  parseClawJson(content: string): ClawHubSkillMeta {
    try {
      const manifest: ClawJsonManifest = JSON.parse(content);

      if (!manifest.claw || !manifest.skill) {
        throw new Error('无效的 claw.json 格式：缺少 claw 版本或 skill 字段');
      }

      const skill = manifest.skill;

      return {
        id: skill.id,
        name: skill.name,
        version: skill.version,
        description: skill.description,
        author: skill.author,
        license: skill.license,
        category: skill.category,
        tags: skill.tags || [],
        icon: skill.icon,
        readme: skill.readme,
        dependencies: skill.dependencies,
        permissions: skill.permissions,
        manifestVersion: manifest.claw,
        source: 'third_party',
      };
    } catch (error) {
      logger.error('解析 claw.json 失败', error as Error);
      throw new Error(`claw.json 解析失败: ${(error as Error).message}`);
    }
  }

  /**
   * 生成 claw.json 清单内容
   * @param meta 技能元数据
   * @returns claw.json 的 JSON 字符串
   */
  generateClawJson(meta: ClawHubSkillMeta): string {
    const manifest: ClawJsonManifest = {
      claw: '1.0',
      skill: {
        id: meta.id,
        name: meta.name,
        version: meta.version,
        description: meta.description,
        author: meta.author,
        license: meta.license,
        category: meta.category,
        tags: meta.tags,
        icon: meta.icon,
        readme: meta.readme,
        dependencies: meta.dependencies,
        permissions: meta.permissions,
      },
    };

    return JSON.stringify(manifest, null, 2);
  }

  /**
   * 解析 skill.yaml 内容
   * 暂为占位实现，后续可引入 yaml 解析库
   * @param content YAML 字符串内容
   * @returns 标准化的技能元数据
   */
  parseSkillYaml(content: string): ClawHubSkillMeta {
    logger.warn('skill.yaml 解析暂未完整实现，返回默认值');

    try {
      const lines = content.split('\n');
      const meta: Record<string, string> = {};

      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          meta[key] = value;
        }
      }

      return {
        id: meta.id || `yaml-skill-${Date.now()}`,
        name: meta.name || meta.id || 'unnamed',
        version: meta.version || '1.0.0',
        description: meta.description || '',
        author: meta.author || 'unknown',
        tags: meta.tags ? meta.tags.split(',').map((t) => t.trim()) : [],
        manifestVersion: 'yaml',
        source: 'third_party',
      };
    } catch (error) {
      logger.error('解析 skill.yaml 失败', error as Error);
      throw new Error(`skill.yaml 解析失败: ${(error as Error).message}`);
    }
  }

  /**
   * 将 InstalledSkill 转换为 PluginRegistration
   * 用于注册到 PluginRegistry
   * @param installed 已安装的技能
   * @returns 兼容 PluginRegistry 的注册项
   */
  toPluginRegistration(installed: InstalledSkill): PluginRegistration {
    return {
      id: installed.meta.id,
      name: installed.meta.name,
      version: installed.meta.version,
      path: installed.installPath,
      state: installed.enabled ? PluginState.ENABLED : PluginState.DISABLED,
      registeredAt: new Date(installed.installedAt),
      enabled: installed.enabled,
      dependencies: installed.meta.dependencies || [],
      dependents: [],
    };
  }

  /**
   * 将 ClawHub 权限声明转换为 PY_APP 权限检查路径
   * @param clawhubPermissions ClawHub 权限声明列表
   * @returns PY_APP 权限检查路径列表
   */
  convertPermissions(clawhubPermissions?: string[]): string[] {
    if (!clawhubPermissions || clawhubPermissions.length === 0) {
      return [];
    }

    return clawhubPermissions
      .map((perm) => {
        const lowerPerm = perm.toLowerCase();
        return CLAWHUB_TO_PYAPP_PERMISSIONS[lowerPerm] || null;
      })
      .filter((p): p is string => p !== null);
  }
}
