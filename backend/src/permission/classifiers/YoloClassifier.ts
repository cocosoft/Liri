/**
 * YOLO分类器
 * AI自动审批安全操作的分类器
 * 参考CC源码 cc_code/backend/utils/permissions/yoloClassifier.ts 实现
 */

import { logger } from '../../utils/log';

/**
 * 分类结果
 */
export interface YoloClassifierResult {
  /** 是否允许 */
  allowed: boolean;
  /** 分类决策：allow/soft_deny/deny */
  decision: 'allow' | 'soft_deny' | 'deny';
  /** 决策理由 */
  reason?: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入 */
  toolInput: Record<string, unknown>;
  /** 使用的模型 */
  model?: string;
  /** 输入token数 */
  inputTokens?: number;
  /** 输出token数 */
  outputTokens?: number;
  /** 执行耗时 */
  durationMs?: number;
  /** 缓存读取的token数 */
  cacheReadInputTokens?: number;
}

/**
 * 分类器配置
 */
export interface YoloClassifierConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 模型名称 */
  model: string;
  /** 温度参数 */
  temperature: number;
  /** 最大输出token */
  maxTokens: number;
  /** 缓存TTL（毫秒） */
  cacheTtlMs: number;
  /** 只读工具白名单 */
  readonlyTools: string[];
  /** 危险工具黑名单 */
  dangerousTools: string[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: YoloClassifierConfig = {
  enabled: true,
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.1,
  maxTokens: 1024,
  cacheTtlMs: 60000,
  readonlyTools: ['read', 'View', 'search', 'list', 'cat', 'pwd', 'echo', 'help', 'info', 'status', 'version', 'whoami', 'ls', 'dir', 'find', 'grep', 'head', 'tail'],
  dangerousTools: ['Write', 'edit', 'delete', 'remove', 'exec', 'run', 'shell', 'bash', 'sudo', 'chmod', 'chown'],
};

/**
 * 缓存条目
 */
interface CacheEntry {
  result: YoloClassifierResult;
  timestamp: number;
}

/**
 * 分类请求
 */
interface ClassificationRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  transcript: string;
}

/**
 * YOLO分类器
 * 使用AI模型自动判断工具使用是否安全
 */
export class YoloClassifier {
  private config: YoloClassifierConfig;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(config: Partial<YoloClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 分类工具使用
   */
  async classify(
    toolName: string,
    toolInput: Record<string, unknown>,
    messages: Array<{ role: string; content: string | unknown }> = []
  ): Promise<YoloClassifierResult> {
    if (!this.config.enabled) {
      return this.createDefaultResult(toolName, toolInput, true, 'classifier_disabled');
    }

    // 检查只读工具白名单
    if (this.isReadonlyTool(toolName)) {
      return this.createDefaultResult(toolName, toolInput, true, 'readonly_tool');
    }

    // 检查危险工具黑名单
    if (this.isDangerousTool(toolName)) {
      return this.createDefaultResult(toolName, toolInput, false, 'dangerous_tool');
    }

    // 检查缓存
    const cacheKey = this.getCacheKey(toolName, toolInput, messages);
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      logger.debug(`YoloClassifier cache hit for ${toolName}`);
      return cached;
    }

    // 执行分类
    const startTime = Date.now();
    try {
      const result = await this.performClassification(toolName, toolInput, messages);
      result.durationMs = Date.now() - startTime;

      // 缓存结果
      this.setCachedResult(cacheKey, result);

      return result;
    } catch (error) {
      logger.error('YoloClassifier error:', error);
      return this.createDefaultResult(toolName, toolInput, true, 'error');
    }
  }

  /**
   * 检查是否为只读工具
   */
  isReadonlyTool(toolName: string): boolean {
    const lowerName = toolName.toLowerCase();
    return this.config.readonlyTools.some(t => lowerName === t.toLowerCase());
  }

