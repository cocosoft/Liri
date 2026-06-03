/**
 * 成本数据持久化服务
 * 将成本/Token统计数据保存到文件，支持跨会话数据持久化
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveDataDir } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 持久化数据结构
 */
export interface PersistedCostData {
  version: number;
  updatedAt: string;
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  modelBreakdown: Record<
    string,
    {
      totalCost: number;
      totalTokens: number;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
}

/**
 * 会话级成本数据接口
 */
export interface SessionCostData {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalRequests: number;
  modelBreakdown: Record<
    string,
    {
      totalCost: number;
      totalTokens: number;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
  successfulRequests: number;
  failedRequests: number;
}

const DEFAULT_DATA_FILE = join(resolveDataDir(), 'cost_data.json');
const CURRENT_VERSION = 1;

/**
 * 初始化空数据
 */
function createEmptyData(): PersistedCostData {
  return {
    version: CURRENT_VERSION,
    updatedAt: new Date().toISOString(),
    totalCostUSD: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    modelBreakdown: {},
  };
}

/**
 * 成本数据持久化服务
 */
export class CostPersistenceService {
  private dataFilePath: string;
  private accumulatedData: PersistedCostData;
  private initialized: boolean = false;

  /**
   * @param dataFilePath 数据文件路径，默认 app/data/cost_data.json
   */
  constructor(dataFilePath?: string) {
    this.dataFilePath = dataFilePath || DEFAULT_DATA_FILE;
    this.accumulatedData = createEmptyData();
  }

  /**
   * 初始化服务，从文件加载历史数据
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const dir = this.dataFilePath.substring(
        0,
        this.dataFilePath.lastIndexOf('\\')
      );
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      if (existsSync(this.dataFilePath)) {
        const content = await readFile(this.dataFilePath, {
          encoding: 'utf-8',
        });
        const parsed = JSON.parse(content) as PersistedCostData;
        if (parsed.version === CURRENT_VERSION) {
          this.accumulatedData = parsed;
        }
      }

      this.initialized = true;
    } catch {
      this.accumulatedData = createEmptyData();
      this.initialized = true;
    }
  }

  /**
   * 获取累积的历史数据
   */
  getAccumulatedData(): PersistedCostData {
    return { ...this.accumulatedData };
  }

  /**
   * 将会话数据合并到累积数据中并保存
   */
  async mergeAndSave(sessionData: SessionCostData): Promise<void> {
    this.accumulatedData.totalCostUSD += sessionData.totalCost;
    this.accumulatedData.totalInputTokens += sessionData.totalInputTokens;
    this.accumulatedData.totalOutputTokens += sessionData.totalOutputTokens;
    this.accumulatedData.totalCacheReadTokens +=
      sessionData.totalCacheReadTokens;
    this.accumulatedData.totalCacheCreationTokens +=
      sessionData.totalCacheCreationTokens;
    this.accumulatedData.totalRequests += sessionData.totalRequests;
    this.accumulatedData.successfulRequests += sessionData.successfulRequests;
    this.accumulatedData.failedRequests += sessionData.failedRequests;
    this.accumulatedData.updatedAt = new Date().toISOString();

    for (const [model, usage] of Object.entries(sessionData.modelBreakdown)) {
      if (!this.accumulatedData.modelBreakdown[model]) {
        this.accumulatedData.modelBreakdown[model] = {
          totalCost: 0,
          totalTokens: 0,
          requestCount: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      const m = this.accumulatedData.modelBreakdown[model];
      m.totalCost += usage.totalCost;
      m.totalTokens += usage.totalTokens;
      m.requestCount += usage.requestCount;
      m.inputTokens += usage.inputTokens;
      m.outputTokens += usage.outputTokens;
    }

    await this.save();
  }

  /**
   * 将当前累积数据写入文件
   */
  async save(): Promise<void> {
    try {
      const dir = this.dataFilePath.substring(
        0,
        this.dataFilePath.lastIndexOf('\\')
      );
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(
        this.dataFilePath,
        JSON.stringify(this.accumulatedData, null, 2),
        { encoding: 'utf-8' }
      );
    } catch (error) {
      logger.error('保存成本数据失败:', { error });
    }
  }

  /**
   * 重置累积数据
   */
  async reset(): Promise<void> {
    this.accumulatedData = createEmptyData();
    await this.save();
  }
}

/**
 * 全局持久化服务实例
 */
export const costPersistenceService = new CostPersistenceService();
