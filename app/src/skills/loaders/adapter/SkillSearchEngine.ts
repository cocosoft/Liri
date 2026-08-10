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
 * SkillSearchEngine（v1.5 阶段 1）
 * 技能搜索引擎：组合适配器搜索 + 自定义源持久化。
 *
 * 接口签名以 LocalHTTPService 现有 4 个消费点为准：
 * - searchRemote(query, opts?) → Promise<LocalSkillSearchResult[]>（含 skill 包装）
 * - getSourceNames() → string[]（同步）
 * - addCustomSource(name, apiBaseUrl) → void（仅 https，SSRF 强化见阶段 4）
 * - removeCustomSource(name) → void
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import type { LocalSkillSearchResult } from './types';
import type { ThirdPartySkillSearchResult } from './ThirdPartySkillAdapter';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('skills:searchEngine');

/** 自定义源条目 */
export interface SkillSourceEntry {
  name: string;
  url: string;
  addedAt: number;
}

/** 源持久化文件 */
const SOURCES_FILE = 'sources.json';

/**
 * 适配器最小接口（避免引入泛型耦合）
 */
export interface SearchEngineAdapter {
  searchSkills(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<ThirdPartySkillSearchResult[]>;
  getLocalStore(): { getSkillsPath(): string };
}

/**
 * 技能搜索引擎
 */
export class SkillSearchEngine {
  private adapter: SearchEngineAdapter;
  private sources: Map<string, string> = new Map();
  private sourcesPath: string;

  constructor(adapter: SearchEngineAdapter) {
    this.adapter = adapter;
    this.sourcesPath = join(
      adapter.getLocalStore().getSkillsPath(),
      SOURCES_FILE
    );
    this.loadSources();
  }

  // ── 源持久化 ──────────────────────────────────────

  private loadSources(): void {
    try {
      if (!existsSync(this.sourcesPath)) return;
      const data = JSON.parse(
        readFileSync(this.sourcesPath, 'utf-8')
      ) as SkillSourceEntry[];
      for (const entry of data) {
        this.sources.set(entry.name, entry.url);
      }
    } catch (error) {
      logger.warn('sources.json 损坏，忽略自定义源', error as Error);
    }
  }

  private saveSources(): void {
    const entries: SkillSourceEntry[] = Array.from(this.sources.entries()).map(
      ([name, url]) => ({ name, url, addedAt: Date.now() })
    );
    // 原子写：temp + rename，防中途崩溃产生半文件
    const tmpPath = `${this.sourcesPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
    renameSync(tmpPath, this.sourcesPath);
  }

  // ── 搜索 ──────────────────────────────────────────

  /**
   * 远程/聚合搜索（含本地已安装）
   * 返回带 skill 包装的结果（消费点使用 r.skill.id）
   */
  async searchRemote(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<LocalSkillSearchResult[]> {
    const results = await this.adapter.searchSkills(query, opts);
    return results.map((r) => ({
      skill: {
        id: r.id,
        name: r.name,
        version: r.version,
        description: r.description,
        author: r.author,
        license: r.license,
        category: r.category,
        tags: r.tags,
      },
      source: 'remote',
      installed: r.installed,
    }));
  }

  // ── 源管理 ────────────────────────────────────────

  getSourceNames(): string[] {
    return Array.from(this.sources.keys());
  }

  addCustomSource(name: string, apiBaseUrl: string): void {
    const trimmedName = name.trim();
    const trimmedUrl = apiBaseUrl.trim();

    if (!trimmedName || !trimmedUrl) {
      throw new Error('源名称与地址不能为空');
    }

    // SSRF 校验（v1.5 阶段 4 强化，修复 P3-5）：
    // 仅 https + 禁内网/回环段
    const url = new URL(trimmedUrl);
    if (url.protocol !== 'https:') {
      throw new Error('自定义源仅支持 https:// 地址');
    }
    const hostname = url.hostname.toLowerCase();
    const isPrivate =
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.localhost') ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      // 2026-08-06 修复：补 169.254.0.0/16 链路本地段（云元数据/AWS metadata 所在网段）
      hostname.startsWith('169.254.') ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '::1';
    if (isPrivate) {
      throw new Error('自定义源不能指向内网或回环地址');
    }

    this.sources.set(trimmedName, trimmedUrl);
    this.saveSources();
    logger.info(`已添加自定义搜索源: ${trimmedName} -> ${trimmedUrl}`);
  }

  removeCustomSource(name: string): void {
    if (this.sources.delete(name)) {
      this.saveSources();
      logger.info(`已移除自定义搜索源: ${name}`);
    }
  }
}
