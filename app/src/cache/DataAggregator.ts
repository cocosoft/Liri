//
/**
 * 数据聚合器
 * 支持增量更新和数据汇总
 */

import { getCacheSystem } from './CacheSystem.js';
import { logForDebugging } from '../utils/debug.js';

/**
 * 聚合数据接口
 */
export interface AggregatedData {
  [key: string]: unknown;
  count?: number;
  sum?: number;
  average?: number;
  min?: number;
  max?: number;
  lastUpdated?: number;
}

/**
 * 数据聚合器
 */
export class DataAggregator {
  private cacheKeyPrefix = 'aggregated_';
  private cache = getCacheSystem();

  /**
   * 增量更新聚合数据
   */
  async incrementData(
    aggregationKey: string,
    field: string,
    value: number
  ): Promise<AggregatedData> {
    const cacheKey = `${this.cacheKeyPrefix}${aggregationKey}`;
    const existingData = (await this.cache.get<AggregatedData>(cacheKey)) || {};

    // 初始化聚合数据
    if (!existingData.count) existingData.count = 0;
    if (!existingData.sum) existingData.sum = 0;

    // 更新聚合数据
    existingData.count++;
    existingData.sum += value;
    existingData.average = existingData.sum / existingData.count;

    // 更新最小值和最大值
    if (existingData.min === undefined || value < existingData.min) {
      existingData.min = value;
    }
    if (existingData.max === undefined || value > existingData.max) {
      existingData.max = value;
    }

    // 更新最后更新时间
    existingData.lastUpdated = Date.now();

    // 保存到缓存
    await this.cache.set(cacheKey, existingData);

    logForDebugging(`数据已增量更新: ${aggregationKey}.${field} += ${value}`);
    return existingData;
  }

  /**
   * 批量增量更新聚合数据
   */
  async batchIncrementData(
    aggregationKey: string,
    data: Record<string, number>
  ): Promise<AggregatedData> {
    const cacheKey = `${this.cacheKeyPrefix}${aggregationKey}`;
    const existingData = (await this.cache.get<AggregatedData>(cacheKey)) || {};

    // 初始化聚合数据
    if (!existingData.count) existingData.count = 0;
    if (!existingData.sum) existingData.sum = 0;

    // 批量更新
    for (const [field, value] of Object.entries(data)) {
      existingData[field] = ((existingData[field] as number) || 0) + value;
      existingData.sum += value;
      existingData.count++;

      // 更新最小值和最大值
      if (existingData.min === undefined || value < existingData.min) {
        existingData.min = value;
      }
      if (existingData.max === undefined || value > existingData.max) {
        existingData.max = value;
      }
    }

    // 更新平均值
    existingData.average = existingData.sum / existingData.count;

    // 更新最后更新时间
    existingData.lastUpdated = Date.now();

    // 保存到缓存
    await this.cache.set(cacheKey, existingData);

    logForDebugging(`数据已批量更新: ${aggregationKey}`);
    return existingData;
  }

  /**
   * 获取聚合数据
   */
  async getAggregatedData(
    aggregationKey: string
  ): Promise<AggregatedData | undefined> {
    const cacheKey = `${this.cacheKeyPrefix}${aggregationKey}`;
    return await this.cache.get<AggregatedData>(cacheKey);
  }