  /**
   * 检查是否为危险工具
   */
  isDangerousTool(toolName: string): boolean {
    const lowerName = toolName.toLowerCase();
    return this.config.dangerousTools.some(t => lowerName === t.toLowerCase());
  }

  /**
   * 获取缓存键
   */
  private getCacheKey(
    toolName: string,
    toolInput: Record<string, unknown>,
    messages: Array<{ role: string; content: string | unknown }>
  ): string {
    const inputStr = JSON.stringify(toolInput);
    const msgHash = this.hashMessages(messages);
    return `${toolName}:${inputStr}:${msgHash}`;
  }

  /**
   * 哈希消息
   */
  private hashMessages(messages: Array<{ role: string; content: string | unknown }>): string {
    const content = messages.map(m => `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('|');
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 获取缓存结果
   */
  private getCachedResult(key: string): YoloClassifierResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.config.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * 设置缓存结果
   */
  private setCachedResult(key: string, result: YoloClassifierResult): void {
    // 限制缓存大小
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * 执行分类
   */
  private async performClassification(
    toolName: string,
    toolInput: Record<string, unknown>,
    messages: Array<{ role: string; content: string | unknown }>
  ): Promise<YoloClassifierResult> {
    const transcript = this.buildTranscript(messages);

    const request: ClassificationRequest = {
      toolName,
      toolInput,
      transcript,
    };

    const prompt = this.buildPrompt(request);

    try {
      const response = await this.callModel(prompt);

      return this.parseResponse(toolName, toolInput, response);
    } catch (error) {
      logger.error('Model call failed:', error);
      throw error;
    }
  }

  /**
   * 构建转录内容
   */
  private buildTranscript(messages: Array<{ role: string; content: string | unknown }>): string {
    return messages.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${m.role}]: ${content}`;
    }).join('\n');
  }

  /**
   * 构建提示词
   */
  private buildPrompt(request: ClassificationRequest): string {
    return `You are a security classifier for tool usage.

Tool: ${request.toolName}
Input: ${JSON.stringify(request.toolInput, null, 2)}

Recent conversation:
${request.transcript || '(empty)'}

Classify this tool usage as: allow, soft_deny, or deny.

Rules:
- allow: Tool is safe to execute, read-only operation or no risk
- soft_deny: Tool has some risk, user should confirm but can auto-approve with notice
- deny: Tool is dangerous or malicious, should always block

Respond in JSON format:
{"decision": "allow|soft_deny|deny", "reason": "explanation"}`;
  }

  /**
   * 调用模型
   */
  private async callModel(prompt: string): Promise<string> {
    // 这里需要集成LLMClient进行实际调用
    // 简化实现返回默认结果
    logger.warn('YoloClassifier: LLM client not integrated, using rule-based fallback');

    return JSON.stringify({
      decision: 'allow',
      reason: 'Rule-based fallback: LLM not available',
    });
  }

  /**
   * 解析响应
   */
  private parseResponse(
    toolName: string,
    toolInput: Record<string, unknown>,
    response: string
  ): YoloClassifierResult {
    try {
      const parsed = JSON.parse(response);
      return {
        allowed: parsed.decision === 'allow',
        decision: parsed.decision,
        reason: parsed.reason,
        toolName,
        toolInput,
        model: this.config.model,
      };
    } catch {
      return this.createDefaultResult(toolName, toolInput, true, 'parse_error');
    }
  }

  /**
   * 创建默认结果
   */
  private createDefaultResult(
    toolName: string,
    toolInput: Record<string, unknown>,
    allowed: boolean,
    reason: string
  ): YoloClassifierResult {
    return {
      allowed,
      decision: allowed ? 'allow' : 'deny',
      reason,
      toolName,
      toolInput,
      model: 'rule-based',
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<YoloClassifierConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): YoloClassifierConfig {
    return { ...this.config };
  }

  /**
   * 设置启用状态
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

/**
 * 导出单例
 */
export const yoloClassifier = new YoloClassifier();
