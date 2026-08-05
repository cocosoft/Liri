/**
 * 分类器管理器
 * 从 AutoModeClassifier.ts 拆分而来，降低文件体积
 */
import { TTLCache } from '@modules/utils/cache';
import { AutoModeClassifier } from './AutoModeClassifier';
import { SpanStatusCode, metrics } from '@opentelemetry/api';
import type { Span, Counter } from '@opentelemetry/api';
import { getOTelTracing } from '@modules/monitoring';
import type {
  IAutoModeClassifier,
  ClassifierDecision,
} from './AutoModeClassifier';

/**
 * 分类器管理器
 * 管理多个分类器的注册和使用
 */
export class ClassifierManager {
  /**
   * 分类器实例
   */
  private classifier: IAutoModeClassifier | null = null;

  /**
   * 分类器缓存（基于标准 TTLCache，自动管理 TTL 过期）
   */
  private cache: TTLCache<ClassifierDecision>;

  /**
   * 分类器配置
   */
  private config = {
    enabled: true,
    cacheEnabled: true,
    cacheTTL: 60000, // 1分钟
  };

  /**
   * OTel 预测结果计数器（惰性初始化；Meter 未就绪时 noop 兜底）
   */
  private classificationCounter: Counter | null = null;

  constructor() {
    this.cache = new TTLCache<ClassifierDecision>(1000, this.config.cacheTTL);
  }

  /**
   * 注册分类器
   * @param classifier 分类器实例
   */
  registerClassifier(classifier: IAutoModeClassifier): void {
    this.classifier = classifier;
  }

  /**
   * 获取分类器
   * @returns 分类器实例
   */
  getClassifier(): IAutoModeClassifier {
    if (!this.classifier) {
      this.classifier = new AutoModeClassifier();
    }
    return this.classifier;
  }

  /**
   * 分类工具使用（Otel 插桩入口：span + 预测计数）
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  async classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }> = []
  ): Promise<ClassifierDecision> {
    // Otel span：每次分类预测可观测（OTel 未初始化时 noop 兜底，不影响主链路）
    let span: Span | null = null;
    try {
      span = getOTelTracing().startSpan('permission.classify', {
        tool: toolName,
      });
    } catch {
      // @ignore-catch: OTel 未初始化时跳过插桩
    }

    try {
      const decision = await this.classifyInner(toolName, input, messages);
      if (span) {
        span.setAttribute('shouldBlock', decision.shouldBlock);
        span.setAttribute('unavailable', String(decision.unavailable ?? false));
        getOTelTracing().endSpan(span, SpanStatusCode.OK);
      }
      this.recordClassification(toolName, decision.shouldBlock);
      return decision;
    } catch (error) {
      if (span) {
        getOTelTracing().recordError(
          span,
          error instanceof Error ? error : new Error(String(error))
        );
        getOTelTracing().endSpan(span, SpanStatusCode.ERROR);
      }
      throw error;
    }
  }

  /**
   * 分类工具使用（内部实现，预测主链路）
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  private async classifyInner(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }> = []
  ): Promise<ClassifierDecision> {
    if (!this.config.enabled) {
      return {
        shouldBlock: false,
        reason: 'Classifier is disabled',
      };
    }

    // 检查缓存（TTLCache 自动处理 TTL 过期）
    const cacheKey = this.getCacheKey(toolName, input);
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    // 使用分类器
    const classifier = this.getClassifier();
    const decision = await classifier.classify(toolName, input, messages);

    // 缓存结果
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, decision);
    }

    return decision;
  }

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean {
    return this.getClassifier().isAllowlistedTool(toolName);
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 确保预测计数器已创建
   */
  private ensureClassificationCounter(): void {
    if (this.classificationCounter) return;
    try {
      this.classificationCounter = metrics
        .getMeter('liri-permission')
        .createCounter('Liri.permission.classifications', {
          description: '分类器预测结果计数（block/pass）',
        });
    } catch {
      // @ignore-catch: metrics 未初始化时不启用计数
    }
  }

  /**
   * 记录分类预测指标（每次预测 +1）
   * @param toolName 工具名称
   * @param shouldBlock 是否建议阻止
   */
  private recordClassification(toolName: string, shouldBlock: boolean): void {
    this.ensureClassificationCounter();
    this.classificationCounter?.add(1, {
      decision: shouldBlock ? 'block' : 'pass',
      tool: toolName,
    });
  }

  /**
   * 启用/禁用分类器
   * @param enabled 是否启用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 启用/禁用缓存
   * @param enabled 是否启用
   */
  setCacheEnabled(enabled: boolean): void {
    this.config.cacheEnabled = enabled;
  }

  /**
   * 获取缓存键
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 缓存键
   */
  private getCacheKey(
    toolName: string,
    input: Record<string, unknown>
  ): string {
    return `${toolName}:${JSON.stringify(input)}`;
  }
}

// 导出单例
export const classifierManager = new ClassifierManager();
