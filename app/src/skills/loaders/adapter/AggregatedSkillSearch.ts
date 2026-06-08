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
 * 聚合搜索
 *
 * 查询本地 SkillHub + 并行查询所有 ThirdPartyAdapter，
 * 合并、去重、排序后返回。
 */

import type { Skill } from '../../types';
import type { SkillHub, SkillHubSearchFilter } from '../../SkillHub';
import type {
  ThirdPartySkillAdapter,
  ThirdPartySkillSearchResult,
} from './ThirdPartySkillAdapter';
import type { ThirdPartyAdapterRegistry } from './ThirdPartyAdapterRegistry';

/** 聚合搜索结果条目 */
export interface AggregatedSearchItem {
  /** 来源标识：'local' | '<adapter_name>' */
  source: string;
  /** 本地技能对象（local 来源时存在） */
  skill?: Skill;
  /** 第三方搜索结果（非 local 来源时存在） */
  remoteResult?: ThirdPartySkillSearchResult;
  /** 技能名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 相关度分数 */
  score: number;
}

/**
 * 聚合搜索
 *
 * 搜索策略：
 * 1. 查本地索引（Hub）
 * 2. 并行查各 ThirdPartyAdapter.searchSkills()
 * 3. 合并、去重、排序
 */
export class AggregatedSkillSearch {
  private hub: SkillHub;
  private adapterRegistry: ThirdPartyAdapterRegistry;

  /**
   * @param hub SkillHub 实例
   * @param adapterRegistry ThirdPartyAdapterRegistry 实例
   */
  constructor(hub: SkillHub, adapterRegistry: ThirdPartyAdapterRegistry) {
    this.hub = hub;
    this.adapterRegistry = adapterRegistry;
  }

  /**
   * 聚合搜索
   * @param query 搜索关键字
   * @param filter 额外的本地过滤条件
   * @param timeoutMs 远程搜索超时（默认 5000ms）
   */
  async search(
    query: string,
    filter?: SkillHubSearchFilter,
    timeoutMs: number = 5000
  ): Promise<AggregatedSearchItem[]> {
    // 1. 查本地 Hub
    const localResults = this.searchLocal(query, filter);

    // 2. 并行查所有 ThirdPartyAdapter
    const adapters = this.adapterRegistry.getAll();
    const remotePromises = adapters.map((adapter) =>
      this.searchAdapterWithTimeout(adapter, query, timeoutMs)
    );
    const remoteResults = (await Promise.allSettled(remotePromises))
      .filter(
        (r): r is PromiseFulfilledResult<ThirdPartySkillSearchResult[]> =>
          r.status === 'fulfilled'
      )
      .flatMap((r) => r.value);

    // 3. 合并、去重
    const merged = this.mergeResults(localResults, remoteResults);

    // 4. 排序
    return merged.sort((a, b) => b.score - a.score);
  }

  /**
   * 本地搜索
   */
  private searchLocal(
    query: string,
    filter?: SkillHubSearchFilter
  ): AggregatedSearchItem[] {
    const localSkills = this.hub.search({ ...filter, keyword: query });
    return localSkills.map((entry) => ({
      source: 'local',
      name: entry.name,
      description: entry.description,
      score: 1.0,
    }));
  }

  /**
   * 带超时的适配器搜索
   */
  private async searchAdapterWithTimeout(
    adapter: ThirdPartySkillAdapter,
    query: string,
    timeoutMs: number
  ): Promise<ThirdPartySkillSearchResult[]> {
    const result = await Promise.race([
      adapter.searchSkills(query),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`搜索超时: ${adapter.name}`)), timeoutMs)
      ),
    ]);
    return result;
  }

  /**
   * 合并本地和远程结果，按名称去重
   */
  private mergeResults(
    local: AggregatedSearchItem[],
    remote: ThirdPartySkillSearchResult[]
  ): AggregatedSearchItem[] {
    const seen = new Set<string>();
    const merged: AggregatedSearchItem[] = [];

    // 本地结果优先
    for (const item of local) {
      seen.add(item.name);
      merged.push(item);
    }

    // 远程结果去重
    for (const r of remote) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        merged.push({
          source: r.installed ? 'installed' : 'remote',
          name: r.name,
          description: r.description,
          score: r.score ?? 0.5,
          remoteResult: r,
        });
      }
    }

    return merged;
  }
}
