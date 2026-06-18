/**
 * 分类器管理器
 * 从 AutoModeClassifier.ts 拆分而来，降低文件体积
 */
import { TTLCache } from '@modules/utils/cache';
import { AutoModeClassifier } from './AutoModeClassifier';
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
   * 分类工具使用
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
