/**
 * Agent子系统增强
 * 子代理类型、后台运行、进度追踪、摘要、群组执行
 */
import { randomUUID } from 'crypto';
import { AgentSwarmManager, SwarmTask, SwarmResult } from './swarms';
import { feature } from '../core/featureFlags';
import { configManager } from '@modules/config';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { EffectScope } from '@modules/context';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent/AgentRunner');

export type SubagentType =
  | 'general-purpose'
  | 'code-review'
  | 'test-writer'
  | 'custom';

export type AgentModel = string; // 模型 ID，由配置/模型体系提供（DB 为唯一事实来源，禁止硬编码模型名）

export type AgentIsolationMode = 'worktree' | 'remote' | 'none';

export type AgentRunnerState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'background';

export interface AgentTaskInput {
  description: string;
  prompt: string;
  subagentType?: SubagentType;
  model?: AgentModel;
  runInBackground?: boolean;
  isolation?: AgentIsolationMode;
  cwd?: string;
}

export interface AgentProgress {
  agentId: string;
  state: AgentRunnerState;
  progress: number;
  message: string;
  startTime: number;
  estimatedTokens?: number;
}

export interface AgentSummary {
  agentId: string;
  task: string;
  result: string;
  durationMs: number;
  tokensUsed: number;
  costUSD: number;
  state: AgentRunnerState;
}

export interface SwarmExecutionResult {
  results: SwarmResult[];
  summary: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalDurationMs: number;
  };
}

const PROGRESS_THRESHOLD_MS = 2000;
const AUTO_BACKGROUND_MS = 120_000;

export class AgentRunner {
  private activeAgents: Map<string, AgentProgress> = new Map();
  private agentSummaries: AgentSummary[] = [];
  private swarmManager?: AgentSwarmManager;

  constructor() {
    // 仅在AGENT_SWARMS功能启用时创建SwarmManager
    if (feature('AGENT_SWARMS')) {
      this.swarmManager = new AgentSwarmManager();
    }
  }

  createProgress(
    agentId: string,
    message: string = 'Starting...'
  ): AgentProgress {
    const progress: AgentProgress = {
      agentId,
      state: 'pending',
      progress: 0,
      message,
      startTime: Date.now(),
    };
    this.activeAgents.set(agentId, progress);
    return progress;
  }

  updateProgress(
    agentId: string,
    update: Partial<AgentProgress>
  ): AgentProgress | null {
    const p = this.activeAgents.get(agentId);
    if (!p) return null;
    Object.assign(p, update);
    return p;
  }

  createSummary(
    agentId: string,
    task: string,
    result: string,
    tokensUsed: number = 0,
    costUSD: number = 0,
    state: AgentRunnerState = 'completed'
  ): AgentSummary {
    const progress = this.activeAgents.get(agentId);
    const durationMs = progress ? Date.now() - progress.startTime : 0;

    const summary: AgentSummary = {
      agentId,
      task,
      result: result.substring(0, 500),
      durationMs,
      tokensUsed,
      costUSD,
      state,
    };
    this.agentSummaries.push(summary);
    this.activeAgents.delete(agentId);
    return summary;
  }

  shouldAutoBackground(agentId: string): boolean {
    const p = this.activeAgents.get(agentId);
    if (!p || p.state !== 'running') return false;
    return Date.now() - p.startTime > AUTO_BACKGROUND_MS;
  }

  isBackgroundTasksDisabled(): boolean {
    return configManager.env('Liri_DISABLE_BACKGROUND_TASKS') === 'true';
  }

  getActiveCount(): number {
    return this.activeAgents.size;
  }

  getSummaries(): AgentSummary[] {
    return [...this.agentSummaries];
  }

  generateAgentId(): string {
    return `agent_${randomUUID().substring(0, 8)}`;
  }

  /**
   * T1.2：创建 Agent 执行副作用作用域。
   * 调用方将资源（临时文件/子进程/订阅）通过 scope.onDispose() 登记，
   * 执行结束（或中断）时调用 scope.dispose() 统一按 LIFO 释放。
   * 返回 scope 本体，AgentCleanup 或 AgentIsolation 辅助函数负责登记标准资源。
   */
  createExecutionScope(): EffectScope {
    return new EffectScope();
  }

  /**
   * 执行Agent群组任务
   * @param tasks 群组任务列表
   * @param options 执行选项
   * @returns 群组执行结果
   */
  async executeSwarm(
    tasks: SwarmTask[],
    options: { parallel?: boolean; timeoutMs?: number } = {}
  ): Promise<SwarmExecutionResult> {
    if (!this.swarmManager) {
      throw new AppError(
        'Agent Swarms feature is not enabled',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const startTime = Date.now();
    const results = await this.swarmManager.execute(tasks, options);
    const totalDurationMs = Date.now() - startTime;

    const completedTasks = results.filter((r) => r.success).length;
    const failedTasks = results.filter((r) => !r.success).length;

    return {
      results,
      summary: {
        totalTasks: tasks.length,
        completedTasks,
        failedTasks,
        totalDurationMs,
      },
    };
  }

  /**
   * 检查群组功能是否可用
   */
  isSwarmEnabled(): boolean {
    return this.swarmManager !== undefined;
  }
}

export const GENERAL_PURPOSE_AGENT = {
  type: 'general-purpose' as SubagentType,
  description: 'General purpose subagent for task delegation',
  model: '' as AgentModel, // 空 = 走模型体系 fallback（resolveModelRoute），不硬编码
};
