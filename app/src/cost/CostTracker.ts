//
/**
 * 成本跟踪器
 * 用于跟踪和计算模型使用的成本，参考CC源码的实现
 */

import { OTelAwareLogger } from '../monitoring/logs/OTelAwareLogger.js';
import {
  formatCost,
  getModelPricing,
  getCanonicalModelName,
  hasUnknownModel,
  resetUnknownModelFlag,
} from './ModelPricing.js';
import { calculateTotalCost } from './calculateCost.js';
import type { CostRecordRepository } from './CostRecordRepository.js';
import { globalEventBus, SystemEvents } from '@modules/core/events/EventBus.js';
import type { CostRecordedEvent } from '@modules/core/events/EventBus.js';
// 多租户 P5（2026-10-21）：累计值按**请求身份**分桶 —— 否则 `/v1/analytics/dashboard`、
// `/v1/workspaces/:id/cost/report` 这类"读 costTracker 内存累计"的端点会把全进程的
// 用量回给单个用户。本地身份恒 `local:local` 一个桶 ⇒ 桌面 / CLI 行为与改造前逐字一致。
import {
  currentOwnerKey,
  getRequestPrincipal,
  principalKeyOf,
} from '@modules/core/identity/requestScope.js';

import { getLogger } from '../monitoring/logs/Logger.js';
const logger = getLogger('cost:CostTracker');

/**
 * 模型使用信息
 */
export interface ModelUsage {
  /** 输入令牌数 */
  inputTokens: number;
  /** 输出令牌数 */
  outputTokens: number;
  /** 缓存读取令牌数 */
  cacheReadInputTokens: number;
  /** 缓存创建令牌数 */
  cacheCreationInputTokens: number;
  /** 网络搜索请求数 */
  webSearchRequests: number;
  /** 推理令牌数（reasoning tokens） */
  reasoningTokens: number;
  /** 成本（美元） */
  costUSD: number;
  /** 是否快速模式 */
  isFastMode: boolean;
  /** 请求次数 */
  requestCount: number;
}

/**
 * 单个身份的累计桶（多租户 P5）
 *
 * 分桶键是 `principalKeyOf(principal)`（`<tenantId>:<userId>`）；本地身份恒 `local:local`，
 * 故桌面 / CLI / cron（无请求作用域）始终落在同一个桶 —— 与改造前的"进程级单值"等价。
 */
interface CostBucket {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalWebSearchRequests: number;
  totalReasoningTokens: number;
  modelUsage: Map<string, ModelUsage>;
  startTime: number;
  currentSessionId: string;
}

/**
 * 成本跟踪器
 */
export class CostTracker {
  /** 身份键 → 累计桶（惰性创建） */
  private buckets: Map<string, CostBucket> = new Map();
  private recordRepository: CostRecordRepository | null = null;
  private otelLogger = new OTelAwareLogger({ module: 'cost:tracker' });

