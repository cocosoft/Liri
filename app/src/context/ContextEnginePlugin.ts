/**
 * ContextEnginePlugin — 上下文引擎插件接口
 *
 * P3-6: 对标 hermes-agent ContextEngine ABC。
 * 允许通过 config 切换不同的上下文压缩策略引擎（内置 CompactionOrchestrator / 第三方 LCM 等）。
 */
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'context:enginePlugin' });

/** 上下文压缩请求 */
export interface CompressionRequest {
  sessionId: string;
  messages: unknown[];
  maxTokens: number;
  abortSignal?: AbortSignal;
}

/** 上下文压缩结果 */
export interface CompressionResult {
  compressed: boolean;
  beforeTokens: number;
  afterTokens: number;
  messages: unknown[];
  summary?: string;
  engineName: string;
}

/**
 * P3-6: 上下文引擎插件抽象接口
 */
export interface ContextEnginePlugin {
  readonly name: string;

  /** session 开始时 */
  onSessionStart?(sessionId: string): Promise<void>;

  /** 判断是否应压缩 */
  shouldCompress(currentTokens: number, maxTokens: number, threshold: number): boolean;

  /** 执行压缩 */
  compress(request: CompressionRequest): Promise<CompressionResult>;

  /** 从 API 响应更新内部状态 */
  onResponse?(usage: { inputTokens: number; outputTokens: number }): Promise<void>;

  /** session 结束时 */
  onSessionEnd?(sessionId: string): Promise<void>;

  /** 暴露额外工具 */
  getToolSchemas?: () => Array<{ name: string; description: string; schema: Record<string, unknown> }>;

  /** 处理引擎专用工具调用 */
  handleToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * P3-6: 上下文引擎注册表 — 支持插拔式引擎切换
 */
export class ContextEngineRegistry {
  private engines = new Map<string, ContextEnginePlugin>();
  private activeEngine: string = 'builtin';

  /** 注册引擎 */
  register(engine: ContextEnginePlugin): void {
    this.engines.set(engine.name, engine);
  }

  /** 注销引擎 */
  unregister(name: string): void {
    this.engines.delete(name);
  }

  /** 切换引擎 */
  switchTo(name: string): ContextEnginePlugin {
    const engine = this.engines.get(name);
    if (!engine) throw new Error(`Context engine '${name}' not found`);
    this.activeEngine = name;
    logger.info('contextEngine:switched', { engine: name });
    return engine;
  }

  /** 获取当前活跃引擎 */
  getCurrent(): ContextEnginePlugin | undefined {
    return this.engines.get(this.activeEngine);
  }

  /** 列出所有可用引擎 */
  listAll(): string[] {
    return [...this.engines.keys()];
  }
}
