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
 * ClawHubConverter
 * ClawHub 技能格式 ↔ Liri 统一 Skill 格式的转换器。
 * 支持 claw.json（主流）、skill.yaml 两种清单格式的解析与生成。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { SkillSource, SkillLoadMethod } from '@modules/skills/types';
import type { Skill } from '@modules/skills/types';
import type { ThirdPartySkillSearchResult } from '../ThirdPartySkillAdapter';
import type { ClawHubSkillMeta, InstalledClawHubSkill } from './ClawHubMeta';

const logger = new Logger({
  module: 'skills:clawHubConverter',
  level: LogLevel.INFO,
});

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
    entry?: string;
    main?: string;
    hooks?: Record<string, string>;
    config?: Record<string, unknown>;
  };
}

/**
 * ClawHub 权限声明 → Liri 权限检查映射
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
 * ClawHubConverter
 */
export class ClawHubConverter {
  /**
   * 将 claw.json 内容解析为 ClawHubSkillMeta
   * @param content claw.json 的字符串内容
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
   * @param content YAML 字符串内容
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
   * 将 InstalledClawHubSkill 转换为 Liri 统一 Skill 类型
   * @param installed 已安装的技能
   */
  toSkill(installed: InstalledClawHubSkill): Skill {
    return {
      name: installed.meta.name,
      description: installed.meta.description,
      source: SkillSource.THIRD_PARTY,
      loadMethod: SkillLoadMethod.ADAPTER,
      loadedFrom: `clawhub:${installed.meta.id}`,
      version: installed.meta.version,
      author: installed.meta.author,
      aliases: [installed.meta.id],
      dependencies: installed.meta.dependencies,
      impl: {
        kind: 'executable',
        execute: async () => {
          return `[ClawHub] 执行技能: ${installed.meta.name} (路径: ${installed.installPath})`;
        },
      },
    };
  }

  /**
   * 将 InstalledClawHubSkill 转换为第三方搜索结果
   * @param installed 已安装的技能
   */
  toSearchResult(
    installed: InstalledClawHubSkill
  ): ThirdPartySkillSearchResult {
    return {
      id: installed.meta.id,
      name: installed.meta.name,
      version: installed.meta.version,
      description: installed.meta.description,
      author: installed.meta.author,
      license: installed.meta.license,
      category: installed.meta.category,
      tags: installed.meta.tags,
      installed: installed.enabled,
    };
  }

  /**
   * 将 ClawHub 权限声明转换为 Liri 权限检查路径
   * @param clawhubPermissions ClawHub 权限声明列表
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
