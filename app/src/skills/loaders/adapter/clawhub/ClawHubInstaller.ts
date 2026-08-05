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
 * ClawHubInstaller
 * ClawHub 技能安装器，负责下载技能文件、解析清单、写入本地存储。
 */

import { join, dirname } from 'path';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import type { LocalSkillStore } from '../LocalSkillStore';
import type { ClawHubSkillMeta, InstalledClawHubSkill } from './ClawHubMeta';
import { ClawHubAPIClient } from './ClawHubAPIClient';

const logger = new Logger({
  module: 'skills:clawHubInstaller',
  level: LogLevel.INFO,
});

const MANIFEST_JSON = 'claw.json';

/**
 * ClawHubInstaller 配置
 */
export interface ClawHubInstallerConfig {
  apiClient: ClawHubAPIClient;
  localStore: LocalSkillStore<InstalledClawHubSkill>;
}

/**
 * ClawHubInstaller
 */
export class ClawHubInstaller {
  private apiClient: ClawHubAPIClient;
  private localStore: LocalSkillStore<InstalledClawHubSkill>;

  constructor(config: ClawHubInstallerConfig) {
    this.apiClient = config.apiClient;
    this.localStore = config.localStore;
  }

  /**
   * 安装技能
   * @param skillId 技能 ID
   * @param sourceUrl 来源 URL（可选）
   * @param targetPath 目标安装目录（可选；updateSkill 原子替换时传入 .tmp 目录）
   */
  async install(
    skillId: string,
    sourceUrl?: string,
    targetPath?: string
  ): Promise<InstalledClawHubSkill> {
    const installPath =
      targetPath || this.localStore.getSkillInstallPath(skillId);

    if (existsSync(installPath)) {
      throw new Error(`技能已安装: ${skillId}`);
    }

    logger.info(`开始安装技能: ${skillId}`);

    let metaData: ClawHubSkillMeta;

    const repoInfo = this.parseRepoId(skillId);

    if (repoInfo) {
      metaData = await this.installFromRepo(
        skillId,
        repoInfo.prefix,
        repoInfo.repo,
        installPath
      );
    } else if (sourceUrl) {
      const download = await this.apiClient.downloadSkill(skillId);
      if (!download) {
        throw new Error(`下载技能失败: ${skillId}`);
      }
      metaData = download.meta;
      await this.writeSkillFiles(installPath, metaData, download.files);
    } else {
      const download = await this.apiClient.downloadSkill(skillId);
      if (!download) {
        throw new Error(`从市场下载技能失败: ${skillId}`);
      }
      metaData = download.meta;
      await this.writeSkillFiles(installPath, metaData, download.files);
    }

    const files = this.collectFiles(installPath);
    this.validateInstallSize(installPath, files);

    const installed: InstalledClawHubSkill = {
      meta: metaData,
      installPath,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      enabled: true,
      files,
      sourceUrl: sourceUrl || '',
    };

    logger.info(`技能安装完成: ${metaData.name}@${metaData.version}`);
    return installed;
  }

  /**
   * 卸载技能
   */
  async uninstall(skill: InstalledClawHubSkill): Promise<void> {
    if (existsSync(skill.installPath)) {
      rmSync(skill.installPath, { recursive: true, force: true });
      logger.info(`技能文件已删除: ${skill.installPath}`);
    }
  }

  /**
   * 解析仓库源 ID（github:/hermes:/gitee: 前缀）
   */
  private parseRepoId(
    skillId: string
  ): { prefix: string; repo: string } | null {
    const match = skillId.match(/^(github|hermes|gitee):(.+)$/);
    return match ? { prefix: match[1], repo: match[2] } : null;
  }

