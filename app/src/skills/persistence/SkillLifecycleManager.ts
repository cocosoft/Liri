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
 * 技能生命周期管理器
 *
 * 统一编排 SkillRegistry + 辅助组件的初始化、DB 加载和事件订阅。
 *
 * 调用方（如 init.ts）只需一次调用：
 *   await initializeSkillLifecycle(registry, skillDB);
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

import type { SkillDB } from './SkillDB';
import type { SkillRegistry } from '../SkillRegistry';
import type { SkillUsageTracker } from '../SkillUsageTracker';
import type { SkillCurator } from '../SkillCurator';
import type { SkillProvenanceTracker } from '../SkillProvenanceTracker';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 技能生命周期配置
 */
export interface SkillLifecycleConfig {
  /** 是否加载历史数据 */
  loadFromDB: boolean;
  /** 是否订阅 Registry 事件 */
  subscribeToRegistry: boolean;
  /** 使用统计追踪器最大记录数 */
  maxUsageRecords: number;
}

const DEFAULT_CONFIG: SkillLifecycleConfig = {
  loadFromDB: true,
  subscribeToRegistry: true,
  maxUsageRecords: 10000,
};

/**
 * 初始化技能生命周期
 *
 * 编排流程：
 * 1. 初始化 SkillDB
 * 2. 创建辅助组件实例（UsageTracker / Curator / ProvenanceTracker）
 * 3. 从 DB 加载历史数据
 * 4. 订阅 SkillRegistry 事件
 *
 * @param registry SkillRegistry 实例
 * @param skillDB SkillDB 实例（可选，默认 getSkillDB()）
 * @param config 生命周期配置（可选）
 */
export async function initializeSkillLifecycle(
  registry: SkillRegistry,
  skillDB: SkillDB,
  config: Partial<SkillLifecycleConfig> = {}
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 1. 初始化 DB
  await skillDB.init();
  logger.debug('SkillDB 已初始化');

  // 2. 获取或创建辅助组件
  const { getSkillUsageTracker } = await import('../SkillUsageTracker');
  const { getSkillCurator } = await import('../SkillCurator');
  const { getSkillProvenanceTracker } =
    await import('../SkillProvenanceTracker');

  const usageTracker = getSkillUsageTracker(skillDB, cfg.maxUsageRecords);
  const curator = getSkillCurator(skillDB);
  const provenanceTracker = getSkillProvenanceTracker(skillDB);

  // 3. 从 DB 加载历史数据
  if (cfg.loadFromDB) {
    await Promise.all([
      usageTracker.loadFromDB(),
      curator.loadFromDB(),
      provenanceTracker.loadFromDB(),
    ]);
    logger.debug('技能辅助组件从 DB 加载完成');
  }

  // 4. 订阅 SkillRegistry 事件
  if (cfg.subscribeToRegistry) {
    usageTracker.subscribeToRegistry(registry);
    curator.subscribeToRegistry(registry);
    provenanceTracker.subscribeToRegistry(registry);
    logger.debug('技能辅助组件已订阅 Registry 事件');
  }

  logger.info('技能生命周期初始化完成');
}
