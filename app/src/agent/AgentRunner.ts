/**
 * Agent子系统增强
 * 子代理类型、后台运行、进度追踪、摘要、群组执行
 */
import { randomUUID } from 'crypto';
import { AgentSwarmManager, SwarmTask, SwarmResult } from './swarms';
import { feature } from '../core/featureFlags';
import { configManager } from '@modules/config';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

export type SubagentType =
  | 'general-purpose'
  | 'code-review'
  | 'test-writer'
  | 'custom';

export type AgentModel = 'sonnet' | 'opus' | 'haiku';

export type AgentIsolation = 'worktree' | 'remote' | 'none';

export type AgentState =
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
  isolation?: AgentIsolation;
  cwd?: string;
}

export interface AgentProgress {
  agentId: string;
  state: AgentState;
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
  state: AgentState;
}

export interface AgentResult {
  agentId: string;
  content: string;
  state: AgentState;
  summary: AgentSummary;
  progress: AgentProgress;
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
    state: AgentState = 'completed'
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
  model: 'haiku' as AgentModel,
};
