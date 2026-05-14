import { delegateCompactionToRuntime } from './delegate.js';
import type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  IngestResult,
} from './types.js';

/**
 * LegacyContextEngine 将现有压缩行为包装在 ContextEngine 接口背后，
 * 保持 100% 向后兼容。
 *
 * - ingest: 空操作（SessionManager 处理消息持久化）
 * - assemble: 直通（返回原始消息 + 粗略 Token 估算）
 * - compact: 委托给 delegateCompactionToRuntime
 */
export class LegacyContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: 'legacy',
    name: 'Legacy Context Engine',
    version: '1.0.0',
  };

  async ingest(_params: {
    sessionId: string;
    sessionKey?: string;
    message: unknown;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    return { ingested: false };
  }

  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: unknown[];
    tokenBudget?: number;
    availableTools?: Set<string>;
    model?: string;
  }): Promise<AssembleResult> {
    return {
      messages: params.messages,
      estimatedTokens: 0,
    };
  }

  async afterTurn(_params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: unknown[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
  }): Promise<void> {
    // 空操作：legacy 流程直接在 SessionManager 中持久化上下文
  }

  async compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: 'budget' | 'threshold';
    customInstructions?: string;
  }): Promise<CompactResult> {
    return delegateCompactionToRuntime(params);
  }
}
