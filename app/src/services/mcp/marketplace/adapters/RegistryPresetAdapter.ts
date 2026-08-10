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
 * RegistryPresetAdapter — 预设 MCP 市场来源适配器（2026-08-06）
 *
 * 用于接入无公开搜索 API 的主流 MCP 市场（MCP.so / MCPMarket.cn / 魔搭 MCP 广场 / mcp-marketplace.io / mcpservers.org）。
 * 这些市场是 Web 目录形态，无文档化开放搜索端点——**不编造 API**（CS06）。
 * 适配器职责：在「MCP 市场 → 来源」列表中展示该市场入口（id/displayName/sourceRegistry），
 * 安装走现有手动来源（用户从市场官网复制 command/URL 后手动添加）。
 *
 * 若某市场后续开放公开搜索 API，应替换为真实 API 适配器（参照 SmitheryRegistryAdapter）。
 */

import { getLogger } from '@modules/monitoring';
import type {
  RegistryAdapter,
  SearchParams,
  SearchResult,
  ServerDetail,
  ServerInstallConfig,
  ThirdPartyRegistry,
} from '../types';

const logger = getLogger('services:mcp:presetAdapter');

export class RegistryPresetAdapter implements RegistryAdapter {
  readonly id: string;
  readonly registryType = 'third_party' as const;
  readonly sourceRegistry: ThirdPartyRegistry;
  readonly displayName: string;
  /** 市场官网（用于前端展示/用户手动浏览） */
  readonly websiteUrl: string;

  constructor(
    id: string,
    displayName: string,
    sourceRegistry: ThirdPartyRegistry,
    websiteUrl: string
  ) {
    this.id = id;
    this.displayName = displayName;
    this.sourceRegistry = sourceRegistry;
    this.websiteUrl = websiteUrl;
  }

  async search(_params: SearchParams): Promise<SearchResult[]> {
    logger.warn(
      `[${this.displayName}] 无公开搜索 API，请在官网浏览后手动安装（${this.websiteUrl}）`
    );
    return [];
  }

  async getServerDetail(_serverId: string): Promise<ServerDetail | null> {
    return null;
  }

  async getCategories(): Promise<
    Array<{ id: string; name: string; count: number }>
  > {
    return [];
  }

  async buildInstallConfig(
    _serverId: string
  ): Promise<ServerInstallConfig | null> {
    return null;
  }
}