  /**
   * 重置聚合数据
   */
  async resetAggregatedData(aggregationKey: string): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}${aggregationKey}`;
    await this.cache.delete(cacheKey);
    logForDebugging(`聚合数据已重置: ${aggregationKey}`);
  }

  /**
   * 合并多个聚合数据
   */
  async mergeAggregatedData(
    targetKey: string,
    sourceKeys: string[]
  ): Promise<AggregatedData> {
    const mergedData: AggregatedData = {
      count: 0,
      sum: 0,
      lastUpdated: Date.now(),
    };

    // 收集所有源数据
    const sourceDataList = await Promise.all(
      sourceKeys.map((key) => this.getAggregatedData(key))
    );

    // 合并数据
    for (const sourceData of sourceDataList) {
      if (sourceData) {
        mergedData.count = (mergedData.count || 0) + (sourceData.count || 0);
        mergedData.sum = (mergedData.sum || 0) + (sourceData.sum || 0);

        // 更新最小值和最大值
        if (sourceData.min !== undefined) {
          if (mergedData.min === undefined || sourceData.min < mergedData.min) {
            mergedData.min = sourceData.min;
          }
        }
        if (sourceData.max !== undefined) {
          if (mergedData.max === undefined || sourceData.max > mergedData.max) {
            mergedData.max = sourceData.max;
          }
        }

        // 合并其他字段
        for (const [field, value] of Object.entries(sourceData)) {
          if (
            !['count', 'sum', 'average', 'min', 'max', 'lastUpdated'].includes(
              field
            )
          ) {
            mergedData[field] =
              ((mergedData[field] as number) || 0) + (value as number);
          }
        }
      }
    }

    // 计算平均值
    if ((mergedData.count || 0) > 0) {
      mergedData.average = (mergedData.sum || 0) / (mergedData.count || 0);
    }

    // 保存到缓存
    const cacheKey = `${this.cacheKeyPrefix}${targetKey}`;
    await this.cache.set(cacheKey, mergedData);

    logForDebugging(`聚合数据已合并: ${targetKey}`);
    return mergedData;
  }

  /**
   * 获取所有聚合数据键
   */
  async getAllAggregatedKeys(): Promise<string[]> {
    const keys = await this.cache.keys();
    return keys
      .filter((key) => key.startsWith(this.cacheKeyPrefix))
      .map((key) => key.replace(this.cacheKeyPrefix, ''));
  }

  /**
   * 清空所有聚合数据
   */
  async clearAllAggregatedData(): Promise<void> {
    const keys = await this.cache.keys();
    for (const key of keys) {
      if (key.startsWith(this.cacheKeyPrefix)) {
        await this.cache.delete(key);
      }
    }
    logForDebugging('所有聚合数据已清空');
  }
}

/**
 * 统计数据聚合器
 */
export class StatsAggregator extends DataAggregator {
  /**
   * 记录工具执行时间
   */
  async recordToolExecutionTime(
    toolName: string,
    durationMs: number
  ): Promise<AggregatedData> {
    return this.incrementData(
      `tool_execution_${toolName}`,
      'duration',
      durationMs
    );
  }

  /**
   * 记录API调用次数
   */
  async recordApiCall(
    apiName: string,
    durationMs: number
  ): Promise<AggregatedData> {
    return this.incrementData(`api_call_${apiName}`, 'duration', durationMs);
  }

  /**
   * 记录缓存命中率
   */
  async recordCacheHit(cacheName: string): Promise<AggregatedData> {
    return this.incrementData(`cache_${cacheName}`, 'hits', 1);
  }

  /**
   * 记录缓存未命中率
   */
  async recordCacheMiss(cacheName: string): Promise<AggregatedData> {
    return this.incrementData(`cache_${cacheName}`, 'misses', 1);
  }

  /**
   * 获取工具执行统计
   */
  async getToolExecutionStats(
    toolName: string
  ): Promise<AggregatedData | undefined> {
    return this.getAggregatedData(`tool_execution_${toolName}`);
  }

  /**
   * 获取API调用统计
   */
  async getApiCallStats(apiName: string): Promise<AggregatedData | undefined> {
    return this.getAggregatedData(`api_call_${apiName}`);
  }

  /**
   * 获取缓存统计
   */
  async getCacheStats(cacheName: string): Promise<AggregatedData | undefined> {
    return this.getAggregatedData(`cache_${cacheName}`);
  }
}

/**
 * 全局数据聚合器实例
 */
export const dataAggregator = new DataAggregator();
export const statsAggregator = new StatsAggregator();

/**
 * 获取数据聚合器实例
 */
export function getDataAggregator(): DataAggregator {
  return dataAggregator;
}

export function getStatsAggregator(): StatsAggregator {
  return statsAggregator;
}
