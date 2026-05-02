/**
 * 反应式压缩实现（基于CC源码）
 * 支持自动触发压缩、阈值检测、断路器模式、进度通知
 */

import type { SessionMessage } from '../../session/models/SessionMessage';
import type { CompactionResult } from './types';
import { roughTokenCountEstimationForMessages } from './utils';

/**
 * 反应式压缩状态（来自CC源码）
 */
export interface ReactiveCompactState {
  /**
   * 是否启用反应式压缩
   */
  enabled: boolean;
  
  /**
   * 连续失败次数
   */
  consecutiveFailures: number;
  
  /**
   * 断路器状态
   */
  circuitBreaker: {
    tripped: boolean;
    tripTime?: Date;
    tripReason?: string;
  };
  
  /**
   * 最后压缩时间
   */
  lastCompactTime?: Date;
  
  /**
   * 压缩统计
   */
  stats: {
    totalCompactions: number;
    successfulCompactions: number;
    failedCompactions: number;
    averageCompressionRatio: number;
  };
}

/**
 * 压缩进度回调（来自CC源码）
 */
export type CompactProgressCallback = (progress: {
  type: 'analysis' | 'summary_generation' | 'artifact_injection' | 'hooks';
  stage: 'start' | 'progress' | 'complete' | 'error';
  progress?: number;
  message?: string;
}) => void;

/**
 * 反应式压缩选项
 */
export interface ReactiveCompactOptions {
  /**
   * 压缩阈值（token数）
   */
  threshold: number;
  
  /**
   * 断路器阈值（连续失败次数）
   */
  circuitBreakerThreshold: number;
  
  /**
   * 断路器重置时间（毫秒）
   */
  circuitBreakerResetTime: number;
  
  /**
   * 最小压缩间隔（毫秒）
   */
  minCompactInterval: number;
  
  /**
   * 进度回调
   */
  onProgress?: CompactProgressCallback;
}

/**
 * 反应式压缩服务类（基于CC源码实现）
 */
export class ReactiveCompactService {
  private states: Map<string, ReactiveCompactState> = new Map();
  private defaultOptions: ReactiveCompactOptions = {
    threshold: 60000, // 60K tokens
    circuitBreakerThreshold: 3,
    circuitBreakerResetTime: 5 * 60 * 1000, // 5分钟
    minCompactInterval: 30 * 1000, // 30秒
  };

  constructor(private compactService: any) {}

  /**
   * 检查是否需要反应式压缩（来自CC源码）
   */
  shouldCompactReactively(
    sessionId: string,
    messages: SessionMessage[],
    model: string,
    options: Partial<ReactiveCompactOptions> = {}
  ): { shouldCompact: boolean; reason: string; tokenCount: number } {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const state = this.getOrCreateState(sessionId);
    
    // 检查断路器状态
    if (this.isCircuitBreakerTripped(state, mergedOptions)) {
      return {
        shouldCompact: false,
        reason: 'Circuit breaker tripped',
        tokenCount: 0,
      };
    }
    
    // 检查最小压缩间隔
    if (this.isWithinMinInterval(state, mergedOptions)) {
      return {
        shouldCompact: false,
        reason: 'Within minimum compact interval',
        tokenCount: 0,
      };
    }
    
    // 计算token数量
    const tokenCount = roughTokenCountEstimationForMessages(messages);
    
    // 检查是否超过阈值
    if (tokenCount <= mergedOptions.threshold) {
      return {
        shouldCompact: false,
        reason: 'Below threshold',
        tokenCount,
      };
    }
    
    return {
      shouldCompact: true,
      reason: 'Above threshold',
      tokenCount,
    };
  }

  /**
   * 执行反应式压缩（来自CC源码）
   */
  async compactReactively(
    sessionId: string,
    messages: SessionMessage[],
    model: string,
    options: Partial<ReactiveCompactOptions> = {}
  ): Promise<{ success: boolean; result?: CompactionResult; error?: string }> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const state = this.getOrCreateState(sessionId);
    
    // 通知压缩开始
    mergedOptions.onProgress?.({
      type: 'analysis',
      stage: 'start',
      message: 'Starting reactive compaction analysis',
    });
    
