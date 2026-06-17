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
 * ClawHubAPIClient
 * ClawHub 远程 API 客户端，负责与 ClawHub 市场通信。
 * 仅处理 HTTP 请求/响应，不包含缓存、索引等逻辑。
 */

import https from 'node:https';
import http from 'node:http';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { ThirdPartySkillSearchResult } from '../ThirdPartySkillAdapter';
import type { ClawHubSkillMeta } from './ClawHubMeta';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * ClawHub API 搜索响应
 */
interface ClawHubSearchResponse {
  skills: Array<{
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
    manifestVersion?: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * ClawHubAPIClient 配置
 */
export interface ClawHubAPIClientConfig {
  apiBaseUrl?: string;
  timeout?: number;
}

/**
 * ClawHubAPIClient
 */
export class ClawHubAPIClient {
  private apiBaseUrl: string;
  private timeout: number;

  constructor(config: ClawHubAPIClientConfig = {}) {
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.clawhub.com/v1';
    this.timeout = config.timeout || 10000;
  }

  /**
   * 远程搜索技能
   */
  async search(
    query: string,
    options?: { category?: string; tags?: string[] }
  ): Promise<ThirdPartySkillSearchResult[]> {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (options?.category) params.set('category', options.category);
    if (options?.tags?.length) params.set('tags', options.tags.join(','));
    params.set('pageSize', '50');

    try {
      const url = `${this.apiBaseUrl}/skills/search?${params.toString()}`;
      const response = await this.httpGetJson<ClawHubSearchResponse>(url);
      return (response.skills || []).map((item) => ({
        id: item.id,
        name: item.name,
        version: item.version || '1.0.0',
        description: item.description,
        author: item.author,
        license: item.license,
        category: item.category,
        tags: item.tags || [],
        installed: false,
      }));
    } catch (error) {
      logger.warn('ClawHub 远程搜索失败', error as Error);
      return [];
    }
  }

  /**
   * 获取技能详情
   */
  async getSkillDetail(skillId: string): Promise<ClawHubSkillMeta | null> {
    try {
      const url = `${this.apiBaseUrl}/skills/${encodeURIComponent(skillId)}`;
      const data = await this.httpGetJson<any>(url);
      return this.mapToSkillMeta(data);
    } catch (error) {
      logger.error(`获取技能详情失败: ${skillId}`, error as Error);
      return null;
    }
  }

  /**
   * 下载技能清单
   */
  async downloadSkill(
    skillId: string
  ): Promise<{ meta: ClawHubSkillMeta; files: Record<string, string> } | null> {
    try {
      const url = `${this.apiBaseUrl}/skills/${encodeURIComponent(skillId)}/download`;
      const data = await this.httpGetJson<any>(url);
      return {
        meta: this.mapToSkillMeta(data),
        files: data.files || {},
      };
    } catch (error) {
      logger.error(`下载技能失败: ${skillId}`, error as Error);
      return null;
    }
  }

  /**
   * 获取技能文本内容（如 SKILL.md）
   */
  async getText(url: string): Promise<string> {
    return this.httpGetText(url);
  }

  /**
   * 将 API 返回数据映射为 ClawHubSkillMeta
   */
  private mapToSkillMeta(data: any): ClawHubSkillMeta {
    return {
      id: data.id || '',
      name: data.name || '',
      version: data.version || '1.0.0',
      description: data.description || '',
      author: data.author || '',
      license: data.license,
      category: data.category,
      tags: data.tags || [],
      icon: data.icon,
      readme: data.readme,
      dependencies: data.dependencies,
      permissions: data.permissions,
      manifestVersion: data.manifestVersion || '1.0',
      source: 'third_party',
    };
  }

  /**
   * HTTP GET JSON 请求
   */
  private httpGetJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;

      const req = client.get(
        url,
        {
          timeout: this.timeout,
          headers: { 'User-Agent': 'Liri-ClawHub/1.0' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const body = Buffer.concat(chunks).toString('utf-8');
              if (
                res.statusCode &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                resolve(JSON.parse(body) as T);
              } else {
                reject(
                  new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)
                );
              }
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时: ${url}`));
      });
    });
  }

  /**
   * HTTP GET 文本请求
   */
  private httpGetText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;

      const req = client.get(
        url,
        {
          timeout: this.timeout,
          headers: { 'User-Agent': 'Liri-ClawHub/1.0' },
        },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const redirectUrl = res.headers.location;
            if (redirectUrl) {
              this.httpGetText(redirectUrl).then(resolve).catch(reject);
              return;
            }
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(body);
            } else {
              reject(
                new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)
              );
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时: ${url}`));
      });
    });
  }
}
