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

import https from 'https';
import http from 'http';
import { Logger, LogLevel } from '@modules/monitoring';
import type { ThirdPartySkillSearchResult } from '../ThirdPartySkillAdapter';
import type { ClawHubSkillMeta } from './ClawHubMeta';
import { checkSsrf } from '../../../../tools/WebFetchTool/ssrf';

const logger = new Logger({
  module: 'skills:clawHubApi',
  level: LogLevel.INFO,
});

/** 重定向最大跳数（S1-4） */
const MAX_REDIRECTS = 3;

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
      const data = await this.httpGetJson<Record<string, unknown>>(url);
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
      const data = await this.httpGetJson<Record<string, unknown>>(url);
      return {
        meta: this.mapToSkillMeta(data),
        files: (data.files as Record<string, string>) || {},
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
  private mapToSkillMeta(data: Record<string, unknown>): ClawHubSkillMeta {
    return {
      id: (data.id as string) || '',
      name: (data.name as string) || '',
      version: (data.version as string) || '1.0.0',
      description: (data.description as string) || '',
      author: (data.author as string) || '',
      license: data.license as string | undefined,
      category: data.category as string | undefined,
      tags: (data.tags as string[]) || [],
      icon: data.icon as string | undefined,
      readme: data.readme as string | undefined,
      dependencies: data.dependencies as string[] | undefined,
      permissions: data.permissions as string[] | undefined,
      manifestVersion: (data.manifestVersion as string) || '1.0',
      source: 'third_party',
    };
  }

  /**
   * HTTP GET JSON 请求
   * 2026-08-06 修复（M2）：复用 httpGetText 安全链路（协议白名单 + 重定向最多 3 跳 + 目标 SSRF 校验），
   * 消除与 httpGetText 的校验不一致（原实现直接 client.get，无任何 SSRF/重定向防护）。
   */
  private async httpGetJson<T>(url: string): Promise<T> {
    const body = await this.httpGetText(url);
    return JSON.parse(body) as T;
  }

  /**
   * HTTP GET 文本请求（S1-4 + M2：仅 http/https、初始与重定向目标均做 SSRF 校验、重定向最多 3 跳）
   */
  private httpGetText(url: string, redirectCount = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      // 协议白名单：仅 http/https
      try {
        const proto = new URL(url).protocol;
        if (proto !== 'http:' && proto !== 'https:') {
          reject(new Error(`仅支持 http/https 地址: ${url}`));
          return;
        }
      } catch {
        reject(new Error(`无效 URL: ${url}`));
        return;
      }

      // 2026-08-06 修复（M2）：初始 URL 同样做 SSRF 校验（统一 SSRF 校验基元，与重定向目标一致）
      checkSsrf(url)
        .then((ssrf) => {
          if (ssrf.blocked) {
            reject(new Error(`目标地址被 SSRF 拦截: ${ssrf.reason}`));
            return;
          }
          this.doHttpGetText(url, redirectCount).then(resolve).catch(reject);
        })
        .catch(reject);
    });
  }

  /**
   * 实际 HTTP GET（已被 httpGetText 校验通过后执行）
   */
  private doHttpGetText(url: string, redirectCount: number): Promise<string> {
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
          const status = res.statusCode;
          if (
            status === 301 ||
            status === 302 ||
            status === 303 ||
            status === 307 ||
            status === 308
          ) {
            const redirectUrl = res.headers.location;
            if (!redirectUrl) {
              reject(new Error(`重定向缺少 Location: ${url}`));
              return;
            }
            if (redirectCount >= MAX_REDIRECTS) {
              reject(new Error(`重定向次数超限（>${MAX_REDIRECTS}）: ${url}`));
              return;
            }
            const target = new URL(redirectUrl, url).toString();
            checkSsrf(target)
              .then((ssrf) => {
                if (ssrf.blocked) {
                  reject(new Error(`重定向目标被 SSRF 拦截: ${ssrf.reason}`));
                  return;
                }
                this.httpGetText(target, redirectCount + 1)
                  .then(resolve)
                  .catch(reject);
              })
              .catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            if (status && status >= 200 && status < 300) {
              resolve(body);
            } else {
              reject(new Error(`HTTP ${status}: ${body.slice(0, 200)}`));
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