  /**
   * 当前请求身份对应的累计桶（惰性创建）。
   *
   * 所有读写都经此入口 ⇒ 读侧自动按身份裁剪，不需要每个调用方各自过滤。
   */
  private bucket(): CostBucket {
    const key = principalKeyOf(getRequestPrincipal());
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        totalCostUSD: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadInputTokens: 0,
        totalCacheCreationInputTokens: 0,
        totalWebSearchRequests: 0,
        totalReasoningTokens: 0,
        modelUsage: new Map<string, ModelUsage>(),
        startTime: Date.now(),
        currentSessionId: '',
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * 设置成本记录存储库
   */
  setRecordRepository(
    repository: CostRecordRepository,
    sessionId?: string
  ): void {
    this.recordRepository = repository;
    if (sessionId) {
      this.bucket().currentSessionId = sessionId;
    }
  }

  /**
   * 设置当前会话ID
   */
  setSessionId(sessionId: string): void {
    this.bucket().currentSessionId = sessionId;
  }

  /**
   * 添加成本
   */
  addCost(
    modelName: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0,
    webSearchRequests: number = 0,
    isFastMode: boolean = false,
    reasoningTokens: number = 0,
    requestId?: string
  ): number {
    const canonicalModelName = getCanonicalModelName(modelName);
    // [v1.2] 使用统一成本计算（safe clamp + 精度 + cache 启发式兜底）
    const pricing = getModelPricing(canonicalModelName, isFastMode);
    const cost = calculateTotalCost(
      pricing,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      webSearchRequests,
      isFastMode ? 'fast' : 'standard',
      0,
      // 每次 addCost 代表一次模型调用；billingMode=per_request 的模型按此次数计费
      1
    );

    const bucket = this.bucket();
    bucket.totalCostUSD += cost;
    bucket.totalInputTokens += inputTokens;
    bucket.totalOutputTokens += outputTokens;
    bucket.totalCacheReadInputTokens += cacheReadTokens;
    bucket.totalCacheCreationInputTokens += cacheCreationTokens;
    bucket.totalWebSearchRequests += webSearchRequests;
    bucket.totalReasoningTokens += reasoningTokens;

    // 更新模型使用信息
    const existingUsage = bucket.modelUsage.get(canonicalModelName);
    if (existingUsage) {
      existingUsage.inputTokens += inputTokens;
      existingUsage.outputTokens += outputTokens;
      existingUsage.cacheReadInputTokens += cacheReadTokens;
      existingUsage.cacheCreationInputTokens += cacheCreationTokens;
      existingUsage.webSearchRequests += webSearchRequests;
      existingUsage.reasoningTokens += reasoningTokens;
      existingUsage.costUSD += cost;
      existingUsage.isFastMode = isFastMode || existingUsage.isFastMode;
      existingUsage.requestCount += 1;
    } else {
      bucket.modelUsage.set(canonicalModelName, {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: cacheReadTokens,
        cacheCreationInputTokens: cacheCreationTokens,
        webSearchRequests,
        reasoningTokens,
        costUSD: cost,
        isFastMode,
        requestCount: 1,
      });
    }

    // 发布成本记录事件（订阅者负责 SQLite 持久化）
    const eventData: CostRecordedEvent = {
      model: canonicalModelName,
      inputTokens,
      outputTokens,
      cacheReadInputTokens: cacheReadTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      costUSD: cost,
      timestamp: Date.now(),
      sessionId: bucket.currentSessionId || undefined,
      requestId,
      // 多租户 P5：归属随事件走 —— 订阅者可能已在别的异步上下文里，
      // 只能靠本字段把行落回归属者的库（本地身份 ⇒ 缺省，事件形状与改造前一致）。
      ownerKey: currentOwnerKey(),
    };
    globalEventBus.publish(SystemEvents.COST_RECORDED, eventData);

    // 输出 OTel 上下文感知的结构化日志（自动注入 traceId/spanId）
    const level = cost === 0 ? 'warn' : 'info';
    this.otelLogger[level]('成本累加', {
      modelName: canonicalModelName,
      costUSD: cost,
      totalCostUSD: bucket.totalCostUSD,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      hasUnknownPricing: hasUnknownModel(),
      isFastMode,
    });

    return cost;
  }

  /**
   * 从使用信息添加成本
   */
  addCostFromUsage(
    modelName: string,
    usage: Omit<ModelUsage, 'costUSD'>
  ): number {
    return this.addCost(
      modelName,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadInputTokens,
      usage.cacheCreationInputTokens,
      usage.webSearchRequests,
      usage.isFastMode,
      usage.reasoningTokens || 0
    );
  }

  /**
   * 获取总成本
   */
  getTotalCostUSD(): number {
    return this.bucket().totalCostUSD;
  }

  /**
   * 获取总输入令牌数
   */
  getTotalInputTokens(): number {
    return this.bucket().totalInputTokens;
  }

  /**
   * 获取总输出令牌数
   */
  getTotalOutputTokens(): number {
    return this.bucket().totalOutputTokens;
  }

  /**
   * 获取总缓存读取令牌数
   */
  getTotalCacheReadInputTokens(): number {
    return this.bucket().totalCacheReadInputTokens;
  }

  /**
   * 获取总缓存创建令牌数
   */
  getTotalCacheCreationInputTokens(): number {
    return this.bucket().totalCacheCreationInputTokens;
  }

  /**
   * 获取总网络搜索请求数
   */
  getTotalWebSearchRequests(): number {
    return this.bucket().totalWebSearchRequests;
  }

  /**
   * 获取总推理令牌数
   */
  getTotalReasoningTokens(): number {
    return this.bucket().totalReasoningTokens;
  }

  /**
   * 获取会话持续时间（毫秒）
   */
  getSessionDuration(): number {
    return Date.now() - this.bucket().startTime;
  }

  /**
   * 获取模型使用信息
   */
  getModelUsage(): Record<string, ModelUsage> {
    return Object.fromEntries(this.bucket().modelUsage.entries());
  }

  /**
   * 获取指定模型的使用信息
   */
  getUsageForModel(modelName: string): ModelUsage | undefined {
    const canonicalName = getCanonicalModelName(modelName);
    return this.bucket().modelUsage.get(canonicalName);
  }

  /**
   * 是否有未知模型成本
   */
  hasUnknownModelCost(): boolean {
    return hasUnknownModel();
  }

  /**
   * 删除租户后丢弃该租户的**内存累计桶**（不触碰其他租户与本地桶）。
   *
   * 为什么要丢：桶里是进程内累计，租户删了还留着既占内存、也会让"同 id 新租户"
   * 一上来就带上旧用量。
   *
   * @returns 丢弃的桶数
   */
  forgetBucketsForTenant(tenantId: string): number {
    const prefix = `${tenantId}:`;
    let dropped = 0;
    for (const key of [...this.buckets.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.buckets.delete(key);
      dropped += 1;
    }
    return dropped;
  }

  /**
   * 重置成本跟踪（清空**所有身份**的累计桶 —— 语义是"从头计量"，不是"只清自己"）
   */
  reset(): void {
    this.buckets.clear();
    resetUnknownModelFlag();
    this.otelLogger.info('成本跟踪已重置');
  }

  /**
   * 格式化模型使用信息
   */
  private formatModelUsage(modelName: string, usage: ModelUsage): string {
    let result = `${modelName}:\n`;
    result += `  输入令牌: ${usage.inputTokens.toLocaleString()}\n`;
    result += `  输出令牌: ${usage.outputTokens.toLocaleString()}\n`;
    result += `  缓存读取令牌: ${usage.cacheReadInputTokens.toLocaleString()}\n`;
    result += `  缓存创建令牌: ${usage.cacheCreationInputTokens.toLocaleString()}\n`;
    if (usage.webSearchRequests > 0) {
      result += `  网络搜索请求: ${usage.webSearchRequests.toLocaleString()}\n`;
    }
    result += `  成本: ${formatCost(usage.costUSD)}\n`;
    if (usage.isFastMode) {
      result += `  模式: 快速模式\n`;
    }
    return result;
  }

  /**
   * 格式化成本报告
   */
  formatCostReport(detailed: boolean = false): string {
    const bucket = this.bucket();
    let report = '\n========================================\n';
    report += '            成本报告\n';
    report += '========================================\n';
    report += `总成本: ${formatCost(bucket.totalCostUSD)}\n`;
    report += `总输入令牌: ${bucket.totalInputTokens.toLocaleString()}\n`;
    report += `总输出令牌: ${bucket.totalOutputTokens.toLocaleString()}\n`;
    report += `总缓存读取令牌: ${bucket.totalCacheReadInputTokens.toLocaleString()}\n`;
    report += `总缓存创建令牌: ${bucket.totalCacheCreationInputTokens.toLocaleString()}\n`;
    if (bucket.totalWebSearchRequests > 0) {
      report += `总网络搜索请求: ${bucket.totalWebSearchRequests.toLocaleString()}\n`;
    }
    report += `会话持续时间: ${(this.getSessionDuration() / 1000).toFixed(1)}秒\n`;

    if (this.hasUnknownModelCost()) {
      report += '\n⚠️  警告: 包含未知模型的成本，使用了默认定价\n';
    }

    if (bucket.modelUsage.size > 0) {
      report += '\n模型使用详情:\n';
      for (const [modelName, usage] of bucket.modelUsage.entries()) {
        report += `\n${this.formatModelUsage(modelName, usage)}`;
      }
    }

    if (detailed) {
      report += '\n详细定价信息:\n';
      for (const [modelName, usage] of bucket.modelUsage.entries()) {
        const pricing = getModelPricing(modelName, usage.isFastMode);
        report += `\n${modelName}:\n`;
        report += `  定价: ${formatCost(pricing.inputPricePerMillion)}/${formatCost(pricing.outputPricePerMillion)} 每百万令牌\n`;
        if (usage.webSearchRequests > 0) {
          report += `  网络搜索: ${formatCost(pricing.webSearchPricePerRequest)} 每次请求\n`;
        }
      }
    }

    report += '========================================\n';

    return report;
  }
}

/**
 * 全局成本跟踪器实例（惰性单例）
 *
 * 不用模块级 `new CostTracker()`：类字段 `otelLogger = new OTelAwareLogger(...)`
 * 在实例化时加载 Logger→LogConfig→core 桶，模块加载期实例化会引入 ESM 循环
 * （core/index → PlanDrivenLoop → tasks/cost 桶 → costTracker TDZ，实测 planDrivenLoop
 * 测试暴露）。首次属性访问才实例化，对齐 systemPromptSections 的 skillRegistry 惰性 Proxy 模式。
 */
let _costTracker: CostTracker | undefined;
export const costTracker = new Proxy({} as CostTracker, {
  get(_target, prop: keyof CostTracker, receiver) {
    _costTracker ??= new CostTracker();
    const value = Reflect.get(_costTracker, prop, _costTracker);
    return typeof value === 'function' ? value.bind(_costTracker) : value;
  },
});

/**
 * 添加成本
 */
export function addCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  webSearchRequests: number = 0,
  isFastMode: boolean = false
): number {
  return costTracker.addCost(
    modelName,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    webSearchRequests,
    isFastMode
  );
}

/**
 * 获取总成本
 */
export function getTotalCostUSD(): number {
  return costTracker.getTotalCostUSD();
}

/**
 * 获取总输入令牌数
 */
export function getTotalInputTokens(): number {
  return costTracker.getTotalInputTokens();
}

/**
 * 获取总输出令牌数
 */
export function getTotalOutputTokens(): number {
  return costTracker.getTotalOutputTokens();
}

/**
 * 获取总缓存读取令牌数
 */
export function getTotalCacheReadInputTokens(): number {
  return costTracker.getTotalCacheReadInputTokens();
}

/**
 * 获取总缓存创建令牌数
 */
export function getTotalCacheCreationInputTokens(): number {
  return costTracker.getTotalCacheCreationInputTokens();
}

/**
 * 获取总网络搜索请求数
 */
export function getTotalWebSearchRequests(): number {
  return costTracker.getTotalWebSearchRequests();
}

/**
 * 获取模型使用信息
 */
export function getModelUsage(): Record<string, ModelUsage> {
  return costTracker.getModelUsage();
}

/**
 * 获取指定模型的使用信息
 */
export function getUsageForModel(modelName: string): ModelUsage | undefined {
  return costTracker.getUsageForModel(modelName);
}

/**
 * 是否有未知模型成本
 */
export function hasUnknownModelCost(): boolean {
  return costTracker.hasUnknownModelCost();
}

/**
 * 重置成本跟踪
 */
export function resetCostTracking(): void {
  costTracker.reset();
}

/**
 * 格式化成本报告
 */
export function formatCostReport(detailed: boolean = false): string {
  return costTracker.formatCostReport(detailed);
}

/**
 * 获取模型使用统计
 */