  /**
   * 从 GitHub/Gitee 仓库安装技能
   */
  private async installFromRepo(
    skillId: string,
    prefix: string,
    repo: string,
    installPath: string
  ): Promise<ClawHubSkillMeta> {
    let skillContent = '';

    if (prefix === 'github' || prefix === 'hermes') {
      for (const branch of ['main', 'master']) {
        const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/SKILL.md`;
        try {
          skillContent = await this.apiClient.getText(rawUrl);
          break;
        } catch {
          continue;
        }
      }
    } else if (prefix === 'gitee') {
      for (const branch of ['main', 'master']) {
        const rawUrl = `https://gitee.com/${repo}/raw/${branch}/SKILL.md`;
        try {
          skillContent = await this.apiClient.getText(rawUrl);
          break;
        } catch {
          continue;
        }
      }
    }

    if (!skillContent) {
      throw new Error(`无法从仓库获取 SKILL.md: ${repo}`);
    }

    const meta = this.parseSkillFrontmatter(
      skillContent,
      skillId,
      prefix,
      repo
    );

    if (!existsSync(installPath)) {
      mkdirSync(installPath, { recursive: true });
    }

    writeFileSync(join(installPath, 'SKILL.md'), skillContent, 'utf-8');
    writeFileSync(
      join(installPath, MANIFEST_JSON),
      JSON.stringify(
        {
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
            source: prefix,
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    return meta;
  }

  /**
   * 解析 SKILL.md frontmatter
   */
  private parseSkillFrontmatter(
    content: string,
    skillId: string,
    source: string,
    repo: string
  ): ClawHubSkillMeta {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const fm: Record<string, string> = {};

    if (fmMatch) {
      const lines = fmMatch[1].split('\n');
      for (const line of lines) {
        const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
        if (m) fm[m[1]] = m[2].trim();
      }
    }

    const body = fmMatch ? content.slice(fmMatch[0].length) : content;
    const descMatch = body.match(/^#\s+(.+)/m);
    const fallbackDesc = descMatch ? descMatch[1] : '';

    return {
      id: skillId,
      name: fm.name || repo.split('/').pop() || skillId,
      version: fm.version || '1.0.0',
      description: fm.description || fallbackDesc,
      author: fm.author || repo.split('/')[0] || 'unknown',
      license: fm.license || undefined,
      category: fm.category || 'community',
      tags: fm.tags ? fm.tags.split(',').map((t) => t.trim()) : [],
      icon: undefined,
      readme: undefined,
      permissions: undefined,
      manifestVersion: fm['manifest-version'] || fm.version || '1.0',
      source: 'third_party',
    };
  }

  /**
   * 写入技能文件到安装目录
   */
  private async writeSkillFiles(
    installPath: string,
    meta: ClawHubSkillMeta,
    files: Record<string, string>
  ): Promise<void> {
    if (!existsSync(installPath)) {
      mkdirSync(installPath, { recursive: true });
    }

    writeFileSync(
      join(installPath, MANIFEST_JSON),
      JSON.stringify(
        {
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
        },
        null,
        2
      ),
      'utf-8'
    );

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(installPath, filePath);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullPath, content, 'utf-8');
    }
  }

  /**
   * 收集已安装的技能文件列表
   */
  private collectFiles(installPath: string): string[] {
    const files: string[] = [];

    if (!existsSync(installPath)) {
      return files;
    }

    const collect = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    };

    collect(installPath);
    return files;
  }

  /**
   * 安装校验（v1.5 阶段 4，修复 P3-7）：文件数 ≤50、总大小 ≤10MB
   * 超限抛错，install 流程中断（安装目录由 Base 层在失败时清理）
   */
  private validateInstallSize(installPath: string, files: string[]): void {
    const MAX_FILES = 50;
    const MAX_BYTES = 10 * 1024 * 1024;

    if (files.length > MAX_FILES) {
      throw new Error(
        `技能文件数超限（${files.length} > ${MAX_FILES}）: ${installPath}`
      );
    }

    let total = 0;
    for (const file of files) {
      try {
        total += statSync(file).size;
      } catch {
        // 文件可能已被移除，忽略
      }
    }
    if (total > MAX_BYTES) {
      throw new Error(
        `技能总大小超限（${(total / 1024 / 1024).toFixed(1)}MB > 10MB）: ${installPath}`
      );
    }
  }
}