    try {
      // 分析上下文
      mergedOptions.onProgress?.({
        type: 'analysis',
        stage: 'progress',
        progress: 0.2,
        message: 'Analyzing conversation context',
      });
      
      const analysisResult = this.analyzeContext(messages, model);
      
      mergedOptions.onProgress?.({
        type: 'analysis',
        stage: 'complete',
        progress: 1.0,
        message: 'Context analysis completed',
      });
      
      // 生成摘要
      mergedOptions.onProgress?.({
        type: 'summary_generation',
        stage: 'start',
        message: 'Generating conversation summary',
      });
      
      const compactResult = await this.compactService.compactConversation(
        messages,
        { isAutoCompact: true, model }
      );
      
      mergedOptions.onProgress?.({
        type: 'summary_generation',
        stage: 'complete',
        progress: 1.0,
        message: 'Summary generation completed',
      });
      
      // 注入制品
      mergedOptions.onProgress?.({
        type: 'artifact_injection',
        stage: 'start',
        message: 'Injecting artifacts',
      });
      
      await this.injectArtifacts(sessionId, compactResult);
      
      mergedOptions.onProgress?.({
        type: 'artifact_injection',
        stage: 'complete',
        progress: 1.0,
        message: 'Artifact injection completed',
      });
      
      // 更新状态
      this.updateStateOnSuccess(state, compactResult);
      
      mergedOptions.onProgress?.({
        type: 'hooks',
        stage: 'complete',
        message: 'Reactive compaction completed successfully',
      });
      
      return { success: true, result: compactResult };
      
    } catch (error) {
      // 更新失败状态
      this.updateStateOnFailure(state, error);
      
      mergedOptions.onProgress?.({
        type: 'hooks',
        stage: 'error',
        message: `Reactive compaction failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 分析上下文（来自CC源码）
   */
  private analyzeContext(messages: SessionMessage[], model: string): any {
    const tokenCount = roughTokenCountEstimationForMessages(messages);
    
    return {
      tokenCount,
      messageCount: messages.length,
      model,
      analysisTime: new Date(),
      estimatedCompressionRatio: this.estimateCompressionRatio(messages),
    };
  }

  /**
   * 估计压缩比率（来自CC源码）
   */
  private estimateCompressionRatio(messages: SessionMessage[]): number {
    // 简化实现：基于消息数量和类型估计压缩比率
    const userMessages = messages.filter(m => m.type === 'user');
    const assistantMessages = messages.filter(m => m.type === 'assistant');
    
    const baseRatio = 0.3; // 基础压缩比率
    const userRatio = userMessages.length > 10 ? 0.2 : 0.1;
    const assistantRatio = assistantMessages.length > 10 ? 0.4 : 0.2;
    
    return Math.min(baseRatio + userRatio + assistantRatio, 0.8);
  }

  /**
   * 注入制品（来自CC源码）
   */
  private async injectArtifacts(sessionId: string, compactResult: CompactionResult): Promise<void> {
    // 简化实现：记录制品注入
    // 实际实现应该注入计划、文件、MCP制品等
    console.log(`Injecting artifacts for session ${sessionId}`);
  }

  /**
   * 检查断路器是否触发（来自CC源码）
   */
  private isCircuitBreakerTripped(
    state: ReactiveCompactState,
    options: ReactiveCompactOptions
  ): boolean {
    if (!state.circuitBreaker.tripped) {
      return false;
    }
    
    // 检查是否应该重置断路器
    if (state.circuitBreaker.tripTime) {
      const timeSinceTrip = Date.now() - state.circuitBreaker.tripTime.getTime();
      if (timeSinceTrip >= options.circuitBreakerResetTime) {
        // 重置断路器
        state.circuitBreaker.tripped = false;
        state.circuitBreaker.tripTime = undefined;
        state.circuitBreaker.tripReason = undefined;
        return false;
      }
    }
    
    return true;
  }

  /**
   * 检查是否在最小压缩间隔内（来自CC源码）
   */
  private isWithinMinInterval(
    state: ReactiveCompactState,
    options: ReactiveCompactOptions
  ): boolean {
    if (!state.lastCompactTime) {
      return false;
    }
    
    const timeSinceLastCompact = Date.now() - state.lastCompactTime.getTime();
    return timeSinceLastCompact < options.minCompactInterval;
  }

  /**
   * 成功时更新状态（来自CC源码）
   */
  private updateStateOnSuccess(state: ReactiveCompactState, result: CompactionResult): void {
    state.consecutiveFailures = 0;
    state.lastCompactTime = new Date();
    
    // 更新统计
    state.stats.totalCompactions++;
    state.stats.successfulCompactions++;
    
    if (result.preCompactTokenCount && result.postCompactTokenCount) {
      const ratio = result.postCompactTokenCount / result.preCompactTokenCount;
      state.stats.averageCompressionRatio = 
        (state.stats.averageCompressionRatio * (state.stats.successfulCompactions - 1) + ratio) / 
        state.stats.successfulCompactions;
    }
    
    // 重置断路器
    state.circuitBreaker.tripped = false;
    state.circuitBreaker.tripTime = undefined;
    state.circuitBreaker.tripReason = undefined;
  }

  /**
   * 失败时更新状态（来自CC源码）
   */
  private updateStateOnFailure(state: ReactiveCompactState, error: any): void {
    state.consecutiveFailures++;
    state.stats.totalCompactions++;
    state.stats.failedCompactions++;
    
    // 检查是否触发断路器
    if (state.consecutiveFailures >= this.defaultOptions.circuitBreakerThreshold) {
      state.circuitBreaker.tripped = true;
      state.circuitBreaker.tripTime = new Date();
      state.circuitBreaker.tripReason = `Consecutive failures: ${state.consecutiveFailures}`;
    }
  }

  /**
   * 获取或创建状态
   */
  private getOrCreateState(sessionId: string): ReactiveCompactState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        enabled: true,
        consecutiveFailures: 0,
        circuitBreaker: {
          tripped: false,
        },
        stats: {
          totalCompactions: 0,
          successfulCompactions: 0,
          failedCompactions: 0,
          averageCompressionRatio: 0.3,
        },
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /**
   * 重置会话状态（来自CC源码）
   */
  resetSessionState(sessionId: string): void {
    this.states.delete(sessionId);
  }

  /**
   * 获取会话状态（来自CC源码）
   */
  getSessionState(sessionId: string): ReactiveCompactState | undefined {
    return this.states.get(sessionId);
  }

  /**
   * 启用/禁用反应式压缩（来自CC源码）
   */
  setReactiveCompactEnabled(sessionId: string, enabled: boolean): void {
    const state = this.getOrCreateState(sessionId);
    state.enabled = enabled;
  }
}